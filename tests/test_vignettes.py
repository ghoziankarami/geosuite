#!/usr/bin/env python3
"""test_vignettes.py -- the tutorials in docs/vignettes/ may never go stale.

Each vignette has a runner (docs/vignettes/tools/run_<name>.py) that drives the
real dist/ build in Chromium step by step and writes every number the tutorial
quotes to docs/vignettes/data/<name>.json. This suite:

1. re-runs every runner (no screenshots) into a temp dir and compares the fresh
   JSON with the committed one -- integers and strings exactly, floats to a
   relative 1e-4 -- so an app change that moves a quoted number fails here,
   not in a reader's hands;
2. checks each runner's independent re-derivations against the app's own
   numbers (e.g. the app's grade-tonnage curve vs. the one recomputed in
   Python from the exported block model);
3. checks that the numbers the prose quotes are the numbers in the JSON, in
   both the Indonesian and English text.

When an intended app change moves a number: re-run the runner (with
screenshots), update the prose, commit all three together.

Needs Playwright + Chromium and a built dist/ (run-tier.sh builds it).
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve()
ROOT = next(p for p in HERE.parents if (p / "build" / "build.mjs").exists())
VIG = ROOT / "docs" / "vignettes"
IGNORED_KEYS = {"runtime_s", "seconds"}

failures: list[str] = []
passes = 0


def check(ok: bool, msg: str):
    global passes
    if ok:
        passes += 1
    else:
        failures.append(msg)
        print(f"  FAIL {msg}")


def compare(want, got, path="$"):
    if isinstance(want, dict):
        if not isinstance(got, dict):
            return check(False, f"{path}: expected object, got {type(got).__name__}")
        for k, v in want.items():
            # timings vary by machine (first public CI run: estimate_seconds 4 -> 5)
            if k in IGNORED_KEYS or k.endswith("seconds") or k.startswith("img_"):
                continue
            if k not in got:
                check(False, f"{path}.{k}: missing from fresh run")
                continue
            compare(v, got[k], f"{path}.{k}")
    elif isinstance(want, list):
        if not isinstance(got, list) or len(got) != len(want):
            return check(False, f"{path}: list length {len(want)} -> {len(got) if isinstance(got, list) else got!r}")
        for i, (a, b) in enumerate(zip(want, got)):
            compare(a, b, f"{path}[{i}]")
    elif want is None or got is None:
        check(want is got, f"{path}: {want!r} -> {got!r}")
    elif isinstance(want, float) or isinstance(got, float):
        ok = isinstance(got, (int, float)) and math.isclose(float(want), float(got), rel_tol=1e-4, abs_tol=1e-6)
        check(ok, f"{path}: {want} -> {got}")
    else:
        check(want == got, f"{path}: {want!r} -> {got!r}")


def fmt(v: float, dec: int, lang: str) -> str:
    s = f"{v:,.{dec}f}"
    if lang == "id":
        s = s.replace(",", "_").replace(".", ",").replace("_", ".")
    return s


def quoted(docs: dict[str, str], label: str, value: float, dec: int):
    for lang, text in docs.items():
        s = fmt(value, dec, lang)
        check(s in text, f"{label}: prose ({lang}) does not quote {s}")


def thalanga_consistency(d: dict, docs: dict[str, str]):
    r, gt = d["resource"], d["independent_gt"]
    # app's computeGT vs the Python re-derivation from the exported block model
    app = {round(x["cutoff_pct"], 2): x for x in r["gt_app"]["all_blocks"]}
    for row in gt["curve"]:
        a = app.get(round(row["cutoff_pct"], 2))
        check(a is not None, f"gt_app lacks cutoff {row['cutoff_pct']}")
        if a:
            check(abs(a["tonnes_Mt"] - row["tonnes_Mt"]) <= 0.002,
                  f"GT @ {row['cutoff_pct']}%: app {a['tonnes_Mt']} Mt vs independent {row['tonnes_Mt']} Mt")
            check(abs(a["grade_pct"] - row["grade_pct"]) <= 0.01,
                  f"GT @ {row['cutoff_pct']}%: app {a['grade_pct']}% vs independent {row['grade_pct']}%")
    est = r["estimate"]
    check(gt["blocks_estimated"] == est["ok"]["n"], "exported block count != estimated block count")
    check(abs(gt["curve"][0]["tonnes_Mt"] - est["tonnes_Mt"]) < 0.002, "independent tonnage != app tonnage")
    check(all(not d[s]["page_errors"] for s in ("core", "assay", "resource")), "page errors during the run")
    check(d["assay"]["export"]["domains"]["M1-Mineralised"] == r["setup"]["samples"],
          "Resource did not receive every M1 composite Assay exported")
    check(d["core"]["crop"]["kept"] == d["independent"]["samples"], "cropped export row count != crop count")
    check("ASSUMED" in (r.get("density_basis_text") or ""), "density is no longer flagged as assumed")

    # the prose quotes the JSON
    c, ind, a = d["core"], d["independent"], d["assay"]
    quoted(docs, "grade codes bdl", c["grade_codes"]["bdl"], 0)
    quoted(docs, "cropped samples", c["crop"]["kept"], 0)
    quoted(docs, "zn cv", ind["zn_cv"], 2)
    quoted(docs, "metal share 1%", ind["metal_share_above_cutoff_pct"]["1.0"], 1)
    quoted(docs, "shell cv", ind["shell"]["cv_in"], 2)
    quoted(docs, "disintegration", a["topcut"]["disintegration"]["value"], 1)
    quoted(docs, "composites", a["composites"]["n"], 0)
    quoted(docs, "under-half composites", a["export"]["under_half_informed"], 0)
    quoted(docs, "nugget", r["variogram"]["nugget"], 1)
    quoted(docs, "range", r["variogram"]["range"], 0)
    quoted(docs, "spacing", r["spacing_note"]["median_m"], 0)
    quoted(docs, "unconstrained blocks", r["estimate_unconstrained"]["ok"]["n"], 0)
    quoted(docs, "unconstrained Mt", r["estimate_unconstrained"]["tonnes_Mt"], 0)
    quoted(docs, "estimated blocks", est["ok"]["n"], 0)
    quoted(docs, "OK grade", est["ok"]["mean"], 2)
    quoted(docs, "NN grade", est["nn"]["mean"], 2)
    quoted(docs, "tonnes", est["tonnes_Mt"], 3)
    quoted(docs, "metal kt", est["zn_metal_kt"], 1)
    quoted(docs, "OK slope", r["crossval"]["metrics"]["ok"]["slope"], 2)
    quoted(docs, "crossval n", r["crossval"]["pairs"], 0)
    for tier in ("high", "medium", "low"):
        quoted(docs, f"confidence {tier}", r["confidence_screen"][tier], 0)
    for row in gt["curve"]:
        quoted(docs, f"GT {row['cutoff_pct']}% Mt", row["tonnes_Mt"], 3)
        quoted(docs, f"GT {row['cutoff_pct']}% grade", row["grade_pct"], 2)
    for row in r["gt_app"]["high_medium"]:
        if row["cutoff_pct"] in (1, 2, 3, 5, 8):
            quoted(docs, f"GT high+medium {row['cutoff_pct']}%", row["tonnes_Mt"], 3)


def babbitt_consistency(d: dict, docs: dict[str, str]):
    raw, c, a, r = d["raw"], d["core"], d["assay"], d["resource"]
    ic, tc = d["independent_composites"], raw["topcut_check"]
    check(c["length_unit_source"] == "ft" and "converted from feet" in (c["export_lengths_line"] or ""),
          "feet conversion not applied or not recorded")
    check(abs(c["B1_001_deepest_midz"] - raw["B1_001_expected_deepest_midz"]) < 0.01,
          f"B1-001 deepest sample at z={c['B1_001_deepest_midz']}, trigonometry says {raw['B1_001_expected_deepest_midz']}")
    check(a["topcut"]["disintegration"] is None and a["topcut"]["body_departure"] is not None,
          "top-cut diagnostics offer a cut inside the body again")
    check((a["export"]["topcut_line"] or "").startswith(f"# topcut: cu_pct cut={tc['cut']:.4f}"), "cap not recorded in the export")
    check(a["topcut_applied"]["affected"] == tc["assays_above"], "app and independent count of capped assays differ")
    check(ic["m1_cu_max"] <= tc["cut"] + 1e-9, "a composite exceeds the cap")
    check(r["setup"]["samples"] == ic["m1_n"], "Resource did not receive every M1 composite")
    e = r["estimate"]
    bx, by, bz = r["blocks"]["size"]
    check(abs(e["tonnes_Mt"] - e["ok"]["n"] * bx * by * bz * r["blocks"]["density"] / 1e6) < 1e-6, "tonnage != blocks x volume x density")
    check(abs(r["gt_app"][0]["tonnes_Mt"] - e["tonnes_Mt"]) < 0.01, "GT at the domain cut-off != estimated tonnage")
    check(r["crossval"]["pairs"] >= 190, f"cross-validation found neighbours for only {r['crossval']['pairs']} of 200")
    check(all(not d[s]["page_errors"] for s in ("core", "assay", "resource")), "page errors during the run")
    for label, v, dec in [("holes", raw["holes"], 0), ("assay rows", raw["assay_rows"], 0), ("unassayed m", raw["unassayed_m"], 0),
                          ("unassayed pct", raw["unassayed_pct"], 1), ("mean assayed", raw["cu_mean_assayed"], 4),
                          ("mean zero-filled", raw["cu_mean_zero_filled"], 4), ("extent x", raw["extent_m"][0], 0),
                          ("volume factor", raw["volume_factor_if_read_as_m"], 1), ("cu-ni r", raw["cu_ni_r"], 3),
                          ("ni/cu", raw["ni_cu_ratio_median"], 3), ("metal share 0.2", raw["metal_share"]["0.2"]["metal_pct"], 1),
                          ("capped assays", tc["assays_above"], 0), ("metal removed lw", tc["metal_removed_length_weighted_pct"], 2),
                          ("cv raw", tc["m1_cv_raw"], 2), ("cv capped", tc["m1_cv_capped"], 2),
                          ("app metal removed", a["topcut_applied"]["metal_removed_pct"], 2),
                          ("body departure", a["topcut"]["body_departure"]["value"], 2),
                          ("under-half composites", a["export"]["under_half_informed"], 0), ("composites", a["composites"]["n"], 0),
                          ("M1 composites", ic["m1_n"], 0), ("M1 mean", ic["m1_cu_mean"], 4), ("nugget", r["variogram"]["nugget"], 3),
                          ("sill", r["variogram"]["sill"], 3), ("range", r["variogram"]["range"], 1),
                          ("spacing", r["spacing_note"]["median_m"], 0), ("blocks", r["blocks"]["n"], 0),
                          ("estimated blocks", e["ok"]["n"], 0), ("OK grade", e["ok"]["mean"], 3), ("NN grade", e["nn"]["mean"], 3),
                          ("tonnes", e["tonnes_Mt"], 0), ("metal Mt", e["cu_metal_kt"] / 1000, 1),
                          ("cv pairs", r["crossval"]["pairs"], 0), ("OK slope", r["crossval"]["metrics"]["ok"]["slope"], 2),
                          ("B1-001 z", c["B1_001_deepest_midz"], 2)]:
        quoted(docs, label, v, dec)
    for row in r["gt_app"]:
        if row["cutoff_pct"] in (0.2, 0.3, 0.4, 0.5, 0.6):
            quoted(docs, f"GT {row['cutoff_pct']} Mt", row["tonnes_Mt"], 0)
            quoted(docs, f"GT {row['cutoff_pct']} grade", row["grade_pct"], 3)


CONSISTENCY = {"thalanga": ("01-thalanga-vms.md", thalanga_consistency),
               "babbitt": ("02-babbitt-cuni.md", babbitt_consistency)}


def main():
    if not (ROOT / "dist" / "Core.html").exists():
        print("dist/ not built -- run `node build/build.mjs` first")
        return 1
    names = sorted(p.stem for p in (VIG / "data").glob("*.json"))
    if not names:
        print("no vignette data found")
        return 1
    with tempfile.TemporaryDirectory(prefix="vignette-verify-") as tmp:
        for name in names:
            runner = VIG / "tools" / f"run_{name}.py"
            check(runner.exists(), f"{name}: no runner {runner.name}")
            if not runner.exists():
                continue
            print(f"── {name}: re-running {runner.name}")
            env = dict(os.environ, VIGNETTE_OUT_DIR=tmp)
            res = subprocess.run([sys.executable, str(runner), "--no-shots"], env=env,
                                 capture_output=True, text=True, timeout=900)
            if res.returncode == 3:
                print(f"  SKIP {name}: its public data is not available offline ({(res.stdout or '').strip()[-160:]})")
                continue
            fresh = Path(tmp) / f"{name}.json"
            check(res.returncode == 0 and fresh.exists(),
                  f"{name}: runner failed ({res.returncode}): {(res.stderr or res.stdout)[-600:]}")
            if not fresh.exists():
                continue
            committed = json.loads((VIG / "data" / f"{name}.json").read_text(encoding="utf-8"))
            compare(committed, json.loads(fresh.read_text(encoding="utf-8")), name)
            if name in CONSISTENCY:
                md, fn = CONSISTENCY[name]
                docs = {"id": (VIG / md).read_text(encoding="utf-8"),
                        "en": (VIG / "en" / md).read_text(encoding="utf-8")}
                fn(committed, docs)
            for img in (v for k, v in _walk(committed) if k.startswith("img_")):
                check((VIG / "img" / img).exists(), f"{name}: screenshot {img} missing")
    print(f"\n{passes} passed, {len(failures)} failed")
    return 1 if failures else 0


def _walk(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if isinstance(v, (dict, list)):
                yield from _walk(v)
            else:
                yield k, v
    elif isinstance(o, list):
        for v in o:
            yield from _walk(v)


if __name__ == "__main__":
    sys.exit(main())
