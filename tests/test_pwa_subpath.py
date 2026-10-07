#!/usr/bin/env python3
"""A fork hosted below /geosuite/ installs and works offline."""

import http.server
import shutil
import socket
import tempfile
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        shutil.copytree(ROOT / "dist", folder / "geosuite")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]

        def handler(*args, **kwargs):
            return http.server.SimpleHTTPRequestHandler(*args, directory=tmp, **kwargs)

        server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
                context = browser.new_context()
                page = context.new_page()
                base = f"http://localhost:{port}/geosuite/"
                page.goto(base + "Core.html", wait_until="load", timeout=90000)
                page.wait_for_function(
                    "() => navigator.serviceWorker && navigator.serviceWorker.controller",
                    timeout=60000,
                )
                manifest = context.new_cdp_session(page).send("Page.getAppManifest")
                assert manifest["url"] == base + "manifest.webmanifest", manifest
                import json

                data = json.loads(manifest["data"])
                assert data["scope"] == "./" and data["start_url"].startswith(
                    "./"
                ), data
                shell = [
                    "Core.html",
                    "Assay.html",
                    "Resource.html",
                    "vendor/plotly.min.js",
                    "manifest.webmanifest",
                    "pwa/icon-192.png",
                ]
                page.wait_for_function(
                    """async (items) => {
                    const cache = await caches.open('geosuite-app-v4:/geosuite/');
                    return (await Promise.all(items.map(x => cache.match('/geosuite/' + x))))
                      .every(Boolean);
                }""",
                    arg=shell,
                    timeout=60000,
                )
                context.set_offline(True)
                assay = context.new_page()
                assay.goto(
                    base + "Assay.html?source=app", wait_until="load", timeout=60000
                )
                assay.wait_for_function(
                    "() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length > 0",
                    timeout=60000,
                )
                assert assay.evaluate("typeof Plotly !== 'undefined'")
                browser.close()
        finally:
            server.shutdown()
    print("PASS: subfolder manifest, scoped cache, offline Assay")


if __name__ == "__main__":
    main()
