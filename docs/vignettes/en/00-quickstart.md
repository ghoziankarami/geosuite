# Quickstart: GeoSuite in 10 minutes

This guide is for GeoSuite 3.2.0. All three modules open with a synthetic nickel laterite sample project (CC BY 4.0, credit Orebit.id). Core loads 349 collars with deliberate data errors. Assay and Resource load prepared LIM/SAP intervals from the complete 350-hole source. The sample is for practice, not field data.

## 1. Core: check the drillholes (3 minutes)

[Open Orebit Core](https://geosuite.orebit.id/Core.html) and click **Start review**. The main stages are in the sidebar: Import, Validation, Desurvey, Merge, Domain, Export. **Advanced tools** opens the tables, strip log and section views.

- **Dashboard** shows 349 collars, 8,896 assay intervals, 1,368 geology intervals and 8,796 m of total depth.
- **Validation** lists every finding by hole: missing collars, missing surveys, overlapping or gapped intervals and mismatched IDs. Desurvey stays locked until the blocking findings are resolved.
- **Fix the sample:** click **Download source CSVs**, extract them, import the four original tables and validate again. Use this only for the synthetic source.
- **Desurvey** calculates each hole's 3D trace. **Merge** joins collar, survey, assay and geology into one master table.

## 2. Core: build a domain (optional, about 10 minutes)

Open **Domain**. It has four tasks: **1 · Choose method**, **2 · Contacts**, **3 · Build & review**, **4 · Handoff**.

- **Between contact surfaces:** make a geological group from lithology codes (for example SAP), save its upper and lower contact surfaces, then build the solid between them.
- **Digitized section rings:** draw a closed ring on several parallel sections, then build the loft.
- After the build, check the volume, topology and the collar check. Enter a reviewer and a reason, then accept the solid. You can export it as DXF or OBJ.
- **Continue in Assay →** carries the master table and the reviewed solid to Assay.

Each step is described in the [Core Domain → Assay → Resource guide](https://geosuite.orebit.id/docs/#/ref/domain-workflow).

## 3. Assay: understand the grades (3 minutes)

[Open Orebit Assay](https://geosuite.orebit.id/Assay.html). The built-in sample holds 1 m intervals from 350 holes with Ni, Co, Fe, MgO, SiO2, Al2O3 and Cr2O3.

- **Stats** shows the mean, CV and percentiles for each element.
- **Top-Cut** shows the upper tail of the distribution and a suggested cap.
- **Domain Statistics** compares populations by domain. Method changes are a preview. Enter a reason and click **Apply reviewed population** to use one.
- **Composite** makes composites at the length you choose. When the data comes from Core Domain, composites stop at hard domain boundaries.

## 4. Resource: estimate and report (4 minutes)

[Open Orebit Resource](https://geosuite.orebit.id/Resource.html) and click **Start review**.

- **Setup:** choose Ni, percent units and one horizon, for example saprolite.
- **Variography:** click **Compute & fit variogram**. Check the experimental points, pair counts and model. A custom 3D direction (azimuth and dip) is in the variogram parameters.
- **Block Model:** check the cell size and density, then click **Generate Grid**. When a Core domain solid is attached, the blocks are clipped to it.
- **Estimation:** click **Run Estimation (IDW + OK + NN)**, then check **Cross-Val** and **Swath**.
- **Grade-Tonnage** compares cut-offs. The **Handoff Report** records the cut-off, methods, density and limits. The result is a screening estimate, not a Mineral Resource.

## 5. Your own data

In Core, open **Import** and add your collar, survey, assay and geology CSV files. Column names such as `Au (g/t)` or `Cu (%)` are recognised. Lab codes such as `-0.005` (below detection) and `-999` (missing) are handled on import. Import and calculations run on your computer.

Save the project from the profile menu (the avatar at the top right) as a `.orebit` file. You can reopen it in the same module.

## Install and work offline

The web version needs no installation. In Chrome or Edge, choose **Install app**; in Safari on macOS 14+, choose **File → Add to Dock**. Open Core, Assay and Resource once while online before using them offline. Google Drive, satellite maps and update checks still need internet.

Windows users can download three executables from [GitHub Releases](https://github.com/ghoziankarami/geosuite/releases/latest). The executables are unsigned; compare them with the checksum list on the release page.

Browser storage belongs to the browser profile. Clearing it can remove saved work, so keep `.orebit` files outside the browser. To build from source, follow the [repository installation guide](https://github.com/ghoziankarami/geosuite#run-from-source).

On a phone or tablet, **Steps** opens the main stages and **Advanced** opens the optional tools.

## Next

The [Thalanga tutorial](01-thalanga-vms.md) uses a public Queensland dataset and explains each decision, from the raw compilation to a grade-tonnage screen compared with 1989–1998 production. The [manual](https://geosuite.orebit.id/docs/) describes every screen and setting. The synthetic nickel laterite CSV files are in the [public dataset repository](https://github.com/ghoziankarami/orebit-datasets/tree/main/02-nikel-laterit).
