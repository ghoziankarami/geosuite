"""Synthetic raw CSVs for native geological builds; no approved state or packets."""
import csv


def write_domain_fixture(folder, *, measured_ends=False, varying_grades=False, grid_size=5):
    # Explicit synthetic laterite: 100x100 m footprint, 6 m SAP thickness.
    # Independent volume oracle: 100*100*6 = 60,000 m³.
    tables = {'collar': [['hole_id', 'x', 'y', 'z', 'depth']],
              'survey': [['hole_id', 'depth', 'azimuth', 'dip']],
              'assay': [['hole_id', 'from_m', 'to_m', 'ni_pct']],
              'geology': [['hole_id', 'from_m', 'to_m', 'lith1']]}
    if grid_size not in (5, 6):
        raise ValueError("Native fixture supports the documented five/six-hole grids")
    spacing = 100 // (grid_size - 1)
    for i in range(grid_size):
        for j in range(grid_size):
            hole = f'L{i}{j}'
            depth = 4 + i + j / 2
            tables['collar'].append([hole, 700000 + spacing*i, 9800000 + spacing*j, 100, depth + 10])
            tables['survey'].append([hole, 0, 0, -90])
            if measured_ends:
                tables['survey'].append([hole, depth + 10, 0, -90])
            sap_grade = 1 + i / 10 + j / 50 if varying_grades else 1.6
            for a, b, code, grade in ((0, depth, 'LIM', .9), (depth, depth+6, 'SAP', sap_grade),
                                      (depth+6, depth+10, 'BRK', .2)):
                tables['assay'].append([hole, a, b, grade])
                tables['geology'].append([hole, a, b, code])
    paths = []
    for name, rows in tables.items():
        path = folder / f'{name}.csv'
        with path.open('w', newline='') as output:
            csv.writer(output).writerows(rows)
        paths.append(path)
    return paths
