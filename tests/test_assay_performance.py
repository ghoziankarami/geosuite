"""Actual synthetic CSV uploads, exact analyses, bounded plotting and stale-job safety."""
import functools
import http.server
import os
from pathlib import Path
import tempfile
import threading
from playwright.sync_api import sync_playwright

ROOT = next(p for p in Path(__file__).resolve().parents if (p/'build').is_dir() and (p/'src').is_dir())
DIST = ROOT / 'dist'
if not DIST.is_dir():
    DIST = ROOT / 'artifacts' / 'dist'
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

with tempfile.TemporaryDirectory() as temp:
    csv = Path(temp) / 'synthetic-contact.csv'
    n = 18000
    lines = ['hole_id,from_m,to_m,midx,midy,midz,lithology,domain,au_gpt,cu_pct']
    for i in range(n):
        h = i // 30
        x = 392000 + (h % 24) * 45.3 + (h % 7) * 1.7
        y = 9558000 + (h // 24) * 51.9 + (h % 11) * .9
        grade = 1 if h % 2 else 10
        lines.append(f'H{h},{i%30*2},{i%30*2+2},{x},{y},{180-i%30*2},HOST,{"A" if h%2 else "B"},{grade},{grade*.2}')
    csv.write_text('\n'.join(lines)+'\n')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(DIST)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=['--no-sandbox','--disable-dev-shm-usage'])
            page = browser.new_page()
            page.on('console',lambda message:print('Browser:',message.text[:240]) if message.type=='error' else None)
            page.goto(os.environ.get('ASSAY_PERF_URL') or f'http://127.0.0.1:{server.server_port}/Assay.html')
            page.wait_for_function('()=>window.__i18nBooted&&!!DATA')
            page.evaluate("document.querySelectorAll('.lang-picker-overlay,#tourOverlay').forEach(e=>e.remove());applyLanguage('en');window._renderFailures=[]")
            page.locator('#fileInput').set_input_files(str(csv))
            page.wait_for_function('(n)=>DATA.rows.length===n', arg=n)
            page.wait_for_function("()=>document.getElementById('tab3').classList.contains('active')")
            page.evaluate('showTab(8)')
            page.wait_for_function('()=>!_plotQueueRunning&&!_plotQueue.length')
            assert page.locator('#declusterPanel').inner_text().strip() == ''
            assert page.evaluate("statsSummary(DATA.rows.map(r=>r[colIdx('au_gpt')])).mean") == 5.5
            assert page.evaluate("statCDF.data[0].x.length<=2500&&statCDF.data[0].x[0]===1&&statCDF.data[0].x.at(-1)===10")
            assert page.evaluate("statCDF.layout.title.text.includes('18,000')")
            page.locator('#assayStatsAdvanced > summary').click()
            page.wait_for_function("()=>document.getElementById('declusterPanel').textContent.trim().length>0&&!_plotQueueRunning&&!_plotQueue.length")
            assert page.locator('#declusterHeatmap').count() == 1
            page.evaluate('showTab(9)')
            page.wait_for_function('()=>!_plotQueueRunning&&!_plotQueue.length')
            assert page.evaluate("tcLogProb.data[0].x.length<=2500")
            assert page.evaluate("statsSummary(DATA.rows.map(r=>r[colIdx('au_gpt')])).p99") == 10
            # A full scan for every contact creates tens of millions of probes here.
            # This budget catches that regression without a machine-dependent speed assertion.
            page.evaluate("""() => {const original=Math.hypot;window._contactProbes=0;Math.hypot=function(...xs){if(++window._contactProbes>1000000)throw new Error('Contact workload budget exceeded');return original(...xs)};showTab(11)}""")
            try:
                page.wait_for_function("()=>document.getElementById('contactProfile')?.data?.length>0&&!_plotQueueRunning&&!_plotQueue.length", timeout=45000)
            except Exception:
                print('Renderer failures:',page.evaluate('window._renderFailures'))
                raise
            assert page.evaluate('_domainTagged.length') == n
            assert page.evaluate("new Set(DATA.rows.map(r=>r[colIdx('domain')])).size") == 2
            assert page.evaluate('_contactProbes') < 1000000
            assert page.evaluate('window._renderFailures.length') == 0
            # Controls must invalidate the actual diagnosis, not leave a stale A/B plot.
            page.locator('#domainValElementSelect').select_option('cu_pct')
            page.locator('#contactBinWidth').fill('23')
            page.locator('#contactBinWidth').press('Tab')
            page.wait_for_function('()=>!_plotQueueRunning&&!_plotQueue.length')
            page.locator('#domainMethodSelect').select_option('lithology')
            assert page.locator('#contactProfile').count() == 0
            page.wait_for_function("()=>!window._domainValidationTimer&&!_plotQueueRunning&&!_plotQueue.length")
            assert page.evaluate("_domainTagged.every(t=>t.domain==='L-HOST')")
            assert page.locator('#domainValidation').inner_text().strip() == ''
            page.locator('#domainMethodSelect').select_option('existing')
            page.wait_for_function("()=>!!document.getElementById('contactProfile')?.data&&!_plotQueueRunning&&!_plotQueue.length")
            assert page.locator('#domainValElementSelect').input_value() == 'cu_pct'
            assert page.locator('#contactBinWidth').input_value() == '23'
            assert page.evaluate("new Set(_domainTagged.map(t=>t.domain)).size") == 2
            # A replacement through the real CSV owner cancels scheduled old diagnostics
            # and clears manual diagnosis settings; the uploaded source is unchanged.
            page.evaluate('renderDomain()')
            replacement_csv = Path(temp) / 'synthetic-contact-replacement.csv'
            replacement_csv.write_text(csv.read_text())
            page.locator('#fileInput').set_input_files(str(replacement_csv))
            page.wait_for_function("()=>document.getElementById('tab3').classList.contains('active')")
            assert page.evaluate('window._domainValidationControls===null&&window._domainValidationTimer===null')
            assert page.locator('#domainValidation').inner_text().strip() == ''
            # A replaced plot node and dataset may not be overwritten by its delayed job.
            result = page.evaluate("""async () => {
              const node=document.createElement('div');node.id='perf-stale';document.body.append(node);
              _plotQueueRunning=true;_queuePlot(node.id,[{x:[0,1],y:[0,1],type:'scatter'}],{});
              const replacement=node.cloneNode();replacement.textContent='new dataset';node.replaceWith(replacement);
              await _drainPlotQueue();return replacement.textContent==='new dataset'&&!replacement.data;
            }""")
            assert result
            browser.close()
            print('PASS Assay: 18,000 uploaded rows; full numerical population, lazy optional tools, bounded plots, exact contact workload, current domain diagnosis, editable parameters and dataset/job reset.')
    finally:
        server.shutdown()
