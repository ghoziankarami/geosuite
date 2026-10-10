#!/usr/bin/env python3
"""Opt-in real-upload workflow measurements; no default device latency/heap gate.

Runs public gold/nickel/tin Core→Assay→Resource handoffs and deterministic150k
Assay→Resource uploads in fresh browser contexts. Required data/error invariants
fail closed. Latency and Chromium CDP heap are repeated observations, not native
Mac/Windows acceptance, peak process memory, or a production stability claim.
Outputs metadata/hashes only; all generated CSVs and owned processes are removed.
"""

import argparse
import csv
import functools
import hashlib
import http.server
import importlib.util
import importlib.metadata
import json
import math
import os
import platform
import statistics
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_rows(path):
    with path.open() as stream:
        return list(csv.DictReader(line for line in stream if not line.startswith("#")))


def csv_evidence(path):
    rows = read_rows(path)
    return {
        "rows": len(rows),
        "file_sha256": digest(path),
        "population_sha256": hashlib.sha256(
            json.dumps(rows, sort_keys=True).encode()
        ).hexdigest(),
        "units": [
            line
            for line in path.read_text().splitlines()
            if line.startswith("# units:")
        ],
    }


def original_columns(page):
    # The real Domain control may add inferred labels where none were supplied.
    # Retain every supplied column/value; a wholly empty domain field carries
    # no observed interpretation. Existing nonempty source domains stay strict.
    return page.evaluate("""()=>DATA.cols.filter((name,index)=>name!=='domain'||
      DATA.rows.some(row=>row[index]!=null&&row[index]!==''))""")


def source_checksum(page, columns):
    return checksum(
        page,
        "DATA.rows.map(row=>" + json.dumps(columns) + ".map(name=>row[colIdx(name)]))",
    )


def control_source(root, name):
    # Private checkout and public source ZIP carry the same controls in
    # different supported test layouts.
    for parent in [root / "tests/geosuite", root / "tests"]:
        source = parent / name
        if source.is_file():
            return source
    raise FileNotFoundError(f"Missing {name} in tests/geosuite/ or tests/")


