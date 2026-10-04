/* =========================================================
   Admin-Panel
   - Login (Benutzer/Passwort, als SHA-256 in config.json)
   - Alle Einstellungen mit Live-Vorschau
   - Veröffentlichen direkt ins GitHub-Repo (ein Commit)
   ========================================================= */
(function () {
  'use strict';
  const CS = window.CS;
  const U = CS.util;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const KEY = {
    draft: 'cs-admin-draft',
    preview: 'cs-preview-config',
    session: 'cs-admin-session',
    lock: 'cs-admin-lock',
    token: 'cs-gh-token',
    panel: 'cs-admin-panel',
    pubOpts: 'cs-admin-publish-opts',
  };
  const DEFAULT_HASH = CS.DEFAULT_CONFIG.admin.passHash;
  const DEFAULT_GITHUB_URL = CS.DEFAULT_CONFIG.social[0].url;

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* voll? */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* egal */ } },
  };
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* egal */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* egal */ } },
  };

  const S = {
    published: null,
    publishedText: '',
    draft: null,
    panel: 'start',
    openItems: {},
    previewMode: '',
    previewLang: 'de',
    tickers: [],
  };

  const serialize = (cfg) => JSON.stringify(cfg, null, 2) + '\n';
  const isDirty = () => serialize(S.draft) !== S.publishedText;
  const postOrigin = () => (location.origin && location.origin !== 'null' ? location.origin : '*');

  // ---------------------------------------------------------
  //  Kleine DOM-Helfer
  // ---------------------------------------------------------
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
        else if (k === 'style') el.style.cssText = v;
        else if (k in el && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  let toastTimer = 0;
  function toast(text, kind = '', ms = 3200) {
    const t = $('#toast');
    t.textContent = text;
    t.className = 'a-toast show ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'a-toast ' + kind; }, ms);
  }

  const val = (path) => U.get(S.draft, path);

  // ---------------------------------------------------------
  //  Änderungen → Entwurf speichern → Vorschau aktualisieren
  // ---------------------------------------------------------
  let previewTimer = 0;
  function set(path, value, opts = {}) {
    U.set(S.draft, path, value);
    changed(opts);
  }

  function changed({ rerender = false } = {}) {
    ls.set(KEY.draft, JSON.stringify(S.draft));
    ls.set(KEY.preview, JSON.stringify(S.draft));
    clearTimeout(previewTimer);
    previewTimer = setTimeout(sendPreview, 120);
    updateStatus();
    applyAdminTheme();
    if (rerender) showPanel(S.panel, { keepScroll: true });
    else runTickers();
  }

  function sendPreview() {
    const frame = $('#preview');
    if (frame && frame.contentWindow) {
      try { frame.contentWindow.postMessage({ type: 'cs:config', config: S.draft }, postOrigin()); } catch (e) { /* noch nicht geladen */ }
    }
  }

  function sendToPreview(msg) {
    const frame = $('#preview');
    try { frame.contentWindow.postMessage(msg, postOrigin()); } catch (e) { /* egal */ }
  }

  function applyAdminTheme() {
    const th = S.draft.theme;
    const r = document.documentElement.style;
    r.setProperty('--a1', th.accent1);
    r.setProperty('--a2', th.accent2);
    r.setProperty('--a3', th.accent3);
    $('#site-name').textContent = S.draft.brand.name || '';
  }

  function updateStatus() {
    const st = $('#status');
    st.textContent = '';
    st.append(isDirty()
      ? h('span', { class: 'pill dirty', text: '● Nicht veröffentlichte Änderungen' })
      : h('span', { class: 'pill clean', text: '✓ Alles veröffentlicht' }));
    if (S.published.admin.passHash === DEFAULT_HASH) {
      st.append(h('button', { class: 'pill dirty', type: 'button', style: 'border:0;cursor:pointer', text: '⚠️ Standard-Passwort aktiv', on: { click: () => showPanel('security') } }));
    }
  }

  // ---------------------------------------------------------
  //  Feld-Bausteine
  // ---------------------------------------------------------
  let uid = 0;
  const nextId = () => 'f' + ++uid;

  function group(title, ...children) {
    return h('section', { class: 'group' }, title ? h('h3', { text: title }) : null, ...children);
  }

  function info(html, kind = '') {
    return h('div', { class: 'info ' + kind, html });
  }

  function help(text) {
    return text ? h('div', { class: 'help', html: text }) : null;
  }

  function fieldText(path, label, o = {}) {
    const id = nextId();
    const input = h(o.multiline ? 'textarea' : 'input', {
      id,
      type: o.multiline ? null : o.type || 'text',
      placeholder: o.placeholder || '',
      maxLength: o.max || null,
      autocomplete: o.autocomplete || 'off',
      spellcheck: o.spellcheck === false ? 'false' : null,
    });
    input.value = val(path) == null ? '' : val(path);
    input.addEventListener('input', () => {
      let v = input.value;
      if (o.type === 'number') v = v === '' ? 0 : Number(v);
      set(path, v, { rerender: !!o.rerender });
    });
    return h('label', { class: 'field', for: id }, h('span', { text: label }), input, help(o.help));
  }

  function fieldI18n(path, label, o = {}) {
    const rows = ['de', 'en'].map((lang) => {
      const input = h(o.multiline ? 'textarea' : 'input', { type: o.multiline ? null : 'text', placeholder: o.placeholder || '', 'aria-label': `${label} (${lang.toUpperCase()})` });
      input.value = val(path + '.' + lang) || '';
      input.addEventListener('input', () => set(path + '.' + lang, input.value));
      return h('div', { class: 'i18n-row' }, h('span', { class: 'i18n-flag', text: lang.toUpperCase() }), input);
    });
    return h('div', { class: 'field' }, h('span', { class: 'field-label', text: label }), h('div', { class: 'i18n' }, rows), help(o.help));
  }

  function fieldToggle(path, label, helpText, o = {}) {
    const input = h('input', { type: 'checkbox', role: 'switch' });
    input.checked = !!val(path);
    input.addEventListener('change', () => set(path, input.checked, { rerender: !!o.rerender }));
    return h('label', { class: 'toggle' },
      h('span', { class: 't-text' }, h('b', { text: label }), helpText ? h('span', { class: 'help', html: helpText }) : null),
      h('span', { class: 'switch' }, input, h('span', { class: 'track' })));
  }

  function fieldSelect(path, label, options, o = {}) {
    const id = nextId();
    const sel = h('select', { id }, options.map(([v, l]) => h('option', { value: v, text: l })));
    sel.value = val(path);
    sel.addEventListener('change', () => set(path, sel.value, { rerender: !!o.rerender }));
    return h('label', { class: 'field', for: id }, h('span', { text: label }), sel, help(o.help));
  }

  function fieldRange(path, label, min, max, step, fmt = (v) => v) {
    const id = nextId();
    const input = h('input', { id, type: 'range', min, max, step });
    input.value = val(path);
    const out = h('output', { for: id, text: fmt(Number(input.value)) });
    input.addEventListener('input', () => { out.textContent = fmt(Number(input.value)); set(path, Number(input.value)); });
    return h('label', { class: 'field', for: id }, h('span', { text: label }), h('div', { class: 'range-row' }, input, out));
  }

  function fieldColor(path, label, onChange) {
    const color = h('input', { type: 'color', 'aria-label': label });
    const text = h('input', { type: 'text', maxLength: 7, spellcheck: 'false', 'aria-label': label + ' (Hex)' });
    color.value = text.value = val(path);
    color.addEventListener('input', () => { text.value = color.value; set(path, color.value); onChange && onChange(); });
    text.addEventListener('input', () => {
      if (/^#[0-9a-f]{6}$/i.test(text.value)) { color.value = text.value; set(path, text.value.toLowerCase()); onChange && onChange(); }
    });
    return h('div', { class: 'field' }, h('span', { class: 'field-label', text: label }), h('div', { class: 'color-row' }, color, text));
  }

  const EMOJIS = ['🚀', '🪐', '🌙', '⭐', '✨', '🔥', '💎', '🎮', '🎵', '🌈', '⚡', '🦄', '👾', '🛸', '🍀', '❤️', '🎨', '📱', '🤖', '🏆'];

  function fieldEmoji(path, label, o = {}) {
    const id = nextId();
    const input = h('input', { id, type: 'text', maxLength: 16 });
    input.value = val(path) || '';
    input.addEventListener('input', () => set(path, input.value));
    const picks = h('div', { class: 'emoji-picks' }, EMOJIS.map((e) => h('button', {
      type: 'button', text: e, 'aria-label': 'Emoji ' + e,
      on: { click: () => { input.value = e; set(path, e); input.dispatchEvent(new Event('input', { bubbles: true })); } },
    })));
    return h('label', { class: 'field', for: id }, h('span', { text: label }), input, o.picks === false ? null : picks, help(o.help));
  }

  function resizeImage(file, maxSize) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        if (file.type === 'image/svg+xml' || file.type === 'image/gif') { resolve(reader.result); return; }
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          let out = c.toDataURL('image/webp', 0.86);
          if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/png');
          resolve(out);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function fieldImage(path, label, o = {}) {
    const wrap = h('div', { class: 'field image-field' }, h('span', { class: 'field-label', text: label }));
    const render = () => {
      while (wrap.children.length > 1) wrap.lastChild.remove();
      const src = val(path);
      const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml', hidden: true });
      file.addEventListener('change', async () => {
        const f = file.files[0];
        if (!f) return;
        try {
          const data = await resizeImage(f, o.maxSize || 512);
          if (data.length > 600000) toast('Das Bild ist ziemlich groß – kleinere Bilder laden schneller.', 'error');
          set(path, data);
          render();
        } catch (e) {
          toast('Bild konnte nicht gelesen werden.', 'error');
        }
      });
      const urlInput = h('input', { type: 'url', placeholder: 'https://… (oder Bild hochladen)', 'aria-label': label + ' – Link' });
      urlInput.value = src && !String(src).startsWith('data:') ? src : '';
      urlInput.addEventListener('change', () => { set(path, urlInput.value.trim()); render(); });
      wrap.append(
        h('div', { class: 'image-preview' },
          src ? h('img', { src: U.safeUrl(src, { allowData: true }), alt: '' }) : h('span', { class: 'muted small', text: 'Noch kein Bild' }),
          h('div', { class: 'actions' },
            h('button', { class: 'a-btn small', type: 'button', text: '📁 Hochladen', on: { click: () => file.click() } }),
            src ? h('button', { class: 'a-btn small danger', type: 'button', text: 'Entfernen', on: { click: () => { set(path, ''); render(); } } }) : null)),
        file, urlInput, help(o.help));
    };
    render();
    return wrap;
  }

  function fieldList(path, o) {
    const wrap = h('div', { class: 'field' });
    if (o.label) wrap.append(h('span', { class: 'field-label', text: o.label }));
    const list = h('div', { class: 'list' });
    const items = val(path) || [];
    const open = (S.openItems[path] = S.openItems[path] || new Set());

    items.forEach((item, i) => {
      const itemPath = path + '.' + i;
      const titleEl = h('span', { class: 'li-title', text: o.itemTitle(item, i) });
      const move = (dir) => (e) => {
        e.preventDefault();
        const arr = val(path);
        const j = i + dir;
        if (j < 0 || j >= arr.length) return;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        const wasOpen = open.has(i), otherOpen = open.has(j);
        open.delete(i); open.delete(j);
        if (wasOpen) open.add(j);
        if (otherOpen) open.add(i);
        changed({ rerender: true });
      };
      const del = (e) => {
        e.preventDefault();
        if (!confirm('Diesen Eintrag wirklich löschen?')) return;
        val(path).splice(i, 1);
        S.openItems[path] = new Set(Array.from(open).filter((k) => k !== i).map((k) => (k > i ? k - 1 : k)));
        changed({ rerender: true });
      };
      const details = h('details', { class: 'list-item', open: open.has(i) },
        h('summary', null,
          o.itemIcon ? o.itemIcon(item) : null,
          titleEl,
          h('span', { class: 'li-tools' },
            h('button', { type: 'button', title: 'Nach oben', 'aria-label': 'Nach oben', text: '↑', on: { click: move(-1) } }),
            h('button', { type: 'button', title: 'Nach unten', 'aria-label': 'Nach unten', text: '↓', on: { click: move(1) } }),
            h('button', { class: 'del', type: 'button', title: 'Löschen', 'aria-label': 'Löschen', text: '✕', on: { click: del } }))),
        h('div', { class: 'list-body' }, o.fields(itemPath, item)));
      details.addEventListener('toggle', () => { if (details.open) open.add(i); else open.delete(i); });
      details.addEventListener('input', () => { titleEl.textContent = o.itemTitle(val(itemPath), i); });
      details.addEventListener('change', () => { titleEl.textContent = o.itemTitle(val(itemPath), i); });
      list.append(details);
    });

    const add = h('button', {
      class: 'a-btn small', type: 'button', text: '＋ ' + (o.addLabel || 'Hinzufügen'),
      on: { click: () => {
        const arr = val(path) || [];
        arr.push(o.newItem());
        U.set(S.draft, path, arr);
        open.add(arr.length - 1);
        changed({ rerender: true });
      } },
    });
    if (o.max && items.length >= o.max) add.disabled = true;
    wrap.append(list, h('div', null, add));
    return wrap;
  }

  const L = (de = '', en = '') => ({ de, en });
  const tr = (f) => U.tr(f, 'de', { name: S.draft.brand.name });

  // ---------------------------------------------------------
  //  Bereiche (Panels)
  // ---------------------------------------------------------
  const TIMEZONES = [
    ['Europe/Berlin', 'Deutschland (Berlin)'], ['Europe/Vienna', 'Österreich (Wien)'], ['Europe/Zurich', 'Schweiz (Zürich)'],
    ['Europe/London', 'UK (London)'], ['America/New_York', 'USA Ost (New York)'], ['America/Los_Angeles', 'USA West (Los Angeles)'],
    ['Asia/Tokyo', 'Japan (Tokio)'], ['UTC', 'UTC'],
  ];

  function fmtDuration(ms) {
    if (!Number.isFinite(ms)) return '–';
    if (ms <= 0) return 'abgelaufen';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d) return `${d} T ${hh} Std`;
    if (hh) return `${hh} Std ${m} Min`;
    return `${m} Min ${s % 60} Sek`;
  }

  function toLocalInput(ms, tz) {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
    return `${p.year}-${p.month}-${p.day}T${String(+p.hour % 24).padStart(2, '0')}:${p.minute}`;
  }

  const CHECKS = [
    { label: 'Projektname festlegen', panel: 'content', done: (d) => d.brand.name && d.brand.name !== 'NOVA' },
    { label: 'Startdatum in der Zukunft', panel: 'start', done: (d) => d.mode === 'live' || U.launchTime(d) > Date.now() },
    { label: 'Texte anpassen', panel: 'content', done: (d) => tr(d.soon.text) !== tr(CS.DEFAULT_CONFIG.soon.text) },
    { label: 'E-Mail-Anmeldung einrichten', panel: 'signup', done: (d) => !d.signup.enabled || !!String(d.signup.endpoint || '').trim() },
    { label: 'Social-Media-Links eintragen', panel: 'social', done: (d) => (d.social || []).some((s) => s.url && s.url !== DEFAULT_GITHUB_URL) },
    { label: 'Admin-Passwort ändern', panel: 'security', done: (d) => d.admin.passHash !== DEFAULT_HASH },
    { label: 'Mit GitHub verbinden', panel: 'publish', done: () => !!getToken() },
    { label: 'Besucherzähler einrichten', panel: 'seo', optional: true, done: (d) => !!String(d.analytics.goatcounter || '').trim() },
  ];

  const PANELS = [
    { id: 'start', icon: '🏠', title: 'Start', desc: 'Wann geht deine Seite live? Hier hast du alles im Blick.', render: panelStart },
    { id: 'content', icon: '✏️', title: 'Texte & Marke', desc: 'Name, Logo und alle Texte – auf Deutsch und Englisch.', render: panelContent },
    { id: 'design', icon: '🎨', title: 'Design & Effekte', desc: 'Farben, Sterne, Planeten, Rakete und Sound.', render: panelDesign },
    { id: 'sections', icon: '🧩', title: 'Bereiche', desc: 'Welche Abschnitte gezeigt werden und was drinsteht.', render: panelSections },
    { id: 'roadmap', icon: '🗺️', title: 'Roadmap & FAQ', desc: 'Zeitplan und häufige Fragen.', render: panelRoadmap },
    { id: 'signup', icon: '📧', title: 'Anmeldung', desc: 'E-Mail-Liste für deinen Launch.', render: panelSignup },
    { id: 'social', icon: '🔗', title: 'Social Media', desc: 'Links zu deinen Kanälen – mit passenden Icons.', render: panelSocial },
    { id: 'fun', icon: '🎮', title: 'Spiel & Easter Eggs', desc: 'Mini-Spiel und versteckte Überraschungen.', render: panelFun },
    { id: 'seo', icon: '📈', title: 'SEO & Statistik', desc: 'Google, Link-Vorschau und Besucherzähler.', render: panelSeo },
    { id: 'security', icon: '🔒', title: 'Sicherheit', desc: 'Benutzername und Passwort für diesen Admin-Bereich.', render: panelSecurity },
    { id: 'publish', icon: '☁️', title: 'Veröffentlichen', desc: 'Änderungen online stellen, sichern und wiederherstellen.', render: panelPublish },
  ];

  // ---------- Start ----------
  function panelStart() {
    const d = S.draft;
    const modeLabel = h('div', { class: 'v' });
    const countdown = h('div', { class: 'v' });
    const dateLabel = h('div', { class: 'v', style: 'font-size:1rem' });
    S.tickers.push(() => {
      const mode = U.currentMode(S.draft);
      modeLabel.textContent = mode === 'live' ? '🚀 Live' : '⏳ Coming Soon';
      const t = U.launchTime(S.draft);
      countdown.textContent = fmtDuration(t - Date.now());
      dateLabel.textContent = Number.isFinite(t)
        ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: S.draft.timeZone }).format(new Date(t))
        : 'ungültig';
    });

    const modes = [
      ['auto', '🤖', 'Automatisch', 'Coming Soon bis zum Startdatum, dann automatisch Live'],
      ['soon', '⏳', 'Coming Soon', 'Immer die Countdown-Seite'],
      ['live', '🚀', 'Live', 'Sofort die fertige Seite zeigen'],
    ];
    const modeCards = h('div', { class: 'mode-cards', role: 'group', 'aria-label': 'Modus' }, modes.map(([v, icon, title, desc]) =>
      h('button', {
        class: 'mode-card', type: 'button', 'aria-pressed': String(d.mode === v),
        on: { click: () => set('mode', v, { rerender: true }) },
      }, h('span', { class: 'mc-icon', text: icon }), h('b', { text: title }), h('small', { text: desc }))));

    const quick = (label, fn) => h('button', { class: 'a-btn small', type: 'button', text: label, on: { click: fn } });
    const setLaunch = (ms) => set('launchDate', toLocalInput(ms, S.draft.timeZone), { rerender: true });

    // Checkliste
    const doneCount = CHECKS.filter((c) => !c.optional && c.done(d)).length;
    const total = CHECKS.filter((c) => !c.optional).length;
    const checklist = h('ul', { class: 'checklist' }, CHECKS.map((c) => {
      const ok = !!c.done(d);
      return h('li', { class: ok ? 'done' : 'todo' },
        h('button', { type: 'button', on: { click: () => showPanel(c.panel) } },
          h('span', { class: 'ck', text: ok ? '✓' : '' }), h('span', { class: 'txt', text: c.label }),
          c.optional ? h('span', { class: 'opt', text: 'optional' }) : null));
    }));

    return [
      group('Überblick',
        h('div', { class: 'stat-row' },
          h('div', { class: 'stat-box' }, modeLabel, h('div', { class: 'l', text: 'Aktueller Modus' })),
          h('div', { class: 'stat-box' }, countdown, h('div', { class: 'l', text: 'bis zum Start' })),
          h('div', { class: 'stat-box' }, dateLabel, h('div', { class: 'l', text: 'Startzeitpunkt' })))),
      group('Modus', modeCards),
      group('Startzeitpunkt',
        h('div', { class: 'group-row' },
          fieldText('launchDate', 'Datum & Uhrzeit', { type: 'datetime-local', rerender: false }),
          fieldSelect('timeZone', 'Zeitzone', TIMEZONES)),
        h('div', { class: 'btn-row' },
          quick('In 1 Minute (Test)', () => setLaunch(Date.now() + 61000)),
          quick('+ 1 Tag', () => setLaunch(U.launchTime(S.draft) + 86400000)),
          quick('+ 1 Woche', () => setLaunch(U.launchTime(S.draft) + 7 * 86400000)),
          quick('In 30 Tagen', () => setLaunch(Date.now() + 30 * 86400000))),
        help('Tipp: „In 1 Minute“ + Modus „Automatisch“ = du siehst in der Vorschau die echte Launch-Show.')),
      group('Launch-Show',
        h('p', { class: 'muted small', text: 'Wenn der Countdown abläuft, gibt es Warp-Speed, „LIFTOFF!“, Konfetti – und die Seite verwandelt sich in die Live-Seite.' }),
        h('div', { class: 'btn-row' }, h('button', { class: 'a-btn primary', type: 'button', text: '🚀 In der Vorschau testen', on: { click: launchTest } }))),
      group(`Einrichtung (${doneCount}/${total})`,
        h('div', { class: 'progress' }, h('div', { style: `width:${Math.round((doneCount / total) * 100)}%` })),
        checklist),
    ];
  }

  // ---------- Texte ----------
  function panelContent() {
    const d = S.draft;
    return [
      group('Marke',
        fieldText('brand.name', 'Projektname', { max: 40, help: 'Erscheint oben links, im Tab, auf der Live-Seite und in der Link-Vorschau.' }),
        fieldSelect('brand.logoType', 'Logo', [['emoji', 'Emoji'], ['image', 'Eigenes Bild']], { rerender: true }),
        d.brand.logoType === 'image'
          ? fieldImage('brand.logoImage', 'Logo-Bild', { maxSize: 256, help: 'Am besten quadratisch, z. B. PNG mit transparentem Hintergrund.' })
          : fieldEmoji('brand.logoEmoji', 'Logo-Emoji')),
      group('Coming-Soon-Seite',
        fieldI18n('soon.badge', 'Kleines Label oben'),
        fieldI18n('soon.headline', 'Große Überschrift'),
        fieldI18n('soon.text', 'Beschreibung', { multiline: true })),
      group('Live-Seite (nach dem Start)',
        fieldI18n('live.badge', 'Kleines Label oben'),
        fieldI18n('live.headline', 'Große Überschrift', { help: '<code>{name}</code> wird automatisch durch den Projektnamen ersetzt.' }),
        fieldI18n('live.text', 'Beschreibung', { multiline: true }),
        fieldI18n('live.ctaText', 'Haupt-Button'),
        fieldText('live.ctaLink', 'Button-Link', { placeholder: '#features oder https://…', help: 'Wohin der Button führt, z. B. zu deinem Shop, deiner App oder <code>#features</code>.' })),
      group('Banner ganz oben',
        fieldToggle('banner.enabled', 'Banner anzeigen', 'Farbiger Streifen für Aktionen und Neuigkeiten.'),
        fieldI18n('banner.text', 'Text'),
        fieldText('banner.link', 'Link (optional)', { placeholder: 'https://…' })),
      group('Footer',
        fieldI18n('footer.text', 'Text unten'),
        fieldToggle('footer.showAdminLink', 'Link „🔒 Admin“ im Footer', 'Ausschalten, wenn Besucher ihn nicht sehen sollen – der Admin-Bereich bleibt unter <code>/admin.html</code> erreichbar.')),
      group('Sprache',
        fieldSelect('defaultLang', 'Startsprache', [['auto', 'Automatisch (nach Browser)'], ['de', 'Deutsch'], ['en', 'Englisch']], { help: 'Besucher können oben rechts jederzeit wechseln.' })),
    ];
  }

  // ---------- Design ----------
  function panelDesign() {
    const d = S.draft;
    const themeCards = h('div', { class: 'themes' }, Object.entries(CS.THEMES).map(([key, th]) =>
      h('button', {
        class: 'theme-card', type: 'button', 'aria-pressed': String(d.theme.preset === key),
        on: { click: () => {
          const { label, ...colors } = th;
          set('theme', { preset: key, ...colors }, { rerender: true });
        } },
      },
      h('span', { class: 'theme-swatch', style: `background:linear-gradient(135deg, ${th.accent2}, ${th.accent1} 50%, ${th.accent3}), ${th.bg}` }),
      h('span', { text: th.label }))));
    const custom = () => { if (S.draft.theme.preset !== 'custom') { S.draft.theme.preset = 'custom'; $$('.theme-card').forEach((b) => b.setAttribute('aria-pressed', 'false')); } };

    return [
      group('Farbthema', themeCards,
        h('div', { class: 'group-row' },
          fieldColor('theme.accent1', 'Hauptfarbe', custom),
          fieldColor('theme.accent2', 'Akzent 1', custom)),
        h('div', { class: 'group-row' },
          fieldColor('theme.accent3', 'Akzent 2', custom),
          fieldColor('theme.bg', 'Hintergrund', custom))),
      group('Countdown',
        fieldSelect('countdown.style', 'Aussehen', [['flip', 'Flip-Uhr (klappende Zahlen)'], ['glass', 'Glas-Kacheln']])),
      group('Weltraum',
        fieldToggle('effects.stars', 'Sternenfeld'),
        fieldRange('effects.starDensity', 'Sterne-Anzahl', 0.3, 2, 0.1, (v) => Math.round(v * 100) + ' %'),
        fieldRange('effects.starSpeed', 'Flug-Geschwindigkeit', 0.3, 3, 0.1, (v) => Math.round(v * 100) + ' %'),
        fieldToggle('effects.nebula', 'Farbnebel'),
        fieldToggle('effects.planets', 'Planeten'),
        fieldToggle('effects.rocket', 'Rakete', 'Fliegt um die Seite – anklicken für einen Probestart.')),
      group('Bewegung & Sound',
        fieldToggle('effects.glitch', 'Glitch-Effekt im Titel'),
        fieldToggle('effects.parallax', 'Sterne folgen der Maus'),
        fieldToggle('effects.tilt', 'Handy-Neigung', 'Sterne bewegen sich, wenn man das Handy kippt.'),
        fieldToggle('effects.soundDefault', 'Sound automatisch an', 'Startet beim ersten Klick. Besucher können ihn jederzeit ausschalten.')),
    ];
  }

  // ---------- Bereiche ----------
  function panelSections() {
    return [
      group('Sichtbare Bereiche',
        fieldToggle('sections.features', 'Features', 'Vor dem Start als „geheime“ Karten, danach mit Inhalt.'),
        fieldToggle('sections.about', 'Über uns', 'Nur auf der Live-Seite.'),
        fieldToggle('sections.stats', 'Zahlen', 'Nur auf der Live-Seite, zählen animiert hoch.'),
        fieldToggle('sections.roadmap', 'Roadmap'),
        fieldToggle('sections.game', 'Mini-Spiel'),
        fieldToggle('sections.faq', 'FAQ'),
        fieldToggle('sections.social', 'Social-Media-Icons')),
      group('Features',
        fieldI18n('features.title', 'Überschrift'),
        fieldToggle('features.revealBeforeLaunch', 'Schon vor dem Start verraten', 'Aus = Karten sind bis zum Launch geschwärzt 🔒'),
        fieldList('features.items', {
          label: 'Karten',
          addLabel: 'Feature hinzufügen',
          max: 12,
          itemTitle: (it) => `${it.icon || '✨'}  ${tr(it.title) || 'Neues Feature'}`,
          newItem: () => ({ icon: '✨', title: L('Neues Feature', 'New feature'), text: L('', '') }),
          fields: (p) => [fieldEmoji(p + '.icon', 'Icon', { picks: false }), fieldI18n(p + '.title', 'Titel'), fieldI18n(p + '.text', 'Text', { multiline: true })],
        })),
      group('Über uns (Live-Seite)',
        fieldI18n('about.title', 'Überschrift'),
        fieldI18n('about.text', 'Text', { multiline: true, help: '<code>{name}</code> = Projektname. Leerzeilen werden übernommen.' }),
        fieldImage('about.image', 'Bild (optional)', { maxSize: 1200 })),
      group('Zahlen (Live-Seite)',
        fieldList('stats.items', {
          addLabel: 'Zahl hinzufügen',
          max: 8,
          itemTitle: (it) => `${Number(it.value || 0).toLocaleString('de-DE')}${it.suffix || ''} – ${tr(it.label)}`,
          newItem: () => ({ value: 100, suffix: '+', label: L('Neue Zahl', 'New number') }),
          fields: (p) => [
            h('div', { class: 'group-row' }, fieldText(p + '.value', 'Zahl', { type: 'number' }), fieldText(p + '.suffix', 'Zeichen danach', { placeholder: '+ / % / k', max: 4 })),
            fieldI18n(p + '.label', 'Beschriftung'),
          ],
        })),
    ];
  }

  // ---------- Roadmap & FAQ ----------
  function panelRoadmap() {
    return [
      group('Roadmap',
        fieldI18n('roadmap.title', 'Überschrift'),
        fieldList('roadmap.items', {
          addLabel: 'Meilenstein hinzufügen',
          max: 12,
          itemTitle: (it) => `${it.status === 'done' ? '✅' : it.status === 'active' ? '🔵' : '⚪'}  ${it.date ? it.date + ' · ' : ''}${tr(it.title)}`,
          newItem: () => ({ date: '', status: 'planned', title: L('Neuer Meilenstein', 'New milestone'), text: L('', '') }),
          fields: (p) => [
            h('div', { class: 'group-row' },
              fieldText(p + '.date', 'Zeitpunkt', { placeholder: 'z. B. Q1 2027' }),
              fieldSelect(p + '.status', 'Status', [['done', '✅ Erledigt'], ['active', '🔵 In Arbeit'], ['planned', '⚪ Geplant']])),
            fieldI18n(p + '.title', 'Titel'),
            fieldI18n(p + '.text', 'Text', { multiline: true }),
          ],
        })),
      group('FAQ',
        fieldI18n('faq.title', 'Überschrift'),
        fieldList('faq.items', {
          addLabel: 'Frage hinzufügen',
          max: 20,
          itemTitle: (it) => '❓ ' + (tr(it.q) || 'Neue Frage'),
          newItem: () => ({ q: L('Neue Frage?', 'New question?'), a: L('', '') }),
          fields: (p) => [fieldI18n(p + '.q', 'Frage'), fieldI18n(p + '.a', 'Antwort', { multiline: true })],
        })),
    ];
  }

  // ---------- Anmeldung ----------
  function panelSignup() {
    const d = S.draft;
    const endpoint = String(d.signup.endpoint || '').trim();
    return [
      d.signup.enabled && !endpoint
        ? info('<b>⚠️ Demo-Modus:</b> Es ist noch kein Dienst eingetragen. Besucher sehen zwar „Danke!“, aber die E-Mail-Adressen werden <b>nirgends gespeichert</b>.', 'warn')
        : null,
      group('E-Mail-Liste',
        fieldToggle('signup.enabled', 'Anmeldeformular anzeigen', null, { rerender: true }),
        fieldText('signup.endpoint', 'Formular-Adresse (Endpoint)', { type: 'url', placeholder: 'https://formspree.io/f/abcdwxyz', rerender: false, spellcheck: false }),
        info(`<b>So richtest du es ein (kostenlos, ca. 3 Minuten):</b>
          <ol>
            <li>Auf <a href="https://formspree.io" target="_blank" rel="noopener">formspree.io</a> ein Konto erstellen.</li>
            <li>„New Form“ anlegen und einen Namen vergeben.</li>
            <li>Die Adresse kopieren, die so aussieht: <code>https://formspree.io/f/…</code></li>
            <li>Hier oben einfügen und <b>Veröffentlichen</b> klicken.</li>
          </ol>
          Neue Anmeldungen findest du dann im Formspree-Dashboard und bekommst sie auf Wunsch per Mail.
          Es funktioniert jeder Dienst, der JSON per POST annimmt (Feld <code>email</code>).`)),
      group('Texte',
        fieldI18n('signup.button', 'Button'),
        fieldI18n('signup.success', 'Danke-Nachricht'),
        fieldI18n('signup.liveTitle', 'Überschrift auf der Live-Seite'),
        fieldI18n('signup.liveText', 'Text auf der Live-Seite', { multiline: true })),
    ];
  }

  // ---------- Social ----------
  function panelSocial() {
    const types = Object.entries(CS.ICONS).map(([k, v]) => [k, v.label]).sort((a, b) => a[1].localeCompare(b[1]));
    const iconOf = (type) => {
      const ic = CS.ICONS[type] || CS.ICONS.website;
      return h('span', { class: 'li-icon', html: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ic.d}"/></svg>` });
    };
    return [
      group('Deine Kanäle',
        fieldList('social', {
          addLabel: 'Kanal hinzufügen',
          max: 16,
          itemIcon: (it) => iconOf(it.type),
          itemTitle: (it) => `${(CS.ICONS[it.type] || CS.ICONS.website).label}${it.url ? '' : ' – Link fehlt'}`,
          newItem: () => ({ type: 'instagram', url: '' }),
          fields: (p) => [
            fieldSelect(p + '.type', 'Plattform', types, { rerender: true }),
            fieldText(p + '.url', 'Link', { type: 'url', placeholder: 'https://…  (bei E-Mail einfach die Adresse)' }),
          ],
        }),
        help('Einträge ohne Link werden Besuchern nicht angezeigt (in der Vorschau erscheinen sie gestrichelt).')),
    ];
  }

  // ---------- Spiel & Easter Eggs ----------
  function panelFun() {
    const secret = String(S.draft.easterEggs.secretWord || '').trim();
    return [
      group('Mini-Spiel „Asteroid Run“',
        fieldToggle('sections.game', 'Spiel anzeigen'),
        fieldI18n('game.title', 'Name des Spiels'),
        fieldI18n('game.text', 'Beschreibung', { multiline: true }),
        help('Steuerung mit Maus, Finger oder Pfeiltasten. Highscores werden im Browser der Besucher gespeichert.')),
      group('Easter Eggs',
        fieldToggle('easterEggs.enabled', 'Easter Eggs aktiv'),
        fieldText('easterEggs.secretWord', 'Geheimes Wort', { max: 20, help: 'Wer dieses Wort auf der Seite tippt, bekommt deine Nachricht + Konfetti.', rerender: false }),
        fieldI18n('easterEggs.secretMessage', 'Geheime Nachricht'),
        h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'So findet man sie (psst 🤫)' }),
          h('div', { class: 'egg-list', html: `
            <div>🌈 <span><kbd>↑ ↑ ↓ ↓ ← → ← → B A</kbd> – Regenbogen-Sterne</span></div>
            <div>🎉 <span><kbd>party</kbd> tippen – Konfetti-Regen &amp; Disco</span></div>
            <div>🛸 <span><kbd>ufo</kbd> tippen – ein UFO fliegt vorbei</span></div>
            <div>🌌 <span><kbd>warp</kbd> tippen – Hyperraum-Sprung</span></div>
            <div>🔄 <span>5× schnell aufs Logo klicken – Fassrolle</span></div>
            <div>🚀 <span>Auf die Rakete klicken – Probestart</span></div>
            <div>🤫 <span>${secret ? `<kbd>${U.escapeHtml(secret)}</kbd> tippen` : 'Geheimes Wort (oben festlegen)'} – deine Nachricht</span></div>` }))),
    ];
  }

  // ---------- SEO ----------
  function panelSeo() {
    const ogImg = h('img', { alt: 'Vorschaubild', style: 'width:100%;border-radius:10px;border:1px solid var(--line)' });
    CS.images.og(S.draft).then((src) => { ogImg.src = src; }).catch(() => {});
    return [
      group('Google & Link-Vorschau',
        fieldText('seo.title', 'Titel', { help: '<code>{name}</code> = Projektname. Erscheint bei Google und beim Teilen.' }),
        fieldText('seo.description', 'Beschreibung', { multiline: true, help: 'Ideal: 120–160 Zeichen.' }),
        fieldText('seo.siteUrl', 'Adresse der Seite', { type: 'url', placeholder: 'https://name.github.io/repo/', help: 'Wird für die Link-Vorschau gebraucht.' }),
        h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'So sieht dein Link beim Teilen aus' }), ogImg,
          help('Das Bild wird beim Veröffentlichen automatisch neu erzeugt.'))),
      group('Besucherzähler (ohne Cookies)',
        fieldText('analytics.goatcounter', 'GoatCounter-Code', { placeholder: 'z. B. meinprojekt', spellcheck: false, help: 'Der Teil vor <code>.goatcounter.com</code>.' }),
        fieldToggle('analytics.showCounter', 'Besucherzahl im Footer zeigen'),
        info(`<b>Einrichten:</b>
          <ol>
            <li>Kostenlos auf <a href="https://www.goatcounter.com/signup" target="_blank" rel="noopener">goatcounter.com</a> registrieren und einen Code wählen.</li>
            <li>Den Code hier eintragen und veröffentlichen.</li>
            <li>Für die Anzeige im Footer: in GoatCounter unter <i>Settings</i> „Allow adding visitor counts on your website“ aktivieren.</li>
          </ol>
          GoatCounter setzt keine Cookies – du brauchst also keinen Cookie-Banner.`)),
    ];
  }

  // ---------- Sicherheit ----------
  function panelSecurity() {
    const user = h('input', { type: 'text', autocomplete: 'username' });
    user.value = S.draft.admin.user;
    const p1 = h('input', { type: 'password', autocomplete: 'new-password' });
    const p2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const msg = h('p', { class: 'help', role: 'status' });
    const save = async () => {
      const u = user.value.trim();
      if (!u) { msg.textContent = 'Bitte einen Benutzernamen eingeben.'; return; }
      if (p1.value.length < 8) { msg.textContent = 'Das Passwort braucht mindestens 8 Zeichen.'; return; }
      if (p1.value !== p2.value) { msg.textContent = 'Die beiden Passwörter stimmen nicht überein.'; return; }
      try {
        const hash = await U.passHash(u, p1.value);
        S.draft.admin = { user: u, passHash: hash };
        changed({ rerender: true });
        toast('🔒 Gespeichert! Aktiv, sobald du veröffentlichst.', 'success');
      } catch (e) {
        msg.textContent = 'Verschlüsselung nicht verfügbar – bitte über https öffnen.';
      }
    };
    const pending = S.draft.admin.passHash !== S.published.admin.passHash || S.draft.admin.user !== S.published.admin.user;
    return [
      S.published.admin.passHash === DEFAULT_HASH && !pending
        ? info('<b>⚠️ Du nutzt noch das Standard-Passwort <code>12345</code>.</b> Das kennt jeder, der diesen Code liest – ändere es jetzt.', 'danger')
        : null,
      pending ? info('🕒 Neue Zugangsdaten sind gespeichert und werden beim nächsten <b>Veröffentlichen</b> aktiv.', 'warn') : null,
      group('Zugangsdaten ändern',
        h('label', { class: 'field' }, h('span', { text: 'Benutzername' }), user),
        h('label', { class: 'field' }, h('span', { text: 'Neues Passwort' }), p1),
        h('label', { class: 'field' }, h('span', { text: 'Neues Passwort wiederholen' }), p2),
        h('div', { class: 'btn-row' }, h('button', { class: 'a-btn primary', type: 'button', text: 'Speichern', on: { click: save } })),
        msg),
      group('Gut zu wissen',
        info(`Deine Seite ist eine <b>statische Seite</b> (ohne eigenen Server). Der Login hier ist deshalb wie ein Türschild:
          Er hält Neugierige fern, aber jemand mit Technik-Wissen könnte das Panel trotzdem öffnen.<br><br>
          <b>Das ist okay</b>, denn ändern kann deine Seite nur, wer deinen <b>GitHub-Token</b> hat. Der liegt nur in deinem Browser
          und wird nie veröffentlicht. Gib ihn niemals weiter.<br><br>
          Das Passwort wird nur als Prüfsumme (SHA-256) gespeichert – trotzdem gilt: lang und einzigartig wählen.`)),
    ];
  }

  // ---------- Veröffentlichen ----------
  function getToken() { return ls.get(KEY.token) || ss.get(KEY.token) || ''; }

  function pubOpts() {
    try { return Object.assign({ seo: true, images: true }, JSON.parse(ls.get(KEY.pubOpts) || '{}')); } catch (e) { return { seo: true, images: true }; }
  }

  let logEl = null;
  function log(text, kind = '') {
    if (!logEl) return;
    logEl.hidden = false;
    logEl.append(h('div', { class: kind, text }));
    logEl.scrollTop = logEl.scrollHeight;
  }

  function panelPublish() {
    const token = h('input', { id: 'gh-token', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…' });
    token.value = getToken();
    const remember = h('input', { type: 'checkbox', role: 'switch' });
    remember.checked = !!ls.get(KEY.token) || !getToken();
    const storeToken = () => {
      ls.del(KEY.token);
      ss.del(KEY.token);
      if (token.value.trim()) (remember.checked ? ls : ss).set(KEY.token, token.value.trim());
      updateStatus();
    };
    token.addEventListener('input', storeToken);
    remember.addEventListener('change', storeToken);

    const opts = pubOpts();
    const optToggle = (key, label, helpText) => {
      const input = h('input', { type: 'checkbox', role: 'switch' });
      input.checked = !!opts[key];
      input.addEventListener('change', () => { opts[key] = input.checked; ls.set(KEY.pubOpts, JSON.stringify(opts)); });
      return h('label', { class: 'toggle' }, h('span', { class: 't-text' }, h('b', { text: label }), h('span', { class: 'help', text: helpText })), h('span', { class: 'switch' }, input, h('span', { class: 'track' })));
    };

    logEl = h('div', { class: 'log', hidden: true, 'aria-live': 'polite' });
    const importInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    importInput.addEventListener('change', async () => {
      const f = importInput.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        S.draft = U.merge(CS.DEFAULT_CONFIG, data);
        changed({ rerender: true });
        toast('📥 Einstellungen importiert – noch nicht veröffentlicht.', 'success');
      } catch (e) {
        toast('Die Datei ist keine gültige config.json.', 'error');
      }
    });

    return [
      isDirty() ? info('Du hast <b>Änderungen, die noch nicht online sind</b>. Klick auf „Jetzt veröffentlichen“.', 'warn') : info('✓ Alles ist veröffentlicht.'),
      group('Veröffentlichen',
        optToggle('seo', 'Link-Vorschau & App-Daten aktualisieren', 'Titel, Beschreibung und App-Name in index.html / manifest'),
        optToggle('images', 'Vorschaubild & App-Icons neu erzeugen', 'Mit deinem Namen, Logo und deinen Farben'),
        h('button', { class: 'a-btn primary wide', type: 'button', id: 'btn-publish-2', text: '☁️ Jetzt veröffentlichen', on: { click: publish } }),
        logEl),
      group('GitHub-Verbindung',
        h('div', { class: 'group-row' },
          fieldText('github.owner', 'Besitzer (Benutzer/Organisation)', { spellcheck: false }),
          fieldText('github.repo', 'Repository', { spellcheck: false })),
        fieldText('github.branch', 'Branch', { placeholder: 'leer = Standard-Branch des Repos', spellcheck: false, help: 'Der Branch, von dem GitHub Pages deine Seite lädt.' }),
        h('label', { class: 'field', for: 'gh-token' }, h('span', { text: 'Persönlicher Zugriffstoken' }), token,
          help('Wird nur in diesem Browser gespeichert – niemals im Repo.')),
        h('label', { class: 'toggle' }, h('span', { class: 't-text' }, h('b', { text: 'Token auf diesem Gerät merken' }), h('span', { class: 'help', text: 'Aus = nur bis du den Tab schließt.' })), h('span', { class: 'switch' }, remember, h('span', { class: 'track' }))),
        h('div', { class: 'btn-row' }, h('button', { class: 'a-btn', type: 'button', text: '🔌 Verbindung testen', on: { click: testConnection } })),
        info(`<b>Token erstellen (einmalig, 2 Minuten):</b>
          <ol>
            <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com → Fine-grained token erstellen</a></li>
            <li>Name z. B. „Coming Soon Admin“, Ablaufdatum wählen.</li>
            <li><i>Repository access</i>: „Only select repositories“ → dein Repo auswählen.</li>
            <li><i>Permissions → Repository → Contents</i>: <b>Read and write</b>.</li>
            <li>„Generate token“ klicken, Token kopieren und oben einfügen.</li>
          </ol>`)),
      group('Sichern & Wiederherstellen',
        h('div', { class: 'btn-row' },
          h('button', { class: 'a-btn', type: 'button', text: '📤 Exportieren', on: { click: exportConfig } }),
          h('button', { class: 'a-btn', type: 'button', text: '📥 Importieren', on: { click: () => importInput.click() } }),
          importInput),
        h('div', { class: 'btn-row' },
          h('button', { class: 'a-btn danger', type: 'button', text: '↩️ Änderungen verwerfen', disabled: !isDirty(), on: { click: discard } }),
          h('button', { class: 'a-btn danger', type: 'button', text: '🧹 Auf Standard zurücksetzen', on: { click: resetDefaults } })),
        help('„Verwerfen“ holt die zuletzt veröffentlichte Version zurück. „Zurücksetzen“ behält Passwort und GitHub-Daten.')),
    ];
  }

  function exportConfig() {
    const a = h('a', { download: 'config.json' });
    a.href = URL.createObjectURL(new Blob([serialize(S.draft)], { type: 'application/json' }));
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function discard() {
    if (!confirm('Alle nicht veröffentlichten Änderungen verwerfen?')) return;
    S.draft = U.clone(S.published);
    changed({ rerender: true });
    toast('↩️ Zurück zur veröffentlichten Version.');
  }

  function resetDefaults() {
    if (!confirm('Wirklich alles auf die Standard-Einstellungen zurücksetzen? (Passwort und GitHub-Daten bleiben)')) return;
    const keep = { admin: S.draft.admin, github: S.draft.github };
    S.draft = Object.assign(U.clone(CS.DEFAULT_CONFIG), U.clone(keep));
    changed({ rerender: true });
    toast('🧹 Standard wiederhergestellt – noch nicht veröffentlicht.');
  }

  // ---------------------------------------------------------
  //  GitHub
  // ---------------------------------------------------------
  function explain(e) {
    const s = e && e.status;
    if (s === 401) return 'Der Token ist ungültig oder abgelaufen.';
    if (s === 403) return 'Keine Berechtigung. Der Token braucht „Contents: Read and write“ für dieses Repo.';
    if (s === 404) return 'Repo oder Branch nicht gefunden – oder der Token hat keinen Zugriff darauf.';
    if (s === 409) return 'Konflikt: Das Repo ist leer oder wurde gleichzeitig geändert. Bitte nochmal versuchen.';
    if (s === 422) return 'GitHub hat die Änderung abgelehnt (' + (e.message || '422') + ').';
    if (e instanceof TypeError) return 'Keine Verbindung zu GitHub. Bist du online?';
    return 'Fehler: ' + (e && e.message ? e.message : e);
  }

  function api(token) {
    return async function req(method, path, body) {
      const res = await fetch('https://api.github.com' + path, {
        method,
        headers: Object.assign({
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + token,
          'X-GitHub-Api-Version': '2022-11-28',
        }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        let message = String(res.status);
        try { message = (await res.json()).message || message; } catch (e) { /* egal */ }
        const err = new Error(message);
        err.status = res.status;
        throw err;
      }
      return res.status === 204 ? null : res.json();
    };
  }

  const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(String(s).replace(/\s/g, '')), (c) => c.charCodeAt(0)));
  const refPath = (branch) => branch.split('/').map(encodeURIComponent).join('/');
  const repoPath = () => `/repos/${encodeURIComponent(S.draft.github.owner)}/${encodeURIComponent(S.draft.github.repo)}`;

  async function testConnection() {
    const token = getToken();
    if (!token) { toast('Bitte zuerst einen Token eintragen.', 'error'); return; }
    try {
      const req = api(token);
      const repo = await req('GET', repoPath());
      const branch = S.draft.github.branch || repo.default_branch;
      await req('GET', `${repoPath()}/git/ref/heads/${refPath(branch)}`);
      const canPush = !repo.permissions || repo.permissions.push;
      toast(`✓ Verbunden mit ${repo.full_name} (Branch: ${branch})${canPush ? '' : ' – aber ohne Schreibrechte!'}`, canPush ? 'success' : 'error', 5000);
      updateStatus();
      if (S.panel === 'start') showPanel('start', { keepScroll: true });
    } catch (e) {
      toast(explain(e), 'error', 6000);
    }
  }

  let publishing = false;
  async function publish() {
    if (publishing) return;
    const token = getToken();
    if (!token) {
      showPanel('publish');
      toast('Trag zuerst deinen GitHub-Token ein (Anleitung unten).', 'error', 5000);
      setTimeout(() => { const t = $('#gh-token'); if (t) { t.focus(); t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, 50);
      return;
    }
    if (S.panel !== 'publish') showPanel('publish');
    publishing = true;
    const buttons = [$('#btn-publish'), $('#btn-publish-2')].filter(Boolean);
    buttons.forEach((b) => { b.disabled = true; b.classList.add('busy'); });
    if (logEl) logEl.textContent = '';

    const opts = pubOpts();
    const req = api(token);
    const base = repoPath();
    try {
      log(`Verbinde mit ${S.draft.github.owner}/${S.draft.github.repo} …`);
      const repo = await req('GET', base);
      const branch = S.draft.github.branch || repo.default_branch;
      log(`Branch: ${branch}`);
      const ref = await req('GET', `${base}/git/ref/heads/${refPath(branch)}`);
      const parent = ref.object.sha;
      const parentCommit = await req('GET', `${base}/git/commits/${parent}`);

      const cfgText = serialize(S.draft);
      const files = [{ path: 'config.json', content: cfgText }];

      if (opts.seo) {
        log('Aktualisiere Link-Vorschau (index.html, manifest) …');
        try {
          const idx = await req('GET', `${base}/contents/index.html?ref=${encodeURIComponent(branch)}`);
          const html = b64decode(idx.content);
          if (/<!-- SEO:START/.test(html)) files.push({ path: 'index.html', content: U.replaceSeoBlock(html, S.draft) });
          else log('⚠ Keine SEO-Markierung in index.html gefunden – übersprungen.');
        } catch (e) {
          if (e.status !== 404) throw e;
          log('⚠ index.html nicht gefunden – übersprungen.');
        }
        files.push({ path: 'manifest.webmanifest', content: CS.images.manifest(S.draft) });
      }

      if (opts.images) {
        log('Erzeuge Vorschaubild & App-Icons …');
        const imgs = await CS.images.all(S.draft);
        for (const [path, dataUrl] of Object.entries(imgs)) {
          const blob = await req('POST', `${base}/git/blobs`, { content: dataUrl.split(',')[1], encoding: 'base64' });
          files.push({ path, sha: blob.sha });
        }
      }

      log('Erstelle Commit …');
      const tree = await req('POST', `${base}/git/trees`, {
        base_tree: parentCommit.tree.sha,
        tree: files.map((f) => (f.sha
          ? { path: f.path, mode: '100644', type: 'blob', sha: f.sha }
          : { path: f.path, mode: '100644', type: 'blob', content: f.content })),
      });

      if (tree.sha === parentCommit.tree.sha) {
        log('✓ Keine Änderungen – online ist schon alles aktuell.', 'ok');
      } else {
        const commit = await req('POST', `${base}/git/commits`, {
          message: 'Admin-Panel: Seite aktualisiert 🚀',
          tree: tree.sha,
          parents: [parent],
        });
        await req('PATCH', `${base}/git/refs/heads/${refPath(branch)}`, { sha: commit.sha });
        log(`✓ Veröffentlicht! (Commit ${commit.sha.slice(0, 7)})`, 'ok');
        log('GitHub Pages braucht meist 1–2 Minuten, bis alles online ist.');
      }

      S.published = U.clone(S.draft);
      S.publishedText = cfgText;
      ss.set(KEY.session, S.published.admin.passHash);
      ls.set(KEY.draft, JSON.stringify(S.draft));
      updateStatus();
      toast('🎉 Veröffentlicht! In 1–2 Minuten ist alles online.', 'success', 5000);
    } catch (e) {
      log('✗ ' + explain(e), 'err');
      toast(explain(e), 'error', 6000);
    } finally {
      publishing = false;
      buttons.forEach((b) => { b.disabled = false; b.classList.remove('busy'); });
    }
  }

  // ---------------------------------------------------------
  //  Navigation & Panels
  // ---------------------------------------------------------
  function buildNav() {
    const nav = $('#nav');
    nav.textContent = '';
    for (const p of PANELS) {
      nav.append(h('button', {
        type: 'button', 'data-panel': p.id,
        on: { click: () => { showPanel(p.id); setView('edit'); } },
      }, h('span', { class: 'nav-icon', text: p.icon }), h('span', { text: p.title })));
    }
  }

  function runTickers() { S.tickers.forEach((fn) => fn()); }

  function showPanel(id, { keepScroll = false } = {}) {
    const panel = PANELS.find((p) => p.id === id) || PANELS[0];
    const editor = $('#editor');
    const scroll = editor.scrollTop;
    const active = document.activeElement;
    const activeLabel = active && active.getAttribute && active.getAttribute('aria-label');
    S.panel = panel.id;
    S.tickers = [];
    ls.set(KEY.panel, panel.id);
    $$('#nav button').forEach((b) => b.removeAttribute('aria-current'));
    const navBtn = $(`#nav button[data-panel="${panel.id}"]`);
    if (navBtn) navBtn.setAttribute('aria-current', 'page');

    editor.textContent = '';
    editor.append(h('div', { class: 'panel-head' }, h('h2', null, h('span', { text: panel.icon }), h('span', { text: panel.title })), h('p', { text: panel.desc })));
    editor.append(...panel.render().filter(Boolean));
    editor.scrollTop = keepScroll ? scroll : 0;
    if (keepScroll && activeLabel) {
      const again = editor.querySelector(`[aria-label="${CSS.escape(activeLabel)}"]`);
      if (again) again.focus();
    }
    runTickers();
  }

  function setView(view) {
    $('#layout').dataset.view = view;
    $$('.a-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === view)));
  }

  // ---------------------------------------------------------
  //  Vorschau-Leiste
  // ---------------------------------------------------------
  function segSelect(seg, attr, value) {
    $$(`#${seg} button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
  }

  function launchTest() {
    S.previewMode = 'live';
    segSelect('mode-seg', 'mode', 'live');
    setView('preview');
    sendToPreview({ type: 'cs:launch-test' });
  }

  function setupPreviewBar() {
    $$('#device-seg button').forEach((b) => b.addEventListener('click', () => {
      segSelect('device-seg', 'device', b.dataset.device);
      $('#frame-wrap').classList.toggle('mobile', b.dataset.device === 'mobile');
    }));
    $$('#mode-seg button').forEach((b) => b.addEventListener('click', () => {
      S.previewMode = b.dataset.mode;
      segSelect('mode-seg', 'mode', S.previewMode);
      sendToPreview({ type: 'cs:force-mode', mode: S.previewMode || null });
    }));
    $$('#lang-seg button').forEach((b) => b.addEventListener('click', () => {
      S.previewLang = b.dataset.lang;
      segSelect('lang-seg', 'lang', S.previewLang);
      sendToPreview({ type: 'cs:lang', lang: S.previewLang });
    }));
    $('#btn-launch-test').addEventListener('click', launchTest);
    $('#btn-reload').addEventListener('click', () => { $('#preview').src = 'index.html?preview=1&r=' + Date.now(); });
    $('#preview').addEventListener('load', () => {
      sendPreview();
      sendToPreview({ type: 'cs:lang', lang: S.previewLang });
      if (S.previewMode) sendToPreview({ type: 'cs:force-mode', mode: S.previewMode });
    });
    $$('.a-tabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  }

  // ---------------------------------------------------------
  //  Login
  // ---------------------------------------------------------
  function lockedFor() {
    const until = Number(ls.get(KEY.lock) || 0);
    return Math.max(0, until - Date.now());
  }

  function setupLogin() {
    const form = $('#login-form');
    const err = $('#login-error');
    let fails = 0;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const wait = lockedFor();
      if (wait) { err.textContent = `Zu viele Versuche – bitte ${Math.ceil(wait / 1000)} Sekunden warten.`; return; }
      const user = $('#login-user').value.trim();
      const pass = $('#login-pass').value;
      let ok = false;
      try {
        const hash = await U.passHash(user, pass);
        ok = user === S.published.admin.user && hash === S.published.admin.passHash;
      } catch (ex) {
        err.textContent = 'Dein Browser erlaubt hier keine Verschlüsselung. Öffne die Seite über https:// oder localhost.';
        return;
      }
      if (ok) {
        ss.set(KEY.session, S.published.admin.passHash);
        ls.del(KEY.lock);
        enterApp();
      } else {
        fails++;
        err.textContent = 'Benutzername oder Passwort falsch.';
        form.classList.remove('shake');
        void form.offsetWidth;
        form.classList.add('shake');
        $('#login-pass').select();
        if (fails >= 5) { ls.set(KEY.lock, String(Date.now() + 30000)); fails = 0; err.textContent = 'Zu viele Versuche – bitte 30 Sekunden warten.'; }
      }
    });
  }

  // ---------------------------------------------------------
  //  Start
  // ---------------------------------------------------------
  async function loadPublished() {
    try {
      const res = await fetch('config.json?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) return U.merge(CS.DEFAULT_CONFIG, await res.json());
    } catch (e) { /* lokal ohne Server */ }
    return U.clone(CS.DEFAULT_CONFIG);
  }

  function enterApp() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    document.title = 'Admin – ' + (S.published.brand.name || 'Coming Soon');

    let restored = null;
    try {
      const d = ls.get(KEY.draft);
      if (d) restored = U.merge(CS.DEFAULT_CONFIG, JSON.parse(d));
    } catch (e) { /* kaputter Entwurf */ }
    S.draft = restored || U.clone(S.published);
    if (restored && isDirty()) toast('💾 Deine nicht veröffentlichten Änderungen von letztem Mal sind wieder da.', '', 4500);

    ls.set(KEY.preview, JSON.stringify(S.draft));
    S.previewLang = S.draft.defaultLang === 'en' ? 'en' : 'de';
    segSelect('lang-seg', 'lang', S.previewLang);
    buildNav();
    setupPreviewBar();
    showPanel(ls.get(KEY.panel) || 'start');
    updateStatus();
    applyAdminTheme();
    $('#preview').src = 'index.html?preview=1';

    $('#btn-publish').addEventListener('click', publish);
    $('#btn-logout').addEventListener('click', () => { ss.del(KEY.session); location.reload(); });
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); publish(); }
    });
    setInterval(runTickers, 1000);
  }

  async function boot() {
    S.published = await loadPublished();
    S.publishedText = serialize(S.published);
    setupLogin();
    if (ss.get(KEY.session) === S.published.admin.passHash) enterApp();
    else if (!document.activeElement || document.activeElement === document.body) $('#login-user').focus();
  }

  boot();
})();
