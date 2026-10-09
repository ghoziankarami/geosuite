# Vignette 01 — Thalanga (VMS Zn-Pb-Cu-Ag-Au): from raw public data to a resource screen you can defend

This reproducible reference explicitly uses **XY screening support** in Block Model → Advanced. New projects default to 3D sample proximity; choose XY to reproduce the figures below. Neither envelope is a closed geological solid.

> **Bahasa Indonesia:** [../01-thalanga-vms.md](../01-thalanga-vms.md)

| | |
|---|---|
| **Data** | *NEQ Deposit Atlas – Thalanga* (ds100103), Geological Survey of Queensland, **CC BY 4.0** — <https://geoscience.data.qld.gov.au/dataset/ds100103>. This tutorial imports the four public tables; the bundled app example is synthetic nickel. |
| **Modules** | Core → Assay → Resource |
| **Time** | about 45 minutes by hand |
| **Outcome** | A grade-tonnage screen, with the list of reasons it is **not yet** a Mineral Resource |
| **Reproducible** | `node build/build.mjs && python3 docs/vignettes/tools/run_thalanga.py`. Every number on this page is read from [`../data/thalanga.json`](../data/thalanga.json), which that script writes. `test_vignettes.py` fails the build if the app starts producing different numbers. |

This vignette deliberately avoids "clean" synthetic data. A government compilation like this one is what exploration geologists receive: hundreds of holes from many companies over many decades, laboratory codes that changed over time, shallow geochemical holes mixed with deep diamond holes. The aim is not a pretty number. The aim is to show **every decision** a geologist must make, **why**, and **what happens if it is skipped**.

---

> **Calculation update, 7 October 2026:** this recording uses the physical fitted range for scalar covariance. Search radii select neighbours; they no longer substitute for the model range. Tables and UI screenshots were regenerated from real CSV uploads, with exported grade-tonnage checked independently. Saved historical sessions require refitting to use this corrected mode.

## 0. Geological context and an independent benchmark

