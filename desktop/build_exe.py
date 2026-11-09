#!/usr/bin/env python3
"""Build the GeoSuite Desktop EXEs (Windows) with PyInstaller.

The one implementation of the EXE build. build_windows.bat (a maintainer's
Windows laptop) and the public repo's release workflow (GitHub Actions,
windows-latest) both call this, so the two cannot build different EXEs.

Works in both repository layouts:
    orebit-ops:  exe-wrapper/pywebview/build_exe.py, vendor/ beside it
    public repo: desktop/build_exe.py, vendor/ at the repository root

Usage:
    python build_exe.py                      # all three modules
    python build_exe.py Core Assay           # a subset
    python build_exe.py --single             # one artifact: Core + Assay + Resource
    python build_exe.py --skip-html          # reuse dist/*.html already built

Output: dist/Orebit-<Module>.exe (Windows) or dist/Orebit-GeoSuite(-suite) next to
this file. Unsigned.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = next(
    p
    for p in (HERE.parent, HERE.parent.parent)
    if (p / "build" / "build.mjs").is_file()
)
VENDOR = HERE / "vendor" if (HERE / "vendor").is_dir() else ROOT / "vendor"
WEBVIEW2 = HERE / "MicrosoftEdgeWebview2Setup.exe"  # optional offline installer
OUT = HERE / "dist"
WORK = HERE / "build"

# module -> (EXE name, product code read by orebit_wrapper.py, version-info key)
MODULES = {
    "Core": ("Orebit-Core", "CORE", "core"),
    "Assay": ("Orebit-Assay", "ASAY", "assay"),
    "Resource": ("Orebit-Resource", "RSRC", "resource"),
}


def run(cmd: list[str], cwd: Path = HERE) -> None:
    print("  $ " + " ".join(str(c) for c in cmd), flush=True)
    subprocess.run(cmd, cwd=cwd, check=True)


def launcher_html() -> str:
    """The page the single artifact opens: pick a module, one window, one origin."""
    cards = [
        (
            "Core",
            "Drillhole preparation",
            "Import collar, survey, assay and geology; validate, desurvey, interpret the domain.",
        ),
        (
            "Assay",
            "Assay EDA and treatment",
            "Inspect the received population, review top-cut and composites, read the report.",
        ),
        (
            "Resource",
            "Resource estimation",
            "Continuity, block and support, estimation, validation and the handoff report.",
        ),
    ]
    links = "\n".join(
        '      <li><a class="card" href="%s.html"><strong>%s</strong>'
        "<small>%s</small><span>%s</span></a></li>" % (name, name, title, text)
        for name, title, text in cards
    )
    return (
        """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Orebit GeoSuite</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark}
