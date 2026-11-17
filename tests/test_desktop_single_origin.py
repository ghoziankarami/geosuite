#!/usr/bin/env python3
"""SHELL-1 groundwork: one desktop origin serves Core, Assay and Resource.

The current EXEs bundle a single page each and bind a port per module. The
single-EXE build serves all three pages from one directory on one port, so
every page must receive the desktop marker (`window.__OREBIT_RT__`) before its
own scripts run — this suite pins that contract without needing a window.

No GUI is started: the handler factory is served by a plain HTTPServer.
"""
import functools
import http.server
import importlib.util
import json
import os
import socket
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'build/build.mjs').exists())
DESKTOP = ROOT / ('desktop' if (ROOT / 'desktop').is_dir() else 'exe-wrapper/pywebview')
WRAPPER = DESKTOP / 'orebit_wrapper.py'
PASSED = FAILED = 0

def _stub_tkinter():
    """The wrapper imports tkinter at module level; this suite never opens a window."""
    if 'tkinter' in sys.modules:
        return
    tk = type(sys)('tkinter')
    for name in ('filedialog', 'messagebox'):
        mod = type(sys)('tkinter.' + name)
        setattr(tk, name, mod)
        sys.modules['tkinter.' + name] = mod
    tk.Tk = lambda *a, **k: type('Tk', (), {'withdraw': lambda self: None, 'destroy': lambda self: None})()
    sys.modules['tkinter'] = tk


_stub_tkinter()


