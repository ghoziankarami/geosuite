"""gamtools-style directional variogram, written from GSLIB gamv's definition.

This is an independent implementation (no app code): pairs are selected by the
angle between the pair vector and the search direction, limited by a bandwidth
measured perpendicular to the direction, and binned by the projected distance.

It exists to cross-check VAR-3D-1's three principal-axis curves. GSLIB itself is
not installed on this machine and was not executed; the point of this file is
that the *algorithm* is re-derived from the published definition rather than
taken from the engine under test.
"""
import math


def _unit(v):
    n = math.hypot(*v)
    return [c / n for c in v]


def gamv(samples, direction, lag_width, lag_count, atol_deg, bandwidth):
    """gamv-compatible directional semivariogram.

    samples: iterable of (x, y, z, value).
    Returns [(lag_center, gamma, pairs)] for bins with at least one pair.
    """
    u = _unit(direction)
    cos_atol = math.cos(math.radians(atol_deg))
    bins = [dict(n=0, s=0.0) for _ in range(lag_count)]
    pts = list(samples)
    for i in range(len(pts)):
        xi, yi, zi, vi = pts[i]
        for j in range(i + 1, len(pts)):
            xj, yj, zj, vj = pts[j]
            dx, dy, dz = xj - xi, yj - yi, zj - zi
            h = math.hypot(dx, dy, dz)
            if h == 0:
                continue
            hproj = dx * u[0] + dy * u[1] + dz * u[2]
            if hproj <= 0:  # gamv keeps one direction of the wedge
                continue
            # perpendicular component of the separation
            perp = math.sqrt(max(0.0, h * h - hproj * hproj))
            if perp > bandwidth:
                continue
            if hproj / h + 1e-12 < cos_atol:
                continue
            k = int(hproj // lag_width)
            if k >= lag_count:
                continue
            bins[k]["n"] += 1
            bins[k]["s"] += (vj - vi) ** 2
    out = []
    for k, b in enumerate(bins):
        if not b["n"]:
            continue
        out.append(((k + 0.5) * lag_width, b["s"] / (2 * b["n"]), b["n"]))
    return out
