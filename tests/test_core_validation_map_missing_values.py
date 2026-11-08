"""Unavailable map values remain distinct from explicitly declared zeros."""
import csv
import functools
import http.server
import json
import os
from pathlib import Path
import tempfile
import threading

from playwright.sync_api import sync_playwright

ROOT=next(p for p in Path(__file__).resolve().parents if (p/'build/build.mjs').exists())
DIST=Path(os.environ.get('OREBIT_TEST_DIST',ROOT/'dist'))
FIXTURE=ROOT/'data/dataset-demo/repo/02-nikel-laterit'
passed=0

def check(value,message):
    global passed
    assert value,message
    passed+=1
    print('PASS:',message,flush=True)

def fixture(folder):
    def read(name):
        with (FIXTURE/name).open(encoding='utf-8-sig',newline='') as source:
            reader=csv.DictReader(source)
            aliases={'BHID':'hole_id','XCOLLAR':'easting','YCOLLAR':'northing',
                     'ZCOLLAR':'elevation','TD':'depth','FROM':'from_m','TO':'to_m','LITH':'lithology'}
            fields=[aliases.get(field,field) for field in reader.fieldnames]
            assert len(fields)==len(set(fields)), 'fixture header alias collision'
            return fields,[{aliases.get(key,key):value for key,value in row.items()} for row in reader]
    fields,collars=read('collar.csv');collars=collars[:4];ids=[r['hole_id'] for r in collars]
    # Explicit defect variants: withhold collar depth and Ni, and retain declared zeros.
    # These are not additional measurements or changes to the public fixture.
    collars[0]['depth']='';collars[1]['depth']='0'
    for row in collars:row['PROSPECT']='Synthetic uninformed' if row['hole_id']==ids[2] else 'Synthetic informed'
    tables={'collar.csv':(fields+['PROSPECT'],collars)}
    for name in ('assay.csv','litho.csv'):
        fields,rows=read(name);rows=[row for row in rows if row['hole_id'] in ids]
        if name=='assay.csv':
            for row in rows:
                if row['hole_id']==ids[2]:row['NI_PCT']=''
                if row['hole_id']==ids[3]:row['NI_PCT']='0'
        tables[name]=(fields,rows)
    for name,(fields,rows) in tables.items():
        with (folder/name).open('w',newline='') as target:
            writer=csv.DictWriter(target,fieldnames=fields);writer.writeheader();writer.writerows(rows)
    return ids,len(tables['assay.csv'][1]),len(tables['litho.csv'][1]),{r['hole_id']:[float(r['easting']),float(r['northing'])] for r in collars}

def ready(page,lang):
    page.wait_for_function('()=>window.__i18nBooted')
    picker=page.locator('.lang-picker-overlay')
    if picker.count():picker.locator(f'[data-pick="{lang}"]').click()
    if page.locator('.tour-skip').is_visible():page.locator('.tour-skip').click()
    page.evaluate('(lang)=>applyLanguage(lang)',lang)
    page.evaluate("""()=>{window.__missingMapFailures=[];const render=safeRender;
      window.safeRender=(name,fn)=>render(name,()=>{try{return fn()}catch(e){__missingMapFailures.push(String(e));throw e;}});
      safeRender('missing-map-canary',()=>{throw Error('missing-map-canary')});}""")
    check(page.evaluate("__missingMapFailures.splice(0).some(v=>v.includes('missing-map-canary'))"),'Swallowed-render detector is live')
    page.evaluate("window._renderFailures=(window._renderFailures||[]).filter(v=>v.label!=='missing-map-canary');document.querySelectorAll('.toast').forEach(e=>e.remove())")

def stage(page,n):
    if page.locator('#mobileBottomNav').is_visible():
        page.locator('#mobileBottomNav [data-group="analysis"]').click()
        page.locator(f'#mobileNavDrawer .sub-tab[data-tab="{n}"]').click()
    else:
        button=page.locator(f'nav.tabs .tab[onclick="showTab({n})"]')
        if not button.is_visible():page.locator('nav.tabs .screening-advanced-toggle').click()
        button.click()
    page.wait_for_function('(n)=>document.getElementById("tab"+n).classList.contains("active")',arg=n)

def traces(page):
    return page.evaluate("document.getElementById('linkageMap').data.filter(t=>t.customdata?.length).map(t=>({ids:t.customdata,name:t.name,colors:t.marker.color,hover:t.hovertemplate,xy:(t.customdata||[]).map((id,i)=>[t.x[i],t.y[i]]),symbol:t.marker.symbol,scale:t.marker.showscale}))")

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass

