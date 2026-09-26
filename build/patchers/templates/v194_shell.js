<script id="orebit-v194-shell-js">
/* ═══════════════════════════════════════════════════════════════════════════
 * OREBIT v1.9.4 — runtime DOM mutations.
 * Replaces v1.9.3. Adds:
 *   - Phase pill, lang toggle, i18n
 *   - Floating Help bubble (bottom-right) with menu: Tour / Glossary / Help / Theme
 *   - Quick Start card pinned to Tutorial panel (auto-hides if user has tour-seen)
 *   - Tour auto-trigger CHAINED after lang-picker pick (no race)
 *   - Footer grid-column fix already in CSS
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {{
  'use strict';

  const PHASE_PILL = window.__OREBIT_RT__ ? 'Desktop Edition' : {pill!r};
  const LABEL_EN = {label_en!r};
  const LABEL_ID = {label_id!r};
  const TOUR_KEY = {tour_key!r};
  const QS_TITLE_EN = {qs_title_en!r};
  const QS_TITLE_ID = {qs_title_id!r};
  const QS_BODY_EN = {qs_body_en!r};
  const QS_BODY_ID = {qs_body_id!r};
  const QS_CTA_EN = {qs_cta_en!r};
  const QS_CTA_ID = {qs_cta_id!r};

  const STRINGS = {{
    en: {{
      'nav.tour': 'Tour', 'nav.glossary': 'Glossary', 'nav.help': 'Help',
      'nav.theme': 'Theme', 'nav.lang': 'Language', 'nav.visit': 'orebit.id ↗', 'nav.analysis': 'Analysis', 'nav.results': 'Results',
      'phase.label': LABEL_EN,
      'help.tour': 'Take the tour', 'help.glossary': 'Browse glossary',
      'help.help': 'Help & FAQ', 'help.theme': 'Toggle theme',
      'lang.picker.title': 'Choose your language',
      'lang.picker.subtitle': 'You can change this anytime in the navbar.',
      'lang.picker.aria': 'Language picker',
      'lang.picker.en.name': 'English', 'lang.picker.en.sub': 'Default',
      'lang.picker.id.name': 'Bahasa Indonesia', 'lang.picker.id.sub': 'Indonesian',
      'lang.picker.skip': 'Continue with browser default',
      'qs.title': QS_TITLE_EN, 'qs.body': QS_BODY_EN, 'qs.cta': QS_CTA_EN,
      'help.bubble.title': 'Need help?',
      'tab.dashboard': 'Dashboard', 'tab.import': 'Import', 'tab.collar': 'Collar',
      'tab.survey': 'Survey', 'tab.assay': 'Assay', 'tab.geology': 'Geology',
      'tab.validation': 'Validation', 'tab.striplog': 'Strip Log', 'tab.section': 'Section',
      'tab.desurvey': 'Desurvey', 'tab.merge': 'Merge', 'tab.composite': 'Composite', 'tab.export': 'Export',
      'shell.tabgroup.data': 'DATA', 'shell.tabgroup.processing': 'PROCESSING',
      'shell.tabgroup.visualization': 'VISUALIZATION', 'shell.tabgroup.output': 'OUTPUT',
      'shell.tabgroup.tables': 'TABLES',
      'btn.assayTemplate': 'Download Assay Template',
      'btn.collarTemplate': 'Download Collar Template',
      'btn.downloadPdf': 'Download PDF',
      'btn.exportBundleFile': 'Export Bundle (.orebit)',
      'btn.geologyTemplate': 'Download Geology Template',
      'btn.importBundleFile': 'Import Bundle (.orebit)',
      'btn.importOrebit': 'Import .orebit bundle',
      'btn.openGdrive': 'Open from Google Drive',
      'btn.recompute': 'Recompute',
      'btn.recomputeMerge': 'Recompute Merge',
      'btn.resetSample': 'Reset to Sample Data',
      'btn.saveToProject': 'Save to Project',
      'btn.surveyTemplate': 'Download Survey Template',
      'dash.exportBundle': 'Export Bundle',
      'dash.importBundle': 'Import Bundle',
      'dash.openProject': 'Open Project',
      'desc.assay': 'Assay data: grade intervals per drillhole.',
      'desc.collar': 'Collar data: hole ID, coordinates, depth.',
      'desc.desurvey': 'Minimum Curvature desurvey — industry standard.',
      'desc.striplog': 'Visual strip log per drillhole.',
      'desc.validation': 'Verify linkage across all 4 tables.',
      'estimation.globalMean': 'Global Mean',
      'estimation.maxLocalBias': 'Max Local Bias',
      'footer.brand': 'Orebit — Mining Intelligence',
      'glossary.title': 'Glossary',
      'h3.11stepWorkflow': '11-Step Workflow',
      'h3.autopilot': 'Autopilot Mode',
      'h3.decisionCriteria': 'Decision Criteria',
      'h3.exportOptions': 'Export Options',
      'h3.notSuitableFor': 'Not Suitable For',
      'h3.suitableFor': 'Suitable For',
      'h3.techGlossary': 'Technical Glossary',
      'header.subtitle': 'Exploration · From raw collar/survey/assay/geology → clean desurveyed drillhole',
      'help.title': 'Help & Technical Reference',
      'hint.getStarted': 'Get Started',
      'hint.goal': 'Goal',
      'hint.privacy': 'Privacy-first: all data stays in your browser.',
      'hint.standards': 'Standards',
      'hint.uploadFormat': 'Upload Format',
      'info.quickStart': 'Quick Start',
      'kcmi.section1': 'KCMI Section 1',
      'loading.message': 'Loading Orebit...',
      'nextstep.recommended': 'Recommended Next Step',
      'panel.bivariate.title': 'Bivariate Analysis',
      'panel.composite.title': 'Compositing',
      'panel.compositing.title': 'Compositing',
      'panel.data.title': 'Data Overview',
      'panel.domain.title': 'Domain Modeling',
      'panel.litho.title': 'Lithology',
      'panel.multivariate.title': 'Multivariate Analysis',
      'panel.report.title': 'Report',
      'panel.spacing.title': 'Spacing Analysis',
      'panel.stats.title': 'Statistics',
      'panel.topcut.title': 'Top Cut Analysis',
      'panel.tutorial.title': 'Tutorial',
      'panel.upload.title': 'Upload Data',
      'quickaction.help': 'Help',
      'quickaction.projectMgr': 'Project Manager',
      'quickaction.upload': 'Upload Data',
      'section.autofit': 'Auto Fit',
      'section.next': 'Next',
      'section.prev': 'Previous',
      'section.reset': 'Reset',
      'status.dataNotLoaded': 'data not loaded',
      'step.bivariate': 'Bivariate',
      'step.compositing': 'Compositing',
      'step.domain': 'Domain',
      'step.import': 'Import',
      'step.inspection': 'Inspection',
      'step.litho': 'Lithology',
      'step.multivariate': 'Multivariate',
      'step.report': 'Report',
      'step.spacing': 'Spacing',
      'step.statistics': 'Statistics',
      'step.topcut': 'Top Cut',
      'shell.tabgroup.analysis': 'ANALYSIS',
      'shell.tabgroup.results': 'RESULTS',
      'table.addRow': '+ Add Row',
      'table.applyBdl': 'Apply BDL to all',
      'table.discard': 'Discard Changes',
      'table.next': 'Next ›',
      'table.prev': '‹ Prev',
      'validation.goFix': 'Go fix',
      'welcome.title': '👋 Welcome! Quick guided tour?',
      'welcome.body': 'Explore key features in 6 steps — no setup needed.',
      'welcome.cta': 'Start Tour →'
    }},
    id: {{
      'nav.tour': 'Tour', 'nav.glossary': 'Glosarium', 'nav.help': 'Bantuan',
      'nav.theme': 'Tema', 'nav.lang': 'Bahasa', 'nav.visit': 'orebit.id ↗', 'nav.analysis': 'Analisis', 'nav.results': 'Hasil',
      'phase.label': LABEL_ID,
      'help.tour': 'Ikuti tour', 'help.glossary': 'Buka glosarium',
      'help.help': 'Bantuan & FAQ', 'help.theme': 'Ganti tema',
      'lang.picker.title': 'Pilih bahasa Anda',
      'lang.picker.subtitle': 'Bisa diubah kapan saja dari navbar.',
      'lang.picker.aria': 'Pemilih bahasa',
      'lang.picker.en.name': 'English', 'lang.picker.en.sub': 'Default',
      'lang.picker.id.name': 'Bahasa Indonesia', 'lang.picker.id.sub': 'Indonesia',
      'lang.picker.skip': 'Lanjut pakai bahasa browser',
      'qs.title': QS_TITLE_ID, 'qs.body': QS_BODY_ID, 'qs.cta': QS_CTA_ID,
      'help.bubble.title': 'Butuh bantuan?',
      'tab.dashboard': 'Dasbor', 'tab.import': 'Impor', 'tab.collar': 'Collar',
      'tab.survey': 'Survei', 'tab.assay': 'Assay', 'tab.geology': 'Geologi',
      'tab.validation': 'Validasi', 'tab.striplog': 'Strip Log', 'tab.section': 'Penampang',
      'tab.desurvey': 'Desurvey', 'tab.merge': 'Gabung', 'tab.composite': 'Komposit', 'tab.export': 'Ekspor',
      'shell.tabgroup.data': 'DATA', 'shell.tabgroup.processing': 'PROSES',
      'shell.tabgroup.visualization': 'VISUALISASI', 'shell.tabgroup.output': 'KELUARAN',
      'shell.tabgroup.tables': 'TABEL',
      'btn.assayTemplate': 'Unduh Template Assay',
      'btn.collarTemplate': 'Unduh Template Collar',
      'btn.downloadPdf': 'Unduh PDF',
      'btn.exportBundleFile': 'Ekspor Bundle (.orebit)',
      'btn.geologyTemplate': 'Unduh Template Geologi',
      'btn.importBundleFile': 'Impor Bundle (.orebit)',
      'btn.importOrebit': 'Impor bundle .orebit',
      'btn.openGdrive': 'Buka dari Google Drive',
      'btn.recompute': 'Hitung Ulang',
      'btn.recomputeMerge': 'Hitung Ulang Gabungan',
      'btn.resetSample': 'Reset ke Data Contoh',
      'btn.saveToProject': 'Simpan ke Proyek',
      'btn.surveyTemplate': 'Unduh Template Survei',
      'dash.exportBundle': 'Ekspor Bundle',
      'dash.importBundle': 'Impor Bundle',
      'dash.openProject': 'Buka Proyek',
      'desc.assay': 'Data assay: interval kadar per lubang bor.',
      'desc.collar': 'Data collar: ID lubang, koordinat, kedalaman.',
      'desc.desurvey': 'Desurvey Minimum Curvature — standar industri.',
      'desc.striplog': 'Strip log visual per lubang bor.',
      'desc.validation': 'Verifikasi koneksi di semua 4 tabel.',
      'estimation.globalMean': 'Rata-rata Global',
      'estimation.maxLocalBias': 'Bias Lokal Maks',
      'footer.brand': 'Orebit — Inteligensi Pertambangan',
      'glossary.title': 'Glosarium',
      'h3.11stepWorkflow': 'Alur Kerja 11 Langkah',
      'h3.autopilot': 'Mode Autopilot',
      'h3.decisionCriteria': 'Kriteria Keputusan',
      'h3.exportOptions': 'Opsi Ekspor',
      'h3.notSuitableFor': 'Tidak Cocok Untuk',
      'h3.suitableFor': 'Cocok Untuk',
      'h3.techGlossary': 'Glosarium Teknis',
      'header.subtitle': 'Eksplorasi · Dari collar/survei/assay/geologi mentah → lubang bor desurvey bersih',
      'help.title': 'Bantuan & Referensi Teknis',
      'hint.getStarted': 'Mulai',
      'hint.goal': 'Tujuan',
      'hint.privacy': 'Privasi: semua data tetap di browser.',
      'hint.standards': 'Standar',
      'hint.uploadFormat': 'Format Upload',
      'info.quickStart': 'Mulai Cepat',
      'kcmi.section1': 'KCMI Bagian 1',
      'loading.message': 'Memuat Orebit...',
      'nextstep.recommended': 'Langkah Selanjutnya',
      'panel.bivariate.title': 'Analisis Bivariat',
      'panel.composite.title': 'Komposit',
      'panel.compositing.title': 'Komposit',
      'panel.data.title': 'Ringkasan Data',
      'panel.domain.title': 'Pemodelan Domain',
      'panel.litho.title': 'Litologi',
      'panel.multivariate.title': 'Analisis Multivariat',
      'panel.report.title': 'Laporan',
      'panel.spacing.title': 'Analisis Spasi',
      'panel.stats.title': 'Statistik',
      'panel.topcut.title': 'Analisis Top Cut',
      'panel.tutorial.title': 'Tutorial',
      'panel.upload.title': 'Unggah Data',
      'quickaction.help': 'Bantuan',
      'quickaction.projectMgr': 'Manajer Proyek',
      'quickaction.upload': 'Unggah Data',
      'section.autofit': 'Sesuaikan Otomatis',
      'section.next': 'Berikutnya',
      'section.prev': 'Sebelumnya',
      'section.reset': 'Reset',
      'status.dataNotLoaded': 'data belum dimuat',
      'step.bivariate': 'Bivariat',
      'step.compositing': 'Komposit',
      'step.domain': 'Domain',
      'step.import': 'Impor',
      'step.inspection': 'Inspeksi',
      'step.litho': 'Litologi',
      'step.multivariate': 'Multivariat',
      'step.report': 'Laporan',
      'step.spacing': 'Spasi',
      'step.statistics': 'Statistik',
      'step.topcut': 'Top Cut',
      'shell.tabgroup.analysis': 'ANALISIS',
      'shell.tabgroup.results': 'HASIL',
      'table.addRow': '+ Tambah Baris',
      'table.applyBdl': 'Terapkan BDL ke semua',
      'table.discard': 'Buang Perubahan',
      'table.next': 'Berikutnya ›',
      'table.prev': '‹ Sebelumnya',
      'validation.goFix': 'Perbaiki',
      'welcome.title': '👋 Selamat datang! Ikuti tur singkat?',
      'welcome.body': 'Jelajahi fitur utama dalam 6 langkah — tanpa setup.',
      'welcome.cta': 'Mulai Tur →'
    }}
  }};
  const STORAGE_KEY = 'orebit.lang';
  const PICKER_SHOWN_KEY = 'orebit.lang.picker.shown';

  function detectDefault() {{
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && STRINGS[saved]) return saved;
    const nav = (navigator.language || 'en').toLowerCase();
    return nav.startsWith('id') ? 'id' : 'en';
  }}

  let currentLang = detectDefault();

  function t(key) {{
    return (STRINGS[currentLang] && STRINGS[currentLang][key]) || STRINGS.en[key] || key;
  }}

  function applyI18n() {{
    document.querySelectorAll('[data-orebit-i18n]').forEach(el => {{
      const key = el.getAttribute('data-orebit-i18n');
      el.textContent = t(key);
    }});
    document.querySelectorAll('[data-orebit-i18n-title]').forEach(el => {{
      const key = el.getAttribute('data-orebit-i18n-title');
      el.setAttribute('title', t(key));
    }});
    document.documentElement.setAttribute('lang', currentLang);
    updateLangToggle();
    // Update header h1
    const h1 = document.querySelector('header.orebit-header h1');
    if (h1) {{
      const txtNode = Array.from(h1.childNodes).find(n => n.nodeType === 3);
      if (txtNode) txtNode.textContent = t('phase.label') + ' ';
    }}
  }}

  function updateLangToggle() {{
    const btn = document.getElementById('langToggle');
    if (!btn) return;
    btn.innerHTML = currentLang === 'en'
      ? '<span class="lang-active">EN</span><span class="lang-sep">·</span><span>ID</span>'
      : '<span>EN</span><span class="lang-sep">·</span><span class="lang-active">ID</span>';
    btn.setAttribute('title', currentLang === 'en'
      ? 'Switch to Bahasa Indonesia' : 'Switch to English');
  }}

  function setLang(lang) {{
    if (!STRINGS[lang]) return;
    currentLang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    applyI18n();
    // Bridge: call app-level i18n if it exists
    if (typeof window.applyLanguage === 'function') {{ try {{ window.applyLanguage(lang); }} catch(e){{}} }}
    else if (typeof window.__appSetLang === 'function') {{ try {{ window.__appSetLang(lang); }} catch(e){{}} }}
    // Bottom nav labels are created at init from the then-current language;
    // re-render them so toggling re-translates without a reload.
    if (typeof window.__updateMobileNavLabels === 'function') {{ try {{ window.__updateMobileNavLabels(); }} catch(e){{}} }}
    // Re-sync desktop breadcrumb (tab-active name) after app-level i18n
    const crumb = document.getElementById('orebitCrumb');
    if (crumb) {{
      const act = document.querySelector('nav.tabs .tab.active');
      crumb.textContent = act ? act.textContent.trim() : '';
    }}
    // Also sync app-level storage keys
    try {{ localStorage.setItem('lang', lang); localStorage.setItem('orebit_lang', lang); }} catch(e){{}}
  }}

  function toggleLang() {{
    setLang(currentLang === 'en' ? 'id' : 'en');
  }}

  /* ─── Lang picker modal ─── */
  function showLangPicker(onPick) {{
    if (document.querySelector('.lang-picker-overlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'lang-picker-overlay';
    overlay.innerHTML =
      '<div class="lang-picker" role="dialog" aria-label="' + t('lang.picker.aria') + '">' +
        '<h3>' + t('lang.picker.title') + '</h3>' +
        '<p>' + t('lang.picker.subtitle') + '</p>' +
        '<div class="lang-picker-options">' +
          '<button data-pick="en">' +
            '<span class="flag">🇬🇧</span>' +
            '<span class="name">' + STRINGS.en['lang.picker.en.name'] + '</span>' +
            '<span class="sub">' + STRINGS.en['lang.picker.en.sub'] + '</span>' +
          '</button>' +
          '<button data-pick="id">' +
            '<span class="flag">🇮🇩</span>' +
            '<span class="name">' + STRINGS.en['lang.picker.id.name'] + '</span>' +
            '<span class="sub">' + STRINGS.en['lang.picker.id.sub'] + '</span>' +
          '</button>' +
        '</div>' +
        '<button class="lang-picker-skip" data-pick="skip">' + t('lang.picker.skip') + '</button>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {{
      const pick = e.target.closest('[data-pick]');
      if (!pick) return;
      const v = pick.getAttribute('data-pick');
      if (v === 'en' || v === 'id') setLang(v);
      localStorage.setItem(PICKER_SHOWN_KEY, '1');
      overlay.remove();
      if (typeof onPick === 'function') {{
        try {{ onPick(v); }} catch (e) {{ console.warn('[orebit-v194] onPick:', e); }}
      }}
    }});
  }}

  function maybeShowPickerOnFirstVisit(onDone) {{
    const shown = localStorage.getItem(PICKER_SHOWN_KEY);
    const hasSaved = localStorage.getItem(STORAGE_KEY);
    if (!shown && !hasSaved) {{
      setTimeout(() => showLangPicker(onDone), 700);
      return true;  // picker will show
    }}
    return false; // no picker
  }}

  /* ─── Header transformation ─── */
  function transformHeader() {{
    const header = document.querySelector('header.orebit-header');
    if (!header) return;
    const h1 = header.querySelector('h1');
    if (h1 && !h1.querySelector('.orebit-phase-pill')) {{
      h1.textContent = LABEL_EN + ' ';
      const pill = document.createElement('span');
      pill.className = 'orebit-phase-pill';
      pill.textContent = PHASE_PILL;
      h1.appendChild(pill);
    }}
    const toolbar = header.querySelector('.toolbar');
    // NOTE: language toggle is the template's #lang-switch button (wired by orebit-shared.js
    // applyLanguage, which translates BOTH data-i18n and data-orebit-i18n incl. section labels).
    // We deliberately do NOT inject a second #langToggle here — having two language controls
    // confused users and overflowed the mobile navbar. Single source: #lang-switch.
    // Mark Tour/Glossary/Help in toolbar with collapse-mobile attr (hidden on small screens)
    if (toolbar) {{
      Array.from(toolbar.querySelectorAll('button, .glossary-trigger')).forEach(b => {{
        const txt = (b.textContent || '').toLowerCase();
        if (/tour|glossary|glosarium|help|bantuan/i.test(txt)) {{
          b.setAttribute('data-orebit-collapse-mobile', '');
        }}
      }});
    }}

    // ── Move Undo + Glossary from header toolbar to sidebar footer (preview parity) ──
    relocateToolbarToRail(header);

    // ── Header search affordance (Ctrl+K hook; opens glossary/help search if present) ──
    injectHeaderSearch(header);

    // injectDocsLink(header) removed 2026-09-04: Tuan pointed out the header
    // "Documentation" link and the help menu's "Cari dokumentasi" show the
    // same thing. Verified: the embedded panel renders the identical content
    // geosuite.orebit.id/docs is built from (help_panel.js's own docstring
    // says so), has its own search box and 28 nav entries -- a full browser,
    // not a stub -- and works without internet, which the external link
    // does not. The embedded version is a strict superset, so the external
    // link added a second door to the same room with none of its own value.

    // ── Profile / project avatar (user profile + active project summary) ──
    injectProfileAvatar(header);

    // ── Breadcrumb: reflect the active tab name beside the pill ──
    injectBreadcrumb(header);

    // Section labels are now defined directly in each app's template.html nav
    // (single source of truth, 4 clean groups). The old addTabSections() injector
    // created DUPLICATE labels + an empty "Processing" group, so it is disabled.
    // addTabSections();
  }}

  function relocateToolbarToRail(header) {{
    const rail = document.querySelector('nav.tabs');
    const toolbar = header && header.querySelector('.toolbar');
    if (!rail || !toolbar) return;
    if (rail.querySelector('.orebit-rail-foot')) return; // idempotent
    const foot = document.createElement('div');
    foot.className = 'orebit-rail-foot';
    // Find the Undo + Glossary buttons by id / text, move them down
    const undoBtn = toolbar.querySelector('#undoBtn');
    const glossBtn = Array.from(toolbar.querySelectorAll('button, .glossary-trigger'))
      .find(b => /glossary|glosarium/i.test(b.textContent || ''));
    [undoBtn, glossBtn].forEach(b => {{ if (b) foot.appendChild(b); }});
    if (foot.children.length) rail.appendChild(foot);
  }}

  function injectHeaderSearch(header) {{
    // The magnifier button is gone (2026-09-04); only the Ctrl+K shortcut
    // remains. It read "Search · Ctrl+K" behind a magnifier icon but opened
    // a modal titled "Glossary" -- a terminology list, not a search over the
    // user's data. A geologist reasonably reads a magnifier in an app header
    // as "find my holes/columns", so the control promised one thing and did
    // another. The same action now lives in the help menu, named for what it
    // actually is ("Browse glossary"), which is also where someone looks for
    // terminology help.
    //
    // The keyboard shortcut is kept: it costs no screen space, it is what
    // power users already have in their fingers, and unlike an icon a
    // shortcut makes no visual promise about what it opens.
    if (window.innerWidth <= 768) return;
    if (window.__orebitSearchKeyBound) return;
    window.__orebitSearchKeyBound = true;
    document.addEventListener('keydown', function(e) {{
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {{ e.preventDefault(); openSearch(); }}
    }});
  }}
  function openSearch() {{
    // Reuse glossary search if available, else help; both are existing surfaces.
    if (typeof openGlossary === 'function') {{ openGlossary(); return; }}
    if (typeof openHelp === 'function') {{ openHelp(); return; }}
  }}

  function injectDocsLink(header) {{
    const toolbar = header.querySelector('.toolbar');
    if (!toolbar) return;
    // Already present (either injected by us or present in the source HTML).
    if (toolbar.querySelector('a.orebit-docs-link') || toolbar.querySelector('a[href*="geosuite.orebit.id/docs"]')) return;
    const themeToggle = toolbar.querySelector('#themeToggle');
    const link = document.createElement('a');
    link.href = 'https://geosuite.orebit.id/docs';
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'orebit-link orebit-docs-link';
    link.title = document.documentElement.lang === 'id' ? 'Dokumentasi' : 'Documentation';
    link.innerHTML = '<svg class="lucide-icon" viewBox="0 0 24 24" aria-hidden="true" style="width:14px;height:14px;"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg> <span>' + (document.documentElement.lang === 'id' ? 'Dokumentasi' : 'Documentation') + '</span>';
    // Icon-only on mobile so ID toggle + profile avatar stay on-screen
    if (!document.getElementById('orebit-docs-link-css')) {{
      const st = document.createElement('style');
      st.id = 'orebit-docs-link-css';
      st.textContent = '@media (max-width: 768px){{header.orebit-header .toolbar a[href*="geosuite.orebit.id/docs"] span{{display:none !important}}header.orebit-header .toolbar a[href*="geosuite.orebit.id/docs"]{{width:44px !important;min-width:44px !important;justify-content:center !important;padding:8px 0 !important}}}}';
      document.head.appendChild(st);
    }}
    if (themeToggle) {{
      themeToggle.insertAdjacentElement('afterend', link);
    }} else {{
      toolbar.appendChild(link);
    }}
    // Keep visible on mobile (no data-orebit-collapse-mobile attribute).
  }}

  function injectProfileAvatar(header) {{
    const toolbar = header.querySelector('.toolbar');
    if (!toolbar || toolbar.querySelector('.orebit-avatar')) return;
    var prof = getOrebitProfile();
    var initials = (prof.initials || 'GK');
    const av = document.createElement('button');
    var VERSION = document.querySelector('meta[name="product-version"]')?.getAttribute('content') || "1.9.4";
    window.OREBBIT_VERSION = VERSION;

    // ── Update check (2026-09-06) ───────────────────────────────────────
    // A Desktop Edition EXE is frozen at whatever version was downloaded and
    // had no way to learn a newer one exists: the profile menu showed the
    // running version and a "Check for Updates" link the user had to click,
    // visit, and compare by eye. If they never clicked, they never knew.
    //
    // One request, on open, for the version-discovery file the repo already
    // maintains. It sends nothing about the user or their data -- it is a GET
    // for a 4-line JSON file -- but it IS a network call in a product sold as
    // offline, so it is deliberately the only one, it is never retried, and
    // every failure path is silent: no connection, blocked, malformed answer
    // or an older/equal version all leave the menu exactly as it looks today.
    //
    // Silence on failure matters more than it sounds. The alternative — an
    // error or "couldn't check" line — would punish the offline case, which
    // for this product is normal use rather than a fault.
    function _cmpVer(a, b) {{
      var pa = String(a).replace(/^v/, '').split('.').map(Number);
      var pb = String(b).replace(/^v/, '').split('.').map(Number);
      for (var i = 0; i < Math.max(pa.length, pb.length); i++) {{
        var x = pa[i] || 0, y = pb[i] || 0;
        if (x !== y) return x > y ? 1 : -1;
      }}
      return 0;
    }}
    window.__orebitLatest = null;
    (function checkForUpdate() {{
      try {{
        // file: has no origin to resolve against, and an EXE runs from file:.
        var base = (location.protocol === 'file:')
          ? '{PRODUCT_BASE_URL}' : '';
        fetch(base + '/03-latest.json', {{ cache: 'no-store' }})
          .then(function (r) {{ return r.ok ? r.json() : null; }})
          .then(function (j) {{
            if (!j || !j.version) return;
            if (_cmpVer(j.version, VERSION) > 0) {{
              window.__orebitLatest = j.version;
              var dot = document.querySelector('.orebit-avatar');
              if (dot) dot.classList.add('orebit-has-update');
            }}
          }})
          .catch(function () {{}});
      }} catch (e) {{}}
    }})();
    av.type = 'button';
    av.className = 'orebit-avatar';
    av.setAttribute('aria-label', 'Profile & project');
    av.title = prof.name + ' · ' + LABEL_EN;
    av.textContent = initials;
    toolbar.appendChild(av);

    const backdrop = document.createElement('div');
    backdrop.className = 'orebit-profile-backdrop';
    const menu = document.createElement('div');
    menu.className = 'orebit-profile-menu';
    menu.setAttribute('role', 'menu');
    document.body.appendChild(backdrop);
    document.body.appendChild(menu);

    function close() {{ menu.classList.remove('open'); backdrop.classList.remove('open'); }}
    function render() {{
      var st = getProjectStats();
      var L = (document.documentElement.lang === 'id')
        ? {{ project:'Project aktif', openProject:'Buka project', importBundle:'Import bundle', exportBundle:'Export bundle', theme:'Ganti tema', edit:'Edit profil', save:'Simpan', cancel:'Batal', name:'Nama', company:'Perusahaan', role:'Peran' }}
        : {{ project:'Active project', openProject:'Open project', importBundle:'Import bundle', exportBundle:'Export bundle', theme:'Toggle theme', edit:'Edit profile', save:'Save', cancel:'Cancel', name:'Name', company:'Company', role:'Role' }};
      menu.innerHTML =
        '<div class="orebit-profile-head">'
          + '<div class="pa">' + initials + '</div>'
          + '<div style="flex:1;min-width:0;"><div class="pn">' + esc(prof.name) + '</div><div class="pr">' + esc(prof.role) + (prof.company ? ' · ' + esc(prof.company) : '') + '</div></div>'
          + '<button class="orebit-profile-edit" data-act="edit" title="' + esc(L.edit) + '" aria-label="' + esc(L.edit) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>'
        + '</div>'
        + '<div class="orebit-profile-sec">'
          + '<div class="lbl">' + esc(L.project) + '</div>'
          + '<div class="orebit-profile-row"><span class="k">' + esc(st.nameLabel) + '</span><span class="v">' + esc(st.projectName) + '</span></div>'
          + '<div class="orebit-profile-row"><span class="k">' + esc(st.rowsLabel) + '</span><span class="v num">' + st.rows + '</span></div>'
          + '<div class="orebit-profile-row"><span class="k">' + esc(st.stageLabel) + '</span><span class="v">' + PHASE_PILL + '</span></div>'
        + '</div>'
        // Voluntary support CTA, shown in both the web and the Desktop profile
        // menu. User-initiated, never a paywall.
        + (function(){{
          var isId = document.documentElement.lang === 'id';
          var supportLbl = isId ? 'Dukung Orebit' : 'Support Orebit';
          var titleLbl = isId ? '💚 Terbantu GeoSuite?' : '💚 Enjoying GeoSuite?';
          var bodyLbl = isId ? 'Dukung tool & dokumentasi secara sukarela — sekali saja, tanpa langganan.' : 'Support the tools & docs voluntarily — one-time, no subscription.';
          return '<div class="orebit-profile-upgrade" style="margin:8px 12px 4px;padding:12px;border-radius:8px;background:#ecfdf5;border:1px solid #a7f3d0;text-align:center;">'
            + '<div style="font-size:13px;font-weight:600;color:#065f46;margin-bottom:4px;">' + titleLbl + '</div>'
            + '<div style="font-size:11px;color:#047857;margin-bottom:8px;">' + bodyLbl + '</div>'
            + '<a href="{SUPPORT_URL}" target="_blank" style="display:inline-block;padding:6px 16px;border-radius:6px;background:#0d9488;color:#fff;font-size:12px;font-weight:600;text-decoration:none;">💚 ' + supportLbl + '</a>'
            + '</div>';
        }})()
        + '<div class="orebit-profile-sec" style="padding:6px 0;">'
          + '<button class="orebit-profile-act" data-act="import"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span>' + esc(L.importBundle) + '</span></button>'
          + '<button class="orebit-profile-act" data-act="export"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>' + esc(L.exportBundle) + '</span></button>'
          + '<button class="orebit-profile-act" data-act="theme"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg><span>' + esc(L.theme) + '</span></button>'
        + '</div>'
        + '<div class="orebit-profile-sec" style="padding:2px 0;border-top:1px solid #e2e8f0;margin-top:2px;">'
          + '<div style="padding:8px 16px 2px;font-size:11px;color:#94a3b8;"><span style="font-weight:600;color:#0d9488;">GeoSuite</span> ' + (VERSION.indexOf('v') === 0 ? VERSION : 'v' + VERSION)
            + (window.__orebitLatest
                ? ' <span style="color:#0d9488;font-weight:600;">&#9679; ' + esc(window.__orebitLatest)
                  + (document.documentElement.lang === 'id' ? ' tersedia' : ' available') + '</span>'
                : '')
            + '</div>'
          // Both of these were hardcoded English and stayed English in ID
          // mode, sitting directly above "Kirim Masukan" which does switch --
          // reported from a screenshot 2026-09-04. i18n-coverage.py never saw
          // them because it walks tabs, not opened menus.
          + '<a href="{GITHUB_RELEASES_URL}" target="_blank" class="orebit-profile-act" style="text-decoration:none;color:inherit;" rel="noopener"><span>⟳ ' + (document.documentElement.lang === 'id' ? 'Cek Pembaruan' : 'Check for Updates') + '</span></a>'
          // Documentation intentionally NOT repeated here (removed 2026-09-04):
          // the header already carries a Documentation link to the same URL,
          // and the help bubble opens the embedded manual. Three doors to one
          // room is what made this menu feel crowded.
          + '<a href="mailto:{FEEDBACK_EMAIL}?subject=' + encodeURIComponent('Feedback {label_en} ' + (VERSION.indexOf('v') === 0 ? VERSION : 'v' + VERSION)) + '" class="orebit-profile-act" style="text-decoration:none;color:inherit;" rel="noopener"><span>💬 ' + (document.documentElement.lang === 'id' ? 'Kirim Masukan' : 'Send Feedback') + '</span></a>'
        + '</div>';
      menu.querySelectorAll('.orebit-profile-act, .orebit-profile-edit').forEach(function(b) {{
        b.addEventListener('click', function() {{
          var a = b.getAttribute('data-act');
          if (a === 'edit') {{ renderEdit(L); return; }}
          close();
          if (a === 'theme' && typeof toggleTheme === 'function') toggleTheme();
          else if (a === 'open') {{ if (typeof openProjectManager === 'function') openProjectManager(); else if (typeof openProject === 'function') openProject(); }}
          else if (a === 'import') {{ if (typeof importBundle === 'function') importBundle(); else if (typeof openProjectManager === 'function') openProjectManager(); }}
          else if (a === 'export') {{ if (typeof exportBundle === 'function') exportBundle(); else if (typeof exportProject === 'function') exportProject(); }}
        }});
      }});
    }}
    function renderEdit(L) {{
      var p = getOrebitProfile();
      menu.innerHTML =
        '<div class="orebit-profile-head"><div class="pa">' + (p.initials || 'GK') + '</div>'
          + '<div><div class="pn">' + esc(L.edit) + '</div><div class="pr">Local · Privacy-first</div></div></div>'
        + '<div class="orebit-profile-sec orebit-edit-form">'
          + '<label class="orebit-edit-lbl">' + esc(L.name) + '</label>'
          + '<input class="orebit-edit-inp" id="opfName" type="text" maxlength="40" value="' + esc(p.name) + '">'
          + '<label class="orebit-edit-lbl">' + esc(L.company) + '</label>'
          + '<input class="orebit-edit-inp" id="opfCompany" type="text" maxlength="50" value="' + esc(p.company || '') + '">'
          + '<label class="orebit-edit-lbl">' + esc(L.role) + '</label>'
          + '<input class="orebit-edit-inp" id="opfRole" type="text" maxlength="40" value="' + esc(p.role) + '">'
          + '<div class="orebit-edit-btns">'
            + '<button class="orebit-edit-cancel" data-edit="cancel">' + esc(L.cancel) + '</button>'
            + '<button class="orebit-edit-save" data-edit="save">' + esc(L.save) + '</button>'
          + '</div>'
        + '</div>';
      var nameInp = menu.querySelector('#opfName');
      if (nameInp) nameInp.focus();
      menu.querySelector('[data-edit="cancel"]').addEventListener('click', function() {{ render(); }});
      menu.querySelector('[data-edit="save"]').addEventListener('click', function() {{
        var nm = (menu.querySelector('#opfName').value || '').trim() || 'Geologist';
        var co = (menu.querySelector('#opfCompany').value || '').trim();
        var rl = (menu.querySelector('#opfRole').value || '').trim() || 'Local user · Privacy-first';
        var ini = nm.split(/\s+/).map(function(w){{return w[0];}}).join('').slice(0,2).toUpperCase() || 'GK';
        try {{ localStorage.setItem('orebit_profile', JSON.stringify({{ name:nm, company:co, role:rl, initials:ini }})); }} catch(e) {{}}
        prof = getOrebitProfile(); initials = prof.initials;
        av.textContent = initials; av.title = prof.name + ' · ' + LABEL_EN;
        render();
      }});
    }}
    av.addEventListener('click', function(e) {{
      e.stopPropagation();
      if (menu.classList.contains('open')) {{ close(); return; }}
      render();
      menu.classList.add('open'); backdrop.classList.add('open');
    }});
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', function(e) {{ if (e.key === 'Escape') close(); }});
  }}

  function getOrebitProfile() {{
    var name = 'Geologist', role = 'Local user · Privacy-first', initials = 'GK', company = '';
    try {{
      var raw = localStorage.getItem('orebit_profile');
      if (raw) {{ var p = JSON.parse(raw); name = p.name || name; role = p.role || role; company = p.company || '';
        initials = (p.initials || (name.split(/\s+/).map(function(w){{return w[0];}}).join('').slice(0,2)) || 'GK').toUpperCase(); }}
    }} catch(e) {{}}
    return {{ name: name, role: role, initials: initials, company: company }};
  }}

  function getProjectStats() {{
    var lang = (document.documentElement.lang === 'id');
    var labels = lang
      ? {{ nameLabel:'Nama', rowsLabel:'Baris data', stageLabel:'Tahap', none:'Belum ada data' }}
      : {{ nameLabel:'Name', rowsLabel:'Data rows', stageLabel:'Stage', none:'No data loaded' }};
    var projectName = labels.none, rows = 0;
    try {{
      // Best-effort: read whatever global data model the app exposes.
      var d = (typeof STATE !== 'undefined' && STATE) ? STATE : (typeof DATA !== 'undefined' ? DATA : null);
      if (d) {{
        if (d.projectName) projectName = d.projectName;
        var tally = 0;
        ['collar','survey','assay','geology','composites','samples','rows'].forEach(function(k) {{
          if (d[k] && d[k].length) tally += d[k].length;
        }});
        if (tally) {{ rows = tally; if (projectName === labels.none) projectName = (lang ? 'Project aktif' : 'Active dataset'); }}
      }}
    }} catch(e) {{}}
    return {{ projectName: projectName, rows: rows.toLocaleString(),
      nameLabel: labels.nameLabel, rowsLabel: labels.rowsLabel, stageLabel: labels.stageLabel }};
  }}

  function injectBreadcrumb(header) {{
    var tb = header.querySelector('.title-block');
    if (!tb || tb.querySelector('.orebit-crumb')) return;
    var crumb = document.createElement('span');
    crumb.className = 'orebit-crumb';
    crumb.id = 'orebitCrumb';
    tb.appendChild(crumb);
    function update() {{
      var active = document.querySelector('nav.tabs .tab.active');
      var name = active ? (active.textContent || '').trim() : '';
      crumb.textContent = name;
      crumb.style.display = name ? 'inline-flex' : 'none';
    }}
    update();
    // Re-sync on tab clicks
    document.querySelectorAll('nav.tabs .tab').forEach(function(tab) {{
      tab.addEventListener('click', function() {{ setTimeout(update, 60); }});
    }});
  }}

  function esc(s) {{ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c) {{
    return {{ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }}[c]; }}); }}

  function addTabSections() {{
    const sidebar = document.querySelector('nav.tabs');
    if (!sidebar) return;
    const tabs = sidebar.querySelectorAll('.tab');
    if (tabs.length < 12) return;
    // Section labels: idx -> label+key mapping (key drives i18n via data-orebit-i18n)
    const sections = [
      {{ idx: 0, label: 'DATA', key: 'shell.tabgroup.data' }},      // Before Tutorial
      {{ idx: 2, label: 'TABLES', key: 'shell.tabgroup.tables' }},  // Before Collar
      {{ idx: 6, label: 'ANALYSIS', key: 'shell.tabgroup.analysis' }},  // Before Validation
      {{ idx: 10, label: 'OUTPUT', key: 'shell.tabgroup.output' }},  // Before Merge
    ];
    // Insert labels in reverse order to preserve indices
    sections.reverse().forEach(s => {{
      if (tabs[s.idx]) {{
        const label = document.createElement('div');
        label.className = 'sidebar-section-label';
        label.setAttribute('data-orebit-i18n', s.key);
        label.textContent = (typeof t === 'function' ? t(s.key) : s.label) || s.label;
        label.style.cssText = 'font-family:ui-monospace,"JetBrains Mono",monospace;font-size:10px;font-weight:700;color:var(--fg-mute);letter-spacing:0.1em;padding:16px 12px 6px;margin-top:4px;';
        tabs[s.idx].parentNode.insertBefore(label, tabs[s.idx]);
      }}
    }});
  }}

  /* ─── Guided-tour target resolution ───
     Added 2026-09-04. Each phase's _tourRender() used to do
     `document.querySelector(step.target)` and treat any hit as highlightable.
     A hidden element still returns an element, and its bounding rect is
     0x0 at the origin, so on mobile -- where `nav.tabs` is display:none and
     the tabs live behind the bottom-nav groups -- every tab-targeted step
     drew its spotlight as an invisible dot in the top-left corner. Measured
     before this: all targeted steps in all three phases "found" their
     element and none were visible at 375px.

     Resolution order: the element itself if genuinely visible; else, for a
     tab target, the bottom-nav group button that leads to it; else null,
     which _tourRender already handles by centring the card with no
     spotlight -- an honest "no highlight" instead of a false one. */
  window.__orebitTourTarget = function (sel) {{
    if (!sel) return null;
    function visible(el) {{
      if (!el) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }}
    var el = null;
    try {{
      el = (sel.charAt(0) === '.' || sel.indexOf(' ') >= 0 || sel.indexOf('[') >= 0)
        ? document.querySelector(sel)
        : document.getElementById(sel);
    }} catch (e) {{ return null; }}
    if (visible(el)) return el;

    // Hidden tab -> stand in with its bottom-nav group button.
    // Single backslashes: this template is only run through str.format(),
    // which leaves backslashes alone, so whatever is written here reaches
    // the browser verbatim. `\\(` would be a literal backslash in the emitted
    // regex and never match.
    var m = /showTab\((\d+)\)/.exec(sel);
    var groups = window.__orebitNavGroups;
    if (m && groups) {{
      var idx = parseInt(m[1], 10);
      for (var i = 0; i < groups.length; i++) {{
        var g = groups[i];
        for (var j = 0; j < g.tabs.length; j++) {{
          if (g.tabs[j].idx === idx) {{
            var btn = document.querySelector(
              '.mobile-bottom-nav .nav-item[data-group="' + g.key + '"]');
            return visible(btn) ? btn : null;
          }}
        }}
      }}
    }}
    return null;
  }};

  /* ─── Floating Help bubble ─── */
  function injectHelpBubble() {{
    // `button.` is load-bearing, not decoration. Fixed 2026-09-04: this
    // guard used to be `.orebit-help-bubble`, and all three phase files
    // contain a decorative inline <span class="orebit-help-bubble">?</span>
    // in their Guide prose (the sentence describing "the ? button"). That
    // span matched, so this function returned early and the real floating
    // button was NEVER created -- which silently removed the only entry
    // point to Tour, Glossary and the in-app documentation panel on desktop.
    // Matching on the tag as well as the class keeps the idempotency intent
    // while ignoring prose that merely mentions the control.
    if (document.querySelector('button.orebit-help-bubble')) return;
    const btn = document.createElement('button');
    btn.className = 'orebit-help-bubble';
    btn.type = 'button';
    btn.setAttribute('aria-label', t('help.bubble.title'));
    btn.title = t('help.bubble.title');
    btn.textContent = '?';

    const menu = document.createElement('div');
    menu.className = 'orebit-help-menu';
    // Help-only menu: task help, nothing else. Trimmed 2026-09-04 after a
    // duplication audit found the same functions reachable from three
    // different surfaces at once (verified in code, not eyeballed):
    //   - Toggle theme: header button + this menu + the profile menu.
    //     Theme is a preference, not help; its one home is the profile menu.
    // Glossary is back here (2026-09-04, same day, corrected): it was first
    // removed on the theory that the header's magnifier button was the
    // better, more discoverable home for it -- but that button's own label
    // ("Search · Ctrl+K" behind a magnifier icon) promised a data search and
    // opened a terminology list instead, so the button was removed, not
    // relabelled. Leaving glossary out of BOTH surfaces would have made it
    // reachable only via Ctrl+K, which nobody discovers unless they already
    // know it exists. This menu is where someone actually looking for
    // terminology help would think to check.
    // Left in place: tour, Help & FAQ, and help_panel.js's own "search
    // documentation" entry, which opens the embedded manual -- a different
    // surface from the Help & FAQ overlay, not a duplicate of it.
    menu.innerHTML =
      '<button data-action="tour">' +
        '<span class="icon"></span><span class="label" data-orebit-i18n="help.tour">Take the tour</span>' +
      '</button>' +
      '<button data-action="glossary">' +
        '<span class="icon"></span><span class="label" data-orebit-i18n="help.glossary">Browse glossary</span>' +
      '</button>' +
      '<button data-action="help">' +
        '<span class="icon"></span><span class="label" data-orebit-i18n="help.help">Help & FAQ</span>' +
      '</button>';

    document.body.appendChild(menu);
    document.body.appendChild(btn);

    btn.addEventListener('click', (e) => {{
      e.stopPropagation();
      menu.classList.toggle('open');
    }});

    document.addEventListener('click', (e) => {{
      if (!menu.contains(e.target) && e.target !== btn) {{
        menu.classList.remove('open');
      }}
    }});

    menu.addEventListener('click', (e) => {{
      const action = e.target.closest('[data-action]');
      if (!action) return;
      const a = action.getAttribute('data-action');
      menu.classList.remove('open');
      try {{
        if (a === 'tour' && typeof window.startTour === 'function') {{ window.startTour(); }}
        else if (a === 'glossary' && typeof window.openGlossary === 'function') {{ window.openGlossary(); }}
        else if (a === 'help' && typeof window.openHelp === 'function') {{ window.openHelp(); }}
        else if (a === 'theme' && typeof window.toggleTheme === 'function') {{ window.toggleTheme(); }}
      }} catch (err) {{ console.warn('[orebit-v194] help action:', err); }}
    }});
  }}

  /* ─── Quick Start card ─── */
  function injectQuickStart() {{
    // Opt-in only: a phase must place <div id="orebitQuickStartSlot"></div> where it
    // wants the card. Dashboards stay clean (no auto-inject into .panel.active, which
    // previously leaked raw qs.* keys onto the Dashboard landing).
    const slot = document.getElementById('orebitQuickStartSlot');
    if (!slot) return;
    if (slot.querySelector('.orebit-quickstart')) return;

    const card = document.createElement('div');
    card.className = 'orebit-quickstart';
    card.innerHTML =
      '<div class="orebit-quickstart-content">' +
        '<h3 data-orebit-i18n="qs.title">' + t('qs.title') + '</h3>' +
        '<p data-orebit-i18n="qs.body">' + t('qs.body') + '</p>' +
      '</div>' +
      '<button class="orebit-quickstart-cta" type="button" data-orebit-i18n="qs.cta">' + t('qs.cta') + '</button>';

    card.querySelector('.orebit-quickstart-cta').addEventListener('click', () => {{
      if (typeof window.startTour === 'function') {{
        try {{ window.startTour(); }} catch (e) {{ console.warn(e); }}
      }}
    }});

    // Hide if tour already seen
    if (localStorage.getItem(TOUR_KEY)) {{
      card.style.display = 'none';
    }}

    slot.appendChild(card);
  }}

  /* ─── Welcome card (dashboard greeting, replaces auto-popup tour) ─── */