def check(condition, message):
    global PASSED, FAILED
    ok = bool(condition)
    PASSED += ok
    FAILED += not ok
    print(f"  {'✅' if ok else '❌'} {message}")


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_wrapper():
    spec = importlib.util.spec_from_file_location('orebit_wrapper_under_test', WRAPPER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def cross_origin_migration(wrapper):
    """Drive the actual old-origin page, not a urllib substitute for fetch."""
    from playwright.sync_api import sync_playwright
    native = [{'name': 'current', 'data': {'rows': [1]}},
              {'name': 'old assay', 'data': {'rows': [2, 3]}}]
    read_projects = """async () => {
      const db=await new Promise((res,rej)=>{const q=indexedDB.open('orebit-projects',1);
        q.onupgradeneeded=()=>q.result.createObjectStore('projects',{keyPath:'name'});
        q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});
      const rows=await new Promise((res,rej)=>{const q=db.transaction('projects').objectStore('projects').getAll();
        q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});db.close();return rows;
    }"""
    seed_projects = """async rows => {
      const db=await new Promise((res,rej)=>{const q=indexedDB.open('orebit-projects',1);
        q.onupgradeneeded=()=>q.result.createObjectStore('projects',{keyPath:'name'});
        q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});
      const tx=db.transaction('projects','readwrite');for(const row of rows)tx.objectStore('projects').put(row);
      await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});db.close();
    }"""
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / 'index.html').write_text('<html><body>Native migration target</body></html>')
        old = http.server.ThreadingHTTPServer(('127.0.0.1', 0), wrapper.legacy_handler(0, html='<html><body>Old origin</body></html>'))
        saved_ports = wrapper.LEGACY_PORTS
        try:
            wrapper.LEGACY_PORTS = {'Assay': old.server_port}
            handler = wrapper.make_handler(tmp)
        finally:
            wrapper.LEGACY_PORTS = saved_ports
        requests = []
        class Observed(handler):
            def do_OPTIONS(self):
                requests.append(('OPTIONS', self.headers.get('Origin')))
                super().do_OPTIONS()
            def do_POST(self):
                requests.append(('POST', self.headers.get('Origin')))
                super().do_POST()
        target = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Observed)
        for server in (old, target):
            threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{target.server_port}'
        origin = f'http://127.0.0.1:{old.server_port}'
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch()
                context = browser.new_context()
                source = context.new_page(); source.goto(origin)
                source.evaluate(seed_projects, native)
                source.evaluate("localStorage.setItem('orebit-theme','old')")
                current = context.new_page()
                with current.expect_response('**/legacy-storage.json') as initial_snapshot:
                    current.goto(base)
                check(initial_snapshot.value.status == 404,
                      'startup import finishes without a snapshot before the old origin sends one')
                current.evaluate(seed_projects, [{'name': 'current', 'data': {'rows': [77]}}])
                current.evaluate("localStorage.setItem('orebit-theme','current')")
                check(not (Path(tmp) / 'legacy-storage.json').exists(),
                      'new origin starts before a legacy snapshot arrives')
                old.RequestHandlerClass = wrapper.legacy_handler(target.server_port)
                source.reload()
                source.wait_for_function("document.getElementById('out').textContent.startsWith('Done.')")
                expected = [{'name': 'current', 'data': {'rows': [77]}}, native[1]]
                actual = current.evaluate(read_projects)
                deadline = time.monotonic() + 10
                while actual != expected and time.monotonic() < deadline:
                    time.sleep(0.1)
                    actual = current.evaluate(read_projects)
                check(actual == expected,
                      'late native cross-origin migration imports both names without overwriting current data: ' + repr(actual))
                check(('OPTIONS', origin) in requests and ('POST', origin) in requests,
                      'actual browser JSON fetch completes OPTIONS and POST from the allowed origin')
                check(source.evaluate(read_projects) == native,
                      'old-origin projects remain intact after migration')
                check(current.evaluate("localStorage.getItem('orebit-theme')") == 'current',
                      'late migration keeps current-origin settings')
                current.close(); current = context.new_page(); current.goto(base)
                actual = current.evaluate(read_projects)
                check(actual == expected,
                      'closing and reopening the destination preserves exact native payloads: ' + repr(actual))
                source.reload()
                source.wait_for_function("document.getElementById('out').textContent.startsWith('Done.')")
                check(current.evaluate(read_projects) == expected,
                      'repeat browser migration cannot duplicate or overwrite current projects')
                old.RequestHandlerClass = wrapper.legacy_handler(target.server_port + 1)
                source.reload()
                source.wait_for_function("document.getElementById('out').textContent.startsWith('Migration failed:')")
                check(source.locator('#out').is_visible(), 'failed legacy transfer has visible browser feedback')
                browser.close()

            before = (Path(tmp) / 'legacy-storage.json').read_bytes()
            def refused(data, headers, method='POST'):
                req = urllib.request.Request(base + '/__migrate', data=data, method=method, headers=headers)
                try:
                    urllib.request.urlopen(req, timeout=5)
                    return 200
                except urllib.error.HTTPError as exc:
                    check(exc.headers.get('Access-Control-Allow-Origin') != '*', 'migration never grants wildcard CORS')
                    code = exc.code
                    exc.read(); exc.close()
                    return code
            check(refused(b'{}', {'Origin': 'https://foreign.invalid', 'Content-Type': 'application/json'}) == 403,
                  'foreign-origin POST is refused')
            check(refused(None, {'Origin': 'https://foreign.invalid', 'Access-Control-Request-Method': 'POST',
                                'Access-Control-Request-Headers': 'content-type'}, 'OPTIONS') == 403,
                  'foreign-origin preflight is refused')
            for data in (b'[]', b'{broken', b'{"projects":"invalid"}', b'{"localStorage":{"other":"bad"}}'):
                check(refused(data, {'Origin': origin, 'Content-Type': 'application/json'}) == 400,
                      'malformed native snapshot is refused: ' + data.decode())
            check(refused(b'{}', {'Origin': origin, 'Content-Type': 'text/plain'}) == 400,
                  'non-JSON snapshot content type is refused')
            check(refused(b'{}', {'Origin': origin, 'Content-Type': 'application/json', 'Content-Length': str(8*1024*1024+1)}) == 400,
                  'oversized snapshot is refused before reading its body')
            check((Path(tmp) / 'legacy-storage.json').read_bytes() == before,
                  'every refused request preserves the prior snapshot bytes')
            occupied = wrapper.start_legacy_migration(target.server_port, ports={'Assay': old.server_port})
            check(occupied == [], 'an occupied old-origin port is skipped without taking over its service')
            previous_window = wrapper.LEGACY_WINDOW_SECONDS
            previous_ports = wrapper.LEGACY_PORTS
            try:
                wrapper.LEGACY_WINDOW_SECONDS = 0.05
                wrapper.LEGACY_PORTS = {'Assay': old.server_port}
                expired = wrapper.make_handler(tmp)
            finally:
                wrapper.LEGACY_WINDOW_SECONDS = previous_window
                wrapper.LEGACY_PORTS = previous_ports
            window_server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), expired)
            threading.Thread(target=window_server.serve_forever, daemon=True).start()
            try:
                base = f'http://127.0.0.1:{window_server.server_port}'
                time.sleep(0.06)
                check(refused(b'', {'Origin': origin, 'Content-Type': 'application/json'}) == 410,
                      'migration writes stop when the bounded acceptance window expires')
            finally:
                window_server.shutdown(); window_server.server_close()
            retiring = wrapper.start_legacy_migration(target.server_port, ports={'Assay': 0})
            retiring_port = retiring[0][1].server_port
            previous_window = wrapper.LEGACY_WINDOW_SECONDS
            try:
                wrapper.LEGACY_WINDOW_SECONDS = 0.05
                closer = threading.Thread(target=wrapper.close_legacy_after_window, args=(retiring,))
                closer.start(); closer.join(timeout=2)
                with socket.socket() as probe:
                    check(not closer.is_alive() and probe.connect_ex(('127.0.0.1', retiring_port)) != 0,
                          'the actual launch cleanup owner closes its old-origin listener after the window')
            finally:
                wrapper.LEGACY_WINDOW_SECONDS = previous_window
                for _, server in retiring:
                    server.shutdown(); server.server_close()
        finally:
            for server in (old, target):
                server.shutdown(); server.server_close()


