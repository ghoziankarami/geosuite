"""
Orebit v1.9.4 — UX polish patcher (additive to v1.9.3 shell).

Fixes from UX audit (2026-05-29):
  1. Tour auto-trigger blocked by lang-picker overlay → chain trigger after pick
  2. Phase 02 footer renders inside grid col 1 (sidebar slot) → grid-column: 1/-1
  3. Help button buried in top-right toolbar → floating bottom-right Help bubble
  4. Tutorial wall-of-text overwhelm → "Quick Start" card pinned to top of Tutorial

Safe-inject pattern as v1.9.3:
  - Replaces v1.9.3 block (between V193 markers) with new combined block
  - Single <style>+<script>, before LAST </body>
  - Mutates DOM at runtime, never touches <head>
"""

from pathlib import Path
import argparse
import hashlib
import os
import shutil
import sys

# ─── Patcher configuration (Single Source of Truth) ──────────────────────────
# All environment-specific values live here so the patcher body stays portable.
# Override the vault root via the OREBIT_VAULT_PATH env var (useful for CI and
# for testing against a scratch copy instead of the live vault).


def _find_default_vault() -> str:
    """Auto-detect the GeoSuite vault root by walking up from this file.
    Falls back to the canonical VPS path if no repo marker is found."""
    if os.environ.get("OREBIT_VAULT_PATH"):
        return os.environ["OREBIT_VAULT_PATH"]
    here = os.path.dirname(os.path.abspath(__file__))
    for parent in [here, *list(__import__("pathlib").Path(here).parents)]:
        marker = os.path.join(parent, "AGENTS.md")
        if os.path.exists(marker):
            return os.path.join(
                parent,
                "obsidian-system",
                "vault",
                "Obsidian",
                "1. Projects",
                "GeoSuite",
            )
    return "/home/ubuntu/orebit-ops/obsidian-system/vault/Obsidian/1. Projects/GeoSuite"


_DEFAULT_VAULT = _find_default_vault()

PATCHER_CONFIG = {
    # Vault root that contains the per-phase HTML artifacts (SSOT).
    "vault_path": os.environ.get("OREBIT_VAULT_PATH", _DEFAULT_VAULT),
    # Production URLs injected into the generated HTML shell.
    # Free-first transition (2026-08-17): the in-app "Support Orebit" button
    # used to point at a fixed-price Rp99K Mayar bundle checkout, which is
    # wrong for a voluntary-donation CTA — donors should pick their own
    # amount. DECISION (owner-confirmed live in chat, 2026-08-17): use the
    # owner's own Saweria page instead of Mayar's fundraising type. The
    # owner created https://saweria.co/orebitindonesia themselves, confirmed
    # it renders an open amount field, and personally completed a real test
    # donation through it before authorizing this URL. A verified Mayar
    # "fundraising"-type link also exists as a documented fallback
    # (product id d571b634-626f-434b-9da4-d702d72d07b1, slug
    # "support-orebit", still unlisted/draft) if Saweria ever needs to be
    # swapped out — but Saweria is the live, owner-approved choice. Do not
    # revert this to the Mayar link without a new explicit instruction from
    # the owner.
    "support_url": "https://saweria.co/orebitindonesia",
    "github_releases_url": "https://github.com/ghoziankarami/geosuite/releases",
    "docs_url": "https://geosuite.orebit.id/docs",
    # Origin the Desktop build asks for 03-latest.json. A web build uses a
    # relative path (same origin); an EXE runs from file:, which has no
    # origin to resolve against, so it needs this absolute base.
    "product_base_url": "https://geosuite.orebit.id",
    # In-app feedback entry point (2026-08-20): previously the only feedback
    # prompt was a one-time mailto CTA baked into the license-issuance email
    # (ops/webhooks/mayar-payment.py) — a long-time user who never revisited
    # that email had no path back to send feedback from inside the app.
    "feedback_email": "orebit.id@gmail.com",
}

# Convenience aliases used inside build_block()'s f-string.
SUPPORT_URL = PATCHER_CONFIG["support_url"]
GITHUB_RELEASES_URL = PATCHER_CONFIG["github_releases_url"]
DOCS_URL = PATCHER_CONFIG["docs_url"]
PRODUCT_BASE_URL = PATCHER_CONFIG["product_base_url"]
FEEDBACK_EMAIL = PATCHER_CONFIG["feedback_email"]

# Suffix used for backup files written before any in-place patch.
BACKUP_SUFFIX = ".bak-patch"

