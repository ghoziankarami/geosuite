#!/usr/bin/env python3
"""docs-tool.py — maintenance tool for the single-file GeoSuite documentation.

WHY THIS EXISTS
    docs/index.html ships as one self-contained file so a geologist can save it
    and read it offline at site. That is good for users and bad for whoever has
    to edit it: 175 KB in one file means grep returns 70 KB lines and reading
    the file to find one paragraph is wasteful.

    This tool makes the single file behave like a multi-file docs tree WITHOUT
    splitting it. Every command prints line numbers, so you can open exactly the
    range you need instead of the whole file.

USAGE
    python docs-tool.py map                  every section/page + line number
    python docs-tool.py find <query>         search content, print route + line
    python docs-tool.py show <route>         one page as plain text
    python docs-tool.py verify               list all "needs verification" notes
    python docs-tool.py check                lint: syntax, EN/ID parity, links, images
    python docs-tool.py stats                size and content counts

TYPICAL EDIT LOOP
    python docs-tool.py find "nugget"        ->  ref/variography  line 1461
    (read only lines 1450-1500, edit there)
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
INDEX = HERE / "index.html"
REPO_ROOT = HERE.parents[2]  # sites/geosuite.orebit.id/docs -> repo root
CHANGELOG = REPO_ROOT / "ops/scripts/orebit/geosuite-changelog.json"

C_DIM, C_B, C_OK, C_WARN, C_BAD, C_OFF = "\033[2m", "\033[1m", "\033[32m", "\033[33m", "\033[31m", "\033[0m"
if not sys.stdout.isatty():
    C_DIM = C_B = C_OK = C_WARN = C_BAD = C_OFF = ""


# ----------------------------------------------------------------- loading
def read_html() -> str:
    return INDEX.read_text(encoding="utf-8")


def extract_docs_js(html: str) -> str:
    """Slice out `var VERSION … var DOCS = [ … ];` — the data, not the renderer."""
    start = html.index("var VERSION")
    end = html.index("/* ==================================================================\n   RENDERER")
    return html[start:end]


def load_docs() -> list:
    """Evaluate the DOCS literal in node and return it as Python data.

    Node is used rather than a hand-rolled parser so the tool always agrees
    with what the browser actually sees — there is one source of truth.
    """
    js = extract_docs_js(read_html())
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / "docs.js"
        f.write_text(js + "\nprocess.stdout.write(JSON.stringify({v:VERSION,d:DOCS}));\n", encoding="utf-8")
        r = subprocess.run(["node", str(f)], capture_output=True, text=True, encoding="utf-8")
        if r.returncode != 0:
            print(f"{C_BAD}JavaScript in index.html does not parse:{C_OFF}\n{r.stderr}")
            sys.exit(1)
        return json.loads(r.stdout)


def line_index(html: str, docs=None) -> dict[str, int]:
    """Map every "section/page" route to the 1-based line where it is declared.

    Keyed by full route, not by bare slug: two sections both have a page called
    `index`, and keying on the slug alone silently pointed both at the first one.
    """
    lines = html.split("\n")
    # Section declarations look like:  id:'workflows', en:'Workflows', id_:'…'
    sec_lines: list[tuple[str, int]] = []
    for n, line in enumerate(lines, 1):
        m = re.search(r"^\s*id:'([a-z0-9-]+)',\s*en:'[^']*',\s*id_:", line)
        if m:
            sec_lines.append((m.group(1), n))

    out: dict[str, int] = {}
    for i, (sec_id, start) in enumerate(sec_lines):
        end = sec_lines[i + 1][1] if i + 1 < len(sec_lines) else len(lines) + 1
        for n in range(start, end):
            m = re.search(r"^\s*id:'([a-z0-9-]+)',\s*$", lines[n - 1])
            if m:
                route = f"{sec_id}/{m.group(1)}"
                out.setdefault(route, n)
    return out


def flatten(docs) -> list[dict]:
    flat = []
    for sec in docs:
        for pg in sec["pages"]:
            flat.append({"sec": sec, "page": pg, "route": f"{sec['id']}/{pg['id']}"})
    return flat


def strip_tags(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s)).strip()


def walk_text(blocks, lang="en"):
    """Yield (kind, text) for every translatable string in a block list."""
    def pick(n):
        if n is None:
            return ""
        if isinstance(n, str):
            return n
        return n.get(lang) or n.get("en") or ""

    for b in blocks:
        t = b.get("t")
        if t in ("p", "h", "note"):
            yield t, pick(b)
        elif t in ("ul", "steps"):
            for i in b.get("items", []):
                yield t, pick(i)
        elif t == "table":
            for h in b.get("head", []):
                yield "th", pick(h)
            for row in b.get("rows", []):
                for c in row:
                    yield "td", pick(c)
        elif t == "fig":
            yield "fig", pick(b)
        elif t == "cards":
            for c in b.get("items", []):
                yield "card", pick({"en": c.get("en"), "id": c.get("id")})
                yield "card", pick({"en": c.get("den"), "id": c.get("did")})
        elif t == "sx":
            for s in b.get("items", []):
                yield "q", pick(s.get("q"))
                yield from walk_text(s.get("a", []), lang)


# ----------------------------------------------------------------- commands
def cmd_map():
    data = load_docs()
    lines = line_index(read_html())
    print(f"{C_B}GeoSuite docs — {data['v']}{C_OFF}   {INDEX}\n")
    total = 0
    for sec in data["d"]:
        print(f"{C_B}{sec['en']}{C_OFF} {C_DIM}({sec['id']}/){C_OFF}")
        for pg in sec["pages"]:
            ln = lines.get(f"{sec['id']}/{pg['id']}", 0)
            nb = len(pg["blocks"])
            total += nb
            print(f"   {C_DIM}L{ln:<5}{C_OFF} {sec['id']}/{pg['id']:<20} {pg['en']}  {C_DIM}({nb} blocks){C_OFF}")
        print()
    print(f"{C_DIM}{len(flatten(data['d']))} pages · {total} blocks{C_OFF}")


def cmd_find(query: str):
    data = load_docs()
    lines = line_index(read_html())
    html_lines = read_html().split("\n")
    q = query.lower()
    hits = 0

    for e in flatten(data["d"]):
        page_line = lines.get(e["route"], 0)
        matches = []
        for lang in ("en", "id"):
            for kind, text in walk_text(e["page"]["blocks"], lang):
                flat = strip_tags(text)
                if q in flat.lower():
                    matches.append((lang, kind, flat))
        if e["page"]["en"].lower().find(q) >= 0:
            matches.insert(0, ("--", "title", e["page"]["en"]))
        if not matches:
            continue

        hits += 1
        print(f"\n{C_B}{e['route']}{C_OFF}  {C_DIM}(page starts L{page_line}){C_OFF}")
        seen = set()
        for lang, kind, flat in matches[:6]:
            if flat in seen:
                continue
            seen.add(flat)
            # locate the actual source line for this string
            needle = flat[:40]
            src = next((n for n, l in enumerate(html_lines, 1)
                        if n >= page_line and needle[:30] in strip_tags(l)), page_line)
            i = flat.lower().index(q) if q in flat.lower() else 0
            snip = flat[max(0, i - 40): i + 70]
            print(f"   {C_DIM}L{src:<5} [{lang}/{kind}]{C_OFF} …{snip}…")

    if not hits:
        print(f"{C_WARN}No match for {query!r}.{C_OFF}")
    else:
        print(f"\n{C_DIM}{hits} page(s) matched.{C_OFF}")


def cmd_show(route: str):
    data = load_docs()
    e = next((x for x in flatten(data["d"]) if x["route"] == route), None)
    if not e:
        print(f"{C_BAD}No such route: {route}{C_OFF}\nRun `docs-tool.py map` for the list.")
        sys.exit(1)
    pg = e["page"]
    print(f"{C_B}{pg['en']}{C_OFF}  {C_DIM}/ {pg.get('id_','')}{C_OFF}\n")
    if pg.get("lede"):
        print(strip_tags(pg["lede"]["en"]) + "\n")
    for kind, text in walk_text(pg["blocks"], "en"):
        flat = strip_tags(text)
        if not flat:
            continue
        if kind == "h":
            print(f"\n{C_B}## {flat}{C_OFF}")
        elif kind == "note":
            print(f"  {C_WARN}! {flat}{C_OFF}")
        elif kind in ("ul", "steps"):
            print(f"  - {flat}")
        elif kind in ("th", "td"):
            print(f"    | {flat}")
        else:
            print(flat)


def cmd_verify():
    data = load_docs()
    lines = line_index(read_html())
    n = 0
    print(f"{C_B}Claims flagged for your review{C_OFF}\n")
    for e in flatten(data["d"]):
        for b in _iter_blocks(e["page"]["blocks"]):
            if b.get("t") == "note" and b.get("k") == "verify":
                n += 1
                ln = lines.get(e["route"], 0)
                print(f"{C_WARN}{n}.{C_OFF} {C_B}{e['route']}{C_OFF} {C_DIM}(page L{ln}){C_OFF}")
                print(f"   {strip_tags(b.get('en',''))}\n")
    print(f"{C_DIM}{n} item(s) need a domain expert sign-off.{C_OFF}"
          if n else f"{C_OK}Nothing pending.{C_OFF}")


def _iter_blocks(blocks):
    for b in blocks:
        yield b
        if b.get("t") == "sx":
            for s in b.get("items", []):
                yield from _iter_blocks(s.get("a", []))


def cmd_check():
    html = read_html()
    data = load_docs()
    flat = flatten(data["d"])
    routes = {e["route"] for e in flat}
    problems: list[str] = []
    notes: list[str] = []

    # 1. EN/ID parity — every translatable node must carry both languages.
    missing = 0
    for e in flat:
        for b in _iter_blocks(e["page"]["blocks"]):
            for node in _translatable(b):
                if isinstance(node, dict) and node.get("en") and not node.get("id"):
                    missing += 1
                    if missing <= 5:
                        problems.append(f"missing ID translation in {e['route']}: "
                                        f"{strip_tags(node['en'])[:60]}…")
        if not e["page"].get("id_"):
            problems.append(f"page {e['route']} has no Indonesian title (id_)")
    if missing > 5:
        problems.append(f"…and {missing - 5} more untranslated strings")

    # 2. Internal links must resolve to a real route.
    for m in re.finditer(r'href="#/([a-z0-9-]+/[a-z0-9-]+)"', html):
        if m.group(1) not in routes:
            problems.append(f"dead internal link: #/{m.group(1)}")
    for e in flat:
        for b in _iter_blocks(e["page"]["blocks"]):
            if b.get("t") == "cards":
                for c in b.get("items", []):
                    if c.get("to") not in routes:
                        problems.append(f"dead card link in {e['route']}: {c.get('to')}")

    # 3. Every referenced screenshot must exist on disk.
    for e in flat:
        for b in _iter_blocks(e["page"]["blocks"]):
            if b.get("t") == "fig":
                p = HERE.parent / b["src"].lstrip("/")
                if not p.is_file():
                    problems.append(f"missing image {b['src']} (in {e['route']})")

    # 4. Version must match the changelog SSOT.
    meta = re.search(r'name="docs-version" content="(v[\d.]+)"', html)
    if not meta:
        problems.append("no <meta name=\"docs-version\"> anchor for version-sync-guard")
    elif CHANGELOG.is_file():
        ssot = json.loads(CHANGELOG.read_text(encoding="utf-8"))["current"]
        if meta.group(1) != ssot:
            problems.append(f"version drift: docs says {meta.group(1)}, SSOT says {ssot}")
        else:
            notes.append(f"version {ssot} matches SSOT")

    # 5. Unused screenshots — not an error, but worth knowing.
    used = {b["src"] for e in flat for b in _iter_blocks(e["page"]["blocks"]) if b.get("t") == "fig"}
    shots = HERE / "screenshots" / "docs"
    if shots.is_dir():
        unused = [f.name for f in sorted(shots.iterdir())
                  if f.is_file() and f"/docs/screenshots/docs/{f.name}" not in used]
        if unused:
            notes.append(f"{len(unused)} screenshot(s) not referenced: {', '.join(unused[:6])}"
                         + ("…" if len(unused) > 6 else ""))

    # 6. Size budget — the offline promise dies if this file gets huge.
    kb = INDEX.stat().st_size / 1024
    notes.append(f"file size {kb:.0f} KB")
    if kb > 400:
        problems.append(f"file is {kb:.0f} KB — over the 400 KB offline budget")

    print(f"{C_B}docs-tool check{C_OFF}\n")
    for n in notes:
        print(f"  {C_DIM}·{C_OFF} {n}")
    print()
    if problems:
        for p in problems:
            print(f"  {C_BAD}✗{C_OFF} {p}")
        print(f"\n{C_BAD}{len(problems)} problem(s).{C_OFF}")
        sys.exit(1)
    print(f"  {C_OK}✓ JavaScript parses{C_OFF}")
    print(f"  {C_OK}✓ EN/ID parity complete{C_OFF}")
    print(f"  {C_OK}✓ all internal links resolve{C_OFF}")
    print(f"  {C_OK}✓ all screenshots present{C_OFF}")
    print(f"\n{C_OK}All checks passed.{C_OFF}")


def _translatable(b):
    """Yield every {en,id} node inside a block."""
    t = b.get("t")
    if t in ("p", "h", "note", "fig"):
        yield b
    elif t in ("ul", "steps"):
        yield from b.get("items", [])
    elif t == "table":
        yield from b.get("head", [])
        for row in b.get("rows", []):
            yield from row
    elif t == "sx":
        for s in b.get("items", []):
            yield s.get("q", {})


def cmd_stats():
    data = load_docs()
    flat = flatten(data["d"])
    kinds: dict[str, int] = {}
    words_en = words_id = 0
    for e in flat:
        for b in _iter_blocks(e["page"]["blocks"]):
            kinds[b.get("t", "?")] = kinds.get(b.get("t", "?"), 0) + 1
        words_en += sum(len(strip_tags(t).split()) for _, t in walk_text(e["page"]["blocks"], "en"))
        words_id += sum(len(strip_tags(t).split()) for _, t in walk_text(e["page"]["blocks"], "id"))

    print(f"{C_B}GeoSuite docs {data['v']}{C_OFF}\n")
    print(f"  sections      {len(data['d'])}")
    print(f"  pages         {len(flat)}")
    print(f"  words (EN)    {words_en:,}")
    print(f"  words (ID)    {words_id:,}")
    print(f"  file size     {INDEX.stat().st_size/1024:.0f} KB")
    print(f"\n  {C_DIM}blocks by type{C_OFF}")
    for k, v in sorted(kinds.items(), key=lambda x: -x[1]):
        print(f"    {k:<8} {v}")


def cmd_export_help(out_path: str | None = None, with_figures: bool = False):
    """Emit the in-app help bundle: the same DOCS content, minus what an
    offline desktop build cannot show.

    Screenshots are dropped — they live under /docs/screenshots/ on the web
    server and would be broken images inside the app. Everything else is kept
    verbatim so the help panel and the website can never disagree.
    """
    data = load_docs()

    def clean(blocks):
        out = []
        for b in blocks:
            if b.get("t") == "fig" and not with_figures:
                # The in-app panel is embedded and offline: a /docs/screenshots/
                # src would render as a broken image, so figures are dropped for
                # it. The PDF manual is a different consumer -- it is rendered on
                # a machine that has those files locally -- but it reused this
                # same export and inherited the stripping, which is why the
                # v2.9.1 manual shipped with none of its 16 screenshots.
                # --with-figures is opt-in so the app's default stays unchanged.
                continue
            if b.get("t") == "sx":
                b = dict(b)
                b["items"] = [
                    {**s, "a": clean(s.get("a", []))} for s in b.get("items", [])
                ]
            out.append(b)
        return out

    bundle = []
    for sec in data["d"]:
        bundle.append({
            "id": sec["id"], "en": sec["en"], "id_": sec["id_"],
            "pages": [
                {
                    "id": pg["id"], "en": pg["en"], "id_": pg.get("id_", pg["en"]),
                    "lede": pg.get("lede"),
                    "blocks": clean(pg["blocks"]),
                }
                for pg in sec["pages"]
            ],
        })

    js = json.dumps({"v": data["v"], "d": bundle},
                    ensure_ascii=False, separators=(",", ":"))
    if out_path:
        Path(out_path).write_text(js, encoding="utf-8")
        kb = len(js.encode()) / 1024
        n_pages = sum(len(s["pages"]) for s in bundle)
        print(f"{C_OK}wrote{C_OFF} {out_path}  {kb:.0f} KB  "
              f"({len(bundle)} sections, {n_pages} pages)")
    else:
        # Write bytes, not text: the bundle contains arrows, em-dashes and
        # Indonesian text that a cp1252 console (the Windows default) cannot
        # encode, and this is consumed by a subprocess pipe rather than read
        # by a human. Bypassing the text layer makes the exporter work the
        # same on every platform regardless of PYTHONIOENCODING.
        sys.stdout.buffer.write(js.encode("utf-8"))
        sys.stdout.buffer.flush()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "map":
        cmd_map()
    elif cmd == "export-help":
        figs = "--with-figures" in args
        rest = [a for a in args if a != "--with-figures"]
        cmd_export_help(rest[0] if rest else None, with_figures=figs)
    elif cmd == "find" and args:
        cmd_find(" ".join(args))
    elif cmd == "show" and args:
        cmd_show(args[0])
    elif cmd == "verify":
        cmd_verify()
    elif cmd == "check":
        cmd_check()
    elif cmd == "stats":
        cmd_stats()
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