def load_controls(root, name):
    source = control_source(root, name)
    spec = importlib.util.spec_from_file_location(name[:-3], source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def optional_text(path):
    try:
        return Path(path).read_text().strip()
    except OSError:
        return None


def git_sha(root):
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        return None  # A source ZIP does not require Git to benchmark its artifact.
    return result.stdout.strip() if result.returncode == 0 else None


def settled(page):
    page.wait_for_function(
        """()=>!window._domainValidationTimer&&
      (typeof _plotQueueRunning==='undefined'||!_plotQueueRunning)&&
      (typeof _plotQueue==='undefined'||!_plotQueue.length)""",
        timeout=90000,
    )
    page.evaluate(
        "()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))"
    )


def checksum(page, expression):
    return page.evaluate(
        """async expression=>{
      const value=(0,eval)(expression),bytes=new TextEncoder().encode(JSON.stringify(value));
      const hash=await crypto.subtle.digest('SHA-256',bytes);
      return {sha256:Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join(''),bytes:bytes.length};
    }""",
        expression,
    )


class Bench:
    def __init__(self, page, run, phase, engine):
        self.page, self.run, self.phase = page, run, phase
        self.client = (
            page.context.new_cdp_session(page) if engine == "chromium" else None
        )
        if self.client:
            self.client.send("Performance.enable")

    def heap(self):
        if not self.client:
            return {"available": False, "reason": "CDP is Chromium-only"}
        metrics = {
            row["name"]: row["value"]
            for row in self.client.send("Performance.getMetrics")["metrics"]
        }
        return {
            "available": True,
            "used_bytes": int(metrics["JSHeapUsedSize"]),
            "total_bytes": int(metrics["JSHeapTotalSize"]),
            "dom": self.client.send("Memory.getDOMCounters"),
        }

    def action(self, name, operation):
        before = self.heap()
        started = time.perf_counter()
        operation()
        settled(self.page)
        elapsed = (time.perf_counter() - started) * 1000
        row = {
            "phase": self.phase,
            "action": name,
            "wall_ms": round(elapsed, 3),
            "heap_before": before,
            "heap_after": self.heap(),
        }
        self.run["actions"].append(row)
        print(
            json.dumps(
                {
                    "workload": self.run["workload"],
                    "repeat": self.run["repeat"],
                    "phase": self.phase,
                    "action": name,
                    "wall_ms": row["wall_ms"],
                }
            ),
            flush=True,
        )
        self.assert_clean()

    def assert_clean(self):
        failures = self.page.evaluate(
            "window.__literalHeaderFailures||window.__largeExtentFailures||[]"
        )
        assert not failures and not self.page.audit_errors, {
            "swallowed": failures,
            "pageerror": self.page.audit_errors,
        }


def synthetic(folder, n):
    assert n % 60 == 0, "Synthetic count must preserve equal paired-hole grades"
    path = folder / "synthetic-150k.csv"
    with path.open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(
            [
                "hole_id",
                "from_m",
                "to_m",
                "midx",
                "midy",
                "midz",
                "lithology",
                "domain",
                "au_gpt",
                "cu_pct",
            ]
        )
        for i in range(n):
            hole, depth = divmod(i, 30)
            grade = 1 if hole % 2 else 10
            writer.writerow(
                [
                    f"H{hole}",
                    depth,
                    depth + 1,
                    (hole % 100) * 45.3,
                    -(hole // 100) * 51.9,
                    -depth - 0.5,
                    "HOST",
                    "A" if hole % 2 else "B",
                    grade,
                    grade * 0.2,
                ]
            )
    return path


def exported(page, selector, target):
    with page.expect_download(timeout=90000) as event:
        page.locator(selector).click()
    event.value.save_as(str(target))


def run_workload(browser, base, folder, item, index, args, core, controls):
    run = {
        "workload": item["name"],
        "repeat": index,
        "actions": [],
        "invariants": {},
        "outputs": {},
    }
    files = item["files"]
    element, unit = item["element"], item["unit"]
    contexts = []
    try:
        if item["name"] != "synthetic150k":
            context, page = core.ready(browser, base, "en", 1440, 1000)
            contexts.append(context)
            bench = Bench(page, run, "Core", args.browser)
            core.nav(page, 2)
            expected = {
                "collar": len(read_rows(files[0])),
                "survey": len(read_rows(files[1])),
                "assay": len(read_rows(files[2])),
                "geology": len(read_rows(files[3])),
            }

            def import_core():
                page.locator("#fileInput").set_input_files(
                    [str(path) for path in files]
                )
                page.wait_for_function(
                    "expected=>Object.entries(expected).every(([name,n])=>STATE[name].length===n)",
                    arg=expected,
                    timeout=90000,
                )

            bench.action("upload", import_core)
            raw = checksum(
                page, "[STATE.collar,STATE.survey,STATE.assay,STATE.geology]"
            )
            bench.action("validation", lambda: core.nav(page, 7))
            checks = page.evaluate("_p1RunValidationChecks()")
            failed = [row for row in checks if row["severity"] == "fail"]
            assert not failed, failed
            run["invariants"]["core_uploaded_counts"] = expected
            run["invariants"]["core_validation_failures"] = 0

            def desurvey():
                page.locator("#tab7 .workflow-actions [data-workflow-next]").click()
                page.wait_for_function(
                    "()=>document.querySelector('#tab10.panel.active')&&STATE.desurvey",
                    timeout=90000,
                )

            bench.action("guided_desurvey", desurvey)
            assert (
                page.evaluate("Object.keys(STATE.desurvey.holes).length")
                == expected["collar"]
            )

            def merge():
                page.locator("#tab10 .workflow-actions [data-workflow-next]").click()
                page.wait_for_function(
                    "()=>document.querySelector('#tab11.panel.active')&&STATE.merged?.length",
                    timeout=90000,
                )

            bench.action("guided_merge", merge)
            merged = page.evaluate("STATE.merged.length")
            assert (
                checksum(page, "[STATE.collar,STATE.survey,STATE.assay,STATE.geology]")
                == raw
            )
            run["invariants"]["core_raw_unchanged"] = raw
            core.nav(page, 13)
            source = folder / "core-master.csv"
            bench.action(
                "native_master_csv",
                lambda: exported(
                    page, '#tab13 button[onclick="exportMasterCSV()"]', source
                ),
            )
            assert len(read_rows(source)) == merged
            run["outputs"]["Core"] = csv_evidence(source)
            context.close()
        else:
            source = files[0]

        expected_rows = len(read_rows(source))
        context, page = controls.ready(browser, base, "Assay")
        contexts.append(context)
        bench = Bench(page, run, "Assay", args.browser)
        controls.nav(page, 2)

        def import_assay():
            page.locator("#fileInput").set_input_files(str(source))
            page.wait_for_function(
                "n=>DATA.rows.length===n&&currentTab===3",
                arg=expected_rows,
                timeout=90000,
            )

        bench.action("upload", import_assay)
        columns = original_columns(page)
        raw = source_checksum(page, columns)
        bench.action("report", lambda: controls.nav(page, 13))
        info = page.evaluate(
            """element=>({rows:DATA.rows.length,holes:new Set(DATA.rows.map(r=>r[colIdx('hole_id')])).size,
          composites:_compositeCache.composites.length,mean:statsSummary(DATA.rows.map(r=>r[colIdx(element)])).mean,
          compositeSupport:_compositeCache.composites.reduce((s,c)=>s+c.comp_length,0)})""",
            element,
        )
        if item["name"] == "synthetic150k":
            assert info == {
                "rows": args.synthetic_rows,
                "holes": args.synthetic_rows // 30,
                "composites": args.synthetic_rows,
                "mean": 5.5,
                "compositeSupport": args.synthetic_rows,
            }, info
        run["invariants"]["assay_full_scope"] = info
        bench.action("statistics", lambda: controls.nav(page, 8))
        display = page.evaluate(
            "({source:statsSummary(DATA.rows.map(r=>r[colIdx('"
            + element
            + "')])).n,plotted:statCDF.data[0].x.length})"
        )
        assert (
            display["source"] <= expected_rows and 0 < display["plotted"] <= 2500
        ), display
        if item["name"] == "synthetic150k":
            assert display["source"] == args.synthetic_rows
        run["invariants"]["statistics_scope"] = display
        controls.nav(page, 11)
        master = folder / "assay-master.csv"
        bench.action(
            "native_master_csv",
            lambda: exported(
                page,
                '#tab11 button[onclick="exportMasterForEstimation()"]:visible',
                master,
            ),
        )
        assert source_checksum(page, columns) == raw
        native_rows = read_rows(master)
        assert native_rows
        if item["name"] == "synthetic150k":
            assert len(native_rows) == args.synthetic_rows
            assert (
                sum(float(row[element]) for row in native_rows)
                == args.synthetic_rows * 5.5
            )
            assert (
                sum(float(row["to_m"]) - float(row["from_m"]) for row in native_rows)
                == args.synthetic_rows
            )
        assert "orebit-schema=v1 source=phase2-eda composite=1m" in master.read_text()
        run["invariants"]["assay_raw_unchanged"] = {
            **raw,
            "source_columns": columns,
            "domain_note": "Existing nonempty domains preserved; missing labels may be derived by actual Domain controls.",
        }
        run["outputs"]["Assay"] = csv_evidence(master)
        bench.assert_clean()
        context.close()

        context, page = controls.ready(browser, base, "Resource")
        contexts.append(context)
        bench = Bench(page, run, "Resource", args.browser)
        controls.nav(page, 2)

        def import_resource():
            page.locator("#fileInput").set_input_files(str(master))
            page.wait_for_function(
                "n=>DATA.rows.length===n", arg=len(native_rows), timeout=90000
            )

        bench.action("upload", import_resource)
        raw = checksum(page, "DATA.rows")
        assert page.evaluate("gradeUnitFor(setupState.element)") == unit
        # Oracle uses the actual native CSV, independently of Resource bounds.
        samples = []
        for row in native_rows:
            try:
                values = [float(row[k]) for k in ["midx", "midy", "midz", element]]
            except (ValueError, KeyError):
                continue
            if all(math.isfinite(v) for v in values):
                samples.append(values)
        assert samples, "No valid spatial samples in native input"
        bounds = [
            [min(p[a] for p in samples), max(p[a] for p in samples)] for a in range(3)
        ]
        bench.action("block_model_controls", lambda: controls.nav(page, 5))
        observed = page.evaluate(
            "({bounds:_resourceExtents(getSamples()),samples:getSamples().length})"
        )
        assert observed["samples"] == len(samples), observed
        assert all(
            math.isclose(actual, wanted, abs_tol=1e-8)
            for a, b in zip(observed["bounds"], bounds)
            for actual, wanted in zip(a, b)
        ), (observed, bounds)
        for selector, size in zip(["#bmX", "#bmY", "#bmZ"], [100, 100, 10]):
            page.locator(selector).fill(str(size))

        def grid():
            page.locator("#bmGenBtn").click()
            page.wait_for_function("()=>!!blockState.blocks?.length", timeout=90000)

        bench.action("coarse_generate_grid", grid)
        grid_info = page.evaluate("""()=>({dims:blockState.dims,size:blockState.size,origin:blockState.origin,count:blockState.blocks.length,
          aligned:blockState.blocks.every(b=>['cx','cy','cz'].every((k,a)=>Math.abs((b[k]-blockState.origin[a])/blockState.size[a]-.5-Math.round((b[k]-blockState.origin[a])/blockState.size[a]-.5))<1e-8))})""")
        dims = [
            math.ceil((hi - lo) / size) + 1
            for (lo, hi), size in zip(bounds, [100, 100, 10])
        ]
        assert grid_info["dims"] == dims and grid_info["origin"] == [
            b[0] for b in bounds
        ]
        assert (
            grid_info["size"] == [100, 100, 10]
            and grid_info["aligned"]
            and 0 < grid_info["count"] <= math.prod(dims)
        )
        assert checksum(page, "DATA.rows") == raw
        run["invariants"]["resource_full_scope"] = {
            "rows": len(native_rows),
            "eligible_samples": len(samples),
            "bounds": bounds,
            "unit": unit,
        }
        run["invariants"]["resource_raw_unchanged"] = raw
        run["outputs"]["Resource"] = {
            "grid": grid_info,
            "sha256": checksum(page, "blockState.blocks")["sha256"],
            "scope": "100x100x10m sample-proximity screening grid; no grade estimation/tonnage or default-grid performance inferred",
        }
        bench.assert_clean()
        return run
    finally:
        for context in contexts:
            context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path)
    parser.add_argument("--site", type=Path)
    parser.add_argument(
        "--manifest",
        type=Path,
        help="Optional immutable artifact manifest; verify every installed member",
    )
    parser.add_argument("--datasets", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument(
        "--browser", choices=["chromium", "firefox", "webkit"], default="chromium"
    )
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--device-label", required=True)
    parser.add_argument(
        "--contention",
        required=True,
        help="Observed concurrent work; never assume isolation",
    )
    parser.add_argument(
        "--workloads",
        nargs="+",
        choices=["gold", "nickel", "tin", "synthetic150k"],
        default=["gold", "nickel", "tin", "synthetic150k"],
    )
    args = parser.parse_args()
    args.synthetic_rows = 150000
    root = (
        args.repo
        or next(
            p
            for p in Path(__file__).resolve().parents
            if (p / "build/build.mjs").exists()
        )
    ).resolve()
    site = (args.site or root / "dist").resolve()
    assert 1 <= args.repeats <= 30
    core = load_controls(root, "test_core_literal_headers.py")
    controls = load_controls(root, "test_resource_large_extent.py")
    artifact = None
    if args.manifest:
        manifest = json.loads(args.manifest.read_text())
        for name, record in manifest["files"].items():
            assert (
                digest(site / name) == record["sha256"]
                and (site / name).stat().st_size == record["bytes"]
            ), name
        artifact = {
            "source_commit": manifest["source_commit"],
            "archive_sha256": manifest["archive_sha256"],
            "manifest_sha256": digest(args.manifest),
            "verified_members": len(manifest["files"]),
        }
    result = {
        "schema": "geosuite-workflow-boundary-benchmark-v1",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "harness_sha256": digest(Path(__file__)),
        "artifact": artifact,
        "control_source_sha256": {
            name: digest(control_source(root, name))
            for name in [
                "test_core_literal_headers.py",
                "test_resource_large_extent.py",
            ]
        },
        "source_checkout": git_sha(root),
        "dataset_source": git_sha(args.datasets),
        "site_hashes": {
            str(p.relative_to(site)): digest(p)
            for p in [site / (m + ".html") for m in ["Core", "Assay", "Resource"]]
        },
        "machine": {
            "label": args.device_label,
            "os": platform.platform(),
            "architecture": platform.machine(),
            "python": platform.python_version(),
            "logical_cpus": os.cpu_count(),
            "cpu_quota": optional_text("/sys/fs/cgroup/cpu.max"),
            "memory_limit": optional_text("/sys/fs/cgroup/memory.max"),
            "load_average_start": list(os.getloadavg())
            if hasattr(os, "getloadavg")
            else None,
        },
        "browser": {
            "engine": args.browser,
            "headless": not args.headed,
            "viewport": [1440, 1000],
            "language": "en",
            "service_workers": "blocked",
            "playwright": importlib.metadata.version("playwright"),
        },
        "protocol": {
            "repeats": args.repeats,
            "fresh_context_each_module": True,
            "discarded_warmups": 0,
            "contention": args.contention,
            "latency": "Real action→owner predicate→plot queue idle→two requestAnimationFrames; metadata/hash checks are outside timed action.",
            "heap": "CDP JavaScript heap boundary snapshots only, including instrumentation and natural GC. No forced GC/peak RSS/device threshold. Output hashing allocates temporary buffers.",
            "acceptance": "Data/error invariants required. No latency/heap limits configured or real-device acceptance inferred.",
            "scope": "Public four-table Core→Assay nativeCSV→Resource coarsegrid; separate150k synthetic Assay→Resource. Estimation/PDF/nativeGUI/offline/GPU/frame-rate not benchmarked.",
        },
        "inputs": {},
        "runs": [],
        "status": "running",
    }
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(controls.Quiet, directory=str(site))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(
            prefix="geosuite-workflow-bench-"
        ) as temp, sync_playwright() as pw:
            folder = Path(temp)
            synthetic_path = synthetic(folder, args.synthetic_rows)
            config = [
                ("gold", "01-emas-epitermal", "au_gpt", "g/t"),
                ("nickel", "02-nikel-laterit", "ni_pct", "%"),
                ("tin", "03-timah-placer", "sn_kgm3", "kg/m³"),
            ]
            workloads = [
                {
                    "name": name,
                    "element": element,
                    "unit": unit,
                    "files": [
                        args.datasets / d / f
                        for f in ["collar.csv", "survey.csv", "assay.csv", "litho.csv"]
                    ],
                }
                for name, d, element, unit in config
            ]
            workloads.append(
                {
                    "name": "synthetic150k",
                    "element": "au_gpt",
                    "unit": "g/t",
                    "files": [synthetic_path],
                }
            )
            workloads = [item for item in workloads if item["name"] in args.workloads]
            for item in workloads:
                result["inputs"][item["name"]] = [
                    {
                        "filename": p.name,
                        "bytes": p.stat().st_size,
                        "sha256": digest(p),
                        "rows": len(read_rows(p)),
                    }
                    for p in item["files"]
                ]
            launch = {"headless": not args.headed}
            if args.browser == "chromium":
                launch["args"] = ["--no-sandbox", "--disable-dev-shm-usage"]
            result["browser"]["launch_args"] = launch.get("args", [])
            browser = getattr(pw, args.browser).launch(**launch)
            try:
                result["browser"]["version"] = browser.version
                for item in workloads:
                    for repeat in range(1, args.repeats + 1):
                        run_folder = folder / (item["name"] + str(repeat))
                        run_folder.mkdir()
                        result["runs"].append(
                            run_workload(
                                browser,
                                f"http://127.0.0.1:{server.server_port}",
                                run_folder,
                                item,
                                repeat,
                                args,
                                core,
                                controls,
                            )
                        )
                        args.output.write_text(
                            json.dumps(result, indent=2, allow_nan=False) + "\n"
                        )
                result["status"] = "invariants_pass"
                result["summary"] = []
                keys = {
                    (r["workload"], a["phase"], a["action"])
                    for r in result["runs"]
                    for a in r["actions"]
                }
                for workload, phase, action in sorted(keys):
                    rows = [
                        a
                        for r in result["runs"]
                        if r["workload"] == workload
                        for a in r["actions"]
                        if a["phase"] == phase and a["action"] == action
                    ]
                    values = [a["wall_ms"] for a in rows]
                    result["summary"].append(
                        {
                            "workload": workload,
                            "phase": phase,
                            "action": action,
                            "observations": len(values),
                            "min_ms": min(values),
                            "median_ms": statistics.median(values),
                            "max_ms": max(values),
                            "heap_after_used_bytes": [
                                r["heap_after"].get("used_bytes") for r in rows
                            ],
                        }
                    )
                # Exact repeated output hashes catch nondeterminism/stale state.
                for workload in args.workloads:
                    runs = [r for r in result["runs"] if r["workload"] == workload]
                    populations = [
                        {
                            phase: {
                                key: value
                                for key, value in output.items()
                                if key != "file_sha256"
                            }
                            for phase, output in r["outputs"].items()
                        }
                        for r in runs
                    ]
                    assert (
                        len(
                            {
                                json.dumps(output, sort_keys=True)
                                for output in populations
                            }
                        )
                        == 1
                    ), (
                        workload
                        + " output population parity changed between fresh contexts"
                    )
            finally:
                browser.close()
    except BaseException as error:
        result["status"] = "failed"
        result["error"] = {"type": type(error).__name__, "message": str(error)}
        raise
    finally:
        server.shutdown()
        server.server_close()
        result["finished_at"] = datetime.now(timezone.utc).isoformat()
        result["machine"]["load_average_end"] = (
            list(os.getloadavg()) if hasattr(os, "getloadavg") else None
        )
        result["owned_processes_closed"] = True
        args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
        print(
            json.dumps(
                {
                    "output": str(args.output),
                    "status": result["status"],
                    "runs": len(result["runs"]),
                }
            ),
            flush=True,
        )


if __name__ == "__main__":
    main()
