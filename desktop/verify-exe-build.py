#!/usr/bin/env python3
"""
verify-exe-build.py — Extract and verify Orebit EXE contains the expected
HTML version, profile auto-populate logic, and runtime token injection.

Usage:
    python3 verify-exe-build.py /path/to/Orebit-Resource.exe v2.6.0
"""

import json
import re
import sys
from pathlib import Path

try:
    from PyInstaller.archive.readers import CArchiveReader
except ImportError:
    sys.exit("PyInstaller is required: pip install pyinstaller")


def expected_version() -> str:
    """Read the authoritative version from geosuite-changelog.json (SSOT).

    Resolves the changelog path relative to this file (auto-detect repo root)
    instead of a hardcoded absolute path, so it also works on CI runners
    (GitHub Actions), not just the VPS. Prior hardcoded path made CI fall back
    to a stale literal v2.6.1 and reject new builds (2026-08-10 v2.6.3).
    """
    here = Path(__file__).resolve()
    for parent in [here, *here.parents]:
        cand = parent / "ops" / "scripts" / "orebit" / "geosuite-changelog.json"
        if cand.exists():
            try:
                return json.loads(cand.read_text(encoding="utf-8"))["current"]
            except Exception as e:
                print(f"⚠ could not parse changelog SSOT ({e}); falling back")
                break
    # Public repo layout (desktop/verify-exe-build.py): package.json at the root.
    pkg = here.parent.parent / "package.json"
    if pkg.is_file():
        return "v" + json.loads(pkg.read_text(encoding="utf-8"))["version"].lstrip("v")
    return "v0.0.0"


def extract_index_html(exe_path: Path) -> bytes:
    reader = CArchiveReader(str(exe_path))
    for name in reader.toc:
        if str(name) == "index.html":
            return reader.extract(name)
    raise FileNotFoundError(f"index.html not found inside {exe_path}")


def list_exe_files(exe_path: Path) -> set:
    reader = CArchiveReader(str(exe_path))
    files = set()
    for name in reader.toc:
        key = name[0] if isinstance(name, tuple) else name
        files.add(str(key).replace("\\", "/"))
    return files


def verify(exe_path: Path, expected_version: str) -> dict:
    result = {
        "exe": str(exe_path),
        "expected_version": expected_version,
        "ok": True,
        "checks": {},
    }

    try:
        data = extract_index_html(exe_path)
        html = data.decode("utf-8", errors="replace")
    except Exception as e:
        result["ok"] = False
        result["error"] = f"Failed to extract index.html: {e}"
        return result

    # 1. Version in meta tag
    m = re.search(r'<meta name="product-version" content="([^"]+)"', html)
    found_version = m.group(1) if m else None
    result["checks"]["product_version"] = {
        "expected": expected_version,
        "found": found_version,
        "ok": found_version == expected_version,
    }

    # 2. inject-guard present
    has_guard = "__orebit_guard__" in html
    result["checks"]["inject_guard"] = {
        "ok": has_guard,
        "detail": "__orebit_guard__ marker present"
        if has_guard
        else "missing __orebit_guard__ marker",
    }

    # 3. Profile auto-populate injection present
    result["checks"]["profile_autopopulate"] = {
        "ok": "orebit_profile" in html and "__OREBIT_RT__" in html,
        "detail": "localStorage profile auto-populate present",
    }

    # 4. New v2.6.0 features (injection points)
    result["checks"]["profile_avatar_injection"] = {
        "ok": "injectProfileAvatar" in html,
        "detail": "Profile avatar injector present",
    }

    # 5. Vendor libraries bundled for offline EXE use
    exe_files = list_exe_files(exe_path)
    required_vendor = [
        "vendor/plotly.min.js",
        "vendor/jszip.min.js",
        "vendor/jspdf.umd.min.js",
        "vendor/html2canvas.min.js",
    ]
    missing_vendor = [v for v in required_vendor if v not in exe_files]
    result["checks"]["vendor_bundled"] = {
        "ok": not missing_vendor,
        "detail": "all required vendor files bundled"
        if not missing_vendor
        else f"missing: {', '.join(missing_vendor)}",
    }

    # 6. product.txt bundled, and NO licence machinery: since v3.0.0 GeoSuite is
    # GPL-3.0 with no activation, so a licence gate shipping in an EXE means the
    # build script regressed to a pre-3.0 invocation.
    leftover = [
        f
        for f in exe_files
        if f in ("license_gate.py", "license_verify.py", "machine_id.py")
        or f.rsplit("/", 1)[-1] in ("verify-license.js", "license-gate-ui.js")
        or "nacl" in f.lower()
    ]
    result["checks"]["product_txt_and_no_license_gate"] = {
        "ok": "product.txt" in exe_files and not leftover,
        "detail": "product.txt bundled, no licence modules"
        if "product.txt" in exe_files and not leftover
        else f"product.txt present={'product.txt' in exe_files}; leftover licence files: {leftover}",
    }

    result["ok"] = all(c["ok"] for c in result["checks"].values())
    return result


if __name__ == "__main__":
    if len(sys.argv) == 1:
        exe_dir = Path("dist")
        exes = [
            ("Core", exe_dir / "Orebit-Core.exe"),
            ("Assay", exe_dir / "Orebit-Assay.exe"),
            ("Resource", exe_dir / "Orebit-Resource.exe"),
        ]
    elif len(sys.argv) == 2:
        p = Path(sys.argv[1])
        exes = [(p.stem, p)]
    else:
        exes = []
        for arg in sys.argv[1:]:
            p = Path(arg)
            if p.exists():
                exes.append((p.stem, p))
            else:
                print(f"❌ not found: {p}")
                sys.exit(1)

    all_ok = True
    for name, path in exes:
        if not path.exists():
            print(f"❌ {name}: {path} not found")
            all_ok = False
            continue
        r = verify(path, expected_version())
        status = "✅ PASS" if r["ok"] else "❌ FAIL"
        print(f"{status} {name} ({r['exe']})")
        for check, detail in r["checks"].items():
            mark = "  ✅" if detail["ok"] else "  ❌"
            print(f"{mark} {check}: {detail}")
        if not r["ok"]:
            all_ok = False

    sys.exit(0 if all_ok else 1)
