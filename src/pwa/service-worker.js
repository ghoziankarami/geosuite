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

const SCOPE_PATH = new URL(self.registration.scope).pathname;
const CACHE_VERSION = 'geosuite-app-v4:' + SCOPE_PATH;
const inScope = url => url.pathname.startsWith(SCOPE_PATH);
const shellURL = rel => new URL(rel, self.registration.scope).href;
const APP_SHELL = [
  './Core.html',
  './Assay.html',
  './Resource.html',
  './vendor/plotly.min.js',
  './vendor/jspdf.umd.min.js',
  './vendor/html2canvas.min.js',
  './vendor/jszip.min.js',
  './manifest.webmanifest',
  './pwa/icon-192.png',
  './pwa/icon-512.png',
  './pwa/icon-maskable-512.png',
  './pwa/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => Promise.all(
      APP_SHELL.map(rel => { const url = shellURL(rel); return fetch(url, { cache: 'reload' })
        .then(async res => (await cacheable(url,res) ? cache.put(url, res) : null))
        .catch(() => null); })
    )).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n.startsWith('geosuite-app-') && (n.endsWith(':' + SCOPE_PATH) || (SCOPE_PATH === '/' && n === 'geosuite-app-v3')) && n !== CACHE_VERSION).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function isModulePage(url) {
  return /\/(Core|Assay|Resource)\.html$/.test(url.pathname);
}

function isStaticAsset(url) {
  const rel = url.pathname.slice(SCOPE_PATH.length);
  return rel.startsWith('vendor/') || rel.startsWith('pwa/') ||
         rel === 'manifest.webmanifest';
}

// Never replace a working offline app with a login redirect, error page or wrong asset.
async function cacheable(request, res) {
  if (!res || !res.ok || res.type==='opaque' || res.redirected) return false;
  const url=new URL(typeof request==='string'?request:request.url);
  if(res.url && new URL(res.url).origin!==url.origin)return false;
  const type=res.headers.get('content-type')||'';
  if(isModulePage(url))return type.includes('text/html') && /window\.OREBIT_BUILD_ID=/.test((await res.clone().text()).slice(0,6000));
  if(url.pathname.endsWith('.js'))return /javascript/.test(type);
  if(url.pathname.endsWith('.png'))return type.includes('image/png');
  return !type.includes('text/html');
}
function unavailablePage(request) {
  // No user data is cleared. Static recovery still works if no app JS can load.
  const url=new URL(request.url);const phase=url.pathname.match(/(Core|Assay|Resource)\.html$/)?.[1]||'Core';
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GeoSuite · reconnect</title><body style="font:16px system-ui;max-width:42rem;margin:10vh auto;padding:24px;line-height:1.6"><h1>GeoSuite is not available offline yet</h1><p>Connect to the internet and reopen ${phase} so its app files can be saved. Your project storage has not been cleared.</p><p lang="id">Sambungkan internet lalu buka kembali aplikasi agar file offline tersimpan. Penyimpanan proyek Anda tidak dihapus.</p><button onclick="location.reload()" style="padding:12px 24px;font:inherit">Retry / Coba lagi</button></body></html>`,{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}
async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  let hit=await cache.match(request,{ignoreSearch:true});
  if(hit&&!await cacheable(request,hit))hit=null;
  const controller=new AbortController();
  const timer=hit?setTimeout(()=>controller.abort(),8000):null;
  try {
    const res = await fetch(request,{signal:controller.signal});
    if (await cacheable(request,res)) await cache.put(request, res.clone());
    // Keep authentication/authorization responses visible. Only transient server failure uses cache.
    if((res.status>=500||res.status===408)&&hit)return hit;
    return res;
  } catch (e) {
    return hit || unavailablePage(request);
  } finally {if(timer)clearTimeout(timer);}
}
async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(request, { ignoreSearch: true });
  const refresh = fetch(request)
    .then(async res => { if (await cacheable(request,res)) await cache.put(request, res.clone()); return res; })
    .catch(() => null);
  // Keep background revalidation alive even after the cached response is returned.
  event.waitUntil(refresh.then(()=>undefined));
  return hit || (await refresh) || Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.origin !== self.location.origin || !inScope(url)) return;

  if (isModulePage(url)) {
    event.respondWith(networkFirst(request));
  } else if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request,event));
  }
  // Everything else (landing page, docs, images) goes to the network as usual.
});
