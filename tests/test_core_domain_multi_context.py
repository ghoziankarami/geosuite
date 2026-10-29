"""Native multiple-domain editor isolation, independent solids and project reopen."""
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import tempfile
import threading

from playwright.sync_api import sync_playwright
from domain_native_fixture import write_domain_fixture

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'build/build.mjs').exists())
DIST = Path(os.environ.get('OREBIT_TEST_DIST', ROOT / 'dist'))
EVIDENCE = os.environ.get('OREBIT_MULTI_DOMAIN_EVIDENCE')
passed = 0


def check(value, message):
    global passed
    assert value, message
    passed += 1
    print('PASS:', message, flush=True)


def task(page, name):
    page.locator(f'.domain-steps [data-domain-step="{name}"]').click()


def navigate(page, number):
    button = page.locator('nav.tabs .tab').nth(number - 1)
    if not button.is_visible():
        page.locator('nav.tabs .screening-advanced-toggle').click()
    button.click()
    page.wait_for_function('(n)=>document.getElementById("tab"+n).classList.contains("active")', arg=number)


def raw(page):
    return page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')


def boot(page, url, language):
    page.goto(url)
    page.wait_for_function('()=>window.__i18nBooted&&window.__orebitCoreProjectReady')
    if page.locator('.lang-picker-overlay').count():
        page.locator(f'.lang-picker-overlay [data-pick="{language}"]').click()
    if page.locator('#tourOverlay.open').count():
        page.locator('#tourCard .tour-skip').click()
    if page.locator('html').get_attribute('lang') != language:
        page.locator('#lang-switch').click()
        if page.locator('.lang-picker-overlay').count():
            page.locator(f'.lang-picker-overlay [data-pick="{language}"]').click()
    page.wait_for_function('(language)=>document.documentElement.lang===language', arg=language)
    page.evaluate('''()=>{window.__multiErrors=[];const original=safeRender;
      window.safeRender=(label,fn)=>original(label,()=>{try{const result=fn();
        if(result?.catch)return result.catch(e=>{__multiErrors.push(label+':'+e.message);throw e;});
        return result;}catch(e){__multiErrors.push(label+':'+e.message);throw e;}});
      safeRender('multi-context-canary',()=>{throw Error('detector-live')});}''')
    check(page.evaluate('__multiErrors.splice(0).some(s=>s.includes("detector-live"))'), 'swallowed-render detector is live')


def define(page, code, lithology):
    task(page, 'book')
    page.locator('#domainCodebookSelect').select_option('')
    page.locator('#domainCodebookCode').fill(code)
    page.locator('#domainCodebookLabel').fill('Synthetic '+code)
    page.locator('#domainCodebookLithologies').get_by_label(lithology, exact=True).check()
    page.locator('#domainCodebookApply').click()
    page.wait_for_function('(code)=>OrebitCoreDomain.exportState().codebook.some(d=>d.code===code)', arg=code)


def select(page, code):
    page.locator(f'#domainTree [data-domain-code="{code}"]').click()
    # Selecting alone must bind the context, before an unrelated Apply action.
    task(page, 'contacts')
    check(page.locator('#domainContactTarget').input_value() == 'book:'+code, 'tree selects the actual contact/editor owner '+code)


def review(page, code, overlap=False):
    check(page.locator('#domainSolidAcceptBtn').is_disabled(), 'candidate cannot approve itself')
    page.locator('#domainSolidReviewer').fill('Synthetic multi-domain reviewer')
    page.locator('#domainSolidReason').fill('Synthetic test: inspect separate domain identity, contacts/rings and independent volume.')
    page.locator('#domainSolidReview').check()
    check(page.locator('#domainSolidCode').input_value() == code, 'candidate has the selected output code '+code)
    page.locator('#domainSolidAcceptBtn').click()
    if overlap:
        page.wait_for_function('()=>document.querySelector(".domain-accepted")?.textContent.includes(t("dom.solid.overlapError").split("{code}")[0])')
    else:
        page.wait_for_function('(code)=>OrebitCoreDomain.exportState().domains.some(d=>d.code===code&&!d.build.stale)', arg=code)


