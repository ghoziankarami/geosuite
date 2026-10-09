"""Actual keyboard cancellation, stored project recovery and guided navigation.

Bounded accessibility checks; this suite does not certify WCAG conformance.
OREBIT_TEST_DIST can replay the prior artifact. OREBIT_A11Y_CASE=confirm runs
the independent destructive-Cancel regression against its existing Core UI.
"""
import functools
import http.server
import os
import re
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'build/build.mjs').exists())
DIST = Path(os.environ.get('OREBIT_TEST_DIST', ROOT / 'dist'))
CASE = os.environ.get('OREBIT_A11Y_CASE', 'all')
passed = 0


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(
    ('127.0.0.1', 0), functools.partial(Quiet, directory=str(DIST))
)
threading.Thread(target=server.serve_forever, daemon=True).start()


def check(ok, message):
    global passed
    assert ok, message
    passed += 1
    print('PASS:', message, flush=True)


def boot(page, phase):
    page.goto(f'http://127.0.0.1:{server.server_port}/{phase}.html')
    page.wait_for_function('()=>window.__i18nBooted===true')
    page.wait_for_timeout(300)
    # Renderer exceptions are swallowed by safeRender; prove our detector works.
    page.evaluate("""() => {
      window.__keyboardRenderFailures=[];
      if(typeof safeRender!=='function')return;
      const original=safeRender;
      window.safeRender=(label,fn)=>original(label,()=>{
        try {const result=fn();if(result?.catch)return result.catch(e=>{window.__keyboardRenderFailures.push(String(label)+': '+e.message);throw e;});return result;}
        catch(e){window.__keyboardRenderFailures.push(String(label)+': '+e.message);throw e;}
      });
      safeRender('keyboard canary',()=>{throw new Error('keyboard canary');});
    }""")
    check('keyboard canary' in ' '.join(page.evaluate('window.__keyboardRenderFailures.splice(0)')),
          phase + ' swallowed-render detector catches its canary')


def active(page):
    return page.evaluate("Array.from(document.querySelectorAll('nav.tabs .tab')).findIndex(e=>e.classList.contains('active'))+1")


def raw(page):
    return page.evaluate("JSON.stringify(typeof DATA!=='undefined'?DATA.rows:[STATE.collar,STATE.survey,STATE.assay,STATE.geology])")


def stage(page, number, mobile):
    if mobile:
        if number == 1:
            page.locator('#mobileBottomNav [data-group="home"]').click()
        else:
            page.locator('#mobileBottomNav [data-group="analysis"]').click()
            page.locator(f'#mobileNavDrawer [data-tab="{number}"]').click()
    else:
        page.locator(f'nav.tabs .tab[onclick="showTab({number})"]').click()


def profile_projects(page):
    page.locator('button.orebit-avatar').click()
    support = page.locator('.orebit-profile-upgrade a')
    # Read actual browser styles; calculate WCAG relative luminance independently.
    def ratio():
        colors = support.evaluate('e=>[getComputedStyle(e).color,getComputedStyle(e).backgroundColor]')
        def luminance(color):
            rgb = [float(value)/255 for value in re.findall(r'[\d.]+',color)[:3]]
            linear = [value/12.92 if value <= 0.04045 else ((value+0.055)/1.055)**2.4 for value in rgb]
            return sum(value*weight for value,weight in zip(linear,[0.2126,0.7152,0.0722]))
        values = sorted(luminance(color) for color in colors)
        return (values[1]+0.05)/(values[0]+0.05)
    check(ratio() >= 4.5, 'Visible profile support text meets normal-text contrast minimum')
    support.hover()
    check(ratio() >= 4.5, 'Hovered profile support text meets normal-text contrast minimum')
    page.locator('.orebit-profile-menu [data-act="open"]').focus()
    page.keyboard.press('Enter')
    page.locator('#projectManagerModal').wait_for(state='visible')


def assert_dialog(page, dialog, message):
    check(dialog.get_attribute('role') == 'dialog' and dialog.get_attribute('aria-modal') == 'true',
          message + ' has modal dialog semantics')
    check(bool(dialog.evaluate("e=>(e.getAttribute('aria-label')||(e.getAttribute('aria-labelledby')||'').split(/\\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ')).trim()")),
          message + ' has an accessible name')
    check(dialog.evaluate('e=>e.contains(document.activeElement)'), message + ' receives keyboard focus')
    dialog.evaluate("e=>Promise.all(e.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))")
    box = dialog.bounding_box()
    viewport = page.viewport_size
    check(box and box['x'] >= -1 and box['y'] >= -1 and
          box['x']+box['width'] <= viewport['width']+1 and
          box['y']+box['height'] <= viewport['height']+1,
          message + ' fits the actual viewport')
    for _ in range(9):
        page.keyboard.press('Tab')
        check(dialog.evaluate('e=>e.contains(document.activeElement)'), message + ' retains Tab focus')
    for _ in range(9):
        page.keyboard.press('Shift+Tab')
        check(dialog.evaluate('e=>e.contains(document.activeElement)'), message + ' retains Shift+Tab focus')