def main():
    wrapper = load_wrapper()

    native_projects = [{'name': 'current', 'data': {'rows': [1, 2]}},
                       {'name': 'assay', 'data': {'rows': [3, 4]}}]
    merged = wrapper.merge_legacy({}, {'projects': native_projects})
    check(merged['projects'] == native_projects,
          'two native projects without optional IDs retain their complete records')
    repeated = wrapper.merge_legacy(merged, {'projects': [
        {'name': 'current', 'id': 'old-id', 'data': {'rows': [99]}},
        {'name': 'resource', 'id': 'old-id', 'data': {'rows': [5]}}]})
    check(repeated['projects'] == native_projects + [
        {'name': 'resource', 'id': 'old-id', 'data': {'rows': [5]}}],
        'native names preserve current data and distinct names with legacy IDs')
    check(wrapper.merge_legacy(repeated, {'projects': native_projects}) == repeated,
          'repeated native migration is idempotent')
    check(wrapper.merge_legacy(repeated, {'projects': [None, {}, {'name': ''}, {'name': 5}]}) == repeated,
          'malformed project identities cannot add or replace native records')

    check(callable(getattr(wrapper, 'inject_runtime', None)), 'the runtime injection is importable without a window')
    check(wrapper._module_from_html('<html>launcher</html>') == 'Core',
          'a launcher without a product-stage marker still resolves to one origin')
    check(callable(getattr(wrapper, 'make_handler', None)), 'the handler factory is importable without a window')

    page = b'<html><body><h1>x</h1></body></html>'
    marked = wrapper.inject_runtime(page)
    check(b'window.__OREBIT_RT__' in marked, 'a page receives the desktop marker')
    check(b'"single"' not in marked and b'"single":true' in wrapper.inject_runtime(page, True), 'only a single-origin bundle is marked single')
    check(marked.index(b'window.__OREBIT_RT__') < marked.index(b'<h1>'),
          'the marker is written before the app scripts read it')

    os.environ['__OREBIT_DEFAULT_PROFILE__'] = '{"name":"Shell One"}'
    try:
        with_profile = wrapper.inject_runtime(page)
    finally:
        os.environ.pop('__OREBIT_DEFAULT_PROFILE__', None)
    check(b'orebit_profile' in with_profile, 'the optional default profile is written once')

    check(wrapper.inject_runtime(b'<html>no body</html>') == b'<html>no body</html>',
          'a page without <body> is returned unchanged instead of being corrupted')

    build = (DESKTOP / 'build_exe.py').read_text(encoding='utf-8')
    check('def build_single(' in build, 'the single-artifact build target exists')
    check('--single' in build, 'the single-artifact build is reachable from the CLI')
    versions = (DESKTOP / 'gen_version_info.py').read_text(encoding='utf-8')
    check('"suite"' in versions, 'the single artifact carries its own version resource')
    build_mod = load_module(DESKTOP / 'build_exe.py', 'build_exe_under_test')
    launcher = build_mod.launcher_html()
    for page in ('Core.html', 'Assay.html', 'Resource.html'):
        check(page in launcher, f'the launcher links to {page}')
    check('Orebit GeoSuite' in launcher, 'the launcher names the product')
    with tempfile.TemporaryDirectory() as probe:
        for name in ('Core.html', 'Assay.html', 'Resource.html'):
            (Path(probe) / name).write_text('<html></html>')
        check(wrapper._single_origin(probe) is True, 'a three-page bundle is detected as one origin')
        (Path(probe) / 'Assay.html').unlink()
        check(wrapper._single_origin(probe) is False, 'a single-module bundle is not treated as one origin')

    wrapper_source = WRAPPER.read_text()
    check('start_legacy_migration(port)' in wrapper_source,
          'launch opens the old origins for the migration window')
    check('LEGACY_WINDOW_SECONDS' in wrapper_source,
          'the migration window closes on its own instead of listening forever')
    check('make_handler(base_dir)' in wrapper_source, 'main() serves through the tested handler factory')

    with tempfile.TemporaryDirectory() as tmp:
        for name in ('index.html', 'Core.html', 'Assay.html', 'Resource.html'):
            (Path(tmp) / name).write_text('<html><body>page</body></html>')
        (Path(tmp) / 'secret.txt').write_text('not html')
        handler = wrapper.make_handler(tmp)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            base = f'http://127.0.0.1:{server.server_port}'
            for name in ('', '/', '/index.html', '/Core.html', '/Assay.html', '/Resource.html'):
                body = urllib.request.urlopen(base + name, timeout=10).read()
                check(b'window.__OREBIT_RT__' in body, f'one origin marks {name or "/"} as desktop')
                check(b'"single":true' in body, f'one origin marks {name or "/"} as a single-origin desktop, so Quick and in-window handoff apply')
            try:
                traversal = urllib.request.urlopen(base + '/%2e%2e/%2e%2e/etc/passwd', timeout=10).read()
                leaked = b'__OREBIT_RT__' in traversal or b'root:' in traversal
            except urllib.error.HTTPError as exc:
                leaked = exc.code != 404
            check(not leaked, 'a path outside the bundle is never served or marked')

            # Migration from an old per-module origin: add, never overwrite,
            # never delete.
            def migrate(payload):
                req = urllib.request.Request(
                    base + '/__migrate',
                    data=json.dumps(payload).encode('utf-8'),
                    headers={'Content-Type': 'application/json'},
                    method='POST',
                )
                try:
                    return json.loads(urllib.request.urlopen(req, timeout=10).read())
                except urllib.error.HTTPError as exc:
                    return json.loads(exc.read())

            saved = {'localStorage': {'orebit_profile': '{"name":"Current"}', 'orebit-theme': 'dark'},
                     'projects': [{'id': 'p1', 'name': 'current'}]}
            del saved
            first = migrate({'localStorage': {'orebit_profile': '{"name":"Old"}', 'orebit-tour-seen-core': '1'},
                             'projects': native_projects})
            check(first.get('ok') is True and first.get('projects') == 2,
                  'an old origin hands its projects over: ' + str(first))
            stored = json.loads((Path(tmp) / 'legacy-storage.json').read_text())
            check(stored['localStorage']['orebit_profile'] == '{"name":"Old"}',
                  'a key the single origin did not have is added')
            second = migrate({'localStorage': {'orebit_profile': '{"name":"Newer"}'},
                              'projects': [{'name': 'current', 'data': {'rows': [99]}}]})
            stored = json.loads((Path(tmp) / 'legacy-storage.json').read_text())
            check(stored['projects'][0]['name'] == 'current',
                  'the first snapshot establishes the project record')
            check(len(stored['projects']) == 2, 'no project is deleted by a later migration')
            check(stored['projects'] == native_projects,
                  'HTTP snapshots keep both native project payloads unchanged')
            check(stored['localStorage']['orebit_profile'] == '{"name":"Old"}',
                  'an existing key is never overwritten by an older origin')
            check(second.get('ok') is True, 'a repeat migration is accepted, not an error')

            # The old per-module origins can be re-opened briefly so their
            # storage can be handed over.
            started = wrapper.start_legacy_migration(server.server_port, ports={'Resource': 0})
            check([name for name, _ in started] == ['Resource'],
                  'the free legacy origin is opened: ' + str([n for n, _ in started]))
            port = started[0][1].server_port
            page = urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=10).read()
            check(b'__migrate' in page and str(server.server_port).encode() in page,
                  'the legacy origin knows where to hand its storage over')
            for _, srv in started:
                srv.shutdown(); srv.server_close()

            # The injected import must actually write into the page's storage:
            # absent keys only, projects keyed by name, nothing overwritten.
            (Path(tmp) / 'index.html').write_text(
                '<html><body><div id="ok"></div></body></html>')
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                br = pw.chromium.launch(headless=True, args=['--no-sandbox', '--disable-gpu'])
                page = br.new_page()
                page.goto(base + '/index.html', wait_until='load')
                page.wait_for_timeout(1200)
                applied = page.evaluate(
                    """async () => {
                      const keys = Object.keys(localStorage).filter(k => k.indexOf('orebit') === 0);
                      const db = await new Promise(res => { const q = indexedDB.open('orebit-projects', 1);
                        q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
                      const names = db && db.objectStoreNames.contains('projects')
                        ? await new Promise(res => { const g = db.transaction('projects').objectStore('projects').getAll();
                            g.onsuccess = () => res((g.result || []).map(r => r.name)); g.onerror = () => res([]); })
                        : [];
                      return {keys, names};
                    }""")
                br.close()
            check(len(applied['keys']) >= 1, 'the injected import copies the missing settings: ' + str(applied['keys']))
            check(sorted(applied['names']) == ['assay', 'current'],
                  'the injected import keeps both migrated projects: ' + str(applied['names']))

            bad = migrate({'projects': 'not-a-list'})
            check(bad.get('ok') is False and json.loads((Path(tmp) / 'legacy-storage.json').read_text())['projects'] == stored['projects'],
                  'a malformed snapshot adds nothing and destroys nothing')
        finally:
            server.shutdown()
            server.server_close()

    cross_origin_migration(wrapper)
    print(f'\nSHELL-1 single origin: {PASSED} passed, {FAILED} failed')
    sys.exit(1 if FAILED else 0)


if __name__ == '__main__':
    main()
