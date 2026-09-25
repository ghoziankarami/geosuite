// Orebit GeoSuite service worker — makes the web build an installable,
// fully offline app (macOS: Safari "Add to Dock" or Chrome/Edge "Install";
// also Linux, ChromeOS, Windows). Source of truth: src/pwa/ (copied to dist/ by
// build/build.mjs and to the web root by deploy-geosuite.py).
//
// Replaces obsidian-system/.../_meta/service-worker.js (2026-09-25), which
// cached the module pages under their pre-2026-08 URLs (/try-p2/, /try-p3/)
// and so never cached Core/Assay/Resource at all: "offline" only held for the
// vendor libraries, and those were cache-first forever (updates never arrived).
//
// Strategy:
//   install  — precache the app shell: all three modules, their vendor
//              libraries, the manifest and icons. Tolerant of a missing file
//              (one 404 must not leave the app with no offline copy at all).
//   module pages / navigations — network first (a new release reaches you the
//              next time you are online), cached copy when offline.
//   vendor, icons, manifest — stale-while-revalidate.
// Bump CACHE_VERSION only to force every client to re-download the shell.

const CACHE_VERSION = 'geosuite-app-v3';
const APP_SHELL = [
  '/Core.html',
  '/Assay.html',
  '/Resource.html',
  '/vendor/plotly.min.js',
  '/vendor/jspdf.umd.min.js',
  '/vendor/html2canvas.min.js',
  '/vendor/jszip.min.js',
  '/manifest.webmanifest',
  '/pwa/icon-192.png',
  '/pwa/icon-512.png',
  '/pwa/icon-maskable-512.png',
  '/pwa/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => Promise.all(
      APP_SHELL.map(url => fetch(url, { cache: 'reload' })
        .then(res => (res.ok ? cache.put(url, res) : null))
        .catch(() => null))
    )).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE_VERSION).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function isModulePage(url) {
  return /\/(Core|Assay|Resource)\.html$/.test(url.pathname);
}

function isStaticAsset(url) {
  return url.pathname.includes('/vendor/') || url.pathname.startsWith('/pwa/') ||
         url.pathname === '/manifest.webmanifest';
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    // ?source=app and other query strings must still find the cached module.
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    throw e;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(request, { ignoreSearch: true });
  const refresh = fetch(request)
    .then(res => { if (res && res.ok) cache.put(request, res.clone()); return res; })
    .catch(() => null);
  return hit || (await refresh) || Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  if (isModulePage(url)) {
    event.respondWith(networkFirst(request));
  } else if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
  // Everything else (landing page, docs, images) goes to the network as usual.
});