PHASE_CFG = {
    "01-Core/Core.html": {
        "pill": "Free Web",
        "label_en": "Orebit Core",
        "label_id": "Orebit Core",
        "tour_storage_key": "orebit-tour-seen-p1",
        "qs_title_en": " New here? Start with the demo data",
        "qs_title_id": " Pertama kali? Mulai dengan data demo",
        "qs_body_en": "We've pre-loaded 40 holes from Thalanga VMS so you can explore every step without uploading anything. Click any tab on the left to see what each step does.",
        "qs_body_id": "Sudah ada 40 hole demo dari Thalanga VMS — kamu bisa eksplor semua tahap tanpa upload apapun. Klik tab di kiri untuk lihat tiap langkah.",
        "qs_cta_en": "Take the 6-step tour →",
        "qs_cta_id": "Ikuti tour 6-langkah →",
    },
    "02-Assay/Assay.html": {
        "pill": "Free Web",
        "label_en": "Orebit Assay",
        "label_id": "Orebit Assay",
        "tour_storage_key": "orebit-tour-seen-p2",
        "qs_title_en": " New here? Start with the demo data",
        "qs_title_id": " Pertama kali? Mulai dengan data demo",
        "qs_body_en": "Composite data from Thalanga is pre-loaded. Walk through 11 EDA steps before resource estimation — start with Upload to load your own, or skip ahead to explore.",
        "qs_body_id": "Data composite Thalanga sudah ter-load. Jalani 11 langkah EDA sebelum resource estimation — mulai dari Upload untuk data sendiri, atau langsung skip ke mana saja.",
        "qs_cta_en": "Take the 6-step tour →",
        "qs_cta_id": "Ikuti tour 6-langkah →",
    },
    "03-Resource/Resource.html": {
        "pill": "Free Web",
        "label_en": "Orebit Resource",
        "label_id": "Orebit Resource",
        "tour_storage_key": "orebit-tour-seen-p3",
        "qs_title_en": " New here? Start with the demo data",
        "qs_title_id": " Pertama kali? Mulai dengan data demo",
        "qs_body_en": "Composite domain data is ready. This is where you build the variogram, run kriging/IDW estimation, and produce a KCMI-aligned report — 12 steps, fully guided.",
        "qs_body_id": "Data composite domain sudah siap. Di sini kamu bangun variogram, run kriging/IDW estimation, dan hasilkan laporan KCMI — 12 langkah, full panduan.",
        "qs_cta_en": "Take the 6-step tour →",
        "qs_cta_id": "Ikuti tour 6-langkah →",
    },
}

V193_START = "<!-- OREBIT_V193_SHELL_START -->"
V193_END = "<!-- OREBIT_V193_SHELL_END -->"
V194_START = "<!-- OREBIT_V194_SHELL_START -->"
V194_END = "<!-- OREBIT_V194_SHELL_END -->"
# Owned by orebit_help_patcher.py. Only read here, to keep this patcher's block
# anchored above it -- see the note in compute_patched_html().
HELP_PANEL_START = "<!-- OREBIT_HELP_PANEL_START -->"


# ─── Template loader ────────────────────────────────────────────────────────
# Large CSS/JS/HTML blocks live as separate files under templates/ to keep this
# module readable. Templates are stored in "f-string source form": literal CSS/JS
# braces are doubled ({{ }}) and Python interpolation placeholders ({pill!r},
# {SUPPORT_URL}, …) appear verbatim, exactly as they did inside the original
# f-string. At runtime we read the file once, cache it, and expand it with
# str.format(**vars) — which reproduces the original f-string output byte-for-byte
# ({{ → { , {name!r} → repr(name), etc.). The only f-string escape the original
# used was \\ → \ (in two JS regexes); templates already store the unescaped
# single-backslash form so no further escape processing is needed.

_TEMPLATE_CACHE: dict[str, str] = {}


def _load_template(name: str) -> str:
    """Read a template file from ops/scripts/patchers/templates/.

    Resolves the path relative to this file (OREBIT_ROOT pattern) so the patcher
    remains portable across CI, VPS, and scratch checkouts. Results are cached
    for reuse — build_block() is called once per phase and templates never
    change during a single run.
    """
    cached = _TEMPLATE_CACHE.get(name)
    if cached is not None:
        return cached
    template_path = Path(__file__).parent / "templates" / name
    text = template_path.read_text(encoding="utf-8")
    _TEMPLATE_CACHE[name] = text
    return text