def rings(page, bottom, top):
    task(page, 'contacts')
    page.locator('#domainBuildMethod').select_option('loft')
    page.locator('#domainToolDigitize').click()
    page.locator('#domainLoftSnap').fill('0')
    page.locator('#domainLoftSnap').press('Tab')
    for offset, label in ((0, 'XS +00'), (50, 'XS +01')):
        page.locator('#domainSectionList .domain-section').filter(has_text=label).click()
        page.wait_for_function('(off)=>OrebitCoreDomainViewer.state().offset===off', arg=offset)
        for h, rl in ((-40, bottom), (40, bottom), (40, top), (-40, top)):
            page.locator('#domainLoftH').fill(str(h))
            page.locator('#domainLoftRL').fill(str(rl))
            page.locator('#domainLoftAdd').click()
        page.locator('#domainLoftClose').click()


def build(page, method, code, overlap=False):
    task(page, 'solid')
    if method == 'loft':
        page.locator('#domainLoftEnd').select_option('zero')
        page.locator('#domainLoftTopo').select_option('collars')
        page.locator('#domainLoftBuild').click()
    else:
        page.locator('#domainSolidTopo').select_option('collars')
        page.locator('#domainSolidBuild').click()
    page.wait_for_function('()=>window.__domainSolid?.status==="solid"')
    want = 16000 if method == 'loft' else (70000 if code == 'D2' else 60000)
    check(abs(page.evaluate('__domainSolid.volume') - want) < 1e-6, f'{method}/{code}: independent volume {want} m3')
    review(page, code, overlap)


def workspace(page):
    return page.evaluate('OrebitCoreDomain.exportState().workspace')


def model(page, code):
    return page.evaluate('(code)=>OrebitCoreDomain.exportState().domains.find(d=>d.code===code)', code)


def new_domain(page, language):
    task(page, 'contacts')
    page.locator('#domainLoftNewDomain').click()
    dialog = page.locator('[role="dialog"][aria-modal="true"]:not(#mobileNavDrawer):visible')
    dialog.get_by_role('button', name='Continue' if language == 'en' else 'Lanjutkan', exact=True).click()
    page.wait_for_function('()=>!__domainLoft.sections.length&&!__domainLoft.draft.length')


def project_export(page, path):
    if page.locator('#orebit-support-moment').is_visible():
        page.locator('#orebit-support-moment .orebit-support-close').click()
    page.locator('.orebit-avatar').click()
    page.once('dialog', lambda dialog: dialog.accept('multi-domain.orebit'))
    with page.expect_download() as download:
        page.locator('[data-act="export"]').click()
    download.value.save_as(str(path))


