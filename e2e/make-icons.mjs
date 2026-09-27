// 生成应用图标：绿色田字格里一个楷体“字”
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const font = readFileSync(new URL("../fonts/FandolKai.woff2", import.meta.url)).toString("base64");
const svg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100">
<rect width="100" height="100" fill="#fffefa"/>
<g stroke="#3a9a5b" fill="none"><rect x="14" y="14" width="72" height="72" stroke-width="3"/>
<path d="M50 14V86M14 50H86" stroke-width="1.6" stroke-dasharray="4 3"/></g>
<text x="50" y="${50 + 58 * 0.31}" font-size="58" text-anchor="middle" font-family="K" fill="#1d1d1f">字</text></svg>`;
const b = await chromium.launch(); const p = await b.newPage();
for (const s of [180, 192, 512]) {
  await p.setViewportSize({ width: s, height: s });
  await p.setContent(`<style>@font-face{font-family:K;src:url(data:font/woff2;base64,${font})}body{margin:0}</style>${svg(s)}`);
  await p.evaluate(() => document.fonts.load("20px K", "字"));
  await p.screenshot({ path: `icons/icon-${s}.png` });
}
await b.close();
