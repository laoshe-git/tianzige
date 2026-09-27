// 把 hanzi-writer-data（笔画轮廓 + 中线）和 cnchar-order（笔画名称）合并，按码位分 64 片
// 输出 data/strokes/00.json … 63.json：{ 字: { s: [轮廓], m: [中线], n: [笔画名] } }
// 笔画数对不上的字不写名称（n 为空），界面上只显示“第几笔”。
// 运行：node tools/build-strokes.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const cnchar = require("cnchar");
cnchar.use(require("cnchar-order"));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules", "hanzi-writer-data");
const out = path.join(root, "data", "strokes");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// ---------- 笔画名称校正 ----------
// cnchar 对几类笔画只有一个代码，这里按笔画走向或所属部件区分，并修正已知错误。
const XIE_GOU_HORIZONTAL = new Set("飞枫风疯讽凤凰飘汛讯迅虱氨氮氛氟氦氯氖氢氰氧气汽".split(""));  // ⺄ 读横斜钩，其余读横折弯钩
// 竖弯（㇄ 圆转）只出现在含 四 / 西 / 酉 / 匹 的字里，其余 ㇄ 都是竖折
const SHU_WAN_FAMILY = /[四西酉匹洒晒栖硒牺茜哂粞舾恓泗驷酬醇醋奠蹲酚酣酱酵酒酷酪酶醚酿配酋醛酥酸酞酮醒酗酝蘸酌醉遵尊樽撙鳟酊酩醺醴酯酐酰醌醅醪醮醯酽酾酤]/;
const ER_FAMILY = /[尔你您称弥迩玺猕祢]/;   // 尔的第二笔是横钩（字体里钩画得偏长）
const YA_FAMILY = new Set("牙芽呀雅鸦讶伢邪穿蚜砑琊迓".split(""));          // 牙的第二笔是竖折

const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const dirDeg = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; // y 向上

// 横钩 vs 横撇：拐点（最右点）之后的长度 / 横的长度，横钩≈0.2，横撇≥0.45
function hookRatio(m) {
  let ci = 0; m.forEach((p, i) => { if (p[0] > m[ci][0]) ci = i; });
  let h = 0, t = 0;
  for (let i = 1; i < m.length; i++) (i <= ci ? (h += len(m[i - 1], m[i])) : (t += len(m[i - 1], m[i])));
  return t / Math.max(h, 1);
}
// 竖折 vs 竖弯：从“朝下”变到“朝右”之间过渡段的长度，竖折≈0（直角），竖弯是圆弧
function bendSpan(m) {
  let lastDown = -1, firstRight = -1;
  for (let i = 1; i < m.length; i++) {
    const a = dirDeg(m[i - 1], m[i]);
    if (Math.abs(a + 90) <= 20) lastDown = i;
    if (lastDown >= 0 && Math.abs(a) <= 20) { firstRight = i; break; }
  }
  if (lastDown < 0 || firstRight < 0) return 0;
  let span = 0;
  for (let i = lastDown + 1; i < firstRight; i++) span += len(m[i - 1], m[i]);
  return span;
}

function fixNames(ch, names, shapes, medians) {
  const out = names.map((n, i) => {
    const alt = n.split("|"), m = medians[i];
    if (n === "横撇|横钩") return hookRatio(m) < 0.35 || (ER_FAMILY.test(ch) && names.indexOf(n) === i) ? "横钩" : "横撇";
    if (n === "斜钩|卧钩") return !/[贰腻]/.test(ch) && /^点/.test(names[i - 1] || "") && /^点/.test(names[i + 1] || "") ? "卧钩" : "斜钩";   // 心、必：前后都是点
    if (n === "横折折|横折弯") return "横折弯";
    if (shapes[i] === "⺄") return XIE_GOU_HORIZONTAL.has(ch) ? "横斜钩" : "横折弯钩";
    if (shapes[i] === "㇄") return SHU_WAN_FAMILY.test(ch) && bendSpan(m) > 15 ? "竖弯" : "竖折";
    return alt[0].replace(/\d+$/, "");
  });
  // 虫：竖、横折、横、竖、提、点（第五笔是提）
  for (let i = 0; i + 5 < shapes.length; i++) {
    if (shapes.slice(i, i + 6).join("") === "丨𠃍一丨一丶" && /[虫蚀蚂蚁蚊蚌蚓蚕蚜蚤蚣蚪蛀蛆蛇蛊蛋蛙蛛蛤蛮蛰蛹蛾蜀蜂蜓蜕蜗蜘蜜蜡蜻蝇蝉蝎蝗蝙蝠蝴蝶蝌螃螟融螺蟀蟋蟹蠕蠢虹虾虻虽强茧独浊烛触蚯蚱蛔蛐蜒蜈蜥蜴蝈蝗蝓蝮螂螨蟑蟒]/.test(ch))
      out[i + 4] = "提";
  }
  if (YA_FAMILY.has(ch)) { const k = names.indexOf("撇折"); if (k >= 0) out[k] = "竖折"; }
  return out;
}

