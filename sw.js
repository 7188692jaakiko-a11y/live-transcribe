// 画面一式を端末に置いておき、電波の弱い場所でもすぐ開けるようにする
// (文字への変換そのものは、多くの端末で通信が必要)
const CACHE = 'lt-v5';
const SHARE = 'lt-share';   // 共有で受け取った文字の一時置き場
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'points.js', 'import.js', 'manifest.webmanifest',
               'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// 新しい版があればそれを使い、つながらないときだけ端末の控えを使う
// ほかのアプリの「共有」から届いた文字を控えておき、画面を開いて取り込ませる
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'POST' || !new URL(e.request.url).pathname.endsWith('/share-target')) return;
  e.respondWith((async () => {
    const form = await e.request.formData();
    let text = form.get('text') || '';
    const file = form.get('file');
    if (file && typeof file !== 'string') text = [text, await file.text()].filter(Boolean).join('\n');
    const cache = await caches.open(SHARE);
    await cache.put('shared', new Response(JSON.stringify({ title: form.get('title') || '', text }),
      { headers: { 'content-type': 'application/json' } }));
    return Response.redirect('./?shared=1', 303);
  })());
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
