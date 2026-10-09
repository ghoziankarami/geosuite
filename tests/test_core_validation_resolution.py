"""Actual finding-to-cell corrections, without replacing confirmations or data.

Fresh desktop/phone, default source restoration, real CSV uploads, exact record
navigation, Add/Apply, invalid geometry gating, same-name replacement and audit.
OREBIT_TEST_DIST can replay a previous immutable artifact for regression controls.
"""
import functools
import http.server
import json
import os
import tempfile
import threading
from pathlib import Path

import fitz
from playwright.sync_api import sync_playwright

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'build/build.mjs').exists())
DIST = Path(os.environ.get('OREBIT_TEST_DIST', ROOT / 'dist'))
PROOF = Path(os.environ['OREBIT_PROOF_DIR']) if os.environ.get('OREBIT_PROOF_DIR') else None


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


passed = 0


def check(value, name):
    global passed
    assert value, name
    passed += 1
    print('PASS ' + name, flush=True)


def ready(context, base):
    page = context.new_page()
    page.goto(base + '/Core.html')
    page.wait_for_function('()=>window.__i18nBooted===true')
    if page.locator('.lang-picker-overlay').count():
        page.locator('.lang-picker-overlay [data-pick="en"]').click()
    page.evaluate('''()=>{window.__repairErrors=[];const owner=window.safeRender;
      window.safeRender=(name,fn)=>owner(name,()=>{try{return fn();}catch(e){window.__repairErrors.push(String(e));throw e;}});
      safeRender('repair-canary',()=>{throw Error('repair-canary');});}''')
    check(page.evaluate('()=>window.__repairErrors.splice(0).some(x=>x.includes("repair-canary"))'), 'Live swallowed-render canary')
    page.locator('#tab1 .workflow-actions [data-action-role="next"]').click()
    page.wait_for_function('()=>document.getElementById("tab7").classList.contains("active")')
    check(page.locator('#coreValidationResults').count() == 1, 'Concrete results exist before any repair')
    return page


def stage(page, n):
    page.locator('.panel.active .workflow-step-links button').filter(has_text={2: 'Import', 7: 'Validation'}[n]).click()
    page.wait_for_function('(n)=>document.getElementById("tab"+n).classList.contains("active")', arg=n)


def upload(page, paths):
    stage(page, 2)
    before = page.evaluate('()=>STATE.collar.length+":"+STATE.survey.length')
    page.locator('#fileInput').set_input_files([str(p) for p in paths])
    page.wait_for_function('()=>STATE.collar.some(r=>r.hole_id==="FIX-001")')
    stage(page, 7)
    return before


def edit(page, table, idx, col, value, keyboard=False):
    cell = page.locator(f'#{table}Panel tr[data-idx="{idx}"] td[data-col="{col}"]')
    if keyboard:
        cell.focus()
        cell.press('Enter')
    else:
        cell.click()
    cell.locator('input').fill(str(value))
    cell.locator('input').press('Enter')


def apply(page, table):
    page.locator(f'#{table}Panel button[onclick="applyChanges(\'{table}\')"]').click()


def revalidate(page, table):
    page.locator(f'#{table}Panel [data-repair-return]').click()
    page.wait_for_function('()=>document.getElementById("tab7").classList.contains("active")')


def issue(page, identity):
    return page.locator('#coreValidationResults [data-repair-issue]').filter(
        has=page.locator(f'[data-repair-locate="{identity}"]')
    )


