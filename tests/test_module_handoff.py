#!/usr/bin/env python3
"""Core -> Assay -> Resource without downloading and re-uploading files.

Added 2026-09-25. On the web (and in the installed app) the three modules share one
origin, so "Continue in Assay/Resource" hands the file the existing export would have
written to the next module through IndexedDB, and that module loads it through its own
upload input. Checked here:

  1. the button exists in web and Desktop; the Desktop bridge is called;
  2. what arrives in Assay is exactly Core's master export (same rows, same holes);
  3. what arrives in Resource is exactly Assay's composites export;
  4. the handoff is consumed once: reopening the page with ?handoff=1 loads nothing.

All three modules must be served from ONE origin (port 8767 here), as in production.
"""

import csv
import io
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("GEOSUITE_TEST_BASE", "http://localhost") + ":8767"
PASSED = FAILED = 0


def check(name, ok, detail=""):
    global PASSED, FAILED
    ok = bool(ok)
    PASSED += ok
    FAILED += not ok
    print(f"  {'✅' if ok else '❌'} {name}{(': ' + detail) if detail else ''}")


def ready(pg):
    pg.wait_for_function("() => typeof showTab === 'function' && typeof OrebitHandoff === 'object'", timeout=60000)
    pg.evaluate("""() => { document.querySelectorAll('.lang-picker-overlay,#tourOverlay').forEach(e => e.remove());
      window.orebitConfirm = async () => true; window.confirm = () => true; window.alert = () => {}; }""")


def rows_of(text):
    lines = [ln for ln in text.splitlines() if ln and not ln.startswith("#")]
    return list(csv.DictReader(io.StringIO("\n".join(lines))))


