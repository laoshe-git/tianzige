// 离线缓存，分两份：
//   程序文件（CORE_CACHE）：改了任何程序文件就把版本号加一；
//   笔顺数据（DATA_CACHE，约 30MB）：只有重新生成 data/strokes 时才加一，平时升级不用重新下载。
const CORE_CACHE = "tianzige-core-v3";
const DATA_CACHE = "tianzige-strokes-v1";
const CORE = ["./", "index.html", "manifest.webmanifest", "vendor/pinyin-pro.js", "vendor/hanzi-writer.js",
  "js/strokes.js", "js/practice.js", "data/digits.json", "fonts/FandolKai.woff2", "fonts/Andika-pinyin.woff2",
  "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];
const SHARDS = Array.from({ length: 64 }, (_, i) => `data/strokes/${String(i).padStart(2, "0")}.json`);
const isData = (url) => url.includes("/data/strokes/");

self.addEventListener("install", (e) => e.waitUntil((async () => {
  const c = await caches.open(CORE_CACHE);
  // cache: "reload" 绕过浏览器的 HTTP 缓存，确保拿到的是新版本文件
  await c.addAll(CORE.map((u) => new Request(u, { cache: "reload" })));
  await self.skipWaiting();
})()));

self.addEventListener("activate", (e) => e.waitUntil((async () => {
  const data = await caches.open(DATA_CACHE);
  for (const name of await caches.keys()) {
    if (name === CORE_CACHE || name === DATA_CACHE) continue;
    // 旧版本缓存里已经下好的笔顺数据挪过来，不重新下载
    const old = await caches.open(name);
    for (const req of await old.keys()) {
      if (isData(req.url) && !(await data.match(req))) await data.put(req, await old.match(req));
    }
    await caches.delete(name);
  }
  await self.clients.claim();
  // 笔顺数据在后台慢慢下载，不耽误打开
  for (const url of SHARDS) {
    if (await data.match(url)) continue;
    try { const r = await fetch(url); if (r.ok) await data.put(url, r); } catch { /* 下次再补 */ }
  }
})()));

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    const r = await fetch(e.request);
    if (r.ok && new URL(e.request.url).origin === location.origin)
      (await caches.open(isData(e.request.url) ? DATA_CACHE : CORE_CACHE)).put(e.request, r.clone());
    return r;
  })());
});