/* ─── Tour orchestration: chain after lang-picker pick ─── */
  function maybeStartTour() {{
    if (localStorage.getItem(TOUR_KEY)) return;
    if (typeof window.startTour !== 'function') return;
    setTimeout(() => {{
      try {{
        // Re-check overlay is gone
        if (!document.querySelector('.lang-picker-overlay')) {{
          window.startTour();
        }}
      }} catch (e) {{ console.warn('[orebit-v194] startTour:', e); }}
    }}, 400);
  }}

  /* ─── Mobile Bottom Nav ─── */
  function injectMobileNav() {{
    // Only show on mobile
    if (window.innerWidth > 768) return;
    // Dynamic: read tabs from DOM — works for all 3 phases
    var domTabs = document.querySelectorAll('nav.tabs .tab');
    if (domTabs.length < 2) return;

    // Extract tab info from DOM
    var tabs = [];
    domTabs.forEach(function(btn, i) {{
      var label = btn.querySelector('span[data-i18n]');
      var text = label ? label.textContent.trim() : btn.textContent.trim();
      var svgEl = btn.querySelector('svg');
      var svgPaths = '';
      if (svgEl) {{
        var clone = svgEl.cloneNode(true);
        svgPaths = clone.innerHTML;
      }}
      tabs.push({{ idx: i + 1, label: text, icon: svgPaths || '<circle cx="12" cy="12" r="3"/>' }});
    }});

    // Group tabs: [0]=Home, [1:mid]=Analysis, [mid:penultimate]=Results, [last]=Export
    var last = tabs.length - 1;
    var mid = Math.ceil(tabs.length / 2);
    var groups = [
      {{ key:'home', label: tabs[0].label, tabs:[tabs[0]], icon: tabs[0].icon }},
      {{ key:'analysis', label: t('nav.analysis') || 'Analysis', tabs: tabs.slice(1, mid) }},
      {{ key:'results', label: t('nav.results') || 'Results', tabs: tabs.slice(mid, last) }},
      {{ key:'export', label: tabs[last].label, tabs:[tabs[last]], icon: tabs[last].icon }}
    ];
    function svg(d) {{ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+d+'</svg>'; }}

    // Published for the guided tour. On mobile `nav.tabs` is hidden and the
    // tabs live behind these bottom-nav groups, so a tour step that names a
    // tab has to be able to find the group button standing in for it.
    window.__orebitNavGroups = groups;

    // Build nav HTML
    var nav = document.createElement('div');
    nav.className = 'mobile-bottom-nav';
    nav.id = 'mobileBottomNav';
    var items = '<div class="nav-items">';
    groups.forEach(function(g, i) {{
      var icon = g.icon || g.tabs[0].icon;
      items += '<button class="nav-item'+(i===0?' active':'')+'" data-group="'+g.key+'">'+svg(icon)+'<span>'+g.label+'</span></button>';
    }});
    // Tour entry — always reachable on mobile (welcome card may be dismissed)
    items += '<button class="nav-item" id="mobileTourBtn" type="button">'+svg('<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>')+'<span data-i18n="nav.tour">Tour</span></button>';
    items += '</div>';
    nav.innerHTML = items;
    document.body.appendChild(nav);

    var tourBtn = nav.querySelector('#mobileTourBtn');
    if (tourBtn) {{
      tourBtn.addEventListener('click', function() {{
        if (typeof startTour === 'function') startTour();
        else if (typeof window.startTour === 'function') window.startTour();
      }});
    }}

    // ── Nav drawer (replaces the old bottom-stacked .mobile-sub-tabs bar --
    // see PLAN-uiux-desktop-mobile.md §2's mobile-nav follow-up, 2026-09-02.
    // Opens via a hamburger button next to the logo, slides in from the left,
    // auto-closes on selection or backdrop tap. Costs 0px until opened, and a
    // vertical list has no "cut off mid-item" failure mode the way the old
    // horizontal strip did. ──
    var backdrop = document.createElement('div');
    backdrop.className = 'mobile-nav-drawer-backdrop';
    backdrop.id = 'mobileNavDrawerBackdrop';
    document.body.appendChild(backdrop);

    var drawer = document.createElement('div');
    drawer.className = 'mobile-nav-drawer';
    drawer.id = 'mobileNavDrawer';
    document.body.appendChild(drawer);

    function closeDrawer() {{
      drawer.classList.remove('show');
      backdrop.classList.remove('show');
    }}
    function openDrawer() {{
      drawer.classList.add('show');
      backdrop.classList.add('show');
    }}
    backdrop.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function(e) {{
      if (e.key === 'Escape') closeDrawer();
    }});

    var hamburger = document.querySelector('.mobile-nav-hamburger');
    if (!hamburger) {{
      var brand = document.querySelector('header.orebit-header .brand');
      if (brand) {{
        hamburger = document.createElement('button');
        hamburger.type = 'button';
        hamburger.className = 'mobile-nav-hamburger';
        hamburger.setAttribute('aria-label', 'Open navigation');
        hamburger.innerHTML = svg('<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>');
        brand.appendChild(hamburger);
      }}
    }}
    if (hamburger) hamburger.addEventListener('click', openDrawer);

    function renderDrawer(g) {{
      drawer.innerHTML = '<div class="drawer-title"></div>' + g.tabs.map(function(tb) {{
        return '<button class="sub-tab" data-tab="'+tb.idx+'">'+svg(tb.icon)+'<span>'+tb.label+'</span></button>';
      }}).join('');
      drawer.querySelector('.drawer-title').textContent = g.label;
      drawer.querySelectorAll('.sub-tab').forEach(function(st) {{
        st.addEventListener('click', function() {{
          drawer.querySelectorAll('.sub-tab').forEach(function(s) {{ s.classList.remove('active'); }});
          st.classList.add('active');
          var tabIdx = parseInt(st.getAttribute('data-tab'));
          if (typeof showTab === 'function') showTab(tabIdx);
          closeDrawer();
        }});
      }});
      if (drawer.firstElementChild && drawer.children[1]) drawer.children[1].classList.add('active');
    }}

    // Re-render group labels on language toggle (labels are captured at init
    // from the then-current language; without this they go stale on toggle).
    window.__updateMobileNavLabels = function() {{
      var domTabs = document.querySelectorAll('nav.tabs .tab');
      nav.querySelectorAll('.nav-item[data-group]').forEach(function(btn) {{
        var g = btn.getAttribute('data-group');
        var span = btn.querySelector('span');
        if (!span) return;
        if (g === 'analysis') span.textContent = t('nav.analysis') || 'Analysis';
        else if (g === 'results') span.textContent = t('nav.results') || 'Results';
        else if (g === 'home') span.textContent = t('tab.dashboard') || 'Dashboard';
        else {{
          var idx = domTabs.length - 1;
          var lbl = domTabs[idx] && (domTabs[idx].querySelector('span[data-i18n]')
                   || (domTabs[idx].hasAttribute('data-i18n') ? domTabs[idx] : null));
          if (lbl) span.textContent = lbl.textContent.trim();
        }}
      }});
    }};

    var navBtns = nav.querySelectorAll('.nav-item');
    navBtns.forEach(function(btn, idx) {{
      // Tour button has its own handler above — skip it here (no group entry)
      if (btn.id === 'mobileTourBtn') return;
      btn.addEventListener('click', function() {{
        var g = groups[idx];
        if (!g) return;
        navBtns.forEach(function(b, i) {{ b.classList.toggle('active', i === idx); }});
        if (g.tabs.length > 1) {{
          if (hamburger) hamburger.classList.add('show');
          renderDrawer(g);
          if (typeof showTab === 'function') showTab(g.tabs[0].idx);
        }} else {{
          if (hamburger) hamburger.classList.remove('show');
          closeDrawer();
          if (typeof showTab === 'function') showTab(g.tabs[0].idx);
        }}
      }});
    }});
  }}

  /* ─── Init ─── */
  function init() {{
    try {{ transformHeader(); }} catch (e) {{ console.warn('[orebit-v194] header:', e); }}
    try {{ injectHelpBubble(); }} catch (e) {{ console.warn('[orebit-v194] help bubble:', e); }}
    try {{ injectQuickStart(); }} catch (e) {{ console.warn('[orebit-v194] quickstart:', e); }}

    try {{ applyI18n(); }} catch (e) {{ console.warn('[orebit-v194] i18n:', e); }}
    try {{ injectMobileNav(); }} catch (e) {{ console.warn('[orebit-v194] mobile nav:', e); }}

    // Show lang-picker first (tour is now opt-in via header button only)
    maybeShowPickerOnFirstVisit(() => {{}});

    // Hide page loader after all init completes
    const _loader = document.getElementById('pageLoader');
    if (_loader) {{ _loader.classList.add('fade-out'); setTimeout(() => _loader.remove(), 400); }}
  }}

  // Public API
  window.OrebitI18n = {{
    t, setLang, toggleLang, applyI18n, showLangPicker,
    get current() {{ return currentLang; }}
  }};

  if (document.readyState === 'loading') {{
    document.addEventListener('DOMContentLoaded', init);
  }} else {{
    init();
  }}
}})();

</script>
