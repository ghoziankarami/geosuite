# One route through Core, Assay and Resource

Use **Core → Assay → Resource** when starting with drillhole tables. If you
already have validated composites and declared units, you can start in Resource.
The module switcher opens another app; **Continue in Assay/Resource** transfers
the current exported data. These actions serve different purposes.

| Stage | Question it helps answer | Continue with |
| --- | --- | --- |
| Core | Do collar, survey, intervals and geology link correctly? Can XYZ be calculated or verified? | A validated master CSV with geometry and declared units |
| Assay | What does the grade distribution show? Which domain/treatment/composite choices are justified? | Actual domain-tagged composites, interpretation PDF and project backup |
| Resource | How sensitive is the preliminary estimate to spatial model, geometry, density and reporting scope? | Block CSV, plots and the parameter-aware screening PDF |

Keep all modules on the same web address/port for the direct transfer. It uses
the existing CSV export and normal import path; no download/re-upload is needed.
Desktop transfer uses the installed sibling executable when available. Manual
CSV export/import remains a supported fallback. Save project backups separately.

## Consistent controls in all three apps

The dashboard starts with the active-data summary and **Start review**. Each
stage puts insight, stage links and its next action at the top. **Advanced tools**
in the left sidebar exposes direct access to the other views; Next opens those
same views, not a separate calculation pipeline. Parameters remain editable.
Filled buttons run a pending calculation or continue; outlined controls inspect,
and dashed controls customize. Opening a view never approves an interpretation.

Core's main route is Import → Validation → Desurvey → Merge → Export. Table,
strip-log, section and optional composite views remain directly accessible.
The built-in synthetic sample contains a missing collar, missing geology and a
mismatched hole ID. **Validation results** name each affected ID, source row and
field. Open the affected cell or inspect the missing-record context. You can
add verified source records, edit values and click **Apply changes**, then
**Return and revalidate**. A missing collar stays empty until supplied; an ID is
prefilled only to identify the record you chose to add. Mapping/unit controls
remain available under the secondary details.

For the untouched built-in sample, **Repair from bundled original source** uses
its supplied original collar/geology records after confirmation; grades and
measured surveys are preserved. Uploaded or edited projects cannot use that
sample restoration. Otherwise import corrected CSVs or use the normal table
editor. Added, removed and edited values are recorded in the project and PDF.
The PDF includes the latest200 cell changes with an explicit limit; the project
retains the complete audit. Unresolved structural findings block continuation;
missing final measured depth or a geology log can remain recorded warnings.

Resource's route is Setup → Variography → Block Model → Estimation → validation
→ Grade-Tonnage → Report. Compute & fit produces the experimental curve and
model together. Custom sampling/model controls and continuity diagnostics are
collapsed initially. A variogram map is a lag-space diagnostic, not a collar map.
Directional adoption changes search orientation and fills the nested-model form.
Computing downhole supplies the positive anchor for later matching auto-fits;
Apply Nugget changes the current model too. Review these choices before applying.
Grid generation creates cells, not resource tonnage. Only supported estimated
cells enter the selected reporting population. Density, envelope and optional
cutoff decisions remain visible in the exported report.

## Assay: simple first, optional tools when needed

The main route is **Upload → Data/validation → Stats → Domain → Composite → Report**.
Select the element/commodity near the top of the stage before interpreting its plots.
The choice changes the view/report target without applying a cap or domain.
Each stage starts with a quick insight, a recommendation, an action and optional
interpretation notes. Default calculations do not approve an interpretation.
You can edit parameters; advanced navigation exposes all original tools.

1. **Upload:** check automatic column matches. Use manual assignment for unfamiliar
   headers. Select units explicitly when names do not establish them.
2. **Data:** inspect actual errors/warnings. Fix linkage, reversed/overlapping
   intervals, missing fields or invalid grades before relying on a result.
3. **Stats:** examine element, units, missing/zero values and the distribution.
   The optional top-cut tool shows proposals; reviewing them applies no cap.
4. **Domain:** choose source domains or an explicit grouping method. A grade rule
   is a screening grouping, not a verified three-dimensional geological solid.
5. **Composite:** use the suggested median interval length or edit it. Check
   dropped tails, gaps and informed-length grade conservation before continuation.
6. **Report:** export the PDF and continue in Resource. Optional controls let you
   export the stable composite CSV or the interpretation JSON.

**Record this review / Record review and continue** captures actual settings and
notes at that moment. Opening a tab does not mark it reviewed. Changes to the
relevant data or settings mark an earlier review **stale**; re-review when needed.
The PDF distinguishes reviewed, stale and unreviewed stages, including optional
tools you did not run. The Assay project saves these records; importing a new
dataset clears them. Old projects without the optional ledger still load.

Keep the Assay PDF/JSON with downstream Resource exports. The stable generic CSV
carries domain, unit and treatment metadata but not the complete interpretation
ledger. A quick screening report supports initial diligence; it does not establish
laboratory QAQC, geological validity or a certified Mineral Resource.

## Read the exported PDF

Core, Assay and Resource use the same first-page summary: four result cards,
current scope, a short interpretation, inspection priorities and the next step.
Full results and evidence start on page 2; the summary does not replace the
recorded settings or analyst notes.

- **Core:** source collar/assay counts, merged intervals and checks requiring a
  fix. Inspect warnings, coordinate source and CRS before handing data on.
- **Assay:** usable grades, current sample mean, composite count and retained
  informed length for the selected element. The sample mean is not a block
  Resource grade. Missing grades remain different from measured zero.
- **Resource:** selected tonnage, weighted block grade, contained metal and
  grid estimation coverage. The headline follows the actual report cutoff and
  confidence filter; generated, estimated and selected populations are separate.
  An unfinished estimate shows unavailable results, rather than invented zeros.

The PDF records cutoff choices and their justification, including no cutoff.
Review geological limits, density, support and validation before using screening
results in a decision or an enterprise modelling workflow.


## Primary continuation

Core computes Desurvey and Merge as their main stages open; the final main-stage action sends the merged data to Assay. Assay computes its displayed review stages, retains analyst notes and editable parameters, and sends its master export directly to Resource. Resource **Calculate & next** invokes the existing variogram, grid, estimation and cross-validation owners when no result exists or the calculation inputs changed. A completed custom model is retained. Invalid parameters, failed calculations and cancellation keep the current stage open with an explanation. Busy calculations prevent duplicate runs.

The Resource main route is setup → continuity → grid → estimation → cross-validation → grade-tonnage → report. Swath, confidence and the 3D viewer remain linked from relevant stages and directly available in Advanced tools. These visits do not apply treatments or imply analyst approval. Numerical defaults, support assumptions and user changes are recorded in the native report; inspect them before interpreting the screening result.

Resource calculations also check that delayed callbacks still belong to the active data and model. A completed estimate records its applied model, search and assigned unit. Changing those parameters requires recalculation before continuation or PDF export. Display ranges and palettes do not invalidate an estimate.

When coordinates exist under unfamiliar CSV headers, use **Assign source columns** from the focused correction panel. It opens the affected table/field in the existing mapper. Apply Mapping refreshes validation and continuation immediately, retains the original headers/measurements, and records the source-to-target assignments in the project/PDF processing log. Missing measurements still require verified source values.