Thalanga is a volcanogenic massive sulphide (VMS) Zn-Pb-Cu-Ag-Au deposit in the Mount Windsor Subprovince, about 65 km south-west of Charters Towers, Queensland. The underground mine operated from **1989 to 1998** and produced **4.7 Mt @ 8.3 % Zn, 2.6 % Pb, 1.9 % Cu** ([mining-technology.com](https://www.mining-technology.com/projects/thalanga-zinc-project-queensland/)).

That production figure is our benchmark. Never judge an estimate by "the program finished without errors". Ask instead: *is the answer plausible against something known independently?* At the end (§12) we compare the screen against this benchmark and explain the difference.

One limit up front: the dataset has **no lithology logging for the deposit's diamond holes**. No lithology means no geological model. That limits everything downstream, and you will see the consequences clearly.

---

## 1. Load the data (Core)

Open **Orebit Core** and import the four Thalanga CSVs. The runner writes them from the [public fixture](https://github.com/ghoziankarami/geosuite/blob/main/tests/fixtures/thalanga-core.json); the bundled example remains synthetic nickel.

![Core dashboard with the Thalanga dataset](../img/thalanga-01-core-dashboard.png)

| Table | Rows |
|---|---:|
| Collar | 717 |
| Survey | 667 |
| Assay | 9,073 |
| Geology | 14,518 |

Before you look at a map, look at the **hole types**:

| Drill type | Holes |
|---|---:|
| BEDRK (shallow bedrock geochemistry) | 520 |
| REVC (RC) | 55 |
| PERC (percussion) | 45 |
| RAB | 39 |
| ACORE | 21 |
| TCH (trench) | 19 |
| DD (diamond) | 18 |

**Lesson one:** this is a regional compilation, not a deposit drill database. Three-quarters of the holes are shallow geochemical holes drilled to find anomalies, not to measure tonnes. Mix them all into an estimate and hundreds of "background" samples from tens of kilometres away drive the statistics and the variogram. That is why the crop step (§4) exists.

---

## 2. Laboratory grade codes: negative numbers are not numbers

Legacy assay data uses negative numbers as codes, and their meaning differs between labs and decades. Core detects them on import and applies one documented rule (`src/shared/io/grades.js`):

- **ordinary negative values** (−0.01, −5, −0.0001) → *below detection*, used as **half** the detection limit;
- **all-nines codes** (−999, −9999 …) **or** a negative value whose magnitude exceeds the column's largest positive value → **missing** (blank). No detection limit can be higher than the highest grade ever measured;
- **`>X`** (over-range) → X, flagged.

On Thalanga: **2,428** below-detection values and **41** missing codes.

| Column | < detection | Missing codes | Max. positive value |
|---|---:|---:|---:|
| au_gpt | 1,223 | 0 | 1,380 |
| ag_gpt | 578 | 19 | 9,560 |
| s_pct | 485 | 7 | 5 |
| cu_ppm | 68 | 0 | 114,200 |
| pb_ppm | 68 | 15 | 248,000 |
| zn_ppm | 6 | 0 | 406,000 |

Why this matters: the Pb column contains the code **−995,000** and Ag contains **−9,910,000**. Software that treats every negative as "half detection" hands those samples 49 % Pb and 4,955 g/t Ag, which is 15 fake bonanzas. Software that treats them as zero, or silently drops them, lowers the mean without a trace. The column-maximum rule separates the two cases without per-lab guesswork, and the **1,223 Au detection-limit values from several eras** (−0.01, −0.05, −0.0001) are still correctly handled as real low values.

> Check it yourself: on Core's **Validation** tab the row *Below-detection (negative) grade values* reads **0** after import. That does not mean the data was clean. It means every code was translated and logged.

---

## 3. Validation: find, decide, record

Core's **Validation** tab runs 23 checks for these four tables.

![Core validation — FIX REQUIRED](../img/thalanga-02-core-validation.png)

| Check | Before | After fixes |
|---|---|---|
| Collar without survey (assumed vertical) | 259 holes ⚠ | 259 ⚠ |
| Collar without assay | 16 holes ⚠ | 16 ⚠ |
| Collar without geology | 381 holes ⚠ | 381 ⚠ |
| **Duplicate collar hole_id** | **6 ✗** | 6 ✗ |
| Assay interval gaps | 208 ⚠ | 206 ⚠ |
| **Assay interval overlaps** | **115 ✗** | 113 ✗ |
| **Invalid survey measurements** | **1 ✗** | **1 ✗** |
| Linkage verdict | **FIX REQUIRED** | **FIX REQUIRED** |

What the findings are (checked row by row):

- **6 duplicate collars.** LVRC001–LVRC005 appear twice, under two programmes (RGMWP and TCLV), 1–5 cm apart: the same holes compiled twice. BEA317 appears as both ACORE and BEDRK.
- **115 overlaps.** Mostly re-samples or field composites compiled alongside the originals. Example: TCRC11 holds a 4–5 m interval *and* a 4–8 m composite.
- **259 holes without survey** are assumed vertical. All of them are shallow (236 BEDRK, 20 percussion, 3 RC; median depth 36 m, deepest 150 m), so the effect is small. On deep holes that assumption is fatal (§4).
- **381 holes without geology, including every diamond hole in the deposit.**

### Two fixes, and why only two

1. **Two spot samples in TH37** (190.0–190.2 m and 490.0–490.2 m, sample IDs `TH37190`, `TH37490`) sit entirely *inside* longer intervals of the same hole. They are check samples that were compiled in. Both are deleted; otherwise the same rock is counted twice.
2. **Au 1,380 g/t in TH35 100.0–100.2 m.** The next-highest value in the entire dataset is 1.69 g/t, about 800× lower. In the same interval Ag is 1 g/t and Zn 1,210 ppm. A gold bonanza with no silver and no base metals makes no geological sense in a VMS system; a unit or decimal error is far more likely. **The value is blanked, not "corrected" to 1.38.** We do not guess what the lab certificate says. Blank it, record it, request the original certificate.

Both edits are made in Core's data editor and are logged automatically in the **CHANGE_LOG**:

```
assay: 1 rows edited, 0 added, 2 deleted
```

The detailed CHANGE_LOG stays in the Core project and PDF. The cropped CSV records its selected validation scope and points to that audit; it does not contain the complete edit history.

### Why the verdict stays "FIX REQUIRED", correctly

The remaining problems (LVRC/BEA duplicates, the hundreds of TCRC-type overlaps and the invalid TH38 dip) are all in **regional holes outside the deposit area**. A senior geologist does not "clean" data they will not use just to turn the indicator green. That data is **explicitly excluded** by the area boundary (§4), and the reason is written down. A red verdict here is an honest record, not a failure.

---

## 4. Desurvey and crop to the deposit area

### Desurvey

The **Desurvey** tab detects the dip convention from the data: `positive_down`, meaning positive dip points downward. The inventory contains 711 holes and 33 survey findings: 32 conflicting directions at the same MD, plus TH38 has dip132° at MD416 m. Its trace is withheld without guessing or changing the measurement. TH38 is outside the 13-hole area export.

![Desurveyed hole traces](../img/thalanga-03-core-desurvey.png)

Thalanga's diamond holes **flatten strongly** towards the bottom:

| Hole | End depth | Elevation at end of hole (z) |
|---|---:|---:|
| TH1 | 257 m | 140.9 m |
| TH5 | 395.9 m | 117.2 m |
| TH40 | 593.3 m | −103.1 m |

TH5 is almost 400 m long but drops only about 180 m and finishes nearly horizontal. Ignore the survey, assume vertical, and every sample in the lower half of TH5 lands hundreds of metres too deep and tens of metres off position. A block estimate built on those positions is spatially wrong without a single error message.

### Crop to the deposit area

With no lithology in the deposit holes, a geological wireframe cannot be built. The defensible boundary is an explicitly stated **deposit-area box** around the TH-series holes (MGA zone 55):

```
X 370,200 – 372,900 m   Y 7,750,000 – 7,750,800 m
```

File: [`../data/thalanga-deposit-area.geojson`](../data/thalanga-deposit-area.geojson). Load it on the **Crop to Constraint** tab.

![Crop to deposit area](../img/thalanga-04-core-crop.png)

| | |
|---|---:|
| Intervals inside | **667** of 9,071 |
| Intervals dropped | 8,404 |
| Holes inside | **13** of 695 |

Note: the map shows **12 collars** inside the box, but **13 holes** contribute intervals. Core crops on the **desurveyed mid-point of each interval**, not on the collar. One hole is collared outside the box and drills into it. A collar-based crop would lose those intervals.

Holes kept: TE-1, TE-2, TH1, TH2, TH3, TH4, TH5, TH6, TH31, TH35, TH37, TH39, TH40. All 13 (11 diamond, 2 percussion) have surveys, none is a duplicate collar, and the only overlaps among them were the two TH37 spot samples removed in §3. Export **Cropped master CSV (desurveyed)** for the next step. This path validates the selected intervals and their source collars, surveys and geology. A failure inside that selection blocks export. Its scope is recorded in the CSV header and pipeline history; regional findings remain in the Core project.

---

## 5. Know the populations before deciding anything

Before going into Assay, statistics for these 667 samples are computed **outside the app** (plain Python, straight from the exported CSV):

| Zn (%) | |
|---|---:|
| Mean | 2.245 |
| Median | 0.2 |
| Coefficient of variation (CV) | **2.66** |
| P95 / P99 / max. | 15.1 / 31.2 / 40.6 |
| Sample length median / mode | 0.7 m / 1.0 m |

The mean is eleven times the median, with a CV of 2.66. That shape can mean two things that call for very different treatments:

- **one population with a few outliers** → handled by *top-cutting*;
- **a mixture of two populations** (massive sulphide ore and wall rock) → handled by **domaining**.

A simple test tells them apart: look at where the metal sits.

| Samples with Zn ≥ | Share of total Zn metal |
|---|---:|
| 0.5 % | 95.7 % |
| 1 % | **91.7 %** |
| 2 % | 87.0 % |
| 5 % | 74.6 % |

Now split at 1 % Zn:

| | n | Mean Zn | CV |
|---|---:|---:|---:|
| ≥ 1 % (inside the shell) | 170 | 8.26 % | **1.15** |
| < 1 % (outside) | 497 | 0.187 % | 1.26 |

The CV drops from 2.66 to 1.15 once the populations are separated. **The high variability comes from mixing populations, not from outliers.** That conclusion drives the next two decisions: *do not* cap high grades, and *do* separate domains.

---

## 6. Assay: choose the commodity, test the top-cut, build the domain

Upload the cropped master CSV to **Orebit Assay**. Assay recognises units from column names and converts `zn_ppm`, `pb_ppm`, `cu_ppm` to percent (÷ 10,000). The conversion is shown, not done silently.

### Choose the primary commodity

By default Assay takes the first grade column, **cu_pct**, which is wrong for a zinc deposit. Choose **zn_pct** in the **Commodity** selector. The choice applies to validation, domaining, QAQC, the report and the PDF.

![Zn statistics](../img/thalanga-05-assay-stats.png)

### Top-cut: tested, then deliberately not applied

The **Top-Cut** tab looks for the *disintegration* point, where the upper tail of the distribution starts to break up. For Zn it is at **27.5 %** (98.1st percentile).

![Top-cut diagnostics](../img/thalanga-06-assay-topcut.png)

**Decision: no top-cut on Zn.** Reasons:

1. §5 showed that the variability comes from mixed populations. Inside the mineralised domain the CV is only 1.15, well below the level at which geologists usually start considering a cap (about 1.5–2).
2. 27–40 % Zn is sphalerite-rich massive sulphide, a **real population**, and exactly what was mined here. Capping it at 27.5 % removes real metal from the best ore.
3. Top-cuts limit the influence of *a few* extreme samples on *many* blocks. The search strategy (§8) handles that better.

Deciding not to cap is as much a decision as capping, and it **must be written** in the report with its reasoning.

### Domain: a 1 % Zn grade shell, because there is no lithology

**Domain** tab → method **Grade shell (cut-off)**, cut-off **1** (% Zn).

![1 % Zn grade-shell domain](../img/thalanga-07-assay-domain.png)

| Domain | Samples |
|---|---:|
| M1-Mineralised (Zn ≥ 1 %) | 170 |
| M0-Background (Zn < 1 % or not assayed) | 497 |

Why 1 %: it captures 91.7 % of the metal (§5), separates the two populations with a reasonable CV, and is low enough not to "cut into" the ore. A *domain* cut-off is not an *economic* cut-off. It separates populations; it does not decide what is worth mining.

**The limitation must be stated:** a grade shell is not a geological domain. It is shaped by the grades themselves, so it tends to be optimistic at the edges (low samples between high ones are left out) and knows nothing about lithological contacts or structure. With lithology logging, the domains should come from massive sulphide / stringer / wall-rock contacts. That data does not exist here, so we use a grade shell and say so.

### 1 m compositing

**Composite** tab, length **1 m** (the modal sample length).

![1 m compositing](../img/thalanga-08-assay-composite.png)

| | |
|---|---:|
| Composites | **507** (M1: 98, M0: 409) |
| Real sampled length discarded (tails shorter than the minimum) | 11.38 m |
| Hole length with no samples at all | 1,112 m |
| Overlaps | 0 |
| Composites less than 50 % informed by real samples | 77 |

Core treats unsampled intervals as **unknown**, not zero. In compiled data, unassayed intervals are usually *assumed* barren by the driller, but that assumption is for the geologist to make, not the software. Every composite carries a `coverage` column. The yellow warning flags **77 composites** that are less than half informed by real samples. Review them before estimating.

Export with **Export composite CSV** (`exportMasterForEstimation`). The file already carries coordinates, the domain, and grades in percent.

---

## 7. Variogram and grid

Open Variography, compute Downhole first, then Compute and Auto-fit. The downhole nugget is retained. A range at the fitting search boundary is not proven geological continuity.

| Parameter | Result |
|---|---:|
| Downhole pairs | 840 |
| Nugget (%²) | 22.2 |
| First between-hole lag γ (%²) | 77.4 |
| Sill (%²) | 104.0 |
| Range (m; rangeMin flag) | 72.5 |
| Median hole spacing (m) | 90 |
| Block size (m) | 25 ×25 ×10 |
| Generated screening cells | 20,967 |

![Variogram](img/thalanga-10-resource-variogram.png)

Cells are not the entire bounding box. Support and sample-domain assignment restrict the population. Default density 2.8 t/m³ is ASSUMED, not measured.

## 8. Compare estimation decisions

All three experiments use the same composites and variogram. A categorical nearest-neighbour boundary is not a geological solid. Estimation search radius differs from support buffer.

| Experiment | OK cells | Model mass (Mt) | Mean Zn (%) |
|---|---:|---:|---:|
| A: no categorical boundary | 11,527 | 202 | 5.85 |
| A2: default search + boundary | 833 | 14.6 | 7.16 |
| B: reviewed search + boundary | 221 | 3.867 | 7.83 |

A2: 20,129 in-range cells excluded by the categorical boundary.

B keeps major100 m, semi50 m, minor25 m, azimuth98°, dip0°, minimum4/maximum12 composites. These choices restrict unsupported influence; the lens orientation remains unresolved from these holes alone.

![Estimate](img/thalanga-11-resource-estimate.png)

| Method | Mean Zn (%) |
|---|---:|
| OK | 7.83 |
| IDW | 8.44 |
| NN | 8.45 |

NN differs by about 8.0 % from OK. Review clustering and declustered means; this difference is not an accuracy certification.

## 9. Cross-validation

Leave-one-out: 92 pairs.

| Method | Slope | r² | Bias | RMSE |
|---|---:|---:|---:|---:|
| OK | 0.73 | 0.73 | 0.08 | 4.72 |
| IDW | 0.77 | 0.75 | 0.24 | 4.62 |
| NN | 0.82 | 0.73 | -0.12 | 4.84 |

![Cross-validation](img/thalanga-12-resource-crossval.png)

Slope below1 indicates smoothing. Small mean bias does not establish accurate individual blocks; inspect errors by grade and position before block decisions.

## 10. Confidence and grade-tonnage

High: 48; medium: 86; low: 87. This is computational screening, not Measured/Indicated/Inferred classification or CP approval.

![Confidence](img/thalanga-12b-resource-confidence.png)

The table is independently calculated from the OK block CSV. Rounding at0.001 Mt can differ between Python and the app; tests retain the existing rounding tolerance and method.

| Cutoff Zn (%) | Mass (Mt) | Zn (%) | Metal (kt) | High+medium Mt @ % |
|---|---:|---:|---:|---|
| 0 | 3.867 | 7.83 | 302.8 | 2.345 @ 7.82 |
| 1 | 3.867 | 7.83 | 302.8 | 2.345 @ 7.82 |
| 2 | 3.692 | 8.12 | 299.8 | 2.240 @ 8.10 |
| 3 | 2.765 | 10.00 | 276.5 | 1.715 @ 9.80 |
| 5 | 2.205 | 11.64 | 256.7 | 1.365 @ 11.43 |
| 8 | 1.837 | 12.69 | 233.2 | 1.155 @ 12.30 |

![Grade-tonnage](img/thalanga-13-resource-grade-tonnage.png)

## 11. Density and geometry

221 cells × 6,250 m³ × 2.8 t/m³ = 3.867 Mt. Zn metal: 302.8 kt.

Changing only density to3.6 t/m³ gives 4.973 Mt. Measure sulphide density by domain; grade units do not change rock volume.

Interval positions now follow minimum-curvature arcs rather than station chords. Sources and tutorial parameters are not tuned to match a reference. Changed positions affect distances, support and estimated cells. Conflicting survey geometry remains missing rather than guessed.

## 12. Reasonableness and next steps

Historical1989–1998 production of about4.7 Mt @8.3% Zn provides context, not a resource target to match. ExperimentB has a comparable order of magnitude, but production uses different cutoff, dilution and recovery decisions. Numerical similarity does not validate ore geometry.

Next: lithology, solid/topography, honouring, measured SG, QA/QC, directional variograms and CP review. Grade groups do not replace geological modelling. This screening is not a reportable Mineral Resource.

## Attribution

Data: © State of Queensland (Geological Survey of Queensland), *NEQ Deposit Atlas – Thalanga* (ds100103), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Loaded as published. The only changes are the two deletions and one blanked value described in §3, all recorded in the CHANGE_LOG. The area boundary (`thalanga-deposit-area.geojson`) was made for this vignette. Historical production: mining-technology.com, *Thalanga Zinc Project, Queensland*.
