// "Install app" button — the macOS answer for an open-source GeoSuite
// (docs/PLAN-opensource-dan-excellence.md, 2026-09-25). Classic script, no
// export -- inlined into all three phases by build/build.mjs.
//
// The Desktop EXE is Windows-only. On a Mac (and Linux, ChromeOS, Windows) the
// web build installs as its own app instead: src/pwa/manifest.webmanifest +
// service-worker.js precache all three modules, so after one install the app
// opens from the Dock / app launcher and works with no connection. No code
// signing, no Gatekeeper warning, updates arrive on the next online launch.
//
// Chrome/Edge fire `beforeinstallprompt`; the button replays it. Safari has no
// such event -- on a Mac the button explains File → Add to Dock (macOS 14+).
// Hidden in the Desktop EXE (window.__OREBIT_RT__) and when already running as
// an installed app.

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var deferredPrompt = null;
  var btn = null;

  function isInstalledApp() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  }
  function isMacSafari() {
    var ua = window.navigator.userAgent || '';
    return /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|Firefox\//.test(ua);
  }
  function text(key, fallback) {
    try {
      if (typeof t === 'function') { var s = t(key); if (s && s !== key) return s; }
    } catch (e) { /* phase i18n not ready yet */ }
    return fallback;
  }
  function tell(msg) {
    if (typeof toast === 'function') toast(msg, 'info'); else window.alert(msg);
  }

  function ensureButton() {
    if (btn || window.__OREBIT_RT__ || isInstalledApp()) return btn;
    var anchor = document.querySelector('[data-desktop-cta]');
    if (!anchor || !anchor.parentNode) return null;
    btn = document.createElement('a');
    btn.href = '#';
    btn.className = 'orebit-link';
    btn.setAttribute('data-install-app', '');
    btn.setAttribute('data-i18n', 'app.install');
    btn.setAttribute('data-i18n-attr', 'title:app.installTitle');
    btn.title = text('app.installTitle', 'Install GeoSuite as an app on this computer (Mac, Windows, Linux). Works offline.');
    btn.textContent = text('app.install', 'Install app');
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (deferredPrompt) {
        var p = deferredPrompt;
        deferredPrompt = null;
        p.prompt();
        if (p.userChoice) p.userChoice.then(function (c) { if (c && c.outcome === 'accepted' && btn) btn.hidden = true; });
      } else if (isMacSafari()) {
        tell(text('app.installSafari', 'In Safari: File → Add to Dock (macOS 14 or later). GeoSuite then opens as its own app and works offline.'));
      } else {
        tell(text('app.installUnsupported', 'This browser cannot install apps. Use Safari (macOS 14+), Chrome or Edge, then choose Install / Add to Dock.'));
      }
    });
    anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    return btn;
  }

  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault();
    deferredPrompt = ev;
    if (document.readyState !== 'loading') ensureButton();
  });
  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    if (btn) btn.hidden = true;
  });
  // Window/title-bar colour of the installed app follows the brand token
  // (--orebit-teal, light and dark), never a hardcoded hex (test_theme_consistency).
  function syncThemeColor() {
    try {
      var c = getComputedStyle(document.documentElement).getPropertyValue('--orebit-teal').trim();
      if (!c) return;
      var m = document.querySelector('meta[name="theme-color"]');
      if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
      m.content = c;
    } catch (e) { /* cosmetic only */ }
  }
  function onReady() {
    syncThemeColor();
    try {
      new MutationObserver(syncThemeColor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    } catch (e) { /* cosmetic only */ }
    // Safari never fires beforeinstallprompt, so offer the instructions there;
    // Chrome/Edge show the button once the browser says the app is installable.
    if (deferredPrompt || isMacSafari()) ensureButton();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();
})();
