/* AvPlay+ service worker – offline app shell */
var CACHE = 'avplay-plus-v3';
var ASSETS = [
  './', './index.html', './manifest.webmanifest', './icon.svg',
  './css/app.css', './css/extra.css', './hls.min.js',
  './js/data.js', './js/ltx.js', './js/core.js',
  './js/subtitles.js', './js/player.js', './js/search.js',
  './js/adblock_data.js', './js/app.js', './js/extra.js'
];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never proxy cross-origin API calls
  // Network-first: always try the live site so CSS/JS updates appear immediately.
  // Fall back to cache when offline so the installed app still works.
  e.respondWith(
    fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || (req.mode === 'navigate' ? caches.match('./index.html') : null);
      });
    })
  );
});
