"""Shared helpers for the GeoSuite vignette runners.

A vignette runner drives the REAL application (dist/*.html, as users get it)
in Chromium, step by step, and records every number the vignette quotes into
docs/vignettes/data/<name>.json plus screenshots into docs/vignettes/img/.
tests/test_vignettes.py re-runs the runners and fails if the app's numbers
drift from the committed JSON -- so a tutorial can never silently go stale.
"""

from __future__ import annotations

import functools
import http.server
import json
import os
import shutil
import socket
import tempfile
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIGNETTES = HERE.parent
DATA = VIGNETTES / "data"
IMG = VIGNETTES / "img"


def repo_root() -> Path:
    for p in HERE.parents:
        if (p / "build" / "build.mjs").exists():
            return p
    raise SystemExit("repo root (build/build.mjs) not found")


def vendor_dir(root: Path) -> Path:
    for c in (root / "vendor", root / "exe-wrapper" / "pywebview" / "vendor"):
        if (c / "plotly.min.js").exists():
            return c
    raise SystemExit("vendor/ not found")


class Site:
    """dist/ + vendor/ served from a private temp root on a free port."""

    def __init__(self):
        root = repo_root()
        dist = root / "dist"
        if not (dist / "Core.html").exists():
            raise SystemExit("run `node build/build.mjs` first")
        self.dir = Path(tempfile.mkdtemp(prefix="vignette-site-"))
        for f in ("Core.html", "Assay.html", "Resource.html"):
            shutil.copy2(dist / f, self.dir / f)
        shutil.copytree(vendor_dir(root), self.dir / "vendor")

        class Quiet(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass

        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        self.httpd = http.server.ThreadingHTTPServer(
            ("127.0.0.1", port), functools.partial(Quiet, directory=str(self.dir)))
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://localhost:{port}"

    def close(self):
        self.httpd.shutdown()
        shutil.rmtree(self.dir, ignore_errors=True)


def ready(page, lang="en"):
    """Wait for the app, dismiss the first-run language picker and tour, auto-confirm dialogs."""
    page.wait_for_function("() => typeof showTab === 'function' && typeof safeRender === 'function'", timeout=60000)
    page.evaluate("""(lang) => {
        document.querySelectorAll('.lang-picker-overlay,#tourOverlay').forEach(e => e.remove());
        window.orebitConfirm = async () => true; window.confirm = () => true; window.alert = () => {};
        try { if (typeof setLanguage === 'function') setLanguage(lang); } catch (e) {}
    }""", lang)


def download(page, js: str, dest: Path) -> Path:
    with page.expect_download(timeout=240000) as dl:
        page.evaluate(js)
    dl.value.save_as(str(dest))
    return dest


def shot(page, name: str, selector: str | None = None, full=False):
    """Screenshot the active panel (or `selector`) into docs/vignettes/img/<name>.png."""
    IMG.mkdir(parents=True, exist_ok=True)
    out = IMG / f"{name}.png"
    page.wait_for_timeout(700)  # let Plotly finish its transition
    if selector:
        page.locator(selector).first.screenshot(path=str(out))
    else:
        page.screenshot(path=str(out), full_page=full)
    return out.name


def read_csv(path: Path):
    """CSV written by GeoSuite: skips '# ...' schema lines, returns (header, rows as dicts)."""
    lines = [ln for ln in path.read_text(encoding="utf-8").splitlines() if ln and not ln.startswith("#")]
    import csv
    rdr = csv.DictReader(lines)
    return rdr.fieldnames, list(rdr)


def num(v):
    try:
        f = float(v)
        return f if f == f else None
    except (TypeError, ValueError):
        return None


def write_results(name: str, data: dict):
    """Write data/<name>.json -- or into $VIGNETTE_OUT_DIR, which test_vignettes.py
    uses so a verification run never overwrites the committed numbers."""
    out_dir = Path(os.environ.get("VIGNETTE_OUT_DIR") or DATA)
    out_dir.mkdir(parents=True, exist_ok=True)
    p = out_dir / f"{name}.json"
    p.write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=False) + "\n", encoding="utf-8")
    return p
