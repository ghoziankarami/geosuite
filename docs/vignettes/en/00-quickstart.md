# Quickstart: GeoSuite in 10 minutes

**Check the build first.** This walkthrough targets the build with a **350-hole synthetic nickel laterite** sample. Published source, Windows releases and the hosted web modules can come from different revisions. Earlier builds use a Thalanga sample; installation alone does not replace it. Check the sample name and hole count before following the numbers below. If your build shows Thalanga, use the [Thalanga tutorial](01-thalanga-vms.md), which imports its own public dataset, or wait for the matching product build to be published.

Every module opens with the same sample dataset already loaded: 350 drillholes through a nickel laterite deposit (synthetic, CC BY 4.0, credit Orebit.id). You need no account and no files of your own. Follow the four steps below and you will have seen the whole workflow, from raw drillholes to a grade-tonnage curve.

## 1. Core: check the drillholes (3 minutes)

[Open Orebit Core](https://geosuite.orebit.id/try/Core.html). Use **Start review** for the main path. **Advanced tools** in the sidebar opens the detailed table and section views directly.

- **Dashboard** shows 350 drillholes, 8,896 assay intervals and 8.8 km of drilling, with overburden, limonite, saprolite and bedrock logged; 10 holes stop before bedrock.
- **Validation** checks every hole for missing surveys, overlapping or gapped intervals and holes without a geology log, and lists each finding with the reason.
- **Section** draws the holes on a cross-section with grades and lithology.
- **Desurvey** turns collar and survey into 3D hole traces.

## 2. Assay: understand the grades (3 minutes)

[Open Orebit Assay](https://geosuite.orebit.id/try/Assay.html). It opens with nominal 1 m intervals from all 350 holes: Ni, Co, Fe, MgO, SiO2, Al2O3 and Cr2O3, split into a saprolite and a limonite domain.

- **Stats** gives mean, CV and percentiles per element and per domain.
- **Top-Cut** shows where the upper tail breaks up and suggests a cap.
- **Domain** compares the saprolite and limonite domains and can group samples using a cutoff; such a grouping is not a geological solid.

## 3. Resource: estimate and report (4 minutes)

[Open Orebit Resource](https://geosuite.orebit.id/try/Resource.html).

- On the **Dashboard**, click **Start review**. In Setup choose Ni, percent units and one horizon such as saprolite; run limonite separately if justified.
- **Variography:** click **Compute & fit**, inspect the experimental points, pair counts and model. Custom settings and optional directional/downhole tools are below.
- **Block Model:** inspect cell dimensions, density and the support envelope before generating. Then estimate and inspect cross-validation and swath results.
- **Grade-Tonnage** compares cutoffs. **Report** records your chosen cutoff or no-cutoff setting, methods and limitations. A screening estimate is not a certified resource.
- **Advanced tools** opens optional views directly. The same top-stage actions and sidebar pattern apply in Core and Assay.

## 4. Your own data

In Core, open **Import** and drop in your collar, survey, assay and geology CSV files. Column names such as `Au (g/t)` or `Cu (%)` are recognised automatically, and lab codes such as `-0.005` (below detection) or `-999` (missing) are handled for you. CSV imports and calculations run locally. Optional Google Drive access, satellite maps and update checks need an internet connection.

Export the validated master data from Core and load them on the **Upload** tab in Assay, then pass Assay's export to Resource the same way.

## Next

The [full Thalanga tutorial](01-thalanga-vms.md) uses a public dataset (Queensland, loaded from the tutorial's own data file) and follows it through every decision, from the raw government compilation to a grade-tonnage screen checked against 1989–1998 production. The [manual](https://geosuite.orebit.id/docs/) documents every screen and setting.

## Install, work offline and keep backups

No installation is required for the web version. On Chrome or Edge, use **Install app**; on Safari on macOS 14+, use **File → Add to Dock**. Open **Core, Assay and Resource** once while online before offline use. Google Drive, satellite maps and update checks still need a connection.

Windows users can also download the three separate executables from [GitHub Releases](https://github.com/ghoziankarami/geosuite/releases/latest). The executables are unsigned; compare the files with the release checksum list.

Export projects as backups. Browser storage belongs to the browser profile and site origin; clearing it can remove saved work. Save the exported files outside the browser. To build from source, follow the [repository installation guide](https://github.com/ghoziankarami/geosuite#build-from-source).

The collar programme follows an irregular strike-oriented prospect with selective infill. Core retains all raw horizons; the initial Assay/Resource example selects LIM/SAP. Measured density is retained in handoffs. For validation practice, use the [missing-data and interval validation exercises](https://github.com/ghoziankarami/orebit-datasets/tree/main/exercises); inspect and correct them before export.
