/* 汽修管家 - Service Worker（PWA 离线支持占位） */
/* 当前仅用于消除浏览器控制台 404 报错 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  /* 不拦截任何请求，由浏览器默认处理 */
});