def delete_button(page, name, phase):
    if phase == 'Core':
        return page.locator('#projectManagerModal [data-action="delete"]').filter(has_text='Delete').first
    return page.locator('#projectManagerModal .danger').first


def cancel_confirmation(page, phase, language, name, full=True):
    delete = delete_button(page, name, phase)
    delete.click()
    cancel_text = 'Batal' if language == 'id' else 'Cancel'
    # The baseline Assay/Resource box lacks role=dialog; select its real cancel button.
    cancel = page.get_by_role('button', name=cancel_text, exact=True).last
    cancel.wait_for(state='visible')
    if full:
        dialog = cancel.locator('xpath=../..')
        assert_dialog(page, dialog, phase + ' confirmation')
    cancel.focus()
    page.keyboard.press('Enter')
    page.wait_for_timeout(120)
    check(delete_button(page, name, phase).count() == 1,
          phase + ' focused Cancel + Enter preserves the saved project')
    check(page.locator('#projectManagerModal').evaluate('e=>e.contains(document.activeElement)'),
          phase + ' cancellation restores focus in the parent project manager')
    if full:
        for _ in range(9):
            page.keyboard.press('Tab')
            check(page.locator('#projectManagerModal').evaluate('e=>e.contains(document.activeElement)'),
                  phase + ' parent focus trap resumes after nested cancellation')


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        phases = ('Core',) if CASE == 'confirm' else ('Core','Assay','Resource')
        for phase in phases:
            for width,height,language in ((1440,1000,'en'),(1440,1000,'id'),(390,844,'en'),(390,844,'id')):
                context = browser.new_context(viewport={'width':width,'height':height},is_mobile=width<1080,has_touch=width<1080)
                context.add_init_script(f"localStorage.setItem('orebit.lang','{language}')")
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                mobile = width < 1080
                boot(page, 'Core')
                stage(page, 2, mobile)
                page.locator('#btnOpenProject').click()
                page.locator('#pmNewName').wait_for(state='visible')
                name = 'Synthetic keyboard project'
                page.locator('#pmNewName').fill(name)
                page.locator('#pmCreateNew').click()
                page.locator('#projectManagerModal [data-action="delete"]').wait_for(state='visible')
                if CASE == 'confirm':
                    cancel_confirmation(page, phase, language, name, full=False)
                    context.close()
                    continue
                page.locator('#pmClose').click()
                boot(page, phase)
                before = raw(page)
                key = {'Core':'core','Assay':'asy','Resource':'res'}[phase]
                reference = page.locator(f'#tab1 [data-i18n="{key}.wf.title"]')
                check(reference.inner_text() == ('Referensi semua alat' if language == 'id' else 'All tools reference'),
                      phase + ' dashboard names optional reference without implying extra required stages')
                primary = page.locator('#tab1 .workflow-actions [data-action-role="next"]').first
                primary.focus()
                page.keyboard.press('Enter')
                page.wait_for_function("()=>document.activeElement===document.querySelector('.panel.active')", timeout=3000)
                check(active(page) == {'Core':7,'Assay':3,'Resource':3}[phase],
                      phase + ' primary Enter opens its intended stage')
                check(page.locator('.panel.active').evaluate('e=>e===document.activeElement') and
                      page.locator('.panel.active').get_attribute('tabindex') == '-1',
                      phase + ' primary Enter focuses the named destination without adding a tab stop')
                if phase == 'Resource':
                    check(page.locator('#tab3 .action-key').count() == 1,
                          'Resource Setup has one action-role legend')
                    check(page.locator('#setupElement').is_visible() and page.locator('#setupDomain').is_visible() and
                          page.locator('#setupGradeUnit').is_visible() and page.locator('#resourceSetupNext').is_visible(),
                          'Resource Setup keeps essential parameter controls and continuation available')
                stage(page, 1, mobile)
                if not mobile:
                    selected = page.locator('nav.tabs .tab.active')
                    selected.focus()
                    expected = {'Core':[2,7],'Assay':[2,3,8],'Resource':[2,3,4]}[phase]
                    for target in expected:
                        page.keyboard.press('ArrowDown')
                        check(active(page) == target, phase + ' ArrowDown follows disclosed main stage order')
                        check(page.locator('nav.tabs .tab.active').evaluate('e=>e===document.activeElement'),
                              phase + ' keyboard selection and focus agree')
                    page.keyboard.press('Home')
                    check(active(page) == 1, phase + ' Home selects the first disclosed stage')
                    page.keyboard.press('End')
                    check(active(page) == (12 if phase == 'Resource' else 13), phase + ' End selects the handoff stage')
                    check(page.locator('nav.tabs .tab[tabindex="0"]').count() == 1,
                          phase + ' selected tab is the single tab-list stop')
                    panel = page.locator('.panel.active')
                    check(panel.get_attribute('aria-labelledby') == page.locator('nav.tabs .tab.active').get_attribute('id'),
                          phase + ' selected panel is named by its tab')
                else:
                    trigger = page.locator('#mobileBottomNav [data-group="analysis"]')
                    trigger.click()
                    assert_dialog(page, page.locator('#mobileNavDrawer'), phase + ' phone navigation')
                    page.keyboard.press('Escape')
                    check(trigger.evaluate('e=>e===document.activeElement'), phase + ' drawer Escape restores its trigger')
                profile_projects(page)
                manager = page.locator('#projectManagerModal').locator('xpath=./*').first
                assert_dialog(page, manager, phase + ' project manager')
                check(page.get_by_role('button',name='Tutup' if language=='id' else 'Close',exact=True).count() >= 1,
                      phase + ' project-manager close control has a name')
                cancel_confirmation(page, phase, language, name)
                page.keyboard.press('Escape')
                check(page.locator('#projectManagerModal').count() == 0, phase + ' project-manager Escape closes it')
                check(page.locator('button.orebit-avatar').evaluate('e=>e===document.activeElement'),
                      phase + ' project-manager Escape returns to visible profile trigger')
                # Reload actually reads browser storage; cancellation must survive it.
                boot(page, phase)
                profile_projects(page)
                check(delete_button(page, name, phase).count() == 1,
                      phase + ' cancelled deletion survives IndexedDB reopen')
                delete_button(page, name, phase).click()
                cancel = page.get_by_role('button',name='Batal' if language=='id' else 'Cancel',exact=True).last
                confirm = cancel.locator('xpath=../..')
                confirm.locator('button').last.focus()
                page.keyboard.press('Enter')
                page.wait_for_timeout(150)
                check(delete_button(page, name, phase).count() == 0,
                      phase + ' focused affirmative + Enter performs the intended deletion')
                check(raw(page) == before, phase + ' dialog/navigation actions preserve raw measurements')
                page.keyboard.press('Escape')
                check(page.locator('button.orebit-avatar').evaluate('e=>e===document.activeElement'),
                      phase + ' refreshed project manager returns to its original visible trigger')
                if not mobile:
                    for action,overlay in (('help','#helpOverlay'),('glossary','#glossaryOverlay')):
                        page.locator('button.orebit-help-bubble').click()
                        page.locator(f'.orebit-help-menu [data-action="{action}"]').focus()
                        page.keyboard.press('Enter')
                        dialog = page.locator(overlay + ' [role="dialog"]')
                        assert_dialog(page, dialog, phase + ' ' + action)
                        page.keyboard.press('Escape')
                        check(page.locator('button.orebit-help-bubble').evaluate('e=>e===document.activeElement'),
                              phase + ' ' + action + ' Escape returns to visible help trigger')
                if mobile:
                    tour_trigger = page.locator('#mobileTourBtn')
                    tour_trigger.click()
                else:
                    tour_trigger = page.locator('button.orebit-help-bubble')
                    tour_trigger.click()
                    page.locator('.orebit-help-menu [data-action="tour"]').focus()
                    page.keyboard.press('Enter')
                assert_dialog(page, page.locator('#tourCard'), phase + ' tour')
                page.keyboard.press('Escape')
                check(tour_trigger.evaluate('e=>e===document.activeElement'),
                      phase + ' tour Escape returns to its visible trigger')
                check(raw(page) == before, phase + ' tour Escape preserves raw measurements')
                check(not errors and not page.evaluate('window.__keyboardRenderFailures.length'),
                      phase + ' actual actions have no uncaught or swallowed render errors')
                context.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()
print(f'{passed} bounded keyboard/dialog checks passed')
