# GeoSuite vignettes — tutorials on real data

Each vignette follows one real, public drillhole dataset from raw files to a grade-tonnage screen, the way a geologist would work through it: every decision, the reason for it, and what goes wrong if it is skipped. Each one ends with an honest comparison against something known independently, and with the list of what would still be needed before the result could be called a Mineral Resource.

| # | Deposit | What it teaches | Bahasa Indonesia | English |
|---|---|---|---|---|
| 01 | **Thalanga** VMS Zn-Pb-Cu-Ag-Au, Queensland (GSQ, CC BY 4.0) | lab codes and missing values · validating and editing with an audit trail · cropping a regional compilation · populations vs outliers (no top-cut) · grade-shell domaining without lithology · why software defaults produced 202 Mt · checking against 1989–1998 production | [01-thalanga-vms.md](01-thalanga-vms.md) | [en/01-thalanga-vms.md](en/01-thalanga-vms.md) |
| 02 | **Babbitt** Cu-Ni-PGE, Duluth Complex, Minnesota (NRRI via pygslib) | files in feet · 61 % of the core never assayed (unknown ≠ zero) · when a top-cut *is* right · dense data, short variogram range, smoothing · estimate vs RPEEE-constrained resource | [02-babbitt-cuni.md](02-babbitt-cuni.md) | [en/02-babbitt-cuni.md](en/02-babbitt-cuni.md) |

## They cannot go stale

A vignette here is a program as well as a text:

- `tools/run_<name>.py` drives the real app build (`dist/`) in Chromium step by step, exactly as the text describes, and writes every number the text quotes to `data/<name>.json`, plus the screenshots in `img/`.
- Key numbers are recomputed **outside the app** from the exported files: statistics, metal shares, grade-tonnage, positions of desurveyed samples.
- `test_vignettes.py` re-runs every runner on every change, fails if the app's numbers move, checks the independent re-derivations against the app, and checks that the prose in both languages quotes the numbers in the JSON.

Building these two vignettes exposed seventeen defects and gaps in GeoSuite itself. All are fixed, and the ones that affect numbers are pinned by tests:

- **Core:** a `TD` / `EOH` / `hole_depth` collar column not recognised as the hole depth; samples below the last survey station stacked on it when the collar has no depth; no way to import lengths in feet; a "still built-in: geology" banner over an empty table.
- **Assay:** analysis always ran on the first grade column (copper on a zinc deposit); composite coordinates copied from the enclosing raw interval (duplicate points); coverage counting unassayed core; a lognormal departure inside the body offered as a top-cut (P86, 15 % of the metal); top-cut "metal removed" not weighted by sample length (2.99 % reported, 1.68 % true); plot legends spilling over headings.
- **Resource:** leave-one-out finding neighbours only inside its own 200-sample subsample (10 valid pairs of 200); variogram, cross-validation and sensitivity changing from run to run (unseeded `Math.random()`); a slope-of-regression label saying the opposite of the glossary, with an invented "JORC target"; a grade line diving to zero where no tonnage remains; and, the largest, **no domain boundary in estimation** — a domain's grade was spread into every block within search range (Thalanga 202 Mt against 4.7 Mt mined). Blocks now join a domain only if their nearest composite is in it; the Thalanga screen lands at 3.7 Mt @ 8.1 % Zn against 4.7 Mt @ 8.3 % mined. Also: a variogram auto-fit whose nugget search stopped at 60 % of the sill, so Thalanga, Babbitt and an epithermal gold set all "had" a 60 % nugget; and a down-hole variogram that only paired near-vertical samples from a random subsample. The nugget now comes from within-hole pairs, and a fit on an edge of the search is flagged.

That is the point of tutorials on real data.

```bash
node build/build.mjs
python3 docs/vignettes/tools/run_thalanga.py              # ~90 s
python3 docs/vignettes/tools/run_babbitt.py               # ~130 s; downloads the data on first run
python3 "obsidian-system/vault/Obsidian/1. Projects/GeoSuite/_meta/tests/test_vignettes.py"
```

## Writing a new vignette

1. Pick a public dataset with a clear licence, and something independent to compare against (production, a published resource, a known answer).
2. Write `tools/run_<name>.py` with `vignette_kit.py`: drive the app, record every number, recompute the key ones independently, exit 3 if the data cannot be fetched.
3. Write the text in Indonesian and English from `data/<name>.json` only. No number from memory.
4. Add a consistency function to `test_vignettes.py` that ties the prose to the JSON.
