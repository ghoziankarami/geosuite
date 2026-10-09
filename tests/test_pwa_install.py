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
  6. a real v4 -> v5 worker update replaces cached jsPDF on its first request;
     an interrupted update retains the old offline shell and saved projects.

Before this, the deployed service worker cached the module pages under their
pre-2026-08 URLs (/try-p2/, /try-p3/), i.e. never: offline held for the vendor
libraries only, and there was no manifest, so nothing was installable.

Needs: node build/build.mjs already run (dist/), Playwright + Chromium.
Starts its own HTTP server on a free port; no other server required.
"""

import functools
import os
import http.server
import urllib.parse
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
        def end_headers(self):
            if urllib.parse.urlsplit(self.path).path.endswith('/service-worker.js'):
                # Each registration.update() must observe the edited worker,
                # including retries within HTTP Last-Modified's one second.
                self.send_header('Cache-Control', 'no-store')
            # Prime an actual long-lived HTTP cache entry before migration.
            # The worker must revalidate it; a fresh 200 cannot hide the 308.
            if not self.server.test_root_routes and urllib.parse.urlsplit(self.path).path in ['/try/'+mod+'.html' for mod in ('Core','Assay','Resource')]:
                self.send_header('Cache-Control','public, max-age=3600')
            super().end_headers()
        def do_GET(self):
            path=urllib.parse.urlsplit(self.path)
            if self.server.test_root_routes and path.path in ['/try/'+mod+'.html' for mod in ('Core','Assay','Resource')]:
                self.send_response(308)
                self.send_header('Location',path.path.removeprefix('/try')+('?' + path.query if path.query else ''))
                self.end_headers()
                return
            failure=self.server.test_responses.get(urllib.parse.urlsplit(self.path).path)
            if failure:
                status,body=failure
                self.send_response(status);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(body.encode());return
            return super().do_GET()
    handler = functools.partial(Quiet, directory=str(directory))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    httpd.test_responses={}
    httpd.test_root_routes=False
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://localhost:{port}"


SHELL = ["/Core.html", "/Assay.html", "/Resource.html", "/vendor/plotly.min.js", "/vendor/jspdf.umd.min.js",
         "/vendor/html2canvas.min.js", "/vendor/jszip.min.js", "/manifest.webmanifest", "/pwa/icon-192.png",
         "/pwa/icon-512.png", "/pwa/icon-maskable-512.png", "/pwa/apple-touch-icon.png"]


def worker_upgrade(browser_type, site, new_worker):
    """Real registrations on a separate synthetic origin, never production storage.

    The legacy cache holds benign marker JavaScript, not a vulnerable binary
    fixture. The new cache must contain and execute the actual shipped jsPDF.
    Lightweight HTML keeps this lifecycle test independent of app renderers.
    """
    upgrade_site = Path(tempfile.mkdtemp(prefix="pwa-upgrade-site-"))
    profile = Path(tempfile.mkdtemp(prefix="pwa-upgrade-profile-"))
    httpd = ctx = None
    try:
        shutil.copytree(site / "vendor", upgrade_site / "vendor")
        shutil.copytree(site / "pwa", upgrade_site / "pwa")
        shutil.copy2(site / "manifest.webmanifest", upgrade_site / "manifest.webmanifest")
        html = '''<!doctype html><html><head><script>window.OREBIT_BUILD_ID="synthetic-pwa-upgrade";</script>
            <script src="./vendor/jspdf.umd.min.js"></script></head><body>PWA upgrade fixture
            <script>navigator.serviceWorker.register('./service-worker.js');</script></body></html>'''
        for module in ("Core", "Assay", "Resource"):
            (upgrade_site / (module + ".html")).write_text(html)
        # Preserve the former v4 namespace and stale-while-revalidate strategy.
        # The independent checks below require literal v4/v5 cache identities.
        legacy_worker = new_worker.replace("'geosuite-app-v5:'", "'geosuite-app-v4:'")
        (upgrade_site / "service-worker.js").write_text(legacy_worker + "\n// legacy v4 fixture\n")
        old_vendor = "window.__pwaVendorIdentity='legacy-v4';\n"
        new_vendor = "window.__pwaVendorIdentity='updated-v5';\n" + (site / "vendor/jspdf.umd.min.js").read_text()
        vendor = upgrade_site / "vendor/jspdf.umd.min.js"
        vendor.write_text(old_vendor)
        httpd, base = serve(upgrade_site)
        ctx = browser_type.launch_persistent_context(
            str(profile), headless=True, args=["--no-sandbox", "--disable-gpu"])
        pg = ctx.new_page()
        pg.goto(base + "/Core.html", wait_until="load")
        pg.wait_for_function("""async()=>navigator.serviceWorker.controller &&
            (await caches.keys()).includes('geosuite-app-v4:/') &&
            !!await (await caches.open('geosuite-app-v4:/')).match('/vendor/jspdf.umd.min.js')""", timeout=60000)
        pg.reload(wait_until="load")
        check("upgrade fixture runs the cached legacy vendor", pg.evaluate("window.__pwaVendorIdentity==='legacy-v4'"))
        pg.evaluate("""async()=>{
            localStorage.setItem('pwa-upgrade-project','saved-project');
            const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pwa-upgrade-projects',1);
                r.onupgradeneeded=()=>r.result.createObjectStore('projects');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
            await new Promise((resolve,reject)=>{const tx=db.transaction('projects','readwrite');
                tx.objectStore('projects').put({name:'synthetic-project',holes:['UPGRADE-001']},'saved');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
            const other=await caches.open('geosuite-app-v4:/other/');
            await other.put('/other/keep.txt',new Response('other-scope-shell'));
            const unrelated=await caches.open('unrelated-app-cache');
            await unrelated.put('/keep.txt',new Response('unrelated-shell'));
        }""")
        httpd.test_responses["/vendor/jspdf.umd.min.js"] = (503, "interrupted vendor download")
        (upgrade_site / "service-worker.js").write_text(new_worker)
        vendor.write_text(new_vendor)
        update = """async()=>{
            const registration=await navigator.serviceWorker.getRegistration();
            window.__previousPwaWorker=navigator.serviceWorker.controller;
            let listener,timer;
            const finished=new Promise((resolve,reject)=>{
                timer=setTimeout(()=>reject(new Error('worker update did not finish')),45000);
                listener=()=>{const worker=registration.installing;
                    const state=()=>{if(worker.state==='redundant'||worker.state==='activated')resolve(worker.state)};
                    worker.addEventListener('statechange',state);state();};
                registration.addEventListener('updatefound',listener);
            });
            try {await registration.update();return await finished;}
            finally {clearTimeout(timer);registration.removeEventListener('updatefound',listener);}
        }"""
        state = pg.evaluate(update)
        check("interrupted vendor update rejects the new worker", state == "redundant", state)
        if state != "redundant":
            return  # The unsafe-install mutation is already a visible failure.
        caches_after_failure = pg.evaluate("async()=>await caches.keys()")
        check("failed upgrade retains old shell without publishing an incomplete v5 cache",
              "geosuite-app-v4:/" in caches_after_failure and "geosuite-app-v5:/" not in caches_after_failure,
              str(caches_after_failure))
        ctx.set_offline(True)
        pg.reload(wait_until="load")
        check("old worker and vendor still open offline after interrupted update",
              pg.evaluate("window.__pwaVendorIdentity==='legacy-v4' && localStorage.getItem('pwa-upgrade-project')==='saved-project'"))
        ctx.set_offline(False)
        httpd.test_responses.clear()
        state = pg.evaluate(update)
        check("retry installs and activates the complete v5 worker", state == "activated", state)
        pg.wait_for_function("()=>navigator.serviceWorker.controller!==window.__previousPwaWorker", timeout=60000)
        activated_caches = pg.evaluate("async()=>await caches.keys()")
        has_v5 = "geosuite-app-v5:/" in activated_caches and "geosuite-app-v4:/" not in activated_caches
        check("retry activates the new cache version", has_v5, str(activated_caches))
        if not has_v5:
            return
        first_vendor = pg.evaluate("async()=>(await fetch('/vendor/jspdf.umd.min.js')).text()")
        check("first vendor response after activation is the new library", first_vendor == new_vendor)
        cached_vendor = pg.evaluate("async()=>(await (await caches.open('geosuite-app-v5:/')).match('/vendor/jspdf.umd.min.js')).text()")
        check("v5 caches the new fixture marker and exact shipped jsPDF bytes", cached_vendor == new_vendor)
        pg.reload(wait_until="load")
        check("updated page executes jsPDF 4.2.1 immediately",
              pg.evaluate("window.__pwaVendorIdentity==='updated-v5' && window.jspdf?.jsPDF.version==='4.2.1'"))
        ctx.set_offline(True)
        pg.reload(wait_until="load")
        check("updated jsPDF 4.2.1 also executes on offline reload",
              pg.evaluate("window.__pwaVendorIdentity==='updated-v5' && window.jspdf?.jsPDF.version==='4.2.1'"))
        retained = pg.evaluate("""async()=>{
            const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pwa-upgrade-projects',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
            const project=await new Promise((resolve,reject)=>{const r=db.transaction('projects').objectStore('projects').get('saved');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});db.close();
            const keys=await caches.keys();
            return {local:localStorage.getItem('pwa-upgrade-project'),project,keys,
                other:await (await (await caches.open('geosuite-app-v4:/other/')).match('/other/keep.txt')).text(),
                unrelated:await (await (await caches.open('unrelated-app-cache')).match('/keep.txt')).text()};
        }""")
        check("worker upgrade preserves localStorage and IndexedDB projects",
              retained["local"] == "saved-project" and retained["project"] == {"name": "synthetic-project", "holes": ["UPGRADE-001"]}, str(retained["project"]))
        check("activation removes only the obsolete cache of this scope",
              "geosuite-app-v4:/" not in retained["keys"] and "geosuite-app-v5:/" in retained["keys"]
              and retained["other"] == "other-scope-shell" and retained["unrelated"] == "unrelated-shell", str(retained["keys"]))
    except Exception as exc:
        check("real v4-to-v5 browser upgrade completes", False, str(exc).splitlines()[0][:250])
    finally:
        if ctx:
            ctx.close()
        if httpd:
            httpd.shutdown()
            httpd.server_close()
        shutil.rmtree(profile, ignore_errors=True)
        shutil.rmtree(upgrade_site, ignore_errors=True)


def main():
    root = repo_root()
    dist = Path(os.environ.get("OREBIT_TEST_DIST",root / "dist"))
    if not (dist / "Core.html").exists() or not (dist / "manifest.webmanifest").exists():
        print("FATAL: run `node build/build.mjs` first (dist/ has no Core.html or manifest)")
        return 2
    site = Path(tempfile.mkdtemp(prefix="pwa-site-"))
    for f in ("Core.html", "Assay.html", "Resource.html", "manifest.webmanifest", "service-worker.js"):
        shutil.copy2(dist / f, site / f)
    shutil.copytree(dist / "pwa", site / "pwa")
    shutil.copytree(vendor_dir(root), site / "vendor")
    # Preserve a real former /try/ shell to exercise an existing SW registration,
    # then turn on the same entry redirects as the reviewed Nginx configuration.
    shutil.copytree(site, site.parent / (site.name+'-legacy'))
    shutil.move(str(site.parent / (site.name+'-legacy')), str(site / 'try'))
    httpd, base = serve(site)

    with sync_playwright() as p:
        print("\n── Cached v4 → v5 dependency upgrade and interrupted install ──")
        worker_upgrade(p.chromium, site, (site / "service-worker.js").read_text())
        # Installation is a normal-profile workflow. Recent Chromium correctly
        # reports `in-incognito` for Browser.new_context(), regardless of whether
        # the manifest and offline shell are valid. Keep the assertion strict;
        # exercise a profile a user can actually install an application into.
        profile = Path(tempfile.mkdtemp(prefix="pwa-profile-"))
        ctx = p.chromium.launch_persistent_context(
            str(profile), headless=True, args=["--no-sandbox", "--disable-gpu"])
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
            cached = pg.evaluate("""async (shell) => { const c = await caches.open('geosuite-app-v5:/');
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

        print("\n── Update and recovery ──")
        pg.evaluate("localStorage.setItem('pwa-project-canary','keep-project')")
        cached_before=pg.evaluate("async()=>{const c=await caches.open('geosuite-app-v5:/');return (await c.match('/Core.html')).text()}")
        httpd.test_responses['/Core.html']=(503,'temporary upstream failure')
        pg.goto(f"{base}/Core.html?source=app",wait_until='load')
        pg.wait_for_function("() => window.__i18nBooted===true")
        check('transient HTTP503 opens the working cached app',pg.evaluate("typeof showTab==='function'"))
        httpd.test_responses['/Core.html']=(401,'Sign in required')
        pg.goto(f"{base}/Core.html?source=app",wait_until='load')
        check('authentication failure stays visible rather than being bypassed with cache','Sign in required' in pg.inner_text('body'))
        httpd.test_responses['/Core.html']=(200,'<html><body>Wrong deployment page</body></html>')
        pg.goto(f"{base}/Core.html?source=app",wait_until='load')
        cached_after=pg.evaluate("async()=>{const c=await caches.open('geosuite-app-v5:/');return (await c.match('/Core.html')).text()}")
        check('an HTTP200 error page does not overwrite the valid offline module',cached_before==cached_after)
        ctx.set_offline(True)
        pg.goto(f"{base}/Core.html?source=app",wait_until='load')
        pg.wait_for_function("() => window.__i18nBooted===true")
        check('offline launch still works after failed update',pg.evaluate("localStorage.getItem('pwa-project-canary')==='keep-project'"))
        await_deleted=pg.evaluate("async()=>{const c=await caches.open('geosuite-app-v5:/');for(const key of await c.keys())if(new URL(key.url).pathname==='/Core.html')await c.delete(key)}")
        pg.goto(f"{base}/Core.html?source=app",wait_until='load')
        check('missing offline shell shows a useful retry screen instead of blank content','GeoSuite is not available offline yet' in pg.inner_text('body') and pg.get_by_role('button').count()==1)
        check('recovery never clears local project storage',pg.evaluate("localStorage.getItem('pwa-project-canary')==='keep-project'"))
        ctx.set_offline(False);httpd.test_responses.clear()
        core=site/'Core.html';core.write_text(core.read_text().replace('<head>','<head><script>window.__pwaUpdateCanary="new-version";</script>',1))
        pg.goto(f"{base}/Core.html?source=app",wait_until='load')
        pg.wait_for_function("() => window.__i18nBooted===true")
        check('reconnection opens the new app without reinstalling',pg.evaluate("window.__pwaUpdateCanary==='new-version' && localStorage.getItem('pwa-project-canary')==='keep-project'"))
        ctx.set_offline(True)
        pg.goto(f"{base}/Core.html?source=app",wait_until='load')
        pg.wait_for_function("() => window.__i18nBooted===true")
        check('updated module is available on the next offline launch',pg.evaluate("window.__pwaUpdateCanary==='new-version'"))
        ctx.set_offline(False)

        print("\n── Install button ──")
        pg.reload(wait_until="load")
        pg.wait_for_function("() => typeof showTab === 'function'", timeout=60000)
        pg.evaluate("""() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted = true; };
            e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.__testInstallPrompt=e; window.dispatchEvent(e); }""")
        btn = pg.locator("[data-install-app]")
        check("the browser's install event shows an 'Install app' button", btn.count() == 1 and btn.is_visible())
        if btn.count():
            # Native Chromium installability can emit another event after reload
            # between fixture dispatch and the trusted Playwright click. Re-emit
            # the mock in click capture so this assertion tests the app handler
            # against that fixture in the same task, not which event won a race.
            # Real installability is independently checked with CDP above.
            btn.evaluate("""el => el.addEventListener('click', () => {
              window.__prompted=false;
              window.dispatchEvent(window.__testInstallPrompt);
            }, {capture:true,once:true})""")
            btn.click()
            check("clicking it opens the browser's install prompt", pg.evaluate("window.__prompted === true"))
        print("\n── Existing /try/ app → unified root ──")
        httpd.test_responses.clear()
        pg.goto(base+'/try/Core.html?project=synthetic-review',wait_until='load')
        pg.wait_for_function("async()=>!!(await navigator.serviceWorker.getRegistrations()).find(r=>new URL(r.scope).pathname==='/try/'&&r.active)",timeout=60000)
        pg.reload(wait_until='load')
        pg.wait_for_function("()=>navigator.serviceWorker.controller?.scriptURL.endsWith('/try/service-worker.js')",timeout=60000)
        pg.evaluate("""async()=>{
            localStorage.setItem('root-migration-project','preserve-me');
            const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('root-migration-fixture',1);r.onupgradeneeded=()=>r.result.createObjectStore('projects');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
            await new Promise((resolve,reject)=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put({name:'synthetic-review',holes:['FIX-001','FIX-002']},'saved');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
        }""")
        httpd.test_root_routes=True
        pg.goto(base+'/try/Core.html?project=synthetic-review',wait_until='load')
        check('legacy Core entry lands at root and preserves query',pg.url==base+'/Core.html?project=synthetic-review',pg.url)
        pg.wait_for_function("()=>navigator.serviceWorker.controller?.scriptURL.endsWith('/service-worker.js')&&!navigator.serviceWorker.controller.scriptURL.includes('/try/')",timeout=60000)
        check('root migration preserves local project storage',pg.evaluate("localStorage.getItem('root-migration-project')==='preserve-me'"))
        saved=pg.evaluate("""async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('root-migration-fixture',1);r.onsuccess=()=>resolve(r.result)});const value=await new Promise(resolve=>{const r=db.transaction('projects').objectStore('projects').get('saved');r.onsuccess=()=>resolve(r.result)});db.close();return value;}""")
        check('root migration preserves indexed project records',saved=={'name':'synthetic-review','holes':['FIX-001','FIX-002']})
        for mod in ('Assay','Resource'):
            pg.goto(base+'/try/'+mod+'.html?project=synthetic-review',wait_until='load')
            check(mod+' old link opens the same root module',pg.url==base+'/'+mod+'.html?project=synthetic-review',pg.url)
        ctx.set_offline(True)
        for mod in ('Core','Assay','Resource'):
            pg.goto(base+'/'+mod+'.html?source=app',wait_until='load',timeout=60000)
            pg.wait_for_function("()=>typeof showTab==='function'",timeout=60000)
            check(mod+' root shell works offline after online migration',pg.evaluate("typeof Plotly==='object'&&localStorage.getItem('root-migration-project')==='preserve-me'"))
        ctx.set_offline(False)
        ctx.close()
        shutil.rmtree(profile, ignore_errors=True)

        br = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
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