def build_block(cfg: dict) -> str:
    pill = cfg["pill"]
    label_en = cfg["label_en"]
    label_id = cfg["label_id"]
    tour_key = cfg["tour_storage_key"]
    qs_title_en = cfg["qs_title_en"]
    qs_title_id = cfg["qs_title_id"]
    qs_body_en = cfg["qs_body_en"]
    qs_body_id = cfg["qs_body_id"]
    qs_cta_en = cfg["qs_cta_en"]
    qs_cta_id = cfg["qs_cta_id"]

    # The shell block is assembled from two template files (CSS + JS) stored in
    # templates/ next to this patcher. Templates are kept in "f-string source
    # form": literal CSS/JS braces are doubled ({{ }}) and the per-phase values
    # below are interpolated via str.format(**fmt), reproducing the original
    # inline f-string output byte-for-byte. See _load_template() for details.
    fmt = {
        "V194_START": V194_START,
        "V194_END": V194_END,
        "SUPPORT_URL": SUPPORT_URL,
        "GITHUB_RELEASES_URL": GITHUB_RELEASES_URL,
        "PRODUCT_BASE_URL": PRODUCT_BASE_URL,
        "DOCS_URL": DOCS_URL,
        "FEEDBACK_EMAIL": FEEDBACK_EMAIL,
        "pill": pill,
        "label_en": label_en,
        "label_id": label_id,
        "tour_key": tour_key,
        "qs_title_en": qs_title_en,
        "qs_title_id": qs_title_id,
        "qs_body_en": qs_body_en,
        "qs_body_id": qs_body_id,
        "qs_cta_en": qs_cta_en,
        "qs_cta_id": qs_cta_id,
    }
    css = _load_template("v194_shell.css").format(**fmt)
    js = _load_template("v194_shell.js").format(**fmt)
    # Layout mirrors the original f-string exactly:
    #   \n{V194_START}\n<style>…</style>\n\n<script>…</script>\n{V194_END}\n
    return f"\n{V194_START}\n{css}\n\n{js}\n{V194_END}\n"


def strip_old_block(html: str, start_marker: str, end_marker: str) -> str:
    s = html.find(start_marker)
    e = html.find(end_marker)
    if s == -1 or e == -1:
        return html
    e += len(end_marker)
    if e < len(html) and html[e] == "\n":
        e += 1
    # Also strip whitespace (newlines) immediately BEFORE the start marker
    # so re-running the patcher doesn't accumulate blank lines (idempotency).
    while s > 0 and html[s - 1] in "\n\r":
        s -= 1
    return html[:s] + html[e:]


def compute_patched_html(html: str, cfg: dict) -> tuple[bool, str, str]:
    """Pure transform: strip old shell blocks and inject the v1.9.4 block.

    Returns (ok, message, new_html). Does NOT touch the filesystem, so it can be
    used for dry-run, idempotency checks and the real write path alike.
    """
    # Strip prior versions
    stripped = strip_old_block(html, V194_START, V194_END)
    stripped = strip_old_block(stripped, V193_START, V193_END)

    body_idx = stripped.rfind("</body>")
    if body_idx == -1:
        return False, "No </body> found", html

    # Anchor the injection ABOVE the help panel when one is present.
    #
    # Both patchers used to insert immediately before the last </body>, so
    # whichever ran last ended up closest to </body> and pushed the other block
    # upwards. Each patcher then saw its own block "out of place" and reported
    # DRIFT -- running v194 broke the help patcher's idempotency check and vice
    # versa, forever. The blocks are independent (namespaced .obh-* CSS, no
    # shared globals), so the order between them does not matter functionally;
    # it only has to be STABLE. Fixing it to "v194 shell, then help panel"
    # matches the documented build order in CLAUDE.md 3.1 (step 4 then 4b) and
    # makes both checks idempotent no matter how often either one is re-run.
    help_idx = stripped.find(HELP_PANEL_START)
    anchor = help_idx if 0 <= help_idx < body_idx else body_idx

    # Normalize the run of blank lines immediately before the anchor so that
    # re-injection is byte-stable (idempotent). Without this, each patch run
    # leaves one extra "\n" behind, causing whitespace drift on every deploy.
    head = stripped[:anchor].rstrip("\n") + "\n\n"
    tail = stripped[anchor:]

    block = build_block(cfg)
    new_html = head + block + "\n" + tail
    return True, "OK", new_html