def main():
    handler = functools.partial(type('Quiet', (http.server.SimpleHTTPRequestHandler,), {'log_message': lambda *_: None}), directory=str(DIST))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    try:
        with tempfile.TemporaryDirectory(prefix='native-multiple-domains-') as temp, sync_playwright() as pw:
            paths = write_domain_fixture(Path(temp), measured_ends=True)
            browser = pw.chromium.launch(headless=True, args=['--no-sandbox'])
            for language in ('en', 'id'):
                for width, height in ((1440, 1000), (1366, 768)):
                    for method in ('contacts', 'loft'):
                        tag = f'{method}-{language}-{width}x{height}'
                        print('CASE:', tag, flush=True)
                        context = browser.new_context(viewport={'width': width, 'height': height}, accept_downloads=True)
                        context.tracing.start(screenshots=False, snapshots=True, sources=False)
                        errors = []
                        page = context.new_page()
                        page.on('pageerror', lambda error: errors.append(str(error)))
                        try:
                            boot(page, f'http://127.0.0.1:{server.server_port}/Core.html', language)
                            navigate(page, 2)
                            page.locator('#fileInput').set_input_files([str(p) for p in paths])
                            page.wait_for_function('()=>STATE.collar.length===25&&STATE.survey.length===50&&STATE.assay.length===75&&STATE.geology.length===75')
                            page.locator('#coreCRS').fill('EPSG:32748')
                            page.locator('#coreCRS').press('Tab')
                            original = raw(page)
                            navigate(page, 14)
                            define(page, 'D1', 'SAP')
                            if method == 'loft':
                                rings(page, 90, 94)
                            else:
                                task(page, 'contacts')
                                page.locator('#domainContactMaxEdge').fill('80')
                                page.locator('#domainContactMaxEdge').press('Tab')
                            build(page, method, 'D1')
                            first = model(page, 'D1')
                            if method == 'loft':
                                task(page, 'contacts')
                                before = workspace(page)
                                page.locator('#domainLoftNewDomain').click()
                                dialog = page.locator('[role="dialog"][aria-modal="true"]:not(#mobileNavDrawer):visible')
                                dialog.get_by_role('button', name='Cancel' if language == 'en' else 'Batal', exact=True).click()
                                check(workspace(page) == before and model(page, 'D1') == first, tag+': Cancel preserves draft and accepted model')
                                new_domain(page, language)
                            define(page, 'D2', 'LIM')
                            if method == 'loft':
                                check(not workspace(page)['loft']['undo'], tag+': new definition has no D1 Undo history')
                                rings(page, 82, 86)
                            else:
                                task(page, 'contacts')
                                page.locator('#domainContactMaxEdge').fill('90')
                                page.locator('#domainContactMaxEdge').press('Tab')
                            build(page, method, 'D2')
                            second = model(page, 'D2')
                            check(model(page, 'D1') == first, tag+': second acceptance preserves first solid and review')
                            for code, expected in (('D1', first), ('D2', second), ('D1', first)):
                                select(page, code)
                                current = workspace(page)
                                if method == 'loft':
                                    check([s['points'] for s in current['loft']['sections']] == [s['points'] for s in expected['build']['inputs']['sections']], tag+': editor rings belong to '+code)
                                    check(current['loft']['domainCode'] == code, tag+': draft edits target only '+code)
                                else:
                                    check(current['contact']['maxEdge'] == (80 if code == 'D1' else 90), tag+': contact settings belong to '+code)
                            check(model(page, 'D1') == first and model(page, 'D2') == second, tag+': navigation does not approve or stale either domain')
                            # Read-only sender contract against the two natively
                            # accepted solids. The fixture revision here is not
                            # presented as a delivered Assay source/approval.
                            partition = page.evaluate('''async()=>{
                              const reference={source:{assayDatasetRevision:'a'.repeat(64)},proposal:{intervals:
                                STATE.assay.map((r,row)=>({row,holeId:r.hole_id,from:r.from_m,to:r.to_m}))}};
                              const body=await OrebitCoreEDAReference.attachMeasuredMembership(reference,await __orebitDomainHandoff());
                              return body.intervalMembership.intervals.map(row=>({from:row.from,to:row.to,spans:row.spans}));
                            }''')
                            check(len(partition) == 75 and all(
                                row['spans'][0]['entryMD'] == float(row['from'])
                                and row['spans'][-1]['exitMD'] == float(row['to'])
                                and all(s['exitMD'] > s['entryMD'] for s in row['spans'])
                                and all(a['exitMD'] == b['entryMD'] for a, b in zip(row['spans'], row['spans'][1:]))
                                for row in partition), tag+': two-domain sender conserves one ordered partition per original interval')
                            # Real positive-volume overlap must not replace either accepted solid.
                            if method == 'loft':
                                new_domain(page, language)
                            define(page, 'D3', 'SAP')
                            if method == 'loft':
                                rings(page, 90, 94)
                            build(page, method, 'D3', overlap=True)
                            check(page.evaluate('OrebitCoreDomain.exportState().domains.length') == 2 and model(page, 'D1') == first and model(page, 'D2') == second, tag+': rejected overlap preserves both accepted solids')
                            select(page, 'D1')
                            if method == 'loft':
                                page.locator('#domainToolDigitize').click()
                                page.locator('#domainLoftH').fill('0')
                                page.locator('#domainLoftRL').fill('92')
                                page.locator('#domainLoftAdd').click()
                                check(model(page, 'D1')['build']['stale'] and model(page, 'D2') == second, tag+': editing D1 stales only D1')
                                draft = workspace(page)['loft']
                                page.locator('#domainLoftUndo').click()
                                check(not workspace(page)['loft']['draft'] and model(page, 'D2') == second, tag+': Undo stays inside D1 and does not restore scientific acceptance')
                                page.locator('#domainLoftRedo').click()
                                check(workspace(page)['loft']['draft'] == draft['draft'], tag+': Redo restores D1 draft')
                                select(page, 'D2')
                                select(page, 'D1')
                                check(workspace(page)['loft'] == draft, tag+': unfinished D1 draft and history survive switching')
                            select(page, 'D2')
                            saved_model = model(page, 'D2')
                            project = Path(temp)/(tag+'.orebit')
                            project_export(page, project)
                            reopened = context.new_page()
                            reopened.on('pageerror', lambda error: errors.append(str(error)))
                            boot(reopened, f'http://127.0.0.1:{server.server_port}/Core.html', language)
                            reopened.locator('.orebit-avatar').click()
                            with reopened.expect_file_chooser() as chooser:
                                reopened.locator('[data-act="import"]').click()
                            chooser.value.set_files(str(project))
                            reopened.wait_for_function('()=>OrebitCoreDomain.exportState().codebook.length===3')
                            navigate(reopened, 14)
                            check(raw(reopened) == original and model(reopened, 'D2')['build']['meshHash'] == saved_model['build']['meshHash'] and not model(reopened, 'D2')['build']['stale'], tag+': native project reopen preserves raw and D2 reviewed mesh')
                            select(reopened, 'D1')
                            if method == 'loft':
                                check(workspace(reopened)['loft'] == draft and model(reopened, 'D1')['build']['stale'], tag+': native reopen retains unfinished D1 draft/history and stale review')
                            else:
                                check(workspace(reopened)['contact']['maxEdge'] == 80, tag+': native reopen restores D1 contact decisions')
                            select(reopened, 'D2')
                            check(not workspace(reopened)['loft']['draft'] and raw(page) == original and not errors and not page.evaluate('__multiErrors') and not reopened.evaluate('__multiErrors'), tag+': D1 edits do not leak into D2; no swallowed failures or raw changes')
                            if EVIDENCE:
                                output = Path(EVIDENCE)
                                output.mkdir(parents=True, exist_ok=True)
                                image = output/(tag+'.png')
                                reopened.screenshot(path=str(image), full_page=True, animations='disabled')
                                results.append({'case': tag, 'result': 'PASS', 'image': image.name, 'sha256': hashlib.sha256(image.read_bytes()).hexdigest(), 'volumes': [first['build']['volume'], second['build']['volume']]})
                        except Exception:
                            if EVIDENCE:
                                output = Path(EVIDENCE)
                                output.mkdir(parents=True, exist_ok=True)
                                page.screenshot(path=str(output/(tag+'-failure.png')), full_page=True, animations='disabled')
                            raise
                        finally:
                            if EVIDENCE:
                                context.tracing.stop(path=str(Path(EVIDENCE)/(tag+'-trace.zip')))
                            context.close()
            browser.close()
    finally:
        server.shutdown()
        if EVIDENCE:
            Path(EVIDENCE, 'matrix.json').write_text(json.dumps({'passed_assertions': passed, 'cases': results}, indent=2)+'\n')
    print(f'{passed} assertions passed; EN/ID x1440/1366x768 xcontacts/loft native multi-domain matrix', flush=True)


if __name__ == '__main__':
    main()
