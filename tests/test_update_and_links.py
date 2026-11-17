#!/usr/bin/env python3
"""The build checks the official update endpoint and exposes its links once.

Since v3.2.4 each action has one home: the profile menu carries the app/source
links and the Help menu carries the prefilled bug and wrong-number reports.
"""
import http.server
import socket
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "build" / "build.mjs").exists())
DIST = ROOT / "dist"


def main():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]

    def handler(*args, **kwargs):
        return http.server.SimpleHTTPRequestHandler(*args, directory=str(DIST), **kwargs)

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
            page = browser.new_page(viewport={"width": 1366, "height": 900})
            seen = []

            def release(route):
                seen.append(route.request.url)
                route.fulfill(status=200, content_type="application/json",
                              headers={"Access-Control-Allow-Origin": "*"},
                              body='{"version":"v9.0.0"}')

            page.route("https://geosuite.orebit.id/03-latest.json", release)
            page.goto(f"http://localhost:{port}/Core.html", wait_until="load", timeout=90000)
            page.wait_for_function("() => window.__orebitLatest === 'v9.0.0'", timeout=30000)
            assert seen and page.locator(".orebit-avatar.orebit-has-update").count() == 1
            page.locator(".orebit-avatar").click()
            links = page.locator(".orebit-profile-menu a").evaluate_all("(els) => els.map(e => e.href)")
            assert any(x == "https://github.com/ghoziankarami/geosuite" for x in links), links
            assert not any("issues/new?template=" in x for x in links), links
            page.keyboard.press("Escape")
            page.locator("button.orebit-help-bubble").first.click()
            help_links = page.locator(".orebit-help-menu [data-action^='report-']").evaluate_all(
                "(els) => els.map(e => e.href)")
            assert any("template=bug-report.md" in x and "Build%20ID" in x for x in help_links), help_links
            assert any("template=wrong-numbers.md" in x for x in help_links), help_links
            assert "-dirty" not in page.evaluate("window.OREBIT_BUILD_ID")
            browser.close()
    finally:
        server.shutdown()
    print("PASS: update origin, one home per link, clean build ID")


if __name__ == "__main__":
    main()