def _md5(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def backup_path_for(path: Path) -> Path:
    """Return the backup path for a given target file."""
    return path.with_suffix(path.suffix + BACKUP_SUFFIX)


def restore_file(path: Path) -> tuple[bool, str]:
    """Restore a file from its .bak-patch backup."""
    bak = backup_path_for(path)
    if not bak.exists():
        return False, f"NO-BACKUP: {path.name} (no {bak.name} found)"
    try:
        shutil.copy2(bak, path)
    except OSError as e:
        return False, f"ERROR restoring {path.name}: {e}"
    return True, f"RESTORED: {path.name} ← {bak.name}"


def patch_file(
    path: Path, cfg: dict, dry_run: bool = False, phase_label: str = ""
) -> tuple[bool, str]:
    """Patch a single file in place, with backup-before-write.

    In dry_run mode nothing is written; we only report what WOULD happen.
    """
    try:
        html = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return False, f"ERROR: file not found: {path}"
    except OSError as e:
        return False, f"ERROR reading {path.name}: {e}"

    original_size = len(html)
    original_hash = _md5(html)
    label = phase_label or path.name

    ok, msg, new_html = compute_patched_html(html, cfg)
    if not ok:
        return False, f"{msg} in {path.name}"

    already = _md5(new_html) == original_hash

    if dry_run:
        state = "already patched (no change)" if already else "would be patched"
        return True, (
            f"[DRY-RUN] {path}\n"
            f"          phase detected : {label}\n"
            f"          action         : {state}\n"
            f"          size           : {original_size:,} -> {len(new_html):,} bytes\n"
            f"          backup         : {backup_path_for(path).name}"
        )

    if already:
        return True, f"UNCHANGED (already patched): {path.name}"

    # Backup before write so a bad patch never destroys the only artifact.
    bak = backup_path_for(path)
    try:
        shutil.copy2(path, bak)
    except OSError as e:
        return False, f"ERROR creating backup {bak.name}: {e}"

    try:
        # newline="" is load-bearing on Windows: default text mode would
        # translate every \n to \r\n, CRLF-ifying a pure-LF artifact and
        # breaking the byte-identity baseline that Tahap 2 of
        # docs/architecture-migration-plan.md is built on.
        path.write_text(new_html, encoding="utf-8", newline="")
    except OSError as e:
        return False, f"ERROR writing {path.name} (backup at {bak.name}): {e}"

    return True, (
        f"OK: {path.name} {original_size:,}->{len(new_html):,} bytes "
        f"(backup: {bak.name})"
    )


def detect_phase(path: Path) -> tuple[str, dict] | tuple[None, None]:
    """Detect which phase a file belongs to.

    First by filename, then (legacy fallback) by sniffing the first 5000 chars.
    Returns (label, cfg) or (None, None) if unknown.
    """
    stem = path.name.replace("-pilot", "").replace("-test", "")
    for rel, cfg in PHASE_CFG.items():
        target = rel.split("/")[-1]
        if target == path.name or target == stem:
            return rel, cfg
    try:
        text = path.read_text(encoding="utf-8")[:5000]
    except OSError:
        return None, None
    if "Core" in text or ("Drillhole" in text and "Prep" in text):
        return "01-Core/Core.html", PHASE_CFG["01-Core/Core.html"]
    if "Assay" in text or ("Drilling" in text and "EDA" in text):
        return "02-Assay/Assay.html", PHASE_CFG["02-Assay/Assay.html"]
    if "Resource" in text and ("Estimat" in text or "Orebit Resource" in text):
        return "03-Resource/Resource.html", PHASE_CFG["03-Resource/Resource.html"]
    return None, None


def idempotency_check(base: Path, allow_drift: bool = False) -> int:
    """Run detection+transform twice in memory; 2nd run must be a no-op.
    ALSO checks for template drift: does the file's CURRENT shell block
    already match what today's templates would produce?

    These are two different properties and this check used to conflate them:
    "idempotent" (patch-twice-is-stable) says nothing about whether the file
    matches the templates *right now* -- a file can be perfectly idempotent
    while still being stale relative to templates/*.js|css, because
    compute_patched_html() always REGENERATES the block from the current
    templates, discarding whatever was in the file first. Before 2026-08-18
    this printed a plain green "already patched" or "patch then stable" with
    IDENTICAL severity and exit code either way -- so a phase HTML file that
    had been hand-edited inside the OREBIT_V194_SHELL markers (invisible,
    silent, no error) still reported a clean ✅, right up until someone ran
    the *real* (non-dry-run) patch and it silently discarded that edit. That
    happened for real: a UI fix landed directly in the phase HTML instead of
    templates/v194_shell.js, this check said ✅ the whole time, and the fix
    was reverted by the next production deploy's patch step.

    Drift ("patch then stable") is now a FAILURE by default -- this check's
    entire purpose is "is it safe to ship," and answering yes when the file
    is about to change out from under you is exactly the failure mode that
    caused the incident above. Pass allow_drift=True (--allow-drift) only
    if you specifically want the old lenient behavior for some reason.
    """
    print("Idempotency + drift self-check (in-memory, no writes):")
    all_ok = True
    for rel, cfg in PHASE_CFG.items():
        p = base / rel
        if not p.exists():
            print(f"  MISSING: {p}")
            all_ok = False
            continue
        try:
            html = p.read_text(encoding="utf-8")
        except OSError as e:
            print(f"  ERROR reading {p.name}: {e}")
            all_ok = False
            continue
        ok1, _, once = compute_patched_html(html, cfg)
        if not ok1:
            print(f"  {p.name}: first transform failed")
            all_ok = False
            continue
        ok2, _, twice = compute_patched_html(once, cfg)
        if not ok2:
            print(f"  {p.name}: second transform failed")
            all_ok = False
            continue
        if _md5(once) != _md5(twice):
            print(f"  🔴 {p.name}: NOT idempotent — second run changes output")
            all_ok = False
            continue
        if _md5(html) == _md5(once):
            print(f"  ✅ {p.name}: idempotent (already patched, no drift)")
            continue
        # Drift: the file's shell block does not match what the current
        # templates would generate. Either the file was hand-edited inside
        # the markers (will be silently discarded on the next real patch),
        # or the templates changed and this file just hasn't been re-patched
        # yet. Either way, running the real patcher right now WOULD change
        # this file -- that is not a safe "already patched" state.
        if allow_drift:
            print(f"  ⚠️  {p.name}: DRIFT from templates (allowed via --allow-drift)")
        else:
            print(
                f"  ❌ {p.name}: DRIFT from current templates — "
                f"running the real patch WOULD change this file. "
                f"If you hand-edited content inside OREBIT_V194_SHELL_START/END, "
                f"that edit is about to be silently discarded — move it into "
                f"ops/scripts/patchers/templates/v194_shell.{{css,js}} instead, "
                f"then re-run this check. If the templates changed intentionally, "
                f"just run the real (non-dry-run) patch to bring this file current."
            )
            all_ok = False
    return 0 if all_ok else 1


def _iter_targets(base: Path):
    for rel, cfg in PHASE_CFG.items():
        yield base / rel, rel, cfg


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Orebit v1.9.4 UX patcher (additive shell injection)."
    )
    parser.add_argument(
        "target",
        nargs="?",
        help="Optional single HTML file to patch (default: all vault phases).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what WOULD be patched (file + detected phase) without writing.",
    )
    parser.add_argument(
        "--restore",
        action="store_true",
        help="Restore target(s) from their .bak-patch backups.",
    )
    parser.add_argument(
        "--check-idempotent",
        action="store_true",
        help="In-memory idempotency + template-drift self-check (no writes). "
        "Fails if any phase's shell block doesn't match current templates.",
    )
    parser.add_argument(
        "--allow-drift",
        action="store_true",
        help="With --check-idempotent: report template drift as a warning "
        "instead of a failure. Rarely what you want -- see the docstring "
        "on idempotency_check().",
    )
    args = parser.parse_args()

    base = Path(PATCHER_CONFIG["vault_path"])

    if args.check_idempotent:
        return idempotency_check(base, allow_drift=args.allow_drift)

    # Single explicit target file.
    if args.target:
        p = Path(args.target)
        if args.restore:
            ok, msg = restore_file(p)
            print(msg)
            return 0 if ok else 1
        label, cfg = detect_phase(p)
        if cfg is None:
            print(f"Unknown phase for {p}")
            return 1
        ok, msg = patch_file(p, cfg, dry_run=args.dry_run, phase_label=label)
        print(msg)
        return 0 if ok else 1

    # All vault phases.
    rc = 0
    for p, rel, cfg in _iter_targets(base):
        if args.restore:
            ok, msg = restore_file(p)
            print(msg)
            if not ok:
                rc = 1
            continue
        if not p.exists():
            print(f"MISSING: {p}")
            rc = 1
            continue
        ok, msg = patch_file(p, cfg, dry_run=args.dry_run, phase_label=rel)
        print(msg)
        if not ok:
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