def main():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(DIST)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    try:
        with tempfile.TemporaryDirectory() as temp, sync_playwright() as pw:
            folder = Path(temp)
            if PROOF:
                PROOF.mkdir(parents=True, exist_ok=True)
            browser = pw.chromium.launch()
            for viewport in [{'width':1440,'height':960}, {'width':390,'height':844}]:
                context = browser.new_context(viewport=viewport, accept_downloads=True)
                errors = []
                context.on('page', lambda p: p.on('pageerror', lambda e: errors.append(e.stack or str(e))))
                page = ready(context, base)
                check(page.evaluate('()=>{const r=document.getElementById("coreValidationResults"),m=document.getElementById("coreValidationRemedies"),a=document.querySelector("#tab7 .workflow-actions");return !!(r.compareDocumentPosition(m)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(r.compareDocumentPosition(a)&Node.DOCUMENT_POSITION_FOLLOWING);}'), 'Results precede repairs and generic actions')
                check(page.locator('#coreValidationMapping').get_attribute('open') is None, 'Mapping stays secondary to actual findings')
                check(page.locator('#coreValidationResults [data-repair-locate^="missing-collar:"]').count() == 2, 'Default names both exact orphan IDs instead of generic table links')
                check(page.locator('#coreValidationResults [data-repair-locate^="missing-collar:"]').first.get_attribute('data-action-role') == 'inspect', 'Inspecting a finding uses the shared secondary action hierarchy')
                if PROOF:
                    page.locator('#coreValidationResults').screenshot(path=str(PROOF / f'default-findings-{viewport["width"]}.png'))
                prior = page.evaluate('()=>JSON.stringify([STATE.assay,STATE.survey])')
                page.locator('#coreRepairSource').click()
                page.get_by_role('dialog').get_by_role('button', name='Cancel', exact=True).click()
                check(page.locator('#coreRepairSource').is_visible(), 'Actual Cancel preserves unresolved sample')
                page.locator('#coreRepairSource').click()
                page.get_by_role('dialog').get_by_role('button', name='Continue', exact=True).click()
                page.wait_for_function('()=>!_p1RunValidationChecks().some(c=>c.severity==="fail")')
                check(page.locator('#tab7 [data-workflow-next]').is_enabled(), 'Known original restoration clears real gate')
                check(page.evaluate('()=>JSON.stringify([STATE.assay,STATE.survey])') == prior, 'Automatic correction preserves measured assay and survey')

                tables = {
                    'collar': 'hole_id,x,y,z,depth\nFIX-001,,2000,300,10\n',
                    'survey': 'hole_id,depth,dip,azimuth\nFIX-001,0,-120,0\nFIX-002,0,-90,0\n',
                    'assay': 'hole_id,from_m,to_m,ni_pct\nFIX-001,0,10,1.1\nFIX-002,0,10,1.4\n',
                    'geology': 'hole_id,from_m,to_m,lith1\nFIX-001,0,10,SAP\nFIX-002-WRONG,0,10,SAP\n',
                }
                paths = []
                for name, text in tables.items():
                    path = folder / (name + '.csv')
                    path.write_text(text)
                    paths.append(path)
                upload(page, paths)
                raw_grades = page.evaluate('()=>JSON.stringify(STATE.assay)')
                check(page.locator('#coreRepairSource').count() == 0, 'Uploaded project cannot restore bundled sample')
                check(page.locator('#tab7 [data-workflow-next]').is_disabled(), 'Structural errors block actual continuation')
                page.locator('[data-repair-locate="missing-collar:FIX-002"]').click()
                check(page.locator('#collarPanel .core-repair-context').is_visible(), 'Missing collar opens its exact-ID correction context')
                check(page.locator('#collarPanel .editable-table tbody tr').count() == 0, 'Missing collar is visibly absent instead of showing unrelated good rows')
                page.locator('#collarPanel [data-repair-add]').click()
                check(page.evaluate('()=>STATE.newRows.collar[0].hole_id==="FIX-002"&&["x","y","z","depth"].every(k=>STATE.newRows.collar[0][k]===null)'), 'Add prefills only identifier, never coordinates or depth')
                check(page.locator('#collarPanel [data-repair-apply]').get_attribute('data-action-role') == 'apply' and page.locator('#collarPanel [data-repair-apply]').evaluate('(el)=>getComputedStyle(el).backgroundColor') == 'rgb(8, 126, 130)', 'Applying source corrections uses the shared prominent primary action')
                check(page.locator('#collarPanel [data-repair-apply]').is_visible() and 'draft' in page.locator('#collarPanel .core-repair-context').inner_text(), 'New collar clearly identifies its draft and Apply/revalidate action')
                check(page.locator('#tab3 [data-workflow-next]').count() == 0, 'Focused correction removes unrelated advance-to-Survey action')
                # Hold the real compact editor through its one-second UI sync.
                page.wait_for_timeout(1100)
                check(not errors and not page.evaluate('()=>window.__repairErrors'), 'Focused correction survives its real periodic renderer')
                if PROOF:
                    page.wait_for_function('()=>!document.querySelector(".toast")')
                    page.locator('#collarPanel').screenshot(path=str(PROOF / f'missing-collar-{viewport["width"]}.png'))
                for col, value in [('x',1100),('y',2100),('z',301),('depth',10)]:
                    edit(page, 'collar', 1, col, value)
                apply(page, 'collar')
                revalidate(page, 'collar')
                check(page.locator('[data-repair-locate="missing-collar:FIX-002"]').count() == 0, 'Applied collar resolves that finding')
                check(page.locator('#tab7 [data-workflow-next]').is_disabled(), 'Other defects remain blocked after one correction')

                page.locator('[data-repair-locate="missing-collar:FIX-002-WRONG"]').click()
                page.locator('#collarPanel [data-repair-source="geology"]').click()
                check(page.locator('#geologyPanel .editable-table tbody tr').count() == 1, 'ID comparison opens only the exact affected geology record')
                check(page.locator('#geologyPanel td.cell-validation-focus[data-col="hole_id"]').count() == 1 and page.locator('#geologyPanel td.cell-validation-focus[data-col="hole_id"]').inner_text() == 'FIX-002-WRONG', 'Actual wrong ID is highlighted')
                edit(page, 'geology', 1, 'hole_id', 'FIX-002')
                apply(page, 'geology')
                revalidate(page, 'geology')
                check(page.locator('[data-repair-locate="missing-collar:FIX-002-WRONG"]').count() == 0, 'Verified ID correction resolves orphan without adding fabricated collar')

                page.locator('[data-repair-issue="measurement:survey"] [data-repair-row="0"]').click()
                check(page.locator('#surveyPanel td.cell-validation-focus[data-col="dip"]').inner_text() == '-120', 'Survey action identifies the exact invalid measured dip')
                edit(page, 'survey', 0, 'dip', -90)
                apply(page, 'survey')
                revalidate(page, 'survey')
                page.locator('[data-repair-issue="completeness:collar"] [data-repair-row="0"]').click()
                check(page.locator('#collarPanel td.cell-validation-focus[data-col="x"]').inner_text() == '', 'Missing-coordinate action targets the empty X cell')
                edit(page, 'collar', 0, 'x', 1000, keyboard=viewport['width'] == 1440)
                page.locator('#collarPanel [data-repair-apply]').click()
                page.wait_for_function('()=>document.getElementById("tab7").classList.contains("active")')
                check(page.locator('#tab7 [data-workflow-next]').is_enabled(), 'All reviewed structural corrections enable Desurvey')
                check(page.evaluate('()=>JSON.stringify(STATE.assay)') == raw_grades, 'Repair journey never changes grades')
                saved = page.evaluate('async()=>await OrebitProject.save("validation-resolution")')
                diffs = [d for e in saved['metadata']['audit']['changes'] for d in e.get('diffs', [])]
                check(any(d.get('kind') == 'added' and d.get('col') == 'x' and d.get('new') == 1100 for d in diffs), 'Added collar coordinates are recorded in project audit')
                check(any(d.get('col') == 'hole_id' and d.get('old') == 'FIX-002-WRONG' and d.get('new') == 'FIX-002' for d in diffs), 'Exact before/after ID correction survives project export')
                check(any(e['action'] == 'Source correction' for e in saved['metadata']['audit']['pipeline']), 'Manual corrections reach PDF pipeline owner')
                if PROOF:
                    page.locator('#coreValidationResults').screenshot(path=str(PROOF / f'corrected-results-{viewport["width"]}.png'))
                for n in [7, 10, 11]:
                    page.locator(f'#tab{n} .workflow-actions [data-workflow-next]').click()
                    page.wait_for_function('(n)=>!document.getElementById("tab"+n).classList.contains("active")', arg=n)
                check(page.evaluate('()=>STATE.merged?.length===2&&STATE.desurvey?.holes["FIX-002"]'), 'Real primary route desurveys and merges the corrected holes')
                with page.expect_download() as result:
                    page.locator('#pdf-export-btn').click()
                report = folder / 'corrected-core.pdf'
                result.value.save_as(str(report))
                with fitz.open(report) as doc:
                    text = '\n'.join(p.get_text() for p in doc)
                if PROOF:
                    (PROOF / 'last-native-text.txt').write_text(text)
                check('Source correction' in text and 'FIX-002-WRONG' in text, 'Native PDF records the corrections and original wrong ID')
                if PROOF and viewport['width'] == 1440:
                    import shutil
                    shutil.copy2(report, PROOF / 'core-native-corrected.pdf')
                    with fitz.open(report) as doc:
                        doc[0].get_pixmap(matrix=fitz.Matrix(1, 1)).save(PROOF / 'core-native-cover.png')
                if page.locator('#orebit-support-moment .support-close-btn').is_visible():
                    page.locator('#orebit-support-moment .support-close-btn').click()
                page.once('dialog', lambda dialog: dialog.accept('corrected-source.orebit'))
                with page.expect_download() as result:
                    page.locator('#btnExportBundle').click()
                project = folder / 'corrected-source.orebit'
                result.value.save_as(str(project))
                exported = json.loads(project.read_text())
                check(any(e['action'] == 'Source correction' for e in exported['metadata']['audit']['pipeline']), 'Native project download includes correction audit')
                stage(page, 2)
                page.evaluate('()=>{window.__beforeRepairProject=STATE.collar;}')
                with page.expect_file_chooser() as choice:
                    page.locator('#btnImportBundle').click()
                choice.value.set_files(str(project))
                page.wait_for_function('()=>STATE.collar!==window.__beforeRepairProject&&STATE.collar.some(r=>r.hole_id==="FIX-002"&&r.x===1100)')
                stage(page, 7)
                check(page.locator('#tab7 [data-workflow-next]').is_enabled() and page.locator('#coreRepairSource').count() == 0, 'Actual project reopen preserves corrected validation without sample restoration')
                # Defects beyond missing values need their comparison rows, not
                # a generic table switch. Replace the same actual CSV files.
                tables['collar'] = 'hole_id,x,y,z,depth\nFIX-001,1000,2000,300,10\nFIX-001,1001,2001,300,10\nFIX-002,1100,2100,301,10\n'
                tables['survey'] = 'hole_id,depth,dip,azimuth\nFIX-001,0,-90,0\nFIX-002,0,-90,0\n'
                tables['assay'] = 'hole_id,from_m,to_m,ni_pct\nFIX-001,0,7,1.1\nFIX-001,6,10,1.2\nFIX-002,0,10,1.4\n'
                tables['geology'] = 'hole_id,from_m,to_m,lith1\nFIX-001,0,10,SAP\nFIX-002,0,10,SAP\n'
                for name, text in tables.items():
                    (folder / (name + '.csv')).write_text(text)
                stage(page, 2)
                page.evaluate('()=>{window.__beforeRepairCsv=STATE.collar;}')
                page.locator('#fileInput').set_input_files([str(p) for p in paths])
                page.wait_for_function('()=>STATE.collar!==window.__beforeRepairCsv&&STATE.collar.length===3')
                stage(page, 7)
                check(page.locator('[data-repair-issue="duplicate:collar"]').count() == 1 and page.locator('[data-repair-issue="overlaps:assay"]').count() == 1, 'Corrected same-name reimport refreshes actual duplicate/overlap findings')
                page.locator('[data-repair-issue="duplicate:collar"] [data-repair-row="1"]').click()
                check(page.locator('#collarPanel .editable-table tbody tr').count() == 2, 'Duplicate inspection shows both exact-ID collar records')
                page.locator('#collarPanel button[onclick="deleteRow(\'collar\', 1, false)"]').click()
                apply(page, 'collar')
                revalidate(page, 'collar')
                check(page.locator('[data-repair-issue="duplicate:collar"]').count() == 0 and page.locator('#tab7 [data-workflow-next]').is_disabled(), 'Reviewed duplicate deletion resolves only that finding')
                page.locator('[data-repair-issue="overlaps:assay"] [data-repair-row="1"]').click()
                check(page.locator('#assayPanel .editable-table tbody tr').count() == 2 and page.locator('#assayPanel td.cell-validation-focus[data-col="from_m"]').count() == 2, 'Overlap inspection shows the two actual neighbouring interval boundaries')
                page.locator('#lang-switch').click()
                if page.locator('.lang-picker-overlay').count():
                    page.locator('.lang-picker-overlay [data-pick="id"]').click()
                page.wait_for_function('()=>document.documentElement.lang==="id"')
                check(page.locator('#assayPanel .core-repair-context').inner_text().find('tumpang') >= 0 and page.locator('#assayPanel tr[data-idx="1"]').count() == 1, 'Indonesian redraw retains exact correction context')
                edit(page, 'assay', 1, 'from_m', 7)
                apply(page, 'assay')
                revalidate(page, 'assay')
                check(page.locator('[data-repair-issue="overlaps:assay"]').count() == 0 and page.locator('#tab7 [data-workflow-next]').is_enabled() and page.evaluate('()=>JSON.stringify(STATE.assay.map(r=>r.ni_pct))') == '[1.1,1.2,1.4]', 'Verified interval edit revalidates without modifying grades')
                audit = page.evaluate('async()=>await OrebitProject.save("duplicate-overlap")')
                changes = [d for e in audit['metadata']['audit']['changes'] for d in e.get('diffs', [])]
                check(any(d.get('kind') == 'deleted' and d.get('col') == 'x' and d.get('old') == 1001 for d in changes), 'Deleted source values remain in the saved correction audit')
                render_errors = page.evaluate('()=>window.__repairErrors')
                assert not errors and not render_errors, {'page_errors': errors, 'renderer_errors': render_errors}
                check(True, 'Complete correction journey has no renderer or page errors')
                check(page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+1'), 'Phone/desktop correction journey fits the viewport')
                context.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print(f'Core validation resolution: {passed} checks passed', flush=True)


if __name__ == '__main__':
    main()
