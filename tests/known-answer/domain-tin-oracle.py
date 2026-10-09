"""Optional independent S2 check: Node.js owners versus SciPy/Qhull.

Requires numpy/scipy for this test only; the app and normal Node gate do not.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from scipy.spatial import Delaunay

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2] if (HERE.parents[2] / "src").is_dir() else HERE.parents[1]
SOURCE = ROOT / "src/shared/geom/primitives.js"

NODE = r"""
const fs=require('fs');require(process.argv[1]);const result=[];
for(const input of JSON.parse(fs.readFileSync(0,'utf8'))) {
  let start=performance.now();
  const tin=OrebitGeometryPrimitives.makeTIN(input.points),build=performance.now()-start;
  const prepared=OrebitGeometryPrimitives.prepareTIN(tin);start=performance.now();
  const sample=input.query.map(q=>prepared.sample(...q));
  result.push({triangles:tin.triangles,sample,build_ms:build,query_ms:performance.now()-start});
}
process.stdout.write(JSON.stringify(result));
"""


def main() -> None:
    rng = np.random.default_rng(1729)
    cases = []
    for count in [30, 100, 250, 500, 1000, 2000]:
        xy = rng.uniform([392000, 9558000], [393000, 9559000], (count, 2))
        z = rng.uniform(10, 110, count)
        query = rng.uniform([391950, 9557950], [393050, 9559050], (1000, 2))
        cases.append(
            {"points": np.column_stack((xy, z)).tolist(), "query": query.tolist()}
        )
    run = subprocess.run(
        ["node", "-e", NODE, str(SOURCE)],
        input=json.dumps(cases),
        text=True,
        capture_output=True,
        check=True,
        timeout=60,
    )
    output = json.loads(run.stdout)
    assert len(output) == len(cases)
    records, matched, worst = [], 0, 0.0
    for source, actual in zip(cases, output):
        points = np.array(source["points"])
        independent = Delaunay(points[:, :2] - points[0, :2])
        ours = {tuple(sorted(t)) for t in actual["triangles"]}
        theirs = {tuple(sorted(t)) for t in independent.simplices.tolist()}
        assert ours == theirs, (len(points), "triangle mismatch")
        assert len(actual["sample"]) == len(source["query"])
        for query, got in zip(source["query"], actual["sample"]):
            local = np.array(query) - points[0, :2]
            index = independent.find_simplex(local)
            if index < 0:
                assert got is None, "no hull extrapolation"
            else:
                assert got is not None
                transform = independent.transform[index]
                weights = transform[:2].dot(local - transform[2])
                weights = np.r_[weights, 1 - weights.sum()]
                expected = weights.dot(points[independent.simplices[index], 2])
                error = abs(got["z"] - expected)
                worst = max(worst, float(error))
                assert error < 1e-7, (got["z"], expected, error)
            matched += 1
        records.append(
            {
                "vertices": len(points),
                "triangles": len(ours),
                "queries": len(source["query"]),
                "build_ms": actual["build_ms"],
                "query_ms": actual["query_ms"],
            }
        )
    print(
        json.dumps(
            {
                "source_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                "oracle": "SciPy/Qhull and independent transform interpolation",
                "matched_queries": matched,
                "worst_z_error_m": worst,
                "timing_scope": "Node on this CPU; not browser/UI/device certification",
                "cases": records,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
