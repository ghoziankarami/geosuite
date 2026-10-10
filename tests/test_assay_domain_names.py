"""Real imported domain names remain literal and editable through native exports.

Uses legitimate apostrophes, quotes, angle text and property-like labels only;
no executable input. Owns its server and accepts an immutable artifact directory.
"""
import csv
import functools
import http.server
import importlib.util
import json
import os
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "build/build.mjs").exists())
SITE = Path(os.environ.get("ASSAY_DOMAIN_NAMES_SITE", os.environ.get("OREBIT_TEST_DIST", ROOT / "dist")))
spec = importlib.util.spec_from_file_location("domain_name_controls", Path(__file__).with_name("test_resource_large_extent.py"))
controls = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controls)
LABELS = ["O'Neil & <oxide> \"north\"", "__proto__", "constructor", "toString"]
RENAMED = "O'Neil <reviewed> & \"north\""
PASSED = 0


def check(value, message):
    global PASSED
    assert value, message
    PASSED += 1
    print("PASS: " + message, flush=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def tagged(page):
    return page.evaluate("()=>_domainTagged.map(t=>({domain:t.domain,label:t.label}))")


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(SITE)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with tempfile.TemporaryDirectory(prefix="assay-domain-names-") as temp, sync_playwright() as pw:
            folder = Path(temp)
            source = folder / "synthetic-domain-names.csv"
            with source.open("w", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["hole_id", "from_m", "to_m", "midx", "midy", "midz", "lithology", "domain", "ni_pct"])
                for index, label in enumerate(LABELS):
                    for interval in range(3):
                        writer.writerow([f"H{index+1}", interval, interval+1, 500000+index*30, 9000000, 100-interval, "HOST", label, 1+interval/10])
            browser = pw.chromium.launch(headless=True, args=["--no-sandbox"])
            try:
                for language, width, height in (("en", 1440, 1000), ("id", 390, 844)):
                    context, page = controls.ready(browser, base, "Assay", {"width": width, "height": height}, language)
                    controls.nav(page, 2)
                    page.locator("#fileInput").set_input_files(str(source))
                    page.wait_for_function("()=>DATA.rows.length===12&&currentTab===3")
                    before = page.evaluate("()=>JSON.stringify(DATA.rows.map(r=>DATA.cols.filter(c=>c!=='domain').map(c=>r[colIdx(c)])))")
                    controls.nav(page, 11)
                    check(page.locator('#domainMethodSelect').input_value() == 'existing', language + " imported source domains use the actual existing-domain method")
                    check([t["label"] for t in tagged(page)] == [label for label in LABELS for _ in range(3)], language + " property-like and quoted names retain every exact initial label")
                    field = page.get_by_placeholder(LABELS[0], exact=True)
                    check(field.count() == 1 and field.is_visible(), language + " actual custom-name field identifies the quoted source domain")
                    field.fill(RENAMED)
                    field.press("Tab")
                    page.wait_for_function("args=>_domainNames.existing[args[0]]===args[1]", arg=[LABELS[0], RENAMED], timeout=5000)
                    expected = [RENAMED for _ in range(3)] + [label for label in LABELS[1:] for _ in range(3)]
                    check([t["label"] for t in tagged(page)] == expected, language + " actual onchange applies the exact literal custom name only to its source domain")
                    check([t["domain"] for t in tagged(page)] == [label for label in LABELS for _ in range(3)], language + " raw source-domain association survives interpretation")
                    check(page.evaluate("before=>JSON.stringify(DATA.rows.map(r=>DATA.cols.filter(c=>c!=='domain').map(c=>r[colIdx(c)])))===before", before), language + " rename preserves all source grades, support, hole IDs and coordinates")
                    with page.expect_download() as domain_download:
                        page.locator('#tab11 button[onclick="exportDomainCSV()"]').click()
                    domain_csv = folder / (language + '-domains.csv')
                    domain_download.value.save_as(str(domain_csv))
                    records = list(csv.reader(line for line in domain_csv.read_text().splitlines() if not line.startswith('#')))
                    csv_domain = records[0].index('domain')
                    check([row[csv_domain] for row in records[1:]] == expected, language + " native CSV retains exact literal names with standard quoting")
                    controls.nav(page, 2)
                    page.locator("button.orebit-avatar").click()
                    page.once("dialog", lambda dialog: dialog.accept("synthetic-domain-names.orebit"))
                    with page.expect_download() as download:
                        page.locator('.orebit-profile-menu [data-act="export"]').click()
                    project = folder / (language + "-domains.orebit")
                    download.value.save_as(str(project))
                    bundle = json.loads(project.read_text())
                    di = bundle["data"]["cols"].index("domain")
                    check([row[di] for row in bundle["data"]["rows"]] == expected, language + " native project stores exact materialized interpretation and unrenamed property labels")
                    reopened_context, reopened = controls.ready(browser, base, "Assay")
                    controls.nav(reopened, 2)
                    with reopened.expect_file_chooser() as chooser:
                        reopened.locator('#tab2 button[onclick="importBundle()"]').click()
                    chooser.value.set_files(str(project))
                    reopened.wait_for_function("name=>DATA.rows.length===12&&DATA.name===name", arg=bundle['data']['name'])
                    controls.nav(reopened, 11)
                    check([t["label"] for t in tagged(reopened)] == expected, language + " real native project reopen retains exact domain interpretation")
                    for current in (page, reopened):
                        check(not current.audit_errors and not current.evaluate("__largeExtentFailures"), language + " names workflow has no page or swallowed-render failure")
                    reopened_context.close()
                    context.close()
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print(f"ASSAY DOMAIN NAMES: {PASSED} checks passed", flush=True)


if __name__ == "__main__":
    main()
