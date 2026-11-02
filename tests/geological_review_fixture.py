"""Content-bound synthetic protocol fixtures; not native Core acceptance evidence."""
import hashlib
import json


def _json_value(value):
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, list):
        return [_json_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _json_value(item) for key, item in value.items()}
    return value


def digest(value):
    text = json.dumps(_json_value(value), ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(text.encode()).hexdigest()


def reviewed_packet(mesh, volume, code='SAP', density=1.6, inputs=None, readiness='validated'):
    inputs = {**(inputs or {'rules': {'method': 'section-loft'}}),
              'material': {'density': density, 'unit': 't/m3', 'source': 'Core declared material'}}
    source_hash = hashlib.sha256(b'synthetic geological protocol fixture').hexdigest()
    inputs_hash, mesh_hash = digest(inputs), digest(mesh)
    review = {'at': '2026-10-20T00:00:00Z', 'code': code, 'volume': volume,
              'reviewer': 'Synthetic protocol reviewer',
              'reason': 'Synthetic protocol fixture; native Core acceptance is tested separately.',
              'sourceHash': source_hash, 'inputsHash': inputs_hash, 'meshHash': mesh_hash}
    checks = ('topology', 'selfIntersection', 'topography', 'surfaceCrossings', 'overlap', 'honouring', 'geologistReview')
    return {'schemaVersion': 1, 'source': {'sha256': source_hash},
            'crs': {'kind': 'epsg', 'epsg': 32751, 'units': 'm'},
            'domains': [{'code': code, 'density': density, 'build': {
                'mesh': mesh, 'volume': volume, 'inputs': inputs, 'meshHash': mesh_hash, 'inputsHash': inputs_hash,
                'review': review, 'reviewHash': digest(review), 'stale': False,
                'validation': {key: True for key in checks}}}],
            'handoff': {'from': 'Core', 'readiness': readiness, 'volume': volume if readiness == 'validated' else None,
                        'at': '2026-10-20T00:00:00Z'}}
