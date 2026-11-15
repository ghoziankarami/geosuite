"""Visible journey-mode helpers for browser tests of detailed-stage tools."""


def ensure_detailed_mode(page):
    """Reach expert controls through the rendered Quick/Detailed switch."""
    page.wait_for_selector('#journeyMode [data-journey-mode="detailed"]', timeout=15000)
    if page.locator('body').evaluate("el => el.classList.contains('journey-quick')"):
        page.locator('#journeyMode [data-journey-mode="detailed"]').click()
        page.wait_for_function("() => !document.body.classList.contains('journey-quick')")


def open_detailed_tab(page, tab):
    """Switch mode if needed, then activate the visible rail or phone drawer."""
    ensure_detailed_mode(page)
    target = page.locator(f'nav.tabs .tab[onclick="showTab({tab})"]')
    if target.is_visible():
        target.click()
    elif page.evaluate('innerWidth > 1079'):
        # Detailed Assay tools remain behind the visible desktop Advanced toggle.
        # A hidden desktop rail tab is not a reason to click the phone-only drawer.
        toggle = page.locator('#assayAdvancedToggle')
        if not toggle.count() or not toggle.is_visible():
            raise AssertionError(f'Detailed desktop tab {tab} is hidden and has no visible Advanced control')
        if not page.locator('body').evaluate("el => el.classList.contains('assay-advanced-open')"):
            toggle.click()
        page.wait_for_function('(n) => {const e=document.querySelector(`nav.tabs .tab[onclick="showTab(${n})"]`);return !!e&&getComputedStyle(e).display!=="none"}', arg=tab)
        target.click()
    else:
        group = page.evaluate("n => window.__orebitNavGroups?.find(g => g.tabs.some(tab => tab.idx === n))?.key || null", tab)
        if not group:
            raise AssertionError(f'Detailed tab {tab} has no visible native navigation route')
        opener = page.locator(f'#mobileBottomNav [data-group="{group}"]')
        opener.wait_for(state='visible')
        opener.click()
        page.locator(f'#mobileNavDrawer .sub-tab[data-tab="{tab}"]').click()
    page.wait_for_function('(n) => document.getElementById("tab"+n)?.classList.contains("active")', arg=tab)
