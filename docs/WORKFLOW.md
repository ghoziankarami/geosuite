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

## Assay: simple first, optional tools when needed

The main route is **Upload → Data/validation → Stats → Domain → Composite → Report**.
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
