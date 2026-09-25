# Input data format

GeoSuite reads comma-, semicolon- or tab-separated text files (`.csv`, `.txt`),
UTF-8 with or without BOM, dot- or comma-decimal (detected per upload, overridable).
Column names are matched by meaning, not by exact spelling; when a column cannot be
identified, the import stops and shows a column-mapping panel instead of guessing.

## Tables (Orebit Core)

| Table | Required | Common optional columns |
|---|---|---|
| Collar | hole ID, X (easting), Y (northing), Z (elevation) | total depth, azimuth, dip |
| Survey | hole ID, depth, dip, azimuth | — |
| Assay | hole ID, from, to, one or more grade columns | sample ID, density / SG, recovery |
| Lithology | hole ID, from, to, lithology code | weathering, alteration, any category |

Examples of recognised headers: `HOLEID`, `BHID`, `Lubang`; `FROM`/`Dari`, `TO`/`Sampai`;
`EAST`, `X`, `Easting`; `Elevasi`, `RL`, `Z`.

**Coordinates must be projected, in metres** (e.g. UTM). Latitude/longitude degrees are
flagged as a failed check because every distance in the workflow would be wrong.

## Grade columns

A grade column is recognised from the element symbol and, when present, a unit suffix:
`Au_gpt`, `au_ppm`, `Cu_pct`, `CU` (unit inferred and shown in the import report),
`Ni_%`, `Sn_kgm3`, oxides such as `SiO2`, `Al2O3`, `Cr2O3`. Units: g/t, ppm, ppb, %,
kg/m³ (volumetric, for placer). Check the unit shown for each column in the import
report — a bare header such as `CU` cannot say whether it is % or ppm by itself.

## Special values in grade columns

| You write | GeoSuite reads |
|---|---|
| `<0.005` | 0.0025 (half the detection limit) |
| `-0.005` (negative = detection limit) | 0.0025 by default |
| `-99`, `-999`, `-9999` (any all-nines code) | blank — missing sample, excluded |
| a negative larger than the column's highest measured value | blank — missing sample code, excluded |
| `>10` (over-limit) | 10 — a lower bound; re-assay before relying on it |
| `BDL`, `ND`, `NA`, `-`, empty | blank |

The import report shows how many values of each kind were converted.

## Moving data between modules

Core exports a master CSV whose `# orebit-schema=` header lines carry each column's
role and unit, so Assay and Resource read it without re-mapping. Assay exports
composites for Resource the same way. You can also load your own composite file
straight into Resource: it needs hole ID, X, Y, Z (mid-point) and at least one grade.
