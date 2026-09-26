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
    python build_exe.py --skip-html          # reuse dist/*.html already built

Output: dist/Orebit-<Module>.exe next to this file. Unsigned.
"""

from __future__ import annotations

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
        run([sys.executable, "inject-guard.py", str(index)])
        args = [
            sys.executable, "-m", "PyInstaller",
            "--onefile", "--windowed", "--clean", "--noconfirm",
            "--name", exe,
            "--icon", str(HERE / "orebit.ico"),
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
    for m in modules:
        build_one(m)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
