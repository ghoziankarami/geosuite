"""Versioned project source capsules preflight before any module mutates its data."""

import functools
import http.server
import json
import os
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright
import test_resource_large_extent as native

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "build/build.mjs").exists())
DIST = Path(os.environ.get('OREBIT_TEST_DIST', ROOT / 'dist'))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


server = http.server.ThreadingHTTPServer(
    ("127.0.0.1", 0), functools.partial(Quiet, directory=str(DIST))
)
threading.Thread(target=server.serve_forever, daemon=True).start()
passed = 0


def check(value, message):
    global passed
    assert value, message
    passed += 1
    print("PASS:", message, flush=True)


def native_mapping_roundtrip(browser, base, language, viewport):
    context, page = native.ready(browser, base, 'Resource', viewport, language)
    try:
        native.nav(page, 2)
        page.locator('#fileInput').set_input_files({'name':'input.csv', 'mimeType':'text/csv',
            'buffer':b'hole_id,from_m,to_m,au_gpt,midx,midy,midz\nCSV-A,0,1,4.5,120,220,320\n'})
        page.wait_for_function('()=>JSON.stringify(DATA.rows).includes("CSV-A")')
        project = {'name':'native-mapping-roundtrip', 'schemaVersion':2,
                   'data':{'columns':['hole_id','au_gpt','axis_a','axis_b','axis_c'],
                           'rows':[['MAPPED-B',3.5,101,202,303]]}}
        native.nav(page, 2)
        with page.expect_file_chooser() as chooser:
            page.locator('#tab2 button[onclick="importBundle()"]') .click()
        chooser.value.set_files({'name':'mapped.orebit', 'mimeType':'application/json',
                                 'buffer':json.dumps(project).encode('utf-8')})
        page.locator('#p3ApplyMapping').wait_for(state='visible')
        for target, source in (('midx','axis_a'),('midy','axis_b'),('midz','axis_c')):
            page.locator(f'.colmap-sel[data-target="{target}"]').select_option(source)
        page.locator('#colmapGrade').select_option('au_gpt')
        page.locator('#colmapUnit').select_option('ppm')
        page.locator('#p3ApplyMapping').click()
        page.wait_for_function('async()=>!!(await dbGet("native-mapping-roundtrip"))')
        page.locator('.orebit-avatar').click()
        page.locator('.orebit-profile-menu [data-act="open"]').click()
        page.locator('#projectManagerModal button[data-project="native-mapping-roundtrip"][onclick^="loadProjectFromDB"]').click()
        page.locator('#projectManagerModal').wait_for(state='detached')
        check(page.locator('#p3ApplyMapping').count()==0 and page.evaluate('''()=>{
          const r=DATA.rows[0],c=DATA.cols;return r[c.indexOf('hole_id')]==='MAPPED-B'&&
          Number(r[c.indexOf('au_gpt')])===3.5&&Number(r[c.indexOf('midx')])===101&&
          Number(r[c.indexOf('midy')])===202&&Number(r[c.indexOf('midz')])===303&&gradeUnitFor('au_gpt')==='ppm'}'''),
          f'{language} {viewport["width"]}: native mapped project reopens with exact values and unit')
        check(not page.audit_errors and not page.evaluate('__largeExtentFailures.length'),
              f'{language} {viewport["width"]}: no page or swallowed-render failures')
    finally:
        context.close()