def main():
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(DIST)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix='core7-unavailable-') as directory,sync_playwright() as pw:
            folder=Path(directory);ids,assays,geology,coordinates=fixture(folder)
            browser=pw.chromium.launch()
            for lang,width in (('en',1440),('en',768),('en',390),('id',1440),('id',768),('id',390)):
                for no_assay in (False,True):
                    page=browser.new_page(viewport={'width':width,'height':1000 if width>768 else 844})
                    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                    page.goto(f'http://127.0.0.1:{server.server_port}/Core.html');ready(page,lang);stage(page,2)
                    names=('collar.csv','litho.csv') if no_assay else ('collar.csv','assay.csv','litho.csv')
                    page.locator('#fileInput').set_input_files([str(folder/n) for n in names])
                    page.wait_for_function('([n,g])=>STATE.collar.length===4&&STATE.assay.length===n&&STATE.geology.length===g',arg=[0 if no_assay else assays,geology])
                    raw=page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')
                    tag=f'{lang}/{width}/'+('absent-Assay' if no_assay else 'withheld-measurements')
                    stage(page,7)
                    page.wait_for_function("()=>!!document.getElementById('linkageMap')?._fullLayout")
                    check(page.locator('#mapShowLabels').is_checked()==(width>=768)
                          and page.locator('#linkageMap .scatterlayer .textpoint text').count()==(4 if width>=768 else 0),
                          tag+': sparse desktop/tablet keeps IDs while narrow default avoids overlapping labels')
                    page.locator('#mapColorBy').select_option('depth')
                    page.wait_for_function("()=>STATE.mapUI.colorBy==='depth'&&!!document.getElementById('linkageMap')._fullLayout")
                    plotted=traces(page)
                    check(sorted(h for t in plotted for h in t['ids'])==sorted(ids) and all(t['xy'][i]==coordinates[hole] for t in plotted for i,hole in enumerate(t['ids'])),tag+': depth display retains every uploaded ID/XY location')
                    unavailable=[t for t in plotted if ids[0] in t['ids']]
                    label='Depth unavailable' if lang=='en' else 'Kedalaman belum tersedia'
                    check(len(unavailable)==1 and unavailable[0]['name']==label and unavailable[0]['symbol']=='circle-open',tag+': withheld depth is an explicit unavailable category, never a measured0')
                    check(page.evaluate('(label)=>document.getElementById("linkageMap").layout.annotations.some(a=>String(a.text).includes(label))',label),tag+': unavailable depth has a visible annotation in the exportable plot layout')
                    known=[t for t in plotted if ids[1] in t['ids']][0]
                    check(isinstance(known['colors'],list) and known['colors'][known['ids'].index(ids[1])]==0,tag+': an explicitly declared zero depth remains zero')
                    page.locator('#mapColorBy').select_option('grade')
                    page.wait_for_function("()=>STATE.mapUI.colorBy==='grade'&&!!document.getElementById('linkageMap')._fullLayout")
                    if no_assay:
                        check(page.locator('#mapGradeCol').is_disabled() and page.locator('#mapGradeClass').is_disabled(),tag+': missing grade role disables unsupported grade choices')
                        text='No grade columns detected' if lang=='en' else 'Kolom kadar tidak ditemukan'
                        check(page.locator('#linkageMapUnavailableNote').is_visible() and text in page.locator('#linkageMapUnavailableNote').inner_text(),tag+': grade-free map explains unavailable colouring in the selected language')
                        check(not any(t.get('scale',False) for t in traces(page)),tag+': missing grades never invent a numeric colour scale')
                    else:
                        page.locator('#mapGradeCol').select_option('ni_pct')
                        page.wait_for_function("()=>STATE.mapUI.gradeCol==='ni_pct'&&!!document.getElementById('linkageMap')._fullLayout")
                        plotted=traces(page);unavailable=[t for t in plotted if ids[2] in t['ids']]
                        label='Grade unavailable' if lang=='en' else 'Nilai kadar belum tersedia'
                        check(len(unavailable)==1 and unavailable[0]['name']==label and unavailable[0]['symbol']=='circle-open',tag+': uninformed hole has its own grade category, never the lowest numeric class')
                        known=[t for t in plotted if ids[3] in t['ids']][0]
                        check(known['colors'][known['ids'].index(ids[3])]==0,tag+': informed zero grades remain in the first numeric class')
                        page.locator('#mapProspectFilter').select_option('Synthetic uninformed')
                        page.wait_for_function("()=>STATE.mapUI.prospect==='Synthetic uninformed'&&!!document.getElementById('linkageMap')._fullLayout")
                        subset=traces(page)
                        text='No informed grade values' if lang=='en' else 'Tidak ada nilai kadar terinformasi'
                        check(len(subset)==1 and subset[0]['ids']==[ids[2]] and not subset[0].get('scale',False) and page.locator('#linkageMapUnavailableNote').is_visible() and text in page.locator('#linkageMapUnavailableNote').inner_text(),tag+': wholly uninformed filtered population has no fabricated classes or scale')
                        page.locator('#mapProspectFilter').select_option('')
                        page.wait_for_function("()=>STATE.mapUI.prospect===''&&!!document.getElementById('linkageMap')._fullLayout")
                        check(sorted(h for t in traces(page) for h in t['ids'])==sorted(ids),tag+': clearing the unavailable-population filter restores every location')
                    capture=os.environ.get('OREBIT_CAPTURE_MISSING_MAP')
                    if capture:
                        image_dir=Path(capture);image_dir.mkdir(parents=True,exist_ok=True)
                        page.locator('#linkageMapCard').screenshot(path=str(image_dir/f'grade-{lang}-{width}-{int(no_assay)}.png'))
                    page.locator('#mapShowLabels').uncheck();page.locator('#mapColorBy').select_option('depth');page.locator('#mapShowLabels').check()
                    page.wait_for_function('()=>document.querySelectorAll("#linkageMap .scatterlayer .textpoint text").length===4')
                    check(page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')==raw,tag+': all missing-data views and label rebuilds preserve every raw value')
                    related=page.evaluate('JSON.stringify([STATE.survey,STATE.assay,STATE.geology])')
                    with (folder/'collar.csv').open(newline='') as source:
                        reader=csv.DictReader(source);fields=list(reader.fieldnames);collars=list(reader)
                    for row in collars:row['depth']=''
                    empty_depth=folder/'collar-unavailable.csv'
                    with empty_depth.open('w',newline='') as target:
                        writer=csv.DictWriter(target,fieldnames=fields);writer.writeheader();writer.writerows(collars)
                    stage(page,2);page.locator('#fileInput').set_input_files(str(empty_depth))
                    page.wait_for_function("()=>STATE.collar.length===4&&STATE.collar.every(r=>r.depth==null||r.depth==='')")
                    stage(page,7)
                    page.wait_for_function("()=>!!document.getElementById('linkageMap')?._fullLayout")
                    check(page.locator('#mapShowLabels').is_checked()
                          and page.locator('#linkageMap .scatterlayer .textpoint text').count()==4,
                          tag+': explicit ID choice survives related-source reimport, including on narrow screens')
                    page.locator('#mapColorBy').select_option('depth')
                    page.wait_for_function("()=>STATE.mapUI.colorBy==='depth'&&!!document.getElementById('linkageMap')._fullLayout")
                    all_missing=traces(page)
                    label='Depth unavailable' if lang=='en' else 'Kedalaman belum tersedia'
                    check(len(all_missing)==1 and set(all_missing[0]['ids'])==set(ids) and all_missing[0]['name']==label and not all_missing[0].get('scale',False),tag+': wholly unavailable depth retains every location with no fabricated numeric scale')
                    if capture:
                        page.locator('#linkageMapCard').screenshot(path=str(image_dir/f'depth-unavailable-{lang}-{width}-{int(no_assay)}.png'))
                    check(page.evaluate('JSON.stringify([STATE.survey,STATE.assay,STATE.geology])')==related,tag+': unavailable-depth reimport preserves all related raw tables')
                    if lang=='en' and width==1440 and not no_assay:
                        before_png=page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')
                        with page.expect_download() as download:
                            page.locator('#linkageMapExportPngBtn').click()
                        png=Path(capture or directory)/'missing-map-native-export.png';download.value.save_as(str(png))
                        check(png.read_bytes().startswith(b'\x89PNG\r\n\x1a\n') and len(png.read_bytes())>10000,tag+': actual native PNG export contains a real rendered unavailable-depth map')
                        check(page.evaluate('JSON.stringify([STATE.collar,STATE.survey,STATE.assay,STATE.geology])')==before_png,tag+': native PNG export preserves all current source records')
                        if page.locator('#orebit-support-moment').is_visible():page.locator('#orebit-support-moment .support-dismiss-btn').click()
                    if no_assay:
                        stage(page,2);page.locator('#fileInput').set_input_files(str(folder/'assay.csv'))
                        page.wait_for_function('(n)=>STATE.assay.length===n',arg=assays)
                        stage(page,7);page.locator('#mapColorBy').select_option('grade')
                        page.wait_for_function("()=>STATE.mapUI.colorBy==='grade'&&!document.getElementById('mapGradeCol').disabled")
                        page.locator('#mapGradeCol').select_option('ni_pct')
                        page.wait_for_function("()=>STATE.mapUI.gradeCol==='ni_pct'&&!!document.getElementById('linkageMap')._fullLayout")
                        check(not page.locator('#mapGradeClass').is_disabled() and not page.locator('#linkageMapUnavailableNote').is_visible() and sorted(h for t in traces(page) for h in t['ids'])==sorted(ids),tag+': native Assay import restores meaningful grade controls and clears the old role warning')
                    check(not errors and not page.evaluate('__missingMapFailures.length'),tag+': no page or swallowed rendering failures')
                    page.close()
            browser.close()
    finally:server.shutdown();server.server_close()
    print(json.dumps({'suite':'Core missing-value map','checks':passed}),flush=True)

if __name__=='__main__':main()
