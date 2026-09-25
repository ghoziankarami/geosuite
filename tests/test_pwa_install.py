#!/usr/bin/env python3
"""The web build installs as an offline app — GeoSuite's macOS/Linux route.

Added 2026-09-25 (docs/PLAN-opensource-dan-excellence.md). The Desktop EXE is
Windows-only; everyone else installs the web build (Safari "Add to Dock",
Chrome/Edge "Install"). This checks, in Chromium, against dist/ + vendor/
served from its own root exactly as the web root is laid out:

  1. the manifest parses and Chromium reports the app as installable
     (CDP Page.getInstallabilityErrors == []);
  2. the service worker precaches the whole app shell on install;
  3. with the network OFF, all three modules open and load their sample data;
  4. the "Install app" button replays the browser's install prompt;
  5. the button never appears inside the Desktop EXE (window.__OREBIT_RT__).

Before this, the deployed service worker cached the module pages under their
pre-2026-08 URLs (/try-p2/, /try-p3/), i.e. never: offline held for the vendor
libraries only, and there was no manifest, so nothing was installable.

Needs: node build/build.mjs already run (dist/), Playwright + Chromium.
Starts its own HTTP server on a free port; no other server required.
"""

import functools
import http.server
import shutil
import socket
import sys
import tempfile
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

PASSED = FAILED = 0


def check(name, ok, detail=""):
    global PASSED, FAILED
    if ok:
        PASSED += 1
        print(f"  ✅ {name}")
    else:
        FAILED += 1
        print(f"  ❌ {name}  {detail}")


def repo_root() -> Path:
    for p in Path(__file__).resolve().parents:
        if (p / "build" / "build.mjs").exists():
            return p
    raise SystemExit("repo root not found")


def vendor_dir(root: Path) -> Path:
    for c in (root / "vendor", root / "exe-wrapper" / "pywebview" / "vendor"):
        if (c / "plotly.min.js").exists():
            return c
    raise SystemExit("vendor/ not found")


def serve(directory: Path):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    handler = functools.partial(Quiet, directory=str(directory))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://localhost:{port}"


SHELL = ["/Core.html", "/Assay.html", "/Resource.html", "/vendor/plotly.min.js", "/vendor/jspdf.umd.min.js",
         "/vendor/html2canvas.min.js", "/vendor/jszip.min.js", "/manifest.webmanifest", "/pwa/icon-192.png",
         "/pwa/icon-512.png", "/pwa/icon-maskable-512.png", "/pwa/apple-touch-icon.png"]


def main():
    root = repo_root()
    dist = root / "dist"
    if not (dist / "Core.html").exists() or not (dist / "manifest.webmanifest").exists():
        print("FATAL: run `node build/build.mjs` first (dist/ has no Core.html or manifest)")
        return 2
    site = Path(tempfile.mkdtemp(prefix="pwa-site-"))
    for f in ("Core.html", "Assay.html", "Resource.html", "manifest.webmanifest", "service-worker.js"):
        shutil.copy2(dist / f, site / f)
    shutil.copytree(dist / "pwa", site / "pwa")
    shutil.copytree(vendor_dir(root), site / "vendor")
    httpd, base = serve(site)

    with sync_playwright() as p:
        br = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
        ctx = br.new_context()
        pg = ctx.new_page()

        print("\n── Manifest and installability ──")
        pg.goto(f"{base}/Core.html", wait_until="load", timeout=90000)
        pg.wait_for_function("() => navigator.serviceWorker && navigator.serviceWorker.controller", timeout=60000)
        cdp = ctx.new_cdp_session(pg)
        man = cdp.send("Page.getAppManifest")
        check("manifest found and parsed without errors", man.get("url", "").endswith("/manifest.webmanifest")
              and not man.get("errors"), str(man.get("errors"))[:200])
        errs = cdp.send("Page.getInstallabilityErrors").get("installabilityErrors", [])
        check("Chromium reports the app as installable", errs == [], str(errs)[:300])

        print("\n── Service worker precache ──")
        deadline = time.time() + 60
        cached = []
        while time.time() < deadline:
            cached = pg.evaluate("""async (shell) => { const c = await caches.open('geosuite-app-v3');
                const out = []; for (const u of shell) if (await c.match(u)) out.push(u); return out; }""", SHELL)
            if len(cached) == len(SHELL):
                break
            time.sleep(1)
        missing = sorted(set(SHELL) - set(cached))
        check("the whole app shell is precached (3 modules, vendor, manifest, icons)", not missing, f"missing={missing}")

        print("\n── Offline ──")
        ctx.set_offline(True)
        for mod, ready_js in (("Core", "() => typeof STATE !== 'undefined' && STATE.assay && STATE.assay.length > 0"),
                              ("Assay", "() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length > 0"),
                              ("Resource", "() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length > 0")):
            op = ctx.new_page()
            try:
                op.goto(f"{base}/{mod}.html?source=app", wait_until="load", timeout=60000)
                op.wait_for_function(ready_js, timeout=60000)
                plotly = op.evaluate("typeof Plotly !== 'undefined'")
                check(f"offline: {mod} opens with its sample data and Plotly", plotly)
            except Exception as e:  # noqa: BLE001 -- the failure text is the finding
                check(f"offline: {mod} opens with its sample data and Plotly", False, str(e).splitlines()[0][:200])
            op.close()
        ctx.set_offline(False)

        print("\n── Install button ──")
        pg.reload(wait_until="load")
        pg.wait_for_function("() => typeof showTab === 'function'", timeout=60000)
        pg.evaluate("""() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted = true; };
            e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); }""")
        btn = pg.locator("[data-install-app]")
        check("the browser's install event shows an 'Install app' button", btn.count() == 1 and btn.is_visible())
        if btn.count():
            btn.click()
            check("clicking it opens the browser's install prompt", pg.evaluate("window.__prompted === true"))
        ctx.close()

        exe = br.new_context()
        exe.add_init_script("window.__OREBIT_RT__ = { key: null };")
        ep = exe.new_page()
        ep.goto(f"{base}/Core.html", wait_until="load", timeout=60000)
        ep.wait_for_function("() => typeof showTab === 'function'", timeout=60000)
        ep.evaluate("() => { const e = new Event('beforeinstallprompt'); e.prompt = () => {}; window.dispatchEvent(e); }")
        check("no 'Install app' button inside the Desktop EXE", ep.locator("[data-install-app]").count() == 0)
        exe.close()
        br.close()
    httpd.shutdown()
    shutil.rmtree(site, ignore_errors=True)
    print(f"\n  PWA INSTALL: {PASSED} passed, {FAILED} failed")
    return 0 if FAILED == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