def native_literal_headers(browser, base, language, viewport):
    context, page = native.ready(browser, base, 'Resource', viewport, language)
    try:
        native.nav(page, 2)
        page.locator('#fileInput').set_input_files({'name':'literal-headers.csv','mimeType':'text/csv',
            'buffer':b"hole_id,au_gpt,constructor,__proto__,axis_c,O'Neil\nLITERAL,3.5,101,202,303,kept\n"})
        page.locator('#p3ApplyMapping').wait_for(state='visible', timeout=10000)
        check(page.locator('.colmap-sel[data-target="to_m"]').input_value() == '',
              f'{language} {viewport["width"]}: constructor is not guessed as an interval end')
        before = page.evaluate('()=>JSON.stringify(DATA.rows)')
        for target, source in (('midx','constructor'),('midy','__proto__'),('midz','axis_c')):
            page.locator(f'.colmap-sel[data-target="{target}"]').select_option(source)
        page.locator('#colmapGrade').select_option('au_gpt')
        page.locator('#colmapUnit').select_option('g/t')
        page.locator('.colmap-sel[data-target="to_m"]').select_option('constructor')
        page.locator('#p3ApplyMapping').click()
        page.wait_for_function('()=>Array.from(document.querySelectorAll(".toast")).some(e=>e.textContent.includes(t("res.applyColumnMapping.duplicateColumns")))')
        check(page.evaluate('()=>JSON.stringify(DATA.rows)') == before,
              f'{language} {viewport["width"]}: duplicate source assignment is rejected before activation')
        page.locator('.colmap-sel[data-target="to_m"]').select_option('')
        page.locator('#p3ApplyMapping').click()
        try:
            page.wait_for_function('()=>JSON.stringify(DATA.rows).includes("LITERAL")', timeout=8000)
        except Exception as error:
            detail = page.evaluate('''()=>({pending:_pendingUpload?.cols,selected:[...document.querySelectorAll('.colmap-sel')].map(e=>[e.dataset.target,e.value]),
              toasts:[...document.querySelectorAll('.toast')].map(e=>e.textContent),renderErrors:window.__largeExtentFailures})''')
            raise AssertionError(f'Literal mapping did not activate: {detail}; page errors: {page.audit_errors}') from error
        expected = page.evaluate('''()=>{const c=DATA.cols,r=DATA.rows[0];return [r[c.indexOf('hole_id')],
          r[c.indexOf('au_gpt')],r[c.indexOf('midx')],r[c.indexOf('midy')],r[c.indexOf('midz')],r[c.indexOf("O'Neil")]]}''')
        check(expected == ['LITERAL',3.5,101,202,303,'kept'],
              f'{language} {viewport["width"]}: literal CSV headers map to the exact uploaded values')
        page.on('dialog', lambda dialog: dialog.accept())
        page.locator('.orebit-avatar').click()
        with page.expect_download() as download:
            page.locator('.orebit-profile-menu [data-act="export"]').click()
        bundle = Path(download.value.path()).read_bytes()
        native.nav(page, 2)
        with page.expect_file_chooser() as chooser:
            page.locator('#tab2 button[onclick="importBundle()"]') .click()
        chooser.value.set_files({'name':'literal-reopen.orebit','mimeType':'application/json','buffer':bundle})
        page.wait_for_function('()=>DATA.rows.length===1 && JSON.stringify(DATA.rows).includes("LITERAL")')
        check(page.evaluate('''()=>{const c=DATA.cols,r=DATA.rows[0];return [r[c.indexOf('hole_id')],
          r[c.indexOf('au_gpt')],r[c.indexOf('midx')],r[c.indexOf('midy')],r[c.indexOf('midz')],r[c.indexOf("O'Neil")]]}''') == expected,
          f'{language} {viewport["width"]}: native project export and reimport retain mapped measurements and literal extra column')
        check(not page.audit_errors and not page.evaluate('__largeExtentFailures.length'),
              f'{language} {viewport["width"]}: literal mapping has no page or swallowed-render errors')
    finally:
        context.close()


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for module in ("Core", "Assay", "Resource"):
            page = browser.new_page()
            page_errors = []
            page.on('pageerror', lambda error: page_errors.append(str(error)))
            page.goto(f"http://127.0.0.1:{server.server_port}/{module}.html")
            page.wait_for_function("() => window.__i18nBooted === true")
            page.evaluate("document.querySelectorAll('.lang-picker-overlay,#tourOverlay').forEach(e=>e.remove())")
            page.evaluate('''()=>{window.__capsuleRenderErrors=[];const original=window.safeRender;
              window.safeRender=(name,fn)=>original(name,()=>{try{return fn()}catch(e){window.__capsuleRenderErrors.push(name+':'+e.message);throw e}});
              safeRender('capsule-canary',()=>{throw Error('capsule-canary')});}''')
            check(page.evaluate('()=>window.__capsuleRenderErrors.splice(0).some(e=>e.includes("capsule-canary"))'),
                  f'{module} swallowed-render detector canary is live')
            if module == "Core":
                result = page.evaluate("""async () => {
                  const saved=await OrebitProject.save('capsule-core');
                  const before=JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology,STATE.units]);
                  const changed=structuredClone(saved);changed.phase1.assay_csv=changed.phase1.assay_csv.replace('1.1','9.9');
                  let error='';try{await applyBundle(changed)}catch(e){error=e.code||e.message}
                  const after=JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology,STATE.units]);
                  const changedCells=structuredClone(saved);changedCells.phase1.source_rows.assay[0].ni_pct+=1;
                  let cellError='';try{await applyBundle(changedCells)}catch(e){cellError=e.code||e.message}
                  await sealProjectCapsule(changedCells);
                  let mismatch='';try{await applyBundle(changedCells)}catch(e){mismatch=e.code||e.message}
                  const cellsUnchanged=before===JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology,STATE.units]);
                  const stored=await dbGet('capsule-core');
                  const reopened=await OrebitProject.load('capsule-core');
                  const legacy=structuredClone(saved);legacy.schemaVersion=3;delete legacy.sourceCapsule;
                  const migration=await applyBundle(legacy);
                  return {saved:saved.schemaVersion===4&&!!saved.sourceCapsule?.revision,
                    roles:saved.sourceCapsule?.sources.map(s=>s.role).join(',')==='collar,survey,assay,geology',
                    corruptRejected:error.startsWith('PROJECT_SOURCE_REVISION_MISMATCH'),unchanged:before===after,
                    cellRejected:cellError==='PROJECT_SOURCE_REVISION_MISMATCH:assay',
                    representationsRejected:mismatch==='PROJECT_SOURCE_ROWS_MISMATCH',cellsUnchanged,
                    stored:!!stored?.sourceCapsule,opened:!!reopened?.sourceCapsule,
                    migrated:migration===true&&legacy.schemaVersion===4&&!!legacy.sourceCapsule};
                }""")
                check(result["saved"], "Core project save writes a current source capsule")
                check(result["roles"], "Core capsule declares collar, survey, assay and geology roles")
                check(result["corruptRejected"], "Core rejects a modified raw source by its revision")
                check(result["unchanged"], "Rejected Core capsule leaves every active source and unit unchanged")
                check(result["cellRejected"], "Core rejects modified exact cells before activation")
                check(result["representationsRejected"] and result["cellsUnchanged"], "Conflicting exact cells and CSV are rejected even with a resealed capsule, preserving the active data")
                check(result["stored"] and result["opened"], "Core IndexedDB save/reopen retains the capsule")
                check(result["migrated"], "Unsealed legacy Core project remains loadable")
            elif module == "Assay":
                result = page.evaluate("""async () => {
                  const saved=await sealProjectCapsule(buildBundle('capsule-assay'));
                  await dbPut(saved);
                  const before=JSON.stringify(DATA.rows);
                  const changed=structuredClone(saved);changed.data.rows[0][3]=Number(changed.data.rows[0][3])+1;
                  let error='';try{await applyBundle(changed)}catch(e){error=e.code||e.message}
                  const unchanged=before===JSON.stringify(DATA.rows);
                  const stored=await dbGet('capsule-assay');
                  const opened=await applyBundle(stored);
                  const legacy=buildBundle('legacy-assay');legacy.schemaVersion=2;delete legacy.sourceCapsule;
                  const migrated=await applyBundle(legacy);
                  return {saved:saved.schemaVersion===4&&saved.sourceCapsule?.sources[0]?.role==='assay-intervals',
                    corruptRejected:error.startsWith('PROJECT_SOURCE_REVISION_MISMATCH'),unchanged,
                    stored:!!stored?.sourceCapsule,opened,
                    migrated:migrated===true&&legacy.schemaVersion===4&&!!legacy.sourceCapsule};
                }""")
                check(result["saved"], "Standalone Assay project seals its interval role")
                check(result["corruptRejected"], "Assay rejects modified grades before activation")
                check(result["unchanged"], "Rejected Assay capsule preserves active rows")
                check(result["stored"] and result["opened"], "Assay IndexedDB project opens with its verified capsule")
                check(result["migrated"] is True, "Unsealed legacy Assay project remains loadable")
            else:
                result = page.evaluate("""async () => {
                  const saved=await sealProjectCapsule(buildBundle('capsule-resource'));
                  await dbPut(saved);
                  const before=JSON.stringify(DATA.rows);
                  const changed=structuredClone(saved);changed.data.rows[0][0]='TAMPERED';
                  let error='';try{await loadBundle(changed)}catch(e){error=e.code||e.message}
                  const unchanged=before===JSON.stringify(DATA.rows);
                  const stored=await dbGet('capsule-resource');
                  await loadBundle(stored);
                  const legacy=buildBundle('legacy-resource');legacy.schemaVersion=2;delete legacy.sourceCapsule;
                  await loadBundle(legacy);
                  return {saved:saved.schemaVersion===4&&saved.sourceCapsule?.sources[0]?.role==='resource-intervals',
                    corruptRejected:error.startsWith('PROJECT_SOURCE_REVISION_MISMATCH'),unchanged,
                    stored:!!stored?.sourceCapsule,opened:JSON.stringify(DATA.rows)===before,
                    migrated:legacy.schemaVersion===4&&!!legacy.sourceCapsule};
                }""")
                check(result["saved"], "Standalone Resource project seals its interval role")
                check(result["corruptRejected"], "Resource rejects modified rows before activation")
                check(result["unchanged"], "Rejected Resource capsule preserves active rows")
                check(result["stored"] and result["opened"], "Resource project save/reopen retains verified rows")
                check(result["migrated"], "Unsealed legacy Resource project migrates to a verified capsule")
                # Import through the actual file chooser: source capsules have
                # always accepted the legacy `columns` spelling as well as `cols`.
                if page.locator('nav.tabs .tab[onclick="showTab(2)"]').is_hidden():
                    page.locator('#journeyMode [data-journey-mode="detailed"]').click()
                page.locator('nav.tabs .tab[onclick="showTab(2)"]').click()
                page.locator('#fileInput').set_input_files({'name': 'resource-input.csv', 'mimeType': 'text/csv',
                    'buffer': b'hole_id,from_m,to_m,au_gpt,midx,midy,midz\nCSV-INPUT,0,1,4.5,120,220,320\n'})
                page.wait_for_function('()=>JSON.stringify(DATA.rows).includes("CSV-INPUT")')
                check(page.evaluate('()=>DATA.rows.length===1'), 'Resource starts the project import from an actual CSV upload')
                legacy = {'name': 'legacy-columns-native', 'schemaVersion': 2,
                          'units': {'au_gpt': 'g/t'},
                          'data': {'columns': ['hole_id', 'from_m', 'to_m', 'au_gpt', 'midx', 'midy', 'midz'],
                                   'rows': [['LEGACY-A', 0, 1, 1.25, 100, 200, 300],
                                            ['LEGACY-B', 0, 1, 2.5, 110, 210, 290]]}}
                with page.expect_file_chooser() as chooser:
                    page.locator('#tab2 button[onclick="importBundle()"]') .click()
                chooser.value.set_files({'name': 'legacy-columns.orebit', 'mimeType': 'application/json',
                                         'buffer': json.dumps(legacy).encode('utf-8')})
                page.wait_for_function('()=>JSON.stringify(DATA.rows).includes("LEGACY-A")', timeout=15000)
                check(page.evaluate('()=>DATA.rows.length===2 && DATA.cols.includes("au_gpt")'),
                      'Resource native project import activates legacy columns and exact source rows')
                stored_before = page.evaluate('async()=>JSON.stringify(await dbGet("legacy-columns-native"))')
                active_before = page.evaluate('()=>JSON.stringify(DATA.rows)')
                metadata_before = page.evaluate('()=>JSON.stringify(window._lastSchemaMeta)')
                page.locator('#fileInput').set_input_files({'name': 'pending.csv', 'mimeType': 'text/csv',
                    'buffer': b'hole_id,au_gpt\nCSV-PENDING,7\n'})
                page.locator('#p3CancelImport').wait_for(state='visible')
                page.locator('#p3CancelImport').click()
                check(page.evaluate('()=>JSON.stringify(DATA.rows)') == active_before and
                      page.evaluate('()=>JSON.stringify(window._lastSchemaMeta)') == metadata_before,
                      'Cancelling native CSV mapping preserves active source rows and metadata')
                needs_mapping = {'name': 'legacy-columns-native', 'schemaVersion': 2,
                                 'data': {'columns': ['hole_id', 'au_gpt'], 'rows': [['PENDING', 99]]}}
                with page.expect_file_chooser() as chooser:
                    page.locator('#tab2 button[onclick="importBundle()"]') .click()
                chooser.value.set_files({'name': 'pending-mapping.orebit', 'mimeType': 'application/json',
                                         'buffer': json.dumps(needs_mapping).encode('utf-8')})
                page.locator('#p3CancelImport').wait_for(state='visible')
                page.locator('#p3CancelImport').click()
                check(page.evaluate('()=>JSON.stringify(DATA.rows)') == active_before,
                      'Cancelling native project mapping preserves active Resource rows')
                check(page.evaluate('()=>JSON.stringify(window._lastSchemaMeta)') == metadata_before,
                      'Cancelling native project mapping preserves active source metadata and units')
                check(page.evaluate('async()=>JSON.stringify(await dbGet("legacy-columns-native"))') == stored_before,
                      'Cancelling native project mapping preserves the same-name saved project')
                mapped = {'name': 'legacy-columns-native', 'schemaVersion': 2,
                          'data': {'columns': ['hole_id', 'au_gpt', 'axis_a', 'axis_b', 'axis_c'],
                                   'rows': [['MAPPED-A', 3.5, 101, 202, 303]]}}
                with page.expect_file_chooser() as chooser:
                    page.locator('#tab2 button[onclick="importBundle()"]') .click()
                chooser.value.set_files({'name': 'mapped-project.orebit', 'mimeType': 'application/json',
                                         'buffer': json.dumps(mapped).encode('utf-8')})
                page.locator('#p3ApplyMapping').wait_for(state='visible')
                check(page.evaluate('async()=>JSON.stringify(await dbGet("legacy-columns-native"))') == stored_before,
                      'Pending mapping does not overwrite a same-name project')
                for target, source in (('midx', 'axis_a'), ('midy', 'axis_b'), ('midz', 'axis_c')):
                    page.locator(f'.colmap-sel[data-target="{target}"]').select_option(source)
                page.locator('#colmapGrade').select_option('au_gpt')
                page.locator('#colmapUnit').select_option('g/t')
                page.locator('#p3ApplyMapping').click()
                page.wait_for_function('async()=>JSON.stringify((await dbGet("legacy-columns-native"))?.data?.rows).includes("MAPPED-A")')
                check(page.evaluate('()=>JSON.stringify(DATA.rows).includes("MAPPED-A")'),
                      'Applying native project mapping activates and saves the imported project')
                page.locator('.orebit-avatar').click()
                page.locator('.orebit-profile-menu [data-act="open"]').click()
                page.locator('#projectManagerModal button[data-project="legacy-columns-native"][onclick^="loadProjectFromDB"]').click()
                page.locator('#projectManagerModal').wait_for(state='detached')
                check(page.locator('#p3ApplyMapping').count() == 0,
                      'Reopening a mapped project restores its assignments without mapping again')
                check(page.evaluate('''()=>{const r=DATA.rows[0],c=DATA.cols;return r[c.indexOf('hole_id')]==='MAPPED-A'&&
                  Number(r[c.indexOf('au_gpt')])===3.5&&Number(r[c.indexOf('midx')])===101&&
                  Number(r[c.indexOf('midy')])===202&&Number(r[c.indexOf('midz')])===303&&gradeUnitFor('au_gpt')==='g/t'}'''),
                      'Mapped project reopen preserves the grade, coordinates and assigned unit')
                saved = page.evaluate('async()=>await dbGet("legacy-columns-native")')
                check(saved['data']['columns'] == mapped['data']['columns'] and saved['data']['rows'] == mapped['data']['rows'],
                      'Saved mapping preserves the original source columns and measurements')
                saved_before = json.dumps(saved, sort_keys=True)
                active_before = page.evaluate('()=>JSON.stringify(DATA.rows)')
                saved['data']['rows'][0][1] = 999
                with page.expect_file_chooser() as chooser:
                    page.locator('#tab2 button[onclick="importBundle()"]') .click()
                chooser.value.set_files({'name': 'tampered.orebit', 'mimeType': 'application/json',
                                         'buffer': json.dumps(saved).encode('utf-8')})
                page.wait_for_function('()=>Array.from(document.querySelectorAll(".toast")).some(e=>e.textContent.includes("PROJECT_SOURCE_REVISION_MISMATCH"))')
                check(page.evaluate('()=>JSON.stringify(DATA.rows)') == active_before and
                      json.dumps(page.evaluate('async()=>await dbGet("legacy-columns-native")'), sort_keys=True) == saved_before,
                      'Tampered native project import preserves active and same-name saved data')
                stale_mapping = page.evaluate('async()=>await dbGet("legacy-columns-native")')
                stale_mapping['resourceColumnMapping']['sourceRevision'] = '0' * 64
                with page.expect_file_chooser() as chooser:
                    page.locator('#tab2 button[onclick="importBundle()"]') .click()
                chooser.value.set_files({'name': 'stale-mapping.orebit', 'mimeType': 'application/json',
                                         'buffer': json.dumps(stale_mapping).encode('utf-8')})
                page.wait_for_function('()=>Array.from(document.querySelectorAll(".toast")).some(e=>e.textContent.includes(t("res.importBundle.mappingInvalid")))', timeout=5000)
                check(page.evaluate('()=>JSON.stringify(DATA.rows)') == active_before and
                      json.dumps(page.evaluate('async()=>await dbGet("legacy-columns-native")'), sort_keys=True) == saved_before,
                      'Mapping from a different source revision is rejected without changing either project')
                altered_mapping = page.evaluate('async()=>await dbGet("legacy-columns-native")')
                altered_mapping['resourceColumnMapping']['mappedColumns'][2:4] = reversed(altered_mapping['resourceColumnMapping']['mappedColumns'][2:4])
                with page.expect_file_chooser() as chooser:
                    page.locator('#tab2 button[onclick="importBundle()"]') .click()
                chooser.value.set_files({'name': 'altered-mapping.orebit', 'mimeType': 'application/json',
                                         'buffer': json.dumps(altered_mapping).encode('utf-8')})
                page.wait_for_function('()=>Array.from(document.querySelectorAll(".toast")).filter(e=>e.textContent.includes(t("res.importBundle.mappingInvalid"))).length>=2', timeout=5000)
                check(page.evaluate('()=>JSON.stringify(DATA.rows)') == active_before and
                      json.dumps(page.evaluate('async()=>await dbGet("legacy-columns-native")'), sort_keys=True) == saved_before,
                      'Altered axis mapping is rejected without changing either project')
                duplicate = {'name':'legacy-columns-native','schemaVersion':2,
                             'data':{'columns':['hole_id','au_gpt','midx','axis_a','axis_b','axis_c'],
                                     'rows':[['DUPLICATE',3,10,11,12,13]]}}
                with page.expect_file_chooser() as chooser:
                    page.locator('#tab2 button[onclick="importBundle()"]') .click()
                chooser.value.set_files({'name':'duplicate-mapping.orebit','mimeType':'application/json',
                                         'buffer':json.dumps(duplicate).encode('utf-8')})
                page.locator('#p3ApplyMapping').wait_for(state='visible')
                for target, source in (('midx','axis_a'),('midy','axis_b'),('midz','axis_c')):
                    page.locator(f'.colmap-sel[data-target="{target}"]').select_option(source)
                page.locator('#colmapGrade').select_option('au_gpt')
                page.locator('#p3ApplyMapping').click()
                page.wait_for_function('()=>Array.from(document.querySelectorAll(".toast")).some(e=>e.textContent.includes(t("res.applyColumnMapping.duplicateColumns")))', timeout=5000)
                check(page.evaluate('()=>JSON.stringify(DATA.rows)') == active_before and
                      json.dumps(page.evaluate('async()=>await dbGet("legacy-columns-native")'), sort_keys=True) == saved_before,
                      'Duplicate mapped columns are refused before activation or same-name save')
                page.locator('#p3CancelImport').click()
                delayed = {'name': 'legacy-columns-native', 'schemaVersion': 2,
                           'data': {'columns': mapped['data']['columns'],
                                    'rows': [['DELAYED', 8, 111, 222, 333]]}}
                with page.expect_file_chooser() as chooser:
                    page.locator('#tab2 button[onclick="importBundle()"]') .click()
                chooser.value.set_files({'name':'delayed-project.orebit','mimeType':'application/json',
                                         'buffer':json.dumps(delayed).encode('utf-8')})
                page.locator('#p3ApplyMapping').wait_for(state='visible')
                for target, source in (('midx','axis_a'),('midy','axis_b'),('midz','axis_c')):
                    page.locator(f'.colmap-sel[data-target="{target}"]').select_option(source)
                page.locator('#colmapGrade').select_option('au_gpt')
                page.evaluate('''()=>{window.__originalCapsuleHash=window._opcSha256;
                  window._opcSha256=value=>new Promise((resolve,reject)=>{
                    window.__releaseCapsuleHash=()=>window.__originalCapsuleHash(value).then(resolve,reject);
                  });}''')
                page.locator('#p3ApplyMapping').click()
                page.wait_for_function('()=>typeof window.__releaseCapsuleHash==="function"')
                page.locator('#fileInput').set_input_files({'name':'replacement.csv','mimeType':'text/csv',
                    'buffer':b'hole_id,from_m,to_m,au_gpt,midx,midy,midz\nREPLACED,0,1,9,501,502,503\n'})
                page.wait_for_function('()=>JSON.stringify(DATA.rows).includes("REPLACED")')
                replacement_before = page.evaluate('()=>JSON.stringify(DATA.rows)')
                page.evaluate('()=>{window.__releaseCapsuleHash();window._opcSha256=window.__originalCapsuleHash;}')
                page.wait_for_function('''async()=>Array.from(document.querySelectorAll('.toast')).some(e=>e.textContent.includes('PROJECT_SOURCE_CHANGED')) ||
                  JSON.stringify((await dbGet('legacy-columns-native'))?.data?.rows).includes('DELAYED')''', timeout=15000)
                check(page.evaluate('()=>JSON.stringify(DATA.rows)') == replacement_before and
                      json.dumps(page.evaluate('async()=>await dbGet("legacy-columns-native")'), sort_keys=True) == saved_before,
                      'Delayed project save rejects a replaced CSV dataset and preserves the saved project')
            check(not page_errors and not page.evaluate('()=>window.__capsuleRenderErrors.length'),
                  f"{module} capsule journeys have no page or swallowed-render errors")
            page.close()
        for language in ('en', 'id'):
            for viewport in ({'width':1440,'height':1000}, {'width':390,'height':844}):
                native_mapping_roundtrip(browser, f'http://127.0.0.1:{server.server_port}', language, viewport)
        for language, viewport in [('en', {'width':1440,'height':1000}), ('id', {'width':390,'height':844})]:
            native_literal_headers(browser, f'http://127.0.0.1:{server.server_port}', language, viewport)
        browser.close()
finally:
    server.shutdown()
    server.server_close()

print("PROJECT CAPSULE:", passed, "checks passed", flush=True)
