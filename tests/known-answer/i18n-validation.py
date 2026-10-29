"""Independent definition-count parity and negative i18n CLI-report fixtures."""
import importlib.util
import random
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("validator", ROOT / "ops/scripts/validate-i18n.py")
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)
checks = 0

def check(condition, message):
    global checks
    assert condition, message
    checks += 1

keys = ["tab.good", "plot.axis", "attrTitle", "case.Part", "u.é", "missing.key"]
rng = random.Random(9217)
for trial in range(120):
    definitions = "\n".join(
        f"{quote}{key}{quote} : {quote}value{quote}"
        for key, quote in ((rng.choice(keys[:-1]), rng.choice(["'", '"'])) for _ in range(40))
    )
    indexed = validator.definition_counts(definitions)
    for key in keys:
        check(indexed[key] == validator.def_count(definitions, key), "Indexed and prior literal matcher must agree")

with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / "fixture.html"
    path.write_text('''<script>
      const en = {'tab.good':'Good','tab.one':'One','attrTitle':'Title'};
      const id = {"tab.good":"Baik","attrTitle":"Judul"};
    </script>
    <button data-i18n="tab.good"></button>
    <button data-i18n="tab.one"></button>
    <button data-i18n="missing.key"></button>
    <button data-i18n-attr="title:attrTitle"></button>
    <section data-i18n="tab.good"><i data-i18n="tab.one"></i></section>
    ''')
    report = validator.validate_file(path)
    check(report['used'] == 4 and report['ok'] == 2, "Full EN/ID and attribute-only keys remain checked")
    check(report['missing_one'] == ['tab.one'], "One-language omission remains a failure")
    check(report['missing_all'] == ['missing.key'], "Unknown key remains a failure")
    check(len(report['nested_lines']) == 1, "Nested translated content remains a failure")
    path.write_text('''<button data-i18n="tab.good"></button><script>
      const en={'tab.good':'Good'};const id={"tab.good":"Baik"};</script>''')
    report = validator.validate_file(path)
    check(report['used'] == report['ok'] == 1 and not report['missing_all'] and not report['missing_one'], "Valid translated fixture remains valid")
print(f"i18n validation: {checks} independent checks passed")