export const SHARDS = 64;
const shards = Array.from({ length: SHARDS }, () => ({}));
let total = 0, named = 0;
const mismatch = [];

for (const f of readdirSync(src)) {
  if (!f.endsWith(".json") || f === "package.json") continue;
  const ch = f.slice(0, -5);
  if (Array.from(ch).length !== 1) continue;
  const d = JSON.parse(readFileSync(path.join(src, f), "utf8"));
  let names = [];
  try {
    const r = cnchar.stroke(ch, "order", "name")[0];
    const shapes = cnchar.stroke(ch, "order", "shape")[0];
    if (Array.isArray(r) && r.length === d.strokes.length) names = fixNames(ch, r.map(String), shapes.map(String), d.medians);
    else if (Array.isArray(r)) names = r;
  } catch { /* 没有名称数据 */ }
  if (names.length === d.strokes.length) named++;
  else { if (names.length) mismatch.push(`${ch}(${d.strokes.length}/${names.length})`); names = []; }
  shards[ch.codePointAt(0) % SHARDS][ch] = { s: d.strokes, m: d.medians, n: names };
  total++;
}

// 校验：人工确认过的常用字笔画名称
const EXPECT = {
  山: "竖 竖折 竖", 出: "竖折 竖 竖 竖折 竖", 四: "竖 横折 撇 竖弯 横", 西: "横 竖 横折 撇 竖弯 横",
  画: "横 竖 横折 横 竖 横 竖折 竖", 母: "竖折 横折钩 点 横 点", 心: "点 卧钩 点 点", 必: "点 卧钩 点 撇 点",
  我: "撇 横 竖钩 提 斜钩 撇 点", 代: "撇 竖 横 斜钩 点", 九: "撇 横折弯钩", 几: "撇 横折弯钩",
  飞: "横斜钩 撇 点", 风: "撇 横斜钩 撇 点", 气: "撇 横 横 横斜钩", 虫: "竖 横折 横 竖 提 点",
  牙: "横 竖折 竖钩 撇", 学: "点 点 撇 点 横钩 横撇 竖钩 横", 宝: "点 点 横钩 横 横 竖 横 点",
  又: "横撇 捺", 了: "横撇 竖钩", 子: "横撇 竖钩 横", 永: "点 横折钩 横撇 撇 捺", 小: "竖钩 撇 点",
  火: "点 撇 撇 捺", 女: "撇点 撇 横", 地: "横 竖 提 横折钩 竖 竖弯钩", 你: "撇 竖 撇 横钩 竖钩 撇 点",
  没: "点 点 提 撇 横折弯 横撇 捺", 口: "竖 横折 横", 马: "横折 竖折折钩 横", 乙: "横折弯钩",
  吃: "竖 横折 横 撇 横 横折弯钩", 蚂: "竖 横折 横 竖 提 点 横折 竖折折钩 横", 感: "横 撇 横 竖 横折 横 斜钩 撇 点 点 卧钩 点 点", 称: "撇 横 竖 撇 点 撇 横钩 竖钩 撇 点",
};
const all = Object.assign({}, ...shards);
const bad = Object.entries(EXPECT).filter(([c, e]) => all[c]?.n.join(" ") !== e).map(([c, e]) => `${c}: 得到「${all[c]?.n.join(" ")}」应为「${e}」`);
console.log(bad.length ? "笔画名称校验未通过：\n" + bad.join("\n") : `笔画名称校验通过（${Object.keys(EXPECT).length} 字）`);

shards.forEach((s, i) => writeFileSync(path.join(out, `${String(i).padStart(2, "0")}.json`), JSON.stringify(s)));
writeFileSync(path.join(out, "mismatch.txt"), mismatch.join(" "));
console.log(`字数 ${total}，带笔画名称 ${named}，笔画数不一致 ${mismatch.length}（见 data/strokes/mismatch.txt）`);
