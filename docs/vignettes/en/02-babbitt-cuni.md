# Vignette 02 — Babbitt (Cu-Ni, Duluth Complex): feet, unassayed core, and estimating on dense data

This reproducible reference explicitly uses **XY screening support** in Block Model → Advanced. New projects default to 3D sample proximity; choose XY to reproduce the figures below. Neither envelope is a closed geological solid.

> **Bahasa Indonesia:** [../02-babbitt-cuni.md](../02-babbitt-cuni.md) · Previous vignette: [01 — Thalanga](01-thalanga-vms.md)

| | |
|---|---|
| **Data** | The Babbitt (Cu-Ni-PGE) drill database, Duluth Complex, Minnesota — from the Natural Resources Research Institute, University of Minnesota, Duluth Complex database (NRRI/TR-2003/21), as distributed with [pygslib](https://github.com/opengeostat/pygslib)'s Tutorial 1 (MIT). The data is not copied into this repository; the runner reads a local copy or downloads it from a pinned pygslib commit. |
| **Modules** | Core → Assay → Resource |
| **Lessons** | Units in feet · 61 % of the core never assayed · when a top-cut *is* right · estimating on dense data · why an "estimate" is not yet a "resource" |
| **Reproducible** | `python3 docs/vignettes/tools/run_babbitt.py` (about 130 s). Every number is read from [`../data/babbitt.json`](../data/babbitt.json) and re-checked by `test_vignettes.py`. |

Vignette 01 (Thalanga) was a case of *too little* data: 13 holes with no lithology. Babbitt is the opposite: **399 holes, 35,616 assay intervals, more than 160 km of core**. That much data sets different traps. Nothing looks wrong, the software runs smoothly, and the answer can still be off by an order of magnitude.

The Babbitt deposit (now known as Mesaba) is disseminated Cu-Ni-PGE mineralisation in the basal part of the Duluth Complex, a layered intrusion. The mineralisation is continuous, low-grade and broadly parallel to the gently dipping basal contact. Teck's public description gives a geological resource of **more than 1 billion tonnes at about 0.43 % Cu and 0.09 % Ni**. That is our plausibility benchmark in §8.

---

> **Calculation update, 7 October 2026:** this recording uses the physical fitted range for scalar covariance. Search radii select neighbours; they no longer substitute for the model range. Tables and UI screenshots were regenerated from real CSV uploads, with exported grade-tonnage checked independently. Saved historical sessions require refitting to use this corrected mode.

## 1. Files that don't state their units

```
collar_BABBITT.csv   BHID, XCOLLAR, YCOLLAR, ZCOLLAR           ← no depth column
survey_BABBITT.csv   BHID, AT, AZ, DIP
assay_BABBITT.csv    BHID, FROM, TO, CU, NI, S, FE             ← no units in the header
```

Nothing says that every length in these files is in **feet**. You have to find the clues yourself:

- the dominant sample length is exactly **10.0** (78 % of intervals), a round feet number (10 ft = 3.048 m);
- collar elevations are about 1,590, while the ground in north-east Minnesota is about 480 m above sea level. The number only makes sense in feet;
- the collars spread over 18,006 × 11,316. As metres that is 18 × 11 km, far too wide for one deposit.

Read as metres, every length is 3.28 times too long, so **every volume is 3.28³ = 35.3 times too large**, and so are the tonnes and the metal. There is no error and no warning, because a feet file is not "broken".

**In Core:** *Upload* → *Import Options* → **Length unit in the files: Feet (convert to metres)**, then upload the three files. Core multiplies collar X/Y/Z, survey depth and from/to by 0.3048, and states it in the import report and in every export's header:

```
# lengths: metres (converted from feet x0.3048 on import: collar x/y/z/depth, survey depth, from/to)
```

![Core import with feet conversion](../img/babbitt-01-core-import-feet.png)

The result is a 5,488 × 3,449 m footprint, which is plausible for one deposit.

> This option was added to GeoSuite because of this vignette. Before it, there was no way to import feet data correctly.

---

## 2. Validation, and a bug this data exposed

![Core validation](../img/babbitt-02-core-validation.png)

The table links are clean: no orphan holes, no duplicate collars, no gaps or overlaps. Two notes:

- **No end-of-hole depth on the collars.** The 399 missing final depths are reported as a warning; required geometric fields remain 100 % complete. Core extends along the last measured survey direction to the deepest logged interval without filling or changing `collar.depth`. This extrapolation is a directional assumption, not a measured final depth.
- **Two holes have a single survey station** (at depth 0).

Together, these two exposed a **real bug** in GeoSuite. A trace used to be extended only to `collar.depth`. Without that column, every sample below the last survey station was stacked *on that station*. On a single-station hole, every sample sat on the collar: 97 samples in Babbitt. Take B1-001 (−60° towards 327°): the mid-point of its deepest interval (about 129 m along the hole) belongs at elevation **382.53 m**, not at the collar's 494.05 m. The 382.53 m figure is recomputed with trigonometry in the runner and matched against Core's export.

![Desurvey](../img/babbitt-03-core-desurvey.png)

The bug is fixed and now guarded by `test_lab_conventions.py`. **The lesson for geologists:** "no error" is not "the samples are in the right place". Check one or two holes by hand. It is cheap, and it can save the whole model.

---

## 3. 61 % of the core was never assayed: unknown ≠ zero

| | Length |
|---|---:|
| Total drilled | 164,967 m |
| Assayed (Cu present) | 63,726 m |
| **Never assayed** | **101,241 m (61.4 %)** |

Take hole 34873: 0–766.6 m is unassayed, a run of cover rock above the basal zone. Length-weighted mean Cu:

| Treatment of unassayed intervals | Mean Cu |
|---|---:|
| Unknown (left out of the mean) | **0.3638 %** |
| Zero ("barren for sure") | **0.1405 %** |

That is a **factor of 2.6**, and even a well-known geostatistics tutorial takes the "zero" route. Which is right? **It depends on the geology, and that decision belongs to the geologist, not the software:**

- cover intervals (rock above the intrusion, sediments) that were left unassayed because they are obviously barren → zero can be justified, *outside* the mineralised domain;
- intervals *inside* the zone that were skipped to save assay budget → zero is a serious low bias.

GeoSuite treats unassayed intervals as **unknown**: the composite grade is blank, not zero. Since this vignette, **composite coverage counts only length that was actually assayed**. Composites inside unassayed core used to report coverage 1.0 with blank grades. Now **33,236 composites** honestly report being less than 50 % informed.

![10 ft compositing](../img/babbitt-07-assay-composite.png)

---

## 4. Assay: populations, a top-cut that is justified, domains

Upload Core's master CSV to Assay. The unit-less `CU`, `NI`, `S`, `FE` columns are read as percent (`cu_pct` …). The values (median Cu 0.30) fit percent, not ppm. Check it yourself: 0.30 ppm Cu makes no sense in a sulphide zone.

Cu–Ni correlation is **r = 0.711**, with a median Ni/Cu ratio of **0.241**. That is the typical Duluth magmatic-sulphide signature: about four times more Cu than Ni, and the two move together.

![Cu statistics](../img/babbitt-04-assay-stats.png)

### The distribution

| Cu (%) | |
|---|---:|
| Median / P99 / P99.9 | 0.30 / 1.70 / 6.5 |
| Maximum | 24.4 |

Above about 5 % sit a few dozen **semi-massive sulphide** samples: 5–24 % Cu with up to 18 % S. They are real, but they form a thin, discontinuous population inside 0.3–1 % disseminated mineralisation.

### Top-cut diagnostics: the app declines to propose a number

![Top-cut diagnostics](../img/babbitt-05-assay-topcut.png)

The Cu distribution departs from a single lognormal population from **0.72 % (P86)** onwards, inside its body rather than in a sparse upper tail. An earlier GeoSuite version offered that point as a "disintegration candidate". Capping at 0.72 % would have removed 15 % of the metal. The app now calls it what it is: **a population mixture, fixed by domaining, not by a top-cut**.

### Decision: domain first, then a 3 % Cu top-cut

1. **Domain:** a 0.2 % Cu grade shell. It holds 91.4 % of the metal in 62.5 % of the assayed length. The 0.2 % boundary sits near the lower edge of Duluth disseminated mineralisation and separates almost barren intrusive rock.

   ![0.2 % Cu domain](../img/babbitt-06-assay-domain.png)

2. **Top-cut at 3 % Cu**, applied to the raw assays before compositing:

| | |
|---|---:|
| Assays capped | 94 |
| Metal removed, length-weighted (app = independent calculation) | 1.68 % |
| CV inside the 0.2 % shell: before → after | 1.07 → 0.66 |
| P99.5 inside the shell | 3.5 |

![Top-cut applied](../img/babbitt-05b-assay-topcut-applied.png)

Why a top-cut is **right** here when it was **wrong** at Thalanga (vignette 01):

| | Thalanga | Babbitt |
|---|---|---|
| High grades come from | the main ore population (massive sulphide) | thin, sparse semi-massive segregations |
| Continuity between holes | the mined lens | none: one or two samples per hole |
| Search reach vs population size | small radius, large population | 200 m radius, metre-scale population |
| CV inside the domain | 1.15 | 1.07, down to 0.66 by capping 94 samples |

One 24 % Cu assay with a 200 m search spreads massive-sulphide grade into dozens of blocks that are really disseminated. That is what the top-cut prevents. The better geological alternative would be a **separate high-grade domain**, but without lithology logging it cannot be built.

The export header records the decision:

```
# topcut: cu_pct cut=3.0000 affected=94/23684 metal_removed=1.68% (length-weighted) applied_by=manual
```

> Earlier versions summed assay values without length weighting and reported 2.99 %. Metal is grade × length, so a 0.2 m sample must not weigh the same as a 3 m interval. Now fixed, and checked against the independent calculation by `test_vignettes.py`.

### 10 ft (3.048 m) compositing

| | |
|---|---:|
| Composites | 55,119 (M1: 13,464, M0: 41,655) |
| M1 composites: mean / CV / max. | 0.5235 % / 0.59 / 3.0 % |
| M1 footprint (X × Y × Z) | 4,824 × 3,453 × 869 m |

The second bug this stage exposed was in **composite coordinates**. Each composite used to be given the mid-point of the raw interval that contained it. Every composite cut from one long interval, such as the 252 composites from the 766 m interval in hole 34873, landed on **one and the same point**. Zero-distance pairs with different grades inflate the nugget, and duplicate points make the kriging system singular. Positions are now interpolated along the hole at each composite's own mid-depth (`test_estimation_inputs.py`).

---

Equally spaced composites can have equally distant neighbours. NN chooses the lowest source index when normalized distances differ by at most 1e-10; coordinate roundoff must not choose the grade. IDW and kriging retain their own distances and weights.

## 5. Variogram and grid

Compute Downhole, then Compute/Auto-fit. A range at the fitting limit is a warning, not proven continuity.

| Parameter | Result |
|---|---:|
| Downhole pairs | 183,031 |
| Nugget (%²) | 0.028 |
| First between-hole lag γ (%²) | 0.093 |
| Sill (%²) | 0.115 |
| Range (m; rangeMin flag) | 72.5 |
| Median hole spacing (m) | 106 |
| Block size | 50 ×50 ×15 m |
| Generated screening cells | 237,475 |

![Variogram](img/babbitt-09-resource-variogram.png)

## 6. Estimate with recorded scope

| | No categorical boundary | With categorical boundary |
|---|---:|---:|
| OK cells | 74,961 | 26,825 |
| Mean Cu (%) | 0.475 | 0.500 |
| Model mass (Mt, assumed SG2.8) | 7,871 | 2,817 |
| Cu metal (Mt) | 37.4 | 14.1 |

209,515 in-range cells are rejected by domain assignment. This categorical boundary is not a geological solid. Review unassayed composites before treating them as overburden; raw missing grades are not zero grades.

NN mean: 0.509 %; OK mean: 0.500 %. 26,825 × 37,500 m³ ×2.8 t/m³ = 2,817 Mt.

![Estimate](img/babbitt-10-resource-estimate.png)

## 7. Cross-validation

Neighbours come from the full population; test selection uses a fixed seed. Leave-one-out yields 194/200 pairs.

| Method | Slope | r² | Bias | RMSE |
|---|---:|---:|---:|---:|
| OK | 0.64 | 0.64 | 0.03 | 0.202 |
| IDW | 0.68 | 0.61 | 0.03 | 0.211 |
| NN | 0.71 | 0.49 | 0.03 | 0.260 |

![Cross-validation](img/babbitt-11-resource-crossval.png)

Slope below1 indicates smoothing; small mean bias does not validate individual blocks. Drill spacing, support and geology still limit resolution.

## 8. Grade-tonnage

| Cu cutoff (%) | Model mass (Mt) | Mean Cu (%) |
|---|---:|---:|
| 0.20 | 2,817 | 0.500 |
| 0.25 | 2,796 | 0.502 |
| 0.30 | 2,678 | 0.512 |
| 0.35 | 2,374 | 0.536 |
| 0.40 | 1,990 | 0.567 |
| 0.45 | 1,577 | 0.604 |
| 0.50 | 1,189 | 0.646 |
| 0.55 | 870 | 0.690 |
| 0.60 | 623 | 0.737 |
| 0.65 | 437 | 0.785 |
| 0.70 | 307 | 0.832 |
| 0.75 | 209 | 0.883 |
| 0.80 | 130 | 0.951 |

![Grade-tonnage](img/babbitt-12-resource-grade-tonnage.png)

Cutoffs are recorded exactly:0.25% differs from0.20%. Mass equals cell volume ×density; feet were converted to metres. This remains a screening inventory with assumed SG, not a resource bounded by RPEEE, pit shell or NSR.

## 9. Next steps

Review basal-zone lithology/solid, missing assays, measured density, QA/QC, high-grade domains, directional variograms, NSR/pit shell, change of support and CP classification. Applied Assay top-cut is recorded; Resource does not apply it again.

Sources are unchanged, but interval positions now follow minimum-curvature arcs. Changed positions can alter neighbours and support-boundary cells. Composite coordinates from midpoint-only CSV still use interpolation; full trace/endpoint transport follows Domain S8.

## Attribution

Babbitt drill data: Natural Resources Research Institute, University of Minnesota Duluth — Duluth Complex drill-hole database (NRRI/TR-2003/21), distributed with [pygslib](https://github.com/opengeostat/pygslib) (© Adrian Martinez Vargas, MIT licence) in `doc/source/Tutorial_1/Babbitt`. Mesaba resource description: Teck publication (CESL, ALTA 2009) on nickel recovery from Mesaba concentrate. For current official figures, see the Mesaba NI 43-101 technical report published by PolyMet Mining (2022).
