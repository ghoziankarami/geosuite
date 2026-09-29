#!/usr/bin/env python3
"""Local build checks official update endpoint and exposes source/issue links."""
import http.server
import socket
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def main():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    handler = lambda *args, **kwargs: http.server.SimpleHTTPRequestHandler(
        *args, directory=str(ROOT / "dist"), **kwargs
    )
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
            page = browser.new_page()
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
            links = page.locator(".orebit-profile-menu a").evaluate_all(
                "(els) => els.map(e => e.href)"
            )
            assert any("template=bug-report.md" in x and "Build%20ID" in x for x in links), links
            assert any("template=wrong-numbers.md" in x for x in links), links
            assert any(x == "https://github.com/ghoziankarami/geosuite" for x in links), links
            assert "-dirty" not in page.evaluate("window.OREBIT_BUILD_ID")
            browser.close()
    finally:
        server.shutdown()
    print("PASS: update origin, prefilled issues, source link, clean build ID")


if __name__ == "__main__":
    main()
