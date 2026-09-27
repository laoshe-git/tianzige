// 端到端测试：用 WebKit（iPad Safari 同内核）模拟 iPad 操作整个应用。
// 运行：node e2e/run.mjs      产物：e2e/out/*.png + e2e/out/report.json
// 测线上：BASE_URL=https://laoshe-git.github.io/tianzige/ node e2e/run.mjs
import { webkit, chromium, devices } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PNG } from "pngjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "e2e", "out");
mkdirSync(out, { recursive: true });

const PORT = 8790 + Math.floor(Math.random() * 100);
const server = spawn("python3", ["-m", "http.server", String(PORT), "--directory", root], { stdio: "ignore" });
const BASE = process.env.BASE_URL;
const URL = BASE || `http://127.0.0.1:${PORT}/`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

async function waitServer() {
  for (let i = 0; i < 50; i++) {
    try { await fetch(URL); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("server did not start");
}

const pinyins = (page) => page.$$eval("#sheet .cell", (gs) =>
  gs.map((g) => ({ i: +g.dataset.i, py: g.querySelector(".py")?.textContent ?? null, fixed: g.classList.contains("fixed") })));

async function setText(page, text) {
  await page.fill("#input", text);
  await page.waitForTimeout(100);
}

// 截取某个格子（拼音区 + 田字格）并返回像素与几何信息
async function cellPixels(page, index, scale) {
  const geo = await page.$eval(`#sheet .cell[data-i="${index}"] rect`, (r) => {
    const b = r.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  });
  const buf = await page.screenshot({ clip: { x: geo.x, y: geo.y, width: geo.w, height: geo.h } });
  const png = PNG.sync.read(buf);
  return { geo, png, scale };
}

// 深色墨迹（排除绿色格线）的包围盒，坐标换算回 CSS px，相对格子左上角
function inkBox({ png, scale }, y0css, y1css) {
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  const ys = Math.floor(y0css * scale), ye = Math.min(png.height, Math.ceil(y1css * scale));
  for (let y = ys; y < ye; y++) for (let x = 0; x < png.width; x++) {
    const k = (y * png.width + x) * 4;
    const r = png.data[k], g = png.data[k + 1], b = png.data[k + 2];
    if (Math.max(r, g, b) < 110) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { left: minX / scale, right: (maxX + 1) / scale, top: minY / scale, bottom: (maxY + 1) / scale };
}

await waitServer();
const browser = await webkit.launch();
const iPad = devices["iPad Pro 11"];
const scale = iPad.deviceScaleFactor;
const ctx = await browser.newContext({ ...iPad });
// 语音替身：记录要说的话，并很快结束，免得测试等朗读
await ctx.addInitScript(() => {
  window.__utter = [];
  const fake = { speak: (u) => { window.__utter.push(u.text); setTimeout(() => u.onend && u.onend(), 30); },
                 cancel() {}, getVoices: () => [], onvoiceschanged: null };
  Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true });
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

try {
  await page.goto(URL);
  await page.waitForSelector("html[data-fonts=ready]", { timeout: 15000 });
  await page.screenshot({ path: path.join(out, "01-默认.png"), fullPage: true });
  check("首次打开显示示例古诗，字体加载完成", (await pinyins(page)).length > 0);

  // 1. 多音字按词语上下文注音
  const text = "银行行走，长大很长。\n一个不对，好吗？好了。女床装";
  await setText(page, text);
  const expect = { 0: "yín", 1: "háng", 2: "xíng", 3: "zǒu", 5: "zhǎng", 6: "dà", 7: "hěn", 8: "cháng",
                   11: "yí", 12: "gè", 13: "bú", 14: "duì", 16: "hǎo", 17: "ma", 19: "hǎo", 20: "le",
                   22: "nǚ", 23: "chuáng", 24: "zhuāng" };
  const got = Object.fromEntries((await pinyins(page)).map((c) => [c.i, c.py]));
  const wrong = Object.entries(expect).filter(([i, py]) => got[i] !== py).map(([i, py]) => `${Array.from(text)[i]}:${got[i]}≠${py}`);
  check("多音字与变调注音正确（银行/行走、长大/很长、一个/不对、了）", wrong.length === 0, wrong.join(" "));
  check("标点和换行不注拼音", got[4] === null && got[15] === null && got[10] === undefined);
  await page.screenshot({ path: path.join(out, "02-多音字.png"), fullPage: true });

  // 2. 关闭变调后显示本调
  await page.tap("#sandhi");
  const noSandhi = Object.fromEntries((await pinyins(page)).map((c) => [c.i, c.py]));
  check("关闭“一、不”变调后显示本调 yī / bù", noSandhi[11] === "yī" && noSandhi[13] === "bù", `${noSandhi[11]} ${noSandhi[13]}`);
  await page.tap("#sandhi");

  // 3. 长拼音不溢出格子
  const overflow = await page.$$eval("#sheet .cell", (gs) => gs.filter((g) => {
    const t = g.querySelector(".py"); if (!t) return false;
    const cell = g.querySelector("rect").getBoundingClientRect(), b = t.getBoundingClientRect();
    return b.left < cell.left - 0.5 || b.right > cell.right + 0.5;
  }).map((g) => g.querySelector(".py").textContent));
  check("长拼音（chuáng / zhuāng）压缩在本格内", overflow.length === 0, overflow.join(","));

  // 4. 像素级：汉字居中、拼音落在四线三格正确位置
  await page.fill("#size", "160"); await page.dispatchEvent("#size", "input");
  await setText(page, "田国好吗好了女");
  await page.waitForTimeout(150);
  const size = 160, b = size / 6, top = b * 3 + size * 0.12;
  for (const [i, ch] of [[0, "田"], [1, "国"]]) {
    const px = await cellPixels(page, i, scale);
    const ink = inkBox(px, top + 3, top + size - 3);
    const dx = (ink.left + ink.right) / 2 - size / 2, dy = (ink.top + ink.bottom) / 2 - (top + size / 2);
    check(`“${ch}”在田字格正中（偏差 ≤ 3%）`, Math.abs(dx) <= size * 0.03 && Math.abs(dy) <= size * 0.03,
          `dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} 字宽占格 ${(100 * (ink.right - ink.left) / size).toFixed(0)}%`);
  }
  {
    const px = await cellPixels(page, 3, scale);          // 吗 → ma（轻声，无声调符号）
    const ink = inkBox(px, 0, b * 3 + 1);
    check("“ma”正好占中格（第二线到第三线）", Math.abs(ink.top - b) <= b * 0.08 && Math.abs(ink.bottom - 2 * b) <= b * 0.1,
          `top=${ink.top.toFixed(1)} 应≈${b.toFixed(1)}  bottom=${ink.bottom.toFixed(1)} 应≈${(2 * b).toFixed(1)}`);
  }
  {
    const px = await cellPixels(page, 5, scale);          // 了 → le：l 占上中格
    const ink = inkBox(px, 0, b * 3 + 1);
    check("“le”的 l 伸进上格但不出第一线", ink.top > 0 && ink.top < b * 0.7 && Math.abs(ink.bottom - 2 * b) <= b * 0.06,
          `top=${ink.top.toFixed(1)} bottom=${ink.bottom.toFixed(1)}`);
  }
  {
    const px = await cellPixels(page, 6, scale);          // 女 → nǚ：两点加声调仍在第一线以内
    const ink = inkBox(px, 0, b * 3 + 1);
    check("“nǚ”的 ü 点和声调不出第一线", ink.top >= -0.5, `top=${ink.top.toFixed(1)}`);
  }
  await page.screenshot({ path: path.join(out, "03-大格子像素检查.png"), fullPage: true });

  // 5. 改读音（从笔顺页进入）、自定义输入、刷新后保留、续写文字时保留
  async function openFix(i) {
    await page.tap(`#sheet .cell[data-i="${i}"]`);
    await page.waitForSelector("#spPage:not([hidden])");
    await page.tap("#spFix");
  }
  const back = () => page.tap("#spBack");
  await page.fill("#size", "96"); await page.dispatchEvent("#size", "input");
  await setText(page, "朝阳");
  await openFix(0);
  const cands = await page.$$eval("#popCands button", (bs) => bs.map((x) => x.textContent));
  check("点“朝”→改读音，弹出候选读音", cands.includes("zhāo") && cands.includes("cháo"), cands.join(" / "));
  await page.screenshot({ path: path.join(out, "04-改读音弹窗.png") });
  await page.tap('#popCands button:text-is("zhāo")');
  await back();
  let cells = await pinyins(page);
  check("选择 zhāo 后更新并标橙色", cells[0].py === "zhāo" && cells[0].fixed);
  await page.reload();
  await page.waitForSelector("html[data-fonts=ready]");
  cells = await pinyins(page);
  check("刷新后手动读音仍保留", cells[0].py === "zhāo" && cells[0].fixed);
  await page.type("#input", "升起");
  cells = await pinyins(page);
  check("在后面续写文字，前面改过的读音不丢", cells[0].py === "zhāo" && cells.length === 4, cells.map((c) => c.py).join(" "));

  await openFix(1);
  await page.fill("#popInput", "lve4");
  await page.tap("#popOk");
  await back();
  cells = await pinyins(page);
  check("自定义输入 lve4 转成 lüè", cells[1].py === "lüè", cells[1].py);
  await openFix(1);
  await page.tap("#popReset");
  await back();
  cells = await pinyins(page);
  check("恢复自动读音", cells[1].py === "yáng" && !cells[1].fixed, cells[1].py);

  // 6. 练习模式与格子类型
  await setText(page, "我爱学习");
  await page.tap('#segMode button[data-v="hideHan"]');
  let n = await page.$$eval("#sheet .cell", (gs) => gs.map((g) => g.querySelectorAll("text").length));
  check("看拼音写字：只有拼音没有汉字", n.every((k) => k === 1) && (await page.$$eval("#sheet .py", (x) => x.length)) === 4);
  await page.screenshot({ path: path.join(out, "05-看拼音写字.png"), fullPage: true });
  await page.tap('#segMode button[data-v="hidePy"]');
  check("看字写拼音：只有汉字没有拼音", (await page.$$eval("#sheet .py", (x) => x.length)) === 0);
  await page.tap('#segMode button[data-v="all"]');
  await page.tap('#segPinyin button[data-v="0"]');
  await page.tap('#segGrid button[data-v="mi"]');
  await page.tap('#colors .swatch[data-c="#d8453b"]');
  const lines = await page.$eval("#sheet svg", (s) => ({ py: s.querySelectorAll(".py").length, stroke: s.querySelector("g").getAttribute("stroke"),
                                                        lines: s.querySelectorAll("line").length }));
  check("切换为红色米字格、无拼音", lines.py === 0 && lines.stroke === "#d8453b", JSON.stringify(lines));
  await page.screenshot({ path: path.join(out, "06-红色米字格.png"), fullPage: true });

  // 7. 横屏布局
  await page.setViewportSize({ width: iPad.viewport.height, height: iPad.viewport.width });
  await page.tap('#segPinyin button[data-v="1"]');
  await page.tap('#segGrid button[data-v="tian"]');
  await page.tap('#colors .swatch[data-c="#3a9a5b"]');
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload(); await page.waitForSelector("html[data-fonts=ready]");
  await setText(page, "床前明月光，疑是地上霜。\n举头望明月，低头思故乡。");
  await page.screenshot({ path: path.join(out, "07-横屏-静夜思.png"), fullPage: true });
  const rows = await page.$$eval("#sheet svg", (s) => s.length);
  check("横屏下一行放得下一句诗", rows === 2, `rows=${rows}`);
  await page.setViewportSize(iPad.viewport);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, "08-竖屏-静夜思.png"), fullPage: true });
  check("竖屏下自动缩小格子，也是一句一行", (await page.$$eval("#sheet svg", (s) => s.length)) === 2);
  await page.fill("#size", "140"); await page.dispatchEvent("#size", "input");
  const manualRows = await page.$$eval("#sheet svg", (s) => s.length);
  await page.tap("#sizeAuto");
  const autoRows = await page.$$eval("#sheet svg", (s) => s.length);
  check("拖大格子会折行，点“自动”恢复", manualRows > 2 && autoRows === 2, `manual=${manualRows} auto=${autoRows}`);


  // 9. 数字页
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForSelector("html[data-fonts=ready]");
  await page.tap('#tabs button[data-v="num"]');
  const numInfo = await page.$$eval("#sheet .cell", (gs) => gs.map((g) => ({ d: g.querySelectorAll(".digit path").length, r: g.querySelector(".rhyme")?.textContent })));
  check("数字页显示 0–9 共 10 个数字，每个带儿歌", numInfo.length === 10 && numInfo.every((x) => x.d >= 1 && x.r), numInfo.map((x) => x.r).join(" "));
  check("数字页隐藏拼音相关按钮", !(await page.isVisible("#segPinyin")) && !(await page.isVisible("#sandhi")));
  {
    const size = await page.$eval('#sheet .cell[data-i="0"] rect', (r) => r.getBoundingClientRect().width);
    const px = await cellPixels(page, 0, scale);
    const ink = inkBox(px, 3, size - 3);
    const dx = (ink.left + ink.right) / 2 - size / 2, dy = (ink.top + ink.bottom) / 2 - size / 2;
    check("数字“0”在田字格正中", Math.abs(dx) <= size * 0.03 && Math.abs(dy) <= size * 0.03, `dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} 高占格 ${(100 * (ink.bottom - ink.top) / size).toFixed(0)}%`);
  }
  await page.screenshot({ path: path.join(out, "10-数字页.png"), fullPage: true });

  const utter = () => page.evaluate(() => window.__utter.slice());
  const clearUtter = () => page.evaluate(() => { window.__utter = []; });
  const sp = () => page.evaluate(() => { const c = TZ.StrokePage.state(); return c && { ch: c.ch, n: c.n, cur: c.cur, mode: c.mode }; });
  const steps = () => page.$$eval("#spSteps .sp-step span", (x) => x.map((t) => t.textContent));
  const waitCur = (k) => page.waitForFunction((k) => TZ.StrokePage.state()?.cur === k, k, { timeout: 20000 });

  // 10. 数字 4 的笔顺：两笔、逐笔语音、起笔点
  await clearUtter();
  await page.tap('#sheet .cell[data-i="4"]');
  await page.waitForSelector("#spPage:not([hidden])");
  check("点数字 4 打开笔顺页，儿歌显示并朗读", (await page.textContent("#spRhyme")) === "4像小旗迎风飘" && (await utter()).includes("4像小旗迎风飘"));
  check("数字 4 分两笔：斜折、竖", JSON.stringify(await steps()) === JSON.stringify(["1 斜折", "2 竖"]), (await steps()).join(","));
  await clearUtter();
  await page.tap("#spNext");
  await waitCur(1);
  const dot = await page.$eval("#spOverlay .sp-start circle", (c) => ({ cx: +c.getAttribute("cx"), cy: +c.getAttribute("cy") })).catch(() => null);
  check("第一笔：语音口令正确，并标出起笔绿点", (await utter()).includes("第一笔，从上往左下斜，再向右写横。") && dot, JSON.stringify(dot));
  await page.screenshot({ path: path.join(out, "11-数字4第一笔.png") });
  await page.tap("#spNext"); await waitCur(2);
  check("第二笔后写完", (await utter()).includes("第二笔，从上往下写竖。"));
  await page.tap("#spBack");

  // 描一描：按 1 的中线从上往下写 → 通过；从下往上写 → 提示
  async function strokePts(i) {
    return page.evaluate((i) => {
      const c = TZ.StrokePage.state(), st = document.getElementById("spStage").getBoundingClientRect();
      const T = TZ.dataTransform(st.left, st.top, c.S, c.pad);
      return c.data.m[i].map(T.pt);
    }, i);
  }
  async function drag(pts) {
    await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
    for (let k = 1; k < pts.length; k++) {
      const [a, b] = [pts[k - 1], pts[k]];
      for (let t = 1; t <= 4; t++) await page.mouse.move(a[0] + (b[0] - a[0]) * t / 4, a[1] + (b[1] - a[1]) * t / 4);
    }
    await page.mouse.up(); await page.waitForTimeout(250);
  }
  await page.tap('#sheet .cell[data-i="1"]');
  await page.waitForSelector("#spPage:not([hidden])");
  await page.tap("#spTrace");
  await page.waitForTimeout(300);
  await clearUtter();
  const one = await strokePts(0);
  await drag([...one].reverse());
  check("描一描：1 从下往上写会被提示", (await page.textContent("#spSay")).includes("从绿点开始"), await page.textContent("#spSay"));
  await drag(one);
  await page.waitForFunction(() => document.getElementById("spPage").dataset.done === "trace", null, { timeout: 5000 }).catch(() => {});
  check("描一描：1 从上往下写，完成并表扬", (await page.getAttribute("#spPage", "data-done")) === "trace", await page.textContent("#spSay"));
  await page.screenshot({ path: path.join(out, "12-数字1描一描.png") });
  await page.tap("#spBack");

  // 11. 汉字“永”：笔画名称、看一看、描一描、点分解图
  await page.tap('#tabs button[data-v="han"]');
  await setText(page, "永朝");
  await page.tap('#sheet .cell[data-i="0"]');
  await page.waitForSelector("#spPage:not([hidden])");
  await page.waitForFunction(() => TZ.StrokePage.state()?.n === 5);
  check("“永”笔顺分解：点、横折钩、横撇、撇、捺", JSON.stringify(await steps()) === JSON.stringify(["1 点", "2 横折钩", "3 横撇", "4 撇", "5 捺"]), (await steps()).join(","));
  check("笔顺页显示拼音 yǒng、共 5 笔", (await page.textContent("#spPy")) === "yǒng" && (await page.textContent("#spCount")) === "共 5 笔");
  await clearUtter();
  await page.tap("#spPlay");
  await page.waitForFunction(() => document.getElementById("spPage").dataset.done === "play", null, { timeout: 30000 });
  const u = await utter();
  check("看一看：逐笔朗读“第一笔，点”…“第五笔，捺”，最后说一共五笔",
        ["第一笔，点", "第二笔，横折钩", "第三笔，横撇", "第四笔，撇", "第五笔，捺"].every((t) => u.includes(t)) && u.some((t) => t.includes("一共五笔")), u.join(" / "));
  await page.screenshot({ path: path.join(out, "13-永-看一看.png") });

  await page.tap('#spSteps .sp-step[data-k="2"]');
  await waitCur(3);
  check("点分解图第 3 格：前两笔直接出现，演示第三笔", (await sp()).cur === 3 && (await utter()).includes("第三笔，横撇"));

  await page.tap("#spTrace"); await page.waitForTimeout(300);
  for (let i = 0; i < 5; i++) { await drag(await strokePts(i)); }
  await page.waitForFunction(() => document.getElementById("spPage").dataset.done === "trace", null, { timeout: 5000 }).catch(() => {});
  check("描一描“永”：按笔顺描完 5 笔得到表扬", (await page.getAttribute("#spPage", "data-done")) === "trace" && (await page.textContent("#spSay")).includes("真棒"),
        await page.textContent("#spSay"));
  await page.screenshot({ path: path.join(out, "14-永-描一描.png") });
  await page.tap("#spBack");

  // 12. 笔顺页里改读音
  await page.tap('#sheet .cell[data-i="1"]');
  await page.waitForSelector("#spPage:not([hidden])");
  await page.tap("#spFix");
  await page.tap('#popCands button:text-is("zhāo")');
  const mainPy = (await pinyins(page))[1];
  check("在笔顺页改“朝”为 zhāo，页面和格子同步更新", (await page.textContent("#spPy")) === "zhāo" && mainPy.py === "zhāo" && mainPy.fixed);
  await page.tap("#spBack");

  // 13. 横屏笔顺页布局
  await page.setViewportSize({ width: iPad.viewport.height, height: iPad.viewport.width });
  await setText(page, "我");
  await page.tap('#sheet .cell[data-i="0"]');
  await page.waitForSelector("#spPage:not([hidden])");
  await page.tap("#spNext"); await waitCur(1); await page.tap("#spNext"); await waitCur(2);
  const stage = await page.$eval("#spStage", (e) => e.getBoundingClientRect());
  const side = await page.$eval(".sp-side", (e) => e.getBoundingClientRect());
  check("横屏：格子在左、按钮在右，都在屏幕内", side.left >= stage.right && stage.bottom <= iPad.viewport.width, `stage ${Math.round(stage.width)} side.left ${Math.round(side.left)}`);
  await page.screenshot({ path: path.join(out, "15-横屏-我-笔顺.png") });
  await page.tap("#spBack");
  await page.setViewportSize(iPad.viewport);

  // 8. 断网可用（Service Worker 需要安全来源，用 localhost 打开）
  {
    const cb = await chromium.launch();   // Playwright 的 WebKit 不支持模拟断网，这一项用 Chromium
    const c2 = await cb.newContext({ viewport: iPad.viewport, deviceScaleFactor: 2 });
    const p2 = await c2.newPage();
    await p2.goto(BASE || `http://localhost:${PORT}/`);
    await p2.waitForSelector("html[data-fonts=ready]");
    await p2.evaluate(async () => { await navigator.serviceWorker.ready; });
    // 等后台把 64 片笔顺数据都缓存好
    let cached = 0;
    for (let t = 0; t < 120 && cached < 64; t++) {
      cached = await p2.evaluate(async () => (await (await caches.open("tianzige-v2")).keys()).filter((r) => r.url.includes("/data/strokes/")).length);
      if (cached < 64) await p2.waitForTimeout(500);
    }
    check("后台缓存全部 64 片笔顺数据", cached === 64, `cached=${cached}`);
    await c2.setOffline(true);
    await p2.reload();
    await p2.waitForSelector("html[data-fonts=ready]", { timeout: 10000 });
    await p2.fill("#input", "离线也能用");
    const py = await p2.$$eval("#sheet .py", (x) => x.map((t) => t.textContent).join(" "));
    check("断网后重新打开仍能出拼音和格子（Chromium）", py === "lí xiàn yě néng yòng", py);
    await p2.click('#sheet .cell[data-i="0"]');
    await p2.waitForSelector("#spPage:not([hidden])", { timeout: 5000 }).catch(() => {});
    const n = await p2.evaluate(() => TZ.StrokePage.state()?.n);
    check("断网后笔顺页也能打开（“离”10 笔）", n === 10, `n=${n}`);
    await p2.screenshot({ path: path.join(out, "09-断网.png") });
    await cb.close();
  }

  check("页面无脚本错误", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("测试流程未中断", false, String(e));
} finally {
  await browser.close();
  server.kill();
  const passed = results.filter((r) => r.ok).length;
  writeFileSync(path.join(out, "report.json"), JSON.stringify({ engine: "webkit", device: "iPad Pro 11", url: URL, passed, total: results.length, results }, null, 2));
  console.log(`\n${passed}/${results.length} 通过，截图与报告在 e2e/out/`);
  process.exit(passed === results.length ? 0 : 1);
}