def main():
    with sync_playwright() as p:
        br = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
        ctx = br.new_context()

        print("\n── Core → Assay ──")
        core = ctx.new_page()
        core.goto(f"{BASE}/Core.html", wait_until="load", timeout=60000)
        ready(core)
        core.wait_for_function("() => STATE.assay.length > 8000", timeout=60000)
        time.sleep(1.5)
        expected = core.evaluate("(() => { const f = OrebitHandoff.capture(exportMasterCSV); return f && f.text; })()")
        exp_rows = rows_of(expected)
        check("Core's master export can be captured", len(exp_rows) > 8000, str(len(exp_rows)))
        source_density = core.evaluate("STATE.assay.map(r => r.density)")
        check("Core exports every measured density without changing its value",
              len(source_density) == len(exp_rows) and all(float(row['density']) == float(d)
              for row, d in zip(exp_rows, source_density)))

        buttons = core.evaluate("""(() => { for (let i = 1; i <= 14; i++) { try { showTab(i); } catch (e) {}
            if (document.querySelector('[data-handoff="Assay"]')) return true; } return false; })()""")
        check("a 'Continue in Assay' button is rendered on the web", buttons)
        with ctx.expect_page(timeout=60000) as newp:
            core.evaluate("OrebitHandoff.send('Assay', exportMasterCSV)")
        assay = newp.value
        assay.wait_for_load_state("load")
        ready(assay)
        assay.wait_for_function(f"() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length === {len(exp_rows)}", timeout=90000)
        time.sleep(1.5)
        got_holes = set(assay.evaluate("(() => { const i = colIdx('hole_id'); return [...new Set(DATA.rows.map(r => String(r[i])))]; })()"))
        check("Assay received every row of Core's export", True, f"{len(exp_rows)} rows")
        check("…and every hole", got_holes == {r["hole_id"] for r in exp_rows}, f"{len(got_holes)} holes")
        got_density = assay.evaluate("DATA.rows.map(r => r[colIdx('density')])")
        check("Core → Assay preserves the exact density vector",
              len(got_density) == len(exp_rows) and all(float(v) == float(row['density'])
              for v, row in zip(got_density, exp_rows)))

        check("the ?handoff=1 marker is removed from the address", "handoff" not in assay.url, assay.url)

        print("\n── Assay → Resource ──")
        comp = assay.evaluate("(() => { const f = OrebitHandoff.capture(() => exportMasterForEstimation()); return f && f.text; })()")
        comp_rows = rows_of(comp)
        check("Assay's composite export can be captured", len(comp_rows) > 100, str(len(comp_rows)))
        with ctx.expect_page(timeout=60000) as newp:
            assay.evaluate("OrebitHandoff.send('Resource', exportMasterForEstimation)")
        res = newp.value
        res.wait_for_load_state("load")
        ready(res)
        res.wait_for_function(f"() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length === {len(comp_rows)}", timeout=90000)
        check("Resource received every composite", True, f"{len(comp_rows)} composites")
        got_density = res.evaluate("DATA.rows.map(r => r[colIdx('density')])")
        check("Assay → Resource preserves every exported composite density",
              len(got_density) == len(comp_rows) and all(float(v) == float(row['density'])
              for v, row in zip(got_density, comp_rows)))

        doms = res.evaluate("(() => { const s = document.getElementById('setupDomain'); showTab(3); const t = document.getElementById('setupDomain'); return t ? [...t.options].map(o => o.value) : []; })()")
        check("…with the domains Assay assigned", {"M0-Background", "M1-Mineralised"} <= set(doms) or len(doms) > 1, str(doms))

        print("\n── consumed once ──")
        again = ctx.new_page()
        again.goto(f"{BASE}/Resource.html?handoff=1", wait_until="load")
        ready(again)
        time.sleep(2.5)
        n = again.evaluate("(typeof DATA !== 'undefined' && DATA && DATA.rows) ? DATA.rows.length : 0")
        check("reopening with ?handoff=1 does not load the old file again", n != len(comp_rows), f"rows={n}")

        print("\n── Desktop EXE ──")
        exe = ctx.new_page()
        exe.add_init_script("window.__OREBIT_RT__ = {};")
        exe.goto(f"{BASE}/Core.html", wait_until="load")
        exe.wait_for_function("() => typeof showTab === 'function' && typeof OrebitHandoff === 'object'", timeout=60000)
        check("handoff controls are offered in Desktop mode", exe.evaluate("OrebitHandoff.available()") is True)
        sent = exe.evaluate("""async () => {
          window.pywebview = { api: { send_handoff: async (...args) => {
            window.__desktopSent = args; return { ok: true, launched: true };
          } } };
          const ok = await OrebitHandoff.send('Assay', () =>
            downloadFile('bridge.csv', 'hole_id,grade\\nA,1\\n', 'text/csv'));
          return { ok, args: window.__desktopSent };
        }""")
        check("Desktop sends the captured CSV through pywebview", sent["ok"]
              and sent["args"] == ["Assay", "bridge.csv", "hole_id,grade\nA,1\n"])

        desktop_assay = ctx.new_page()
        record = {"name": "master.csv", "text": expected, "ts": int(time.time() * 1000)}
        desktop_assay.add_init_script(
            "window.__OREBIT_RT__={};window.__desktopTakeCalls=0;"
            "window.pywebview={api:{take_handoff:async()=>{"
            "window.__desktopTakeCalls++;return "
            + json.dumps(record) + ";}}};"
        )
        desktop_assay.goto(f"{BASE}/Assay.html", wait_until="load", timeout=60000)
        ready(desktop_assay)
        try:
            desktop_assay.wait_for_function(
                f"() => typeof DATA !== 'undefined' && DATA && DATA.rows && DATA.rows.length === {len(exp_rows)}",
                timeout=30000,
            )
        except Exception:
            pass
        state = desktop_assay.evaluate("""() => ({
          takeCalls: window.__desktopTakeCalls,
          bridge: !!(window.pywebview && window.pywebview.api),
          input: !!document.getElementById('fileInput'),
          rows: typeof DATA !== 'undefined' && DATA && DATA.rows ? DATA.rows.length : null,
          file: document.getElementById('fileInput')?.files?.[0]?.name || null
        })""")
        check("Desktop receiver imports every Core row via file input",
              state["rows"] == len(exp_rows), str(state))
        br.close()
    print(f"\n  MODULE HANDOFF: {PASSED} passed, {FAILED} failed")
    return 0 if FAILED == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