body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f8f9;color:#12202b}
main{max-width:880px;margin:0 auto;padding:48px 20px}
h1{font-size:28px;margin:0 0 6px}
p.lead{margin:0 0 28px;color:#4b5b68}
ul{list-style:none;padding:0;margin:0;display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
a.card{display:block;padding:18px 20px;border:1px solid #d7e0e5;border-radius:12px;background:#fff;color:inherit;text-decoration:none}
a.card:hover{border-color:#0f766e}
a.card strong{display:block;font-size:18px;margin-bottom:4px}
a.card small{display:block;color:#0f766e;margin-bottom:8px}
a.card span{color:#4b5b68;font-size:13px}
@media (prefers-color-scheme:dark){body{background:#101a20;color:#e7eef2}p.lead{color:#9fb1bd}a.card{background:#16242c;border-color:#25373f}a.card span{color:#9fb1bd}}
</style></head><body><main>
<h1>Orebit GeoSuite</h1>
<p class="lead">One window, one project. Pick where to start; changes stay on this machine.</p>
<ul>
%s
</ul>
</main></body></html>
"""
        % links
    )


def _stamp_macos_version(app: Path) -> None:
    """PyInstaller writes 0.0.0; set the version the release actually is."""
    import plistlib

    version = "0.0.0"
    for candidate in (
        ROOT / "ops/scripts/orebit/geosuite-changelog.json",
        ROOT / "package.json",
    ):
        if candidate.is_file():
            data = json.loads(candidate.read_text())
            raw = data.get("current") or data.get("version") or ""
            if raw:
                version = str(raw).lstrip("v")
                break
    info = app / "Contents" / "Info.plist"
    if not info.is_file() or version == "0.0.0":
        return
    with info.open("rb") as f:
        meta = plistlib.load(f)
    meta["CFBundleShortVersionString"] = version
    meta["CFBundleVersion"] = version
    with info.open("wb") as f:
        plistlib.dump(meta, f)


def build_single() -> Path:
    """One artifact carrying Core, Assay and Resource on a single origin.

    SHELL-1: the three pages share one window, one port and one storage, so the
    IndexedDB handoff the web build already uses replaces the APPDATA file
    bridge. `index.html` is the Core page; the module links navigate to the
    sibling pages served from the same directory.
    """
    pages = [ROOT / "dist" / f"{m}.html" for m in MODULES]
    for page in pages:
        if not page.is_file():
            sys.exit(f"ERROR: {page} missing -- run node build/build.mjs first")
    staged = []
    for page in pages:
        target = HERE / page.name
        shutil.copyfile(page, target)
        staged.append(target)
    index = HERE / "index.html"
    index.write_text(launcher_html(), encoding="utf-8")
    staged.append(index)
    sep = os.pathsep
    exe = "Orebit-GeoSuite"
    try:
        args = [
            sys.executable, "-m", "PyInstaller",
            "--onefile", "--windowed", "--clean", "--noconfirm",
            "--name", exe,
            "--version-file", str(WORK / "version_info_suite.txt"),
        ]  # fmt: skip
        icon = HERE / ("orebit.ico" if os.name == "nt" else "orebit.icns")
        if icon.is_file():
            args += ["--icon", str(icon)]
        args += ["--add-data", f"{index}{sep}."]
        for page in pages:
            args += ["--add-data", f"{page}{sep}."]
        args += [
            "--add-data", f"{VENDOR}{sep}vendor",
            "--hidden-import", "tkinter", "--collect-all", "tkinter",
            "--distpath", str(OUT),
            "--workpath", str(WORK / exe),
            "--specpath", str(WORK),
        ]  # fmt: skip
        if WEBVIEW2.is_file():
            args += ["--add-data", f"{WEBVIEW2}{sep}."]
        run(args + [str(HERE / "orebit_wrapper.py")])
    finally:
        for target in staged:
            target.unlink(missing_ok=True)
    if os.name == "nt":
        built = OUT / (exe + ".exe")
    else:
        # A windowed macOS build carries the binary *inside* the bundle; publish
        # and stamp the bundle, not the bare executable beside it.
        app = OUT / (exe + ".app")
        built = app if app.is_dir() else OUT / exe
    if not (built.is_file() or built.is_dir()):
        sys.exit(f"ERROR: PyInstaller did not produce {built}")
    if built.suffix == ".app":
        _stamp_macos_version(built)
    print(f"  {built.name}: {built.stat().st_size:,} bytes\n", flush=True)
    return built


def build_one(module: str) -> Path:
    exe, code, key = MODULES[module]
    html = ROOT / "dist" / f"{module}.html"
    if not html.is_file():
        sys.exit(f"ERROR: {html} missing -- run node build/build.mjs first")
    index, product = HERE / "index.html", HERE / "product.txt"
    shutil.copyfile(html, index)
    product.write_text(code, encoding="ascii")
    sep = os.pathsep  # PyInstaller's --add-data separator (';' on Windows)
    try:
        args = [
            sys.executable, "-m", "PyInstaller",
            "--onefile", "--windowed", "--clean", "--noconfirm",
            "--name", exe,
            "--version-file", str(WORK / f"version_info_{key}.txt"),
            "--add-data", f"{index}{sep}.",
            "--add-data", f"{product}{sep}.",
            "--add-data", f"{VENDOR}{sep}vendor",
            "--hidden-import", "tkinter", "--collect-all", "tkinter",
            "--distpath", str(OUT),
            "--workpath", str(WORK / exe),
            "--specpath", str(WORK),
        ]  # fmt: skip
        if WEBVIEW2.is_file():
            args += ["--add-data", f"{WEBVIEW2}{sep}."]
        run(args + [str(HERE / "orebit_wrapper.py")])
    finally:
        index.unlink(missing_ok=True)
        product.unlink(missing_ok=True)
    built = OUT / f"{exe}.exe"
    if not built.is_file():
        sys.exit(f"ERROR: PyInstaller did not produce {built}")
    print(f"  {built.name}: {built.stat().st_size:,} bytes\n", flush=True)
    return built


def main(argv: list[str]) -> int:
    modules = [a for a in argv if not a.startswith("--")] or list(MODULES)
    unknown = [m for m in modules if m not in MODULES]
    if unknown:
        sys.exit(f"ERROR: unknown module(s) {unknown}; choose from {list(MODULES)}")
    WORK.mkdir(exist_ok=True)
    run([sys.executable, "gen_version_info.py", "--out", str(WORK)])
    if "--skip-html" not in argv:
        run(["node", "build/build.mjs", *modules], cwd=ROOT)
    if "--single" in argv:
        build_single()
        return 0
    for m in modules:
        build_one(m)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
