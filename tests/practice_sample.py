"""Suites that exercise Validation repair use the practice copy of the built-in sample.

The app opens the valid sample by default; the copy with known defects loads on request
(Validation > Load practice data, or the stored choice below). Call enable() before the
suite creates its browser contexts.
"""
from playwright.sync_api import Browser

_SCRIPT = "try{localStorage.setItem('orebit.samplePractice.v1','1')}catch(e){}"


def enable():
    if getattr(Browser, '_orebit_practice', False):
        return
    new_context, new_page = Browser.new_context, Browser.new_page

    def context_with_practice(self, *args, **kwargs):
        context = new_context(self, *args, **kwargs)
        context.add_init_script(_SCRIPT)
        return context

    def page_with_practice(self, *args, **kwargs):
        page = new_page(self, *args, **kwargs)
        page.add_init_script(_SCRIPT)
        return page

    Browser.new_context, Browser.new_page = context_with_practice, page_with_practice
    Browser._orebit_practice = True
