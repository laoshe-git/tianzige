// 离线缓存：改了任何文件就把版本号加一
const CACHE = "tianzige-v2";
const CORE = ["./", "index.html", "manifest.webmanifest", "vendor/pinyin-pro.js", "vendor/hanzi-writer.js", "js/strokes.js",
  "data/digits.json", "fonts/FandolKai.woff2", "fonts/Andika-pinyin.woff2",
  "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];
const SHARDS = Array.from({ length: 64 }, (_, i) => `data/strokes/${String(i).padStart(2, "0")}.json`);

self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  const ks = await caches.keys();
  await Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
  await self.clients.claim();
  // 笔顺数据（约 30MB）在后台慢慢下载，不耽误打开
  const c = await caches.open(CACHE);
  for (const url of SHARDS) {
    if (await c.match(url)) continue;
    try { const r = await fetch(url); if (r.ok) await c.put(url, r); } catch { /* 下次再补 */ }
  }
})()));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    const r = await fetch(e.request);
    if (r.ok && new URL(e.request.url).origin === location.origin) (await caches.open(CACHE)).put(e.request, r.clone());
    return r;
  })());
});
