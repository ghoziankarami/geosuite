# Methodology — what GeoSuite computes, and what it does not

This page states every calculation GeoSuite performs on your data, the default
parameters, the published reference for the method, and the limits of each step.
If a number in a report cannot be traced to a line on this page, treat that as a bug
and [open an issue](../.github/ISSUE_TEMPLATE/wrong-numbers.md).

> **Scope.** GeoSuite output is a *pre-estimation screening* and data-preparation
> result. It is **not** a Mineral Resource classification. A public report under
> KCMI 2017 or JORC 2012 requires a Competent Person who takes responsibility for
> the data, the domains, the estimate and the classification. GeoSuite's KCMI/JORC
> checklists help you prepare that work; they do not replace it.

## 1. Import (all three modules)

| Input token | Read as | Why |
|---|---|---|
| `1.25`, `1,25` (comma-decimal files) | 1.25 | Decimal convention detected once per upload from all files together, overridable. |
| `<0.005` | 0.0025 (half the limit), flagged | Standard half-detection-limit substitution. |
| `-0.005` (negative = detection limit, ALS/SGS/Intertek style) | 0.0025 by default (Core: *half* / *blank* / *keep*) | Same convention, expressed as a negative number. |
| `-9`, `-99`, `-999`, `-9999` … (all nines) | blank (excluded) | Database "not sampled / not received / lost" codes, not measurements. |
| any negative whose size is larger than the column's highest measured value | blank (excluded) | A detection limit cannot exceed every value the lab measured (e.g. `-995000` ppm Pb). |
| `>10` (over-limit) | 10, flagged | The limit is a lower bound; dropping the sample would remove the highest grades and bias estimates low. Re-assay over-limit samples before relying on the estimate. |
| `BDL`, `ND`, `NA`, `-`, empty | blank (excluded) | No value to substitute. |

Every upload shows an **import report**: rows loaded, rows the parser rejected (with
line numbers), how each column was read (role and unit), and how many below-detection
values and missing-sample codes were converted. Nothing is dropped silently.
Implementation: `src/shared/io/parse.js`, `src/shared/io/grades.js`,
`src/shared/io/import.js`; tests: `tests/known-answer/shared-*-boundary.mjs`.

Collar X/Y that look like latitude/longitude degrees are flagged as a failed check:
every later step mixes X/Y with depths in metres, so coordinates must be projected
(e.g. UTM).

## 2. Desurvey (Core)

**Minimum curvature** (Sawaryn & Thorogood, 2003, SPE 84246) between consecutive
survey stations; beyond the last station the hole continues on the last dip/azimuth
to the collar's total depth. A hole without survey is treated as vertical and listed
as a warning. Interval midpoints (`midx`, `midy`, `midz`) are interpolated along the
trace. Implementation: `src/shared/geostat/desurvey.js`.

## 3. Compositing (Assay; Core has a simpler preview)

Down-hole, fixed length (default 1 m, minimum 0.5 m). Grades are **length-weighted
over the part of each sample that overlaps the composite**; unsampled gaps are not
counted as zero grade, and the gap length is reported. Composites restart at every
domain change, and optionally at every lithology change, so no composite blends two
domains. Tails shorter than the minimum are dropped and their length is reported.

## 4. Statistics, top-cut, declustering (Assay, Resource)

- Descriptive statistics, CV, percentiles and log-probability plots per element and per domain.
- **Top-cut (capping)** at a user-chosen value, P95/P99 suggestions shown. The raw data is
  kept; capping is replayed from the raw values each time so thresholds never compound.
- **Cell declustering** (user-chosen cell size): each sample is weighted by 1 / (samples in its
  cell), normalised so the weights sum to the sample count. Declustered mean and the weights are reported next to the naive mean.

## 5. Domaining (Assay)

Manual domains from a column, or automatic: the host domain is the **smallest set of
lithologies that carries at least 80 % of the contained metal** (grade × length). Always
review automatic domains against your geological model; they are a starting point.

## 6. Variography (Assay, Resource)

Experimental semivariograms (omnidirectional, directional sweeps, down-hole) with
spherical, exponential and Gaussian models, single or nested (two structures) with a
nugget. Exponential and Gaussian models use the *practical* range (95 % of sill).
Anisotropy by azimuth/dip rotation of the search ellipsoid.

## 7. Estimation (Resource)

| Method | Detail |
|---|---|
| Ordinary kriging | Point kriging at the block centroid, Lagrange-constrained weights, kriging variance reported. Negative weights are allowed; a negative estimate is clamped to 0 and counted. |
| IDW | Inverse distance, power 2. |
| Nearest neighbour | Sanity baseline. |

Search: ellipsoid (default 200 × 200 × 50 m, 2–16 samples), optional octant search
(off by default). Block size is suggested from data spacing.

**Known limits:** no block discretisation (estimates are at the block centroid, which
understates the smoothing of a true block estimate); no sub-blocking; no conditional
simulation; no classification into Measured/Indicated/Inferred.

## 8. Tonnage and contained metal (Resource)

`tonnes = block volume × density`. Density comes from, in order: a measured density
column carried through the composites (per sample), a per-domain table, or a single
uniform value. **A uniform value you have not entered yourself is the VMS default
2.8 t/m³ and every report labels it "ASSUMED — not measured".**

| Grade unit | Contained metal |
|---|---|
| g/t (= ppm) | tonnes × grade / 10⁶ → t (also shown in kg) |
| % | tonnes × grade / 100 |
| kg/m³ (placer, volumetric) | volume × grade / 1000 → t (density is not used) |

The grade–tonnage curve is computed from the same blocks at each cut-off.

## 9. How the numbers are verified

- `tests/test_pipeline_known_answer.py` drives real CSV files through Core → Assay →
  Resource in a browser and re-derives desurvey, compositing, IDW, nearest neighbour,
  ordinary kriging (its own Gaussian-elimination solver, not the app's), the
  grade–tonnage curve and contained metal for all four units, then compares them with
  what the app reports.
- `tests/known-answer/*.mjs` test the shared import, column, grade-code and geostatistics
  code directly in Node.
- Every change to the math must keep those tests green, and a new behaviour ships with a
  test that fails before the change (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
