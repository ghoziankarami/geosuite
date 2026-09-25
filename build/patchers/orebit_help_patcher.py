#!/usr/bin/env python3
"""orebit_help_patcher.py — inject the in-app documentation panel.

WHAT IT DOES
    Embeds the product documentation into each phase HTML so a geologist can
    get an answer without leaving the tool — offline, in either language, and
    filtered to whichever tab they are standing on.

WHERE THE CONTENT COMES FROM
    sites/geosuite.orebit.id/docs/index.html is the single source. This patcher
    calls docs-tool.py's exporter to turn that content into a compact bundle and
    embeds it. Nothing here is authored by hand, so the app, the website and
    (later) the PDF cannot disagree.

RUN ORDER
    Run this AFTER orebit_v194_patcher.py. The v194 patcher renders the floating
    "?" bubble; this panel adds one item to that bubble's menu rather than
    introducing a second help affordance. (It polls for the menu at runtime, so
    it degrades to a header button if v194 has not run.)

    1. edit exe-wrapper/pywebview/phases/$Phase.html
    2. bump geosuite-changelog.json + version-sync-guard.sh --fix
    3. python3 build.py                      (copies into the vault)
    4. python3 ops/scripts/patchers/orebit_v194_patcher.py
    5. python3 ops/scripts/patchers/orebit_help_patcher.py   <-- this
    6. deploy

USAGE
    python3 orebit_help_patcher.py                     patch all vault phases
    python3 orebit_help_patcher.py <file.html>         patch one file
    python3 orebit_help_patcher.py --dry-run           report, change nothing
    python3 orebit_help_patcher.py --check-idempotent  verify re-runs are no-ops
    python3 orebit_help_patcher.py --restore           undo from .bak-help
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HELP_START = "<!-- OREBIT_HELP_PANEL_START -->"
HELP_END = "<!-- OREBIT_HELP_PANEL_END -->"

DOCS_URL = "https://geosuite.orebit.id/docs/"


def _repo_root() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        # AGENTS.md marks orebit-ops; build/build.mjs also marks the public
        # GeoSuite tree (ops/opensource/export-public.py), which has no AGENTS.md.
        if (parent / "AGENTS.md").exists() or (parent / "build" / "build.mjs").exists():
            return parent
    return here.parents[3]


REPO = _repo_root()
# orebit-ops keeps the user manual with the website; the public tree keeps it at docs/manual/.
DOCS_TOOL = next((p for p in (REPO / "sites/geosuite.orebit.id/docs/docs-tool.py",
                              REPO / "docs/manual/docs-tool.py") if p.exists()),
                 REPO / "sites/geosuite.orebit.id/docs/docs-tool.py")
TEMPLATES = Path(__file__).parent / "templates"


def _default_vault() -> Path:
    if os.environ.get("OREBIT_VAULT_PATH"):
        return Path(os.environ["OREBIT_VAULT_PATH"])
    return REPO / "obsidian-system/vault/Obsidian/1. Projects/GeoSuite"


# ── Tab → documentation mapping ─────────────────────────────────────────────
# Key is the 1-based tab index (matching the showTab(N) handler on each .tab
# button). Value is a list of "section/page" routes; a "#symptom-key" suffix
# deep-links straight into one troubleshooting entry.
#
# The mapping is the whole point of the feature: it turns "here is the manual"
# into "here is the answer to the question you are most likely asking right
# now". Keep it short per tab — three or four entries, most relevant first.
TAB_MAP: dict[str, dict[str, list[str]]] = {
    "Core": {
        "1":  ["start/overview", "start/quickstart"],
        "2":  ["start/data", "trouble/index#columns-not-detected"],
        "3":  ["start/data", "ref/validation"],
        "4":  ["start/data", "trouble/index#holes-point-up"],
        "5":  ["start/data", "workflows/qaqc"],
        "6":  ["start/data", "ref/domains"],
        "7":  ["ref/validation", "workflows/qaqc"],
        "8":  ["workflows/prepare", "start/data"],
        "9":  ["workflows/prepare"],
        "10": ["concepts/desurvey", "trouble/index#holes-point-up", "workflows/prepare"],
        "11": ["workflows/prepare"],
        "12": ["workflows/prepare", "workflows/blocksize"],
        "13": ["workflows/prepare", "workflows/reporting"],
    },
    "Assay": {
        "1":  ["start/overview"],
        "2":  ["start/data", "trouble/index#columns-not-detected"],
        "3":  ["start/data"],
        "4":  ["workflows/topcut"],
        "5":  ["ref/domains"],
        "6":  ["workflows/blocksize", "workflows/variogram"],
        "7":  ["workflows/prepare"],
        "8":  ["workflows/topcut", "concepts/declustering"],
        "9":  ["workflows/topcut"],
        "10": ["ref/domains"],
        "11": ["ref/domains", "concepts/declustering"],
        "12": ["workflows/reporting"],
    },
    "Resource": {
        "1":  ["start/overview", "workflows/estimate"],
        "2":  ["start/data", "trouble/index#columns-not-detected"],
        "3":  ["concepts/declustering", "workflows/topcut", "ref/estimation"],
        "4":  ["ref/variography", "workflows/variogram", "trouble/index#flat-variogram"],
        "5":  ["workflows/blocksize", "ref/estimation"],
        "6":  ["ref/estimation", "workflows/estimate", "trouble/index#low-reach",
               "trouble/index#over-smooth"],
        "7":  ["workflows/estimate", "trouble/index#crossval-slope"],
        "8":  ["concepts/swath", "workflows/estimate"],
        "9":  ["ref/confidence", "concepts/not-classification"],
        "10": ["trouble/index#tonnage-wrong", "workflows/reporting"],
        "11": ["workflows/estimate"],
        "12": ["workflows/reporting", "concepts/not-classification"],
    },
}

PHASES = {
    "01-Core/Core.html": "Core",
    "02-Assay/Assay.html": "Assay",
    "03-Resource/Resource.html": "Resource",
}

_BUNDLE_CACHE: str | None = None


def help_bundle() -> str:
    """Export the documentation bundle via docs-tool.py (the one source)."""
    global _BUNDLE_CACHE
    if _BUNDLE_CACHE is not None:
        return _BUNDLE_CACHE
    if not DOCS_TOOL.is_file():
        raise SystemExit(f"docs-tool.py not found at {DOCS_TOOL}")
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    r = subprocess.run(
        [sys.executable, str(DOCS_TOOL), "export-help"],
        capture_output=True, env=env,
    )
    if r.returncode != 0 or not r.stdout.strip():
        raise SystemExit(
            "docs-tool.py export-help failed:\n"
            + r.stderr.decode("utf-8", "replace")
        )
    # Guard the embedding context: a literal "</script>" inside any string
    # would terminate the host <script> element early.
    _BUNDLE_CACHE = r.stdout.decode("utf-8").replace("</", "<\\/")
    return _BUNDLE_CACHE


def build_block(phase: str) -> str:
    css = (TEMPLATES / "help_panel.css").read_text(encoding="utf-8").rstrip("\n")
    js = (TEMPLATES / "help_panel.js").read_text(encoding="utf-8").rstrip("\n")
    js = (js
          .replace("__OB_HELP_DATA__", help_bundle())
          .replace("__OB_TAB_MAP__", json.dumps(TAB_MAP[phase], separators=(",", ":")))
          .replace("__OB_PHASE__", phase)
          .replace("__OB_DOCS_URL__", DOCS_URL))
    return f"\n{HELP_START}\n{css}\n\n{js}\n{HELP_END}\n"


def strip_old(html: str) -> str:
    """Exact inverse of the insertion in compute().

    build_block() emits the block with exactly ONE leading newline and one
    trailing newline, so removal must take back exactly those two and nothing
    else. An earlier version greedily ate every newline before the marker,
    which also swallowed the blank line separating the preceding v194 block —
    making strip+reinject lossy and the idempotency check report false drift.
    """
    s = html.find(HELP_START)
    e = html.find(HELP_END)
    if s == -1 or e == -1:
        return html
    e += len(HELP_END)
    if e < len(html) and html[e] == "\n":
        e += 1
    if s > 0 and html[s - 1] == "\n":
        s -= 1
    return html[:s] + html[e:]


def compute(html: str, phase: str) -> tuple[bool, str]:
    """Return (changed, new_html). Injects before the LAST </body>."""
    stripped = strip_old(html)
    block = build_block(phase)
    idx = stripped.rfind("</body>")
    if idx == -1:
        return False, html
    out = stripped[:idx] + block + stripped[idx:]
    return out != html, out


def detect_phase(path: Path) -> str | None:
    for rel, name in PHASES.items():
        if Path(rel).name == path.name:
            return name
    stem = path.name.replace("-test", "").replace("-pilot", "")
    for rel, name in PHASES.items():
        if Path(rel).name == stem:
            return name
    return None


def _md5(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def patch_file(path: Path, dry_run: bool = False) -> tuple[bool, str]:
    if not path.is_file():
        return False, f"SKIP  {path} (not found)"
    phase = detect_phase(path)
    if not phase:
        return False, f"SKIP  {path.name} (unknown phase)"
    html = path.read_text(encoding="utf-8")
    changed, new = compute(html, phase)
    if not changed:
        return False, f"OK    {path.name} — already current"
    if dry_run:
        d = (len(new) - len(html)) / 1024
        return True, f"WOULD {path.name} — {phase}, {d:+.0f} KB"
    bak = path.with_suffix(path.suffix + ".bak-help")
    if not bak.exists():
        shutil.copy2(path, bak)
    # newline="" preserves the file's LF endings on Windows (default text
    # mode would CRLF-ify it and break the byte-identity baseline).
    path.write_text(new, encoding="utf-8", newline="")
    d = (len(new) - len(html)) / 1024
    return True, f"PATCH {path.name} — {phase}, {d:+.0f} KB, md5 {_md5(new)[:8]}"


def restore(path: Path) -> str:
    bak = path.with_suffix(path.suffix + ".bak-help")
    if not bak.exists():
        return f"SKIP  {path.name} (no backup)"
    shutil.copy2(bak, path)
    return f"REST  {path.name}"


def check_idempotent(targets: list[Path]) -> int:
    """Patch twice in memory; the second pass must be a no-op."""
    bad = 0
    for p in targets:
        if not p.is_file():
            print(f"  SKIP {p.name} (not found)")
            continue
        phase = detect_phase(p)
        if not phase:
            continue
        html = p.read_text(encoding="utf-8")
        _, once = compute(html, phase)
        changed_again, twice = compute(once, phase)
        if changed_again or once != twice:
            print(f"  FAIL {p.name}: second pass changed the file")
            bad += 1
        else:
            print(f"  OK   {p.name}: idempotent")
        # Drift: does what is in the file already match today's templates?
        if p.read_text(encoding="utf-8") != once:
            print(f"       {p.name}: file differs from current templates "
                  f"(re-run the patcher to refresh)")
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Inject the Orebit in-app help panel.")
    ap.add_argument("target", nargs="?", help="single HTML file (default: all vault phases)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--check-idempotent", action="store_true")
    ap.add_argument("--restore", action="store_true")
    ap.add_argument("--vault", default=str(_default_vault()))
    a = ap.parse_args()

    if a.target:
        targets = [Path(a.target)]
    else:
        base = Path(a.vault)
        targets = [base / rel for rel in PHASES]

    if a.check_idempotent:
        print("=== help panel idempotency ===")
        return check_idempotent(targets)

    if a.restore:
        for p in targets:
            print("  " + restore(p))
        return 0

    print("=== Orebit help panel patcher ===")
    print(f"  bundle: {len(help_bundle())/1024:.0f} KB")
    rc = 0
    for p in targets:
        try:
            _, msg = patch_file(p, dry_run=a.dry_run)
        except Exception as exc:                     # never leave a half-written file
            msg, rc = f"ERROR {p.name}: {exc}", 1
        print("  " + msg)
    return rc


if __name__ == "__main__":
    sys.exit(main())
