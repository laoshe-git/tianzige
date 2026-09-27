// 升级检查：模拟“iPad 上已经装着旧版本”，把网站换成新版本后：
//   1. 新的离线缓存接管，旧缓存删掉；
//   2. 旧缓存里已经下载好的笔顺数据挪进新缓存，不重新下载；
//   3. 再次打开就是新版本，断网照常能用。
// 用法：node e2e/upgrade.mjs <旧版本的 git 提交号>    （Chromium；产物 e2e/out/upgrade-report.json）
import { chromium } from "playwright";
import { execSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const oldRef = process.argv[2] || "HEAD";
const oldDir = mkdtempSync(path.join(os.tmpdir(), "tzg-old-"));
execSync(`git archive ${oldRef} | tar -x -C "${oldDir}"`, { cwd: root });

const PORT = 8950 + Math.floor(Math.random() * 40);
const URL = `http://localhost:${PORT}/`;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve(dir) {
  const p = spawn("python3", ["-m", "http.server", String(PORT), "--directory", dir], { stdio: ["ignore", "ignore", "pipe"] });
  let log = ""; p.stderr.on("data", (d) => { log += d; });
  return { p, log: () => log };
}
async function up() { for (let i = 0; i < 60; i++) { try { await fetch(URL); return; } catch { await sleep(100); } } throw new Error("server down"); }
async function down() { for (let i = 0; i < 60; i++) { try { await fetch(URL); await sleep(100); } catch { return; } } }

let srv = serve(oldDir); await up();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 834, height: 1194 } });
const page = await ctx.newPage();
const cacheInfo = () => page.evaluate(async () => {
  const out = {};
  for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).filter((r) => r.url.includes("/data/strokes/")).length;
  return out;
});
async function poll(fn, ms = 60000) { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v.ok) return v; await sleep(500); } return v; }

try {
  await page.goto(URL);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  const before = await poll(async () => { const c = await cacheInfo(); return { ok: Object.values(c).some((n) => n === 64), c }; });
  check(`旧版本（${oldRef}）装好，64 片笔顺数据已缓存`, before.ok, JSON.stringify(before.c));
  check("旧版本没有“自由练习”（确认测的确实是旧版本）", !(await page.$("#practiceBtn")));

  srv.p.kill(); await down();
  srv = serve(root); await up();
  await page.reload();                         // 旧版本从缓存打开，同时后台发现新版本
  const after = await poll(async () => {
    const c = await cacheInfo(), ks = Object.keys(c).sort().join(",");
    return { ok: ks === "tianzige-core-v3,tianzige-strokes-v1" && c["tianzige-strokes-v1"] === 64, c };
  });
  check("新版本接管：旧缓存删掉，笔顺数据挪进新缓存（64 片）", after.ok, JSON.stringify(after.c));
  const shardGets = (srv.log().match(/"GET \/data\/strokes\//g) || []).length;
  check("升级时没有重新下载笔顺数据", shardGets === 0, `下载了 ${shardGets} 片`);

  await page.reload();
  await page.waitForSelector("#practiceBtn", { timeout: 10000 });
  check("再次打开就是新版本（有“自由练习”）", true);

  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector("html[data-fonts=ready]", { timeout: 10000 });
  await page.fill("#input", "永");
  await page.click("#practiceBtn");
  await page.waitForFunction(() => document.getElementById("prPage").dataset.ch === "永", null, { timeout: 10000 });
  const glyph = await page.$$eval("#prTplLayer .glyph path", (x) => x.length);
  check("升级后断网：自由练习能打开，“永”的字形来自已缓存的笔顺数据", glyph === 5, `笔画 ${glyph}`);
} catch (e) {
  check("升级检查流程未中断", false, String(e));
} finally {
  await browser.close(); srv.p.kill();
  mkdirSync(path.join(root, "e2e", "out"), { recursive: true });
  const passed = results.filter((r) => r.ok).length;
  writeFileSync(path.join(root, "e2e", "out", "upgrade-report.json"), JSON.stringify({ oldRef, passed, total: results.length, results }, null, 2));
  console.log(`\n${passed}/${results.length} 通过`);
  process.exit(passed === results.length ? 0 : 1);
}
