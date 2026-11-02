"""Synthetic tetrahedron/box volumes from independent SciPy/Qhull halfspaces."""
import itertools
import json
from pathlib import Path
import numpy as np
import scipy
from scipy.spatial import ConvexHull, QhullError

rng = np.random.default_rng(17013)
cases = []
for i in range(64):
    vertices = rng.uniform(-2, 3, (4, 3))
    hull = ConvexHull(vertices)
    faces = []
    for ids, eq in zip(hull.simplices, hull.equations):
        ids = ids.tolist()
        if np.dot(np.cross(vertices[ids[1]]-vertices[ids[0]], vertices[ids[2]]-vertices[ids[0]]), eq[:3]) < 0:
            ids[1], ids[2] = ids[2], ids[1]
        faces.append(ids)
    lo = rng.uniform(-1, 1, 3); size = rng.uniform(0.1, 2, 3); hi = lo + size
    planes = list(hull.equations)
    for axis in range(3):
        n = np.zeros(3); n[axis] = 1
        planes.extend([np.r_[n, -hi[axis]], np.r_[-n, lo[axis]]])
    planes = np.array(planes); points = []
    for chosen in itertools.combinations(range(len(planes)), 3):
        coefficients = planes[list(chosen)]
        if abs(np.linalg.det(coefficients[:,:3])) < 1e-12: continue
        p = np.linalg.solve(coefficients[:,:3], -coefficients[:,3])
        if np.all(planes[:,:3]@p + planes[:,3] <= 1e-9):
            if not any(np.linalg.norm(p-q) < 1e-8 for q in points): points.append(p)
    try: volume = float(ConvexHull(np.array(points)).volume) if len(points) >= 4 else 0.
    except QhullError: volume = 0.
    cases.append({'mesh': {'v':vertices.tolist(), 'f':faces}, 'grid': {'origin':lo.tolist(), 'size':size.tolist(), 'count':[1,1,1]}, 'expected':volume})
path = Path(__file__).parent/'fixtures'/'convex-clipping-oracle.json'
path.write_text(json.dumps({'oracle':'SciPy '+scipy.__version__+' ConvexHull; intersections of independent plane triples', 'seed':17013, 'synthetic':True, 'cases':cases}, indent=2)+'\n')
print('Wrote',len(cases),'independent synthetic intersections:',path)
