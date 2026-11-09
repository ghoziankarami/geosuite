#!/usr/bin/env python3
"""VAR-3D-1 cross-check: the engine's principal-axis curves against gamv.

GSLIB itself is not installed here, so this compares the engine with an
independent re-derivation of GSLIB's `gamv` definition (see gamv_oracle.py):
pairs inside an angular tolerance, binned by projected distance.

The two definitions differ on purpose:
  * the engine bins by the full 3D separation and selects by a cone;
  * gamv bins by the projected distance and can add a bandwidth.
So a pair near a lag boundary lands in a different bin, and in a thinly
populated bin that alone moves gamma a lot. The check therefore asserts
agreement only where a bin is well populated (n >= 40), which is the part a
geologist actually reads off the curve, and prints the thinly populated ones
for the record.

A failure here means the engine's axes, pair selection or estimator drifted —
not that the two definitions must produce identical numbers.
"""
import json
import math
import random
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = next(p for p in HERE.parents if (p / 'build/build.mjs').exists())
sys.path.insert(0, str(HERE))
from gamv_oracle import gamv  # noqa: E402

SAMPLE_COUNT = 1400
LAG_WIDTH, LAG_COUNT, TOLERANCE_DEG, MAX_DISTANCE = 10, 6, 10, 60
MIN_PAIRS_FOR_EQUALITY = 40
MAX_RELATIVE_DIFFERENCE = 0.20

APP = r'''
const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync('src/shared/geostat/resource-estimation.js','utf8');
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(src,ctx);
const G=ctx.window.OrebitGeostat;const s=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const out=G.experimental3Axis(s,{azDeg:0,dipDeg:0,rakeDeg:0},
  {lagWidth:%d,lagCount:%d,angularToleranceDeg:%d,maxDistance:%d,minPairs:1});
console.log(JSON.stringify({axes:G.principalAxes(0,0,0),curves:out.curves}));
''' % (LAG_WIDTH, LAG_COUNT, TOLERANCE_DEG, MAX_DISTANCE)

PASSED = 0


def check(condition, message):
    global PASSED
    assert condition, message
    PASSED += 1
    print('PASS:', message, flush=True)


def main():
    random.seed(11)
    points = [{'x': random.uniform(0, 300), 'y': random.uniform(0, 300), 'z': random.uniform(0, 120)}
              for _ in range(SAMPLE_COUNT)]
    for p in points:
        p['v'] = (math.sin(p['x'] / 55.0) + math.cos(p['y'] / 24.0)
                  + math.sin(p['z'] / 11.0)) * 0.5 + random.gauss(0, 0.05)

    work = Path(tempfile.mkdtemp())
    (work / 'points.json').write_text(json.dumps(points))
    (work / 'app.cjs').write_text(APP)
    run = subprocess.run(['node', str(work / 'app.cjs'), str(work / 'points.json')],
                         cwd=ROOT, capture_output=True, text=True)
    if run.returncode:
        print(run.stderr[-2000:], file=sys.stderr)
        raise SystemExit('the engine did not produce three-axis curves')
    app = json.loads(run.stdout)

    tuples = [(p['x'], p['y'], p['z'], p['v']) for p in points]
    compared = 0
    for axis in ('major', 'intermediate', 'minor'):
        curve = app['curves'][axis]
        check(len(curve['lags']) >= 3, f'{axis}: the engine produced a usable curve')
        oracle = {round(lag, 3): gamma
                  for lag, gamma, _ in gamv(tuples, app['axes'][axis], LAG_WIDTH,
                                            LAG_COUNT, TOLERANCE_DEG, float('inf'))}
        for lag, gamma, pairs in zip(curve['lags'], curve['gammas'], curve['pairs']):
            other = oracle.get(round(lag, 3))
            if other is None or pairs < MIN_PAIRS_FOR_EQUALITY:
                if other is not None:
                    print(f'  note {axis} lag {lag:.0f} ({pairs} pairs): '
                          f'engine {gamma:.5f} vs gamv {other:.5f} (thin bin, not asserted)')
                continue
            relative = abs(other - gamma) / gamma
            check(relative <= MAX_RELATIVE_DIFFERENCE,
                  f'{axis} lag {lag:.0f}: engine {gamma:.5f} vs gamv {other:.5f} '
                  f'({relative:.1%}, {pairs} pairs)')
            compared += 1
    check(compared >= 6, f'at least six well-populated bins were compared ({compared})')
    print(f'\nVAR-3D-1 gamv cross-check: {PASSED} passed')


if __name__ == '__main__':
    main()
