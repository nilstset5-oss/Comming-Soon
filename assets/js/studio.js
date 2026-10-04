/* =========================================================
   Studio – das Admin-Panel direkt auf der Seite.
   Änderungen erscheinen sofort live dahinter.

   Als Artifact: nur für Besitzer/Bearbeiter sichtbar, Veröffentlichen
   mit einem Klick (ohne Token, ohne Passwort).
   Als statische Seite (GitHub Pages): Login + GitHub-Token.
   ========================================================= */
(function () {
  'use strict';
  const CS = window.CS;
  const U = CS.util;
  const B = CS.backend;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const ART = B.kind === 'artifact';

  const KEY = {
    draft: 'cs-studio-draft',
    session: 'cs-admin-session',
    lock: 'cs-admin-lock',
    token: 'cs-gh-token',
    panel: 'cs-studio-panel',
    reopen: 'cs-studio-reopen',
    published: 'cs-studio-published',
    pubOpts: 'cs-admin-publish-opts',
    wizard: 'cs-studio-wizard-done',
    all: 'cs-studio-show-all',
    tip: 'cs-studio-inline-tip',
  };
  const DEFAULT_HASH = CS.DEFAULT_CONFIG.admin.passHash;
  const DEFAULT_GITHUB_URL = CS.DEFAULT_CONFIG.social[0].url;

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* voll */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* egal */ } },
  };
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* egal */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* egal */ } },
  };

  const S = {
    enabled: false,
    isOpen: false,
    built: false,
    draft: null,
    published: null,
    publishedText: '',
    lastState: '',
    lastSnapAt: 0,
    history: [],
    future: [],
    panel: 'overview',
    openItems: {},
    tickers: [],
    previewMode: '',
    signups: null,
    scores: null,
    listeners: [],
    unsubs: [],
    collapsed: false,
  };

  const serialize = (cfg) => JSON.stringify(cfg, null, 2) + '\n';
  const isDirty = () => !!S.draft && serialize(S.draft) !== S.publishedText;
  const val = (path) => U.get(S.draft, path);
  const L = (de = '', en = '') => ({ de, en });
  const tr = (f) => U.tr(f, 'de', { name: S.draft.brand.name });

  // ---------------------------------------------------------
  //  DOM-Helfer
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

  const toast = (text, ms) => CS.fx.toast(text, ms || 3200);

  // Zwei-Klick-Bestätigung (Dialoge wie confirm() gibt es nicht überall)
  function confirmButton(label, confirmLabel, onConfirm, cls = 'st-btn danger') {
    const b = h('button', { class: cls, type: 'button', text: label });
    let armed = 0;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (armed) {
        clearTimeout(armed);
        armed = 0;
        b.textContent = label;
        b.classList.remove('armed');
        onConfirm();
        return;
      }
      b.textContent = confirmLabel;
      b.classList.add('armed');
      armed = setTimeout(() => { armed = 0; b.textContent = label; b.classList.remove('armed'); }, 3500);
    });
    return b;
  }

  // ---------------------------------------------------------
  //  Änderungen, Verlauf, Live-Vorschau
  // ---------------------------------------------------------
  let applyTimer = 0;

  function snapshotBefore() {
    const now = Date.now();
    if (now - S.lastSnapAt > 700 && S.lastState) {
      S.history.push(S.lastState);
      if (S.history.length > 120) S.history.shift();
      S.future = [];
    }
    S.lastSnapAt = now;
  }

  function set(path, value, opts = {}) {
    snapshotBefore();
    U.set(S.draft, path, value);
    commit(opts);
  }

  function replaceDraft(next, opts = {}) {
    snapshotBefore();
    S.lastSnapAt = 0;
    S.draft = next;
    commit(Object.assign({ rerender: true }, opts));
  }

  function commit({ rerender = false } = {}) {
    S.lastState = JSON.stringify(S.draft);
    ls.set(KEY.draft, JSON.stringify({ base: S.publishedText, draft: S.draft }));
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => CS.site.applyConfig(S.draft), 60);
    updateStatus();
    if (rerender) showPanel(S.panel, { keepScroll: true });
    else runTickers();
  }

  function undo() {
    if (!S.history.length) return;
    S.future.push(S.lastState);
    S.draft = JSON.parse(S.history.pop());
    S.lastSnapAt = 0;
    commit({ rerender: true });
    toast('↶ Rückgängig gemacht', 1400);
  }

  function redo() {
    if (!S.future.length) return;
    S.history.push(S.lastState);
    S.draft = JSON.parse(S.future.pop());
    S.lastSnapAt = 0;
    commit({ rerender: true });
    toast('↷ Wiederhergestellt', 1400);
  }

  function updateStatus() {
    if (!S.built) return;
    const dirty = isDirty();
    const st = $('#st-status');
    st.textContent = '';
    st.append(dirty
      ? h('span', { class: 'st-pill dirty', text: '● Entwurf – noch nicht veröffentlicht' })
      : h('span', { class: 'st-pill clean', text: '✓ Alles veröffentlicht' }));
    if (!ART && S.published.admin.passHash === DEFAULT_HASH) {
      st.append(h('button', { class: 'st-pill warn', type: 'button', text: '⚠️ Standard-Passwort', on: { click: () => showPanel('security') } }));
    }
    $('#st-undo').disabled = !S.history.length;
    $('#st-redo').disabled = !S.future.length;
    $$('.st-publish').forEach((b) => b.classList.toggle('pulse', dirty));
    $('#st-sub').textContent = S.draft.brand.name || '';
  }

  // ---------------------------------------------------------
  //  Direkt auf der Seite bearbeiten (Text anklicken & tippen)
  // ---------------------------------------------------------
  let inline = null;

  function setQuiet(path, value) {
    snapshotBefore();
    U.set(S.draft, path, value);
    S.lastState = JSON.stringify(S.draft);
    ls.set(KEY.draft, JSON.stringify({ base: S.publishedText, draft: S.draft }));
    updateStatus();
  }

  function startInline(node) {
    if (inline) inline.blur();
    const path = node.dataset.edit;
    const i18n = node.dataset.editI18n !== '0';
    const multi = node.dataset.editMulti === '1';
    const full = i18n ? path + '.' + CS.site.getLang() : path;
    const current = U.get(S.draft, full);
    const original = current == null ? '' : String(current);
    node.textContent = original;
    node.setAttribute('contenteditable', 'plaintext-only');
    if (node.contentEditable !== 'plaintext-only') node.setAttribute('contenteditable', 'true');
    node.setAttribute('spellcheck', 'true');
    node.classList.add('editing');
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    let cancel = false;
    const read = () => {
      let v = node.innerText.replace(/\u00a0/g, ' ').replace(/\n$/, '');
      if (!multi) v = v.replace(/\s*\n\s*/g, ' ');
      return v;
    };
    const onInput = () => setQuiet(full, read());
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel = true; node.blur(); }
      else if (e.key === 'Enter' && (!multi || e.ctrlKey || e.metaKey)) { e.preventDefault(); node.blur(); }
    };
    const onBlur = () => {
      node.removeEventListener('input', onInput);
      node.removeEventListener('keydown', onKey);
      node.removeEventListener('blur', onBlur);
      node.removeAttribute('contenteditable');
      node.classList.remove('editing');
      inline = null;
      if (cancel) setQuiet(full, original);
      CS.site.applyConfig(S.draft);
      if (S.isOpen) showPanel(S.panel, { keepScroll: true });
    };
    node.addEventListener('input', onInput);
    node.addEventListener('keydown', onKey);
    node.addEventListener('blur', onBlur);
    inline = node;
    if (!ls.get(KEY.tip)) {
      ls.set(KEY.tip, '1');
      toast(multi ? '✏️ Schreib los – Strg+Enter oder daneben klicken übernimmt, Esc bricht ab.' : '✏️ Schreib los – Enter übernimmt, Esc bricht ab.', 4500);
    }
  }

  function onPageClick(e) {
    if (!S.isOpen || !e.target.closest) return;
    const node = e.target.closest('[data-edit]');
    if (!node || node.closest('#studio')) return;
    // Links, Aufklapper & Co. sollen beim Bearbeiten nicht reagieren
    e.preventDefault();
    if (node.isContentEditable) return;
    e.stopPropagation();
    startInline(node);
  }

  // ---------------------------------------------------------
  //  Feld-Bausteine
  // ---------------------------------------------------------
  let uid = 0;
  const nextId = () => 'st-f' + ++uid;

  const group = (title, ...children) => h('section', { class: 'st-group' }, title ? h('h3', { text: title }) : null, ...children);
  const info = (html, kind = '') => h('div', { class: 'st-info ' + kind, html });
  const help = (text) => (text ? h('div', { class: 'st-help', html: text }) : null);

  function fieldText(path, label, o = {}) {
    const id = nextId();
    const input = h(o.multiline ? 'textarea' : 'input', {
      id,
      type: o.multiline ? null : o.type || 'text',
      placeholder: o.placeholder || '',
      maxLength: o.max || null,
      autocomplete: 'off',
      spellcheck: o.spellcheck === false ? 'false' : null,
    });
    input.value = val(path) == null ? '' : val(path);
    input.addEventListener('input', () => {
      let v = input.value;
      if (o.type === 'number') v = v === '' ? 0 : Number(v);
      set(path, v, { rerender: !!o.rerender });
    });
    return h('label', { class: 'st-field', for: id }, h('span', { text: label }), input, help(o.help));
  }

  function fieldI18n(path, label, o = {}) {
    const rows = ['de', 'en'].map((lang) => {
      const input = h(o.multiline ? 'textarea' : 'input', { type: o.multiline ? null : 'text', placeholder: o.placeholder || '', 'aria-label': `${label} (${lang.toUpperCase()})` });
      input.value = val(path + '.' + lang) || '';
      input.addEventListener('input', () => set(path + '.' + lang, input.value));
      input.addEventListener('focus', () => { if (CS.site.getLang() !== lang) { CS.site.setLang(lang); syncSegs(); } });
      return h('div', { class: 'st-i18n-row' }, h('span', { class: 'st-flag', text: lang.toUpperCase() }), input);
    });
    return h('div', { class: 'st-field' }, h('span', { class: 'st-label', text: label }), h('div', { class: 'st-i18n' }, rows), help(o.help));
  }

  function switchEl(checked, onChange) {
    const input = h('input', { type: 'checkbox', role: 'switch' });
    input.checked = !!checked;
    input.addEventListener('change', () => onChange(input.checked));
    return h('span', { class: 'st-switch' }, input, h('span', { class: 'st-track' }));
  }

  function fieldToggle(path, label, helpText, o = {}) {
    return h('label', { class: 'st-toggle' },
      h('span', { class: 'st-t-text' }, h('b', { text: label }), helpText ? h('span', { class: 'st-help', html: helpText }) : null),
      switchEl(val(path), (v) => set(path, v, { rerender: !!o.rerender })));
  }

  function fieldSelect(path, label, options, o = {}) {
    const id = nextId();
    const sel = h('select', { id }, options.map(([v, l]) => h('option', { value: v, text: l })));
    sel.value = val(path);
    sel.addEventListener('change', () => set(path, sel.value, { rerender: !!o.rerender }));
    return h('label', { class: 'st-field', for: id }, h('span', { text: label }), sel, help(o.help));
  }

  function fieldRange(path, label, min, max, step, fmt = (v) => v) {
    const id = nextId();
    const input = h('input', { id, type: 'range', min, max, step });
    input.value = val(path);
    const out = h('output', { for: id, text: fmt(Number(input.value)) });
    input.addEventListener('input', () => { out.textContent = fmt(Number(input.value)); set(path, Number(input.value)); });
    return h('label', { class: 'st-field', for: id }, h('span', { text: label }), h('div', { class: 'st-range' }, input, out));
  }

  function fieldColor(path, label, onChange) {
    const color = h('input', { type: 'color', 'aria-label': label });
    const text = h('input', { type: 'text', maxLength: 7, spellcheck: 'false', 'aria-label': label + ' (Hex)' });
    color.value = text.value = val(path);
    color.addEventListener('input', () => { text.value = color.value; onChange && onChange(); set(path, color.value); });
    text.addEventListener('input', () => {
      if (/^#[0-9a-f]{6}$/i.test(text.value)) { color.value = text.value; onChange && onChange(); set(path, text.value.toLowerCase()); }
    });
    return h('div', { class: 'st-field' }, h('span', { class: 'st-label', text: label }), h('div', { class: 'st-color' }, color, text));
  }

  const EMOJIS = ['🚀', '🪐', '🌙', '⭐', '✨', '🔥', '💎', '🎮', '🎵', '🌈', '⚡', '🦄', '👾', '🛸', '🍀', '❤️', '🎨', '📱', '🤖', '🏆', '🎬', '🛍️', '🎉', '☕'];

  function fieldEmoji(path, label, o = {}) {
    const id = nextId();
    const input = h('input', { id, type: 'text', maxLength: 16 });
    input.value = val(path) || '';
    input.addEventListener('input', () => set(path, input.value));
    const picks = h('div', { class: 'st-emojis' }, EMOJIS.map((e) => h('button', {
      type: 'button', text: e, 'aria-label': 'Emoji ' + e,
      on: { click: () => { input.value = e; set(path, e); input.dispatchEvent(new Event('change', { bubbles: true })); } },
    })));
    return h('label', { class: 'st-field', for: id }, h('span', { text: label }), input, o.picks === false ? null : picks, help(o.help));
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
    const wrap = h('div', { class: 'st-field st-image' }, h('span', { class: 'st-label', text: label }));
    const render = () => {
      while (wrap.children.length > 1) wrap.lastChild.remove();
      const src = val(path);
      const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml', hidden: true });
      file.addEventListener('change', async () => {
        const f = file.files[0];
        if (!f) return;
        try {
          const data = await resizeImage(f, o.maxSize || 512);
          if (data.length > 600000) toast('Das Bild ist ziemlich groß – kleinere Bilder laden schneller.');
          set(path, data);
          render();
        } catch (e) {
          toast('Das Bild konnte nicht gelesen werden. Versuch PNG oder JPG.');
        }
      });
      const urlInput = h('input', { type: 'url', placeholder: ART ? 'Bild hochladen ↑' : 'https://… (oder Bild hochladen)', 'aria-label': label + ' – Link' });
      urlInput.value = src && !String(src).startsWith('data:') ? src : '';
      urlInput.addEventListener('change', () => { set(path, urlInput.value.trim()); render(); });
      wrap.append(
        h('div', { class: 'st-image-box' },
          src ? h('img', { src: U.safeUrl(src, { allowData: true }), alt: '' }) : h('span', { class: 'st-help', text: 'Noch kein Bild' }),
          h('div', { class: 'st-row' },
            h('button', { class: 'st-btn small', type: 'button', text: '📁 Hochladen', on: { click: () => file.click() } }),
            src ? h('button', { class: 'st-btn small danger', type: 'button', text: 'Entfernen', on: { click: () => { set(path, ''); render(); } } }) : null)),
        file, ART ? null : urlInput, help(o.help));
    };
    render();
    return wrap;
  }

  function fieldList(path, o) {
    const wrap = h('div', { class: 'st-field' });
    if (o.label) wrap.append(h('span', { class: 'st-label', text: o.label }));
    const list = h('div', { class: 'st-list' });
    const items = val(path) || [];
    const open = (S.openItems[path] = S.openItems[path] || new Set());

    items.forEach((item, i) => {
      const itemPath = path + '.' + i;
      const titleEl = h('span', { class: 'st-li-title', text: o.itemTitle(item, i) });
      const move = (dir) => (e) => {
        e.preventDefault();
        e.stopPropagation();
        const arr = val(path);
        const j = i + dir;
        if (j < 0 || j >= arr.length) return;
        snapshotBefore();
        [arr[i], arr[j]] = [arr[j], arr[i]];
        const a = open.has(i), b = open.has(j);
        open.delete(i); open.delete(j);
        if (a) open.add(j);
        if (b) open.add(i);
        commit({ rerender: true });
      };
      const del = confirmButton('✕', 'Löschen?', () => {
        snapshotBefore();
        val(path).splice(i, 1);
        S.openItems[path] = new Set(Array.from(open).filter((k) => k !== i).map((k) => (k > i ? k - 1 : k)));
        commit({ rerender: true });
      }, 'st-li-del');
      del.title = 'Löschen';
      const details = h('details', { class: 'st-li', open: open.has(i) },
        h('summary', null,
          o.itemIcon ? o.itemIcon(item) : null,
          titleEl,
          h('span', { class: 'st-li-tools' },
            h('button', { type: 'button', title: 'Nach oben', 'aria-label': 'Nach oben', text: '↑', on: { click: move(-1) } }),
            h('button', { type: 'button', title: 'Nach unten', 'aria-label': 'Nach unten', text: '↓', on: { click: move(1) } }),
            del)),
        h('div', { class: 'st-li-body' }, o.fields(itemPath, item)));
      details.addEventListener('toggle', () => { if (details.open) open.add(i); else open.delete(i); });
      const retitle = () => { titleEl.textContent = o.itemTitle(val(itemPath) || {}, i); };
      details.addEventListener('input', retitle);
      details.addEventListener('change', retitle);
      list.append(details);
    });

    const add = h('button', {
      class: 'st-btn small', type: 'button', text: '＋ ' + (o.addLabel || 'Hinzufügen'),
      on: { click: () => {
        snapshotBefore();
        const arr = val(path) || [];
        arr.push(o.newItem());
        U.set(S.draft, path, arr);
        open.add(arr.length - 1);
        commit({ rerender: true });
      } },
    });
    if (o.max && items.length >= o.max) add.disabled = true;
    wrap.append(list, h('div', null, add));
    return wrap;
  }

  // ---------------------------------------------------------
  //  Daten aus der Datenbank (nur Artifact)
  // ---------------------------------------------------------
  function watchData() {
    if (!ART || S.unsubs.length) return;
    const a = B.watchSignups((rows) => { S.signups = rows; notify(); }, () => { S.signups = S.signups || []; notify(); });
    const b = B.watchScores((rows) => { S.scores = rows; notify(); });
    S.unsubs = [a, b].filter(Boolean);
  }

  function stopWatching() {
    S.unsubs.forEach((u) => { try { u(); } catch (e) { /* egal */ } });
    S.unsubs = [];
  }

  function notify() { S.listeners.forEach((fn) => fn()); }

  // ---------------------------------------------------------
  //  Panels
  // ---------------------------------------------------------
  const TIMEZONES = [
    ['Europe/Berlin', 'Deutschland (Berlin)'], ['Europe/Vienna', 'Österreich (Wien)'], ['Europe/Zurich', 'Schweiz (Zürich)'],
    ['Europe/London', 'UK (London)'], ['America/New_York', 'USA Ost (New York)'], ['America/Los_Angeles', 'USA West (Los Angeles)'],
    ['Asia/Tokyo', 'Japan (Tokio)'], ['UTC', 'UTC'],
  ];

  function fmtDuration(ms) {
    if (!Number.isFinite(ms)) return '–';
    if (ms <= 0) return 'gestartet';
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

  const fmtDate = (ts) => new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ts));

  function getToken() { return ls.get(KEY.token) || ss.get(KEY.token) || ''; }

  const CHECKS = [
    { label: 'Projektname festlegen', panel: 'content', done: (d) => d.brand.name && d.brand.name !== 'NOVA' },
    { label: 'Texte anpassen (oder Vorlage/KI nutzen)', panel: 'templates', done: (d) => tr(d.soon.text) !== tr(CS.DEFAULT_CONFIG.soon.text) },
    { label: 'Startdatum in der Zukunft', panel: 'schedule', done: (d) => d.mode === 'live' || U.launchTime(d) > Date.now() },
    { label: 'Social-Media-Links eintragen', panel: 'social', done: (d) => (d.social || []).some((s) => s.url && s.url !== DEFAULT_GITHUB_URL) },
    ART
      ? { label: 'Link zum Teilen eintragen', panel: 'seo', done: (d) => !!String(d.seo.siteUrl || '').trim() && !/github\.io/.test(d.seo.siteUrl) }
      : { label: 'E-Mail-Anmeldung einrichten', panel: 'signups', done: (d) => !d.signup.enabled || !!String(d.signup.endpoint || '').trim() },
    ART ? null : { label: 'Admin-Passwort ändern', panel: 'security', done: (d) => d.admin.passHash !== DEFAULT_HASH },
    ART ? null : { label: 'Mit GitHub verbinden', panel: 'publish', done: () => !!getToken() },
  ].filter(Boolean);

  const PANELS = [
    { id: 'overview', icon: '🏠', title: 'Übersicht', desc: 'Alles Wichtige auf einen Blick.', render: panelOverview },
    { id: 'wizard', icon: '🧙', title: 'Schnellstart', desc: 'In drei Schritten zu deiner Seite.', render: panelWizard },
    { id: 'templates', icon: '✨', title: 'Vorlagen & KI', desc: 'In Sekunden zu passenden Texten und Farben.', render: panelTemplates },
    { id: 'content', icon: '✏️', title: 'Texte & Marke', desc: 'Tipp: Du kannst auch direkt auf der Seite auf einen Text klicken.', render: panelContent },
    { id: 'design', icon: '🎨', title: 'Design', desc: 'Farben, Sterne, Rakete, Sound und Live-Effekte.', render: panelDesign },
    { id: 'schedule', icon: '🗓️', title: 'Zeitplan', desc: 'Wann deine Seite live geht.', render: panelSchedule },
    { id: 'ai', icon: '🤖', title: 'KI-Chat', desc: 'Nach dem Start beantwortet eine KI die Fragen deiner Besucher.', render: panelAi },
    { id: 'signups', icon: '📧', title: 'Anmel\u00addungen', desc: 'Wer beim Start Bescheid bekommen will.', render: panelSignups },
    { id: 'publish', icon: '☁️', title: 'Veröffent\u00adlichen', desc: 'Online stellen, sichern, wiederherstellen.', render: panelPublish },
    { id: 'sections', adv: true, icon: '🧩', title: 'Bereiche', desc: 'Welche Abschnitte es gibt und was drinsteht.', render: panelSections },
    { id: 'roadmap', adv: true, icon: '🗺️', title: 'Roadmap & FAQ', desc: 'Zeitplan und häufige Fragen.', render: panelRoadmap },
    { id: 'social', adv: true, icon: '🔗', title: 'Social Media', desc: 'Links zu deinen Kanälen.', render: panelSocial },
    { id: 'fun', adv: true, icon: '🎮', title: 'Spiel & Eggs', desc: 'Mini-Spiel, Bestenliste und versteckte Überraschungen.', render: panelFun },
    { id: 'seo', adv: true, icon: '📣', title: 'Teilen & SEO', desc: 'Dein Link, Vorschaubild und Statistik.', render: panelSeo },
    { id: 'security', adv: true, icon: '🔒', title: 'Zugang', desc: 'Wer dieses Studio benutzen darf.', render: panelSecurity },
  ];

  // ---------- Übersicht ----------
  function statBox(valueEl, label) {
    return h('div', { class: 'st-stat' }, valueEl, h('div', { class: 'st-stat-l', text: label }));
  }

  function panelOverview() {
    const d = S.draft;
    const mode = h('div', { class: 'st-stat-v' });
    const countdown = h('div', { class: 'st-stat-v' });
    const signups = h('div', { class: 'st-stat-v', text: ART ? '…' : '–' });
    const players = h('div', { class: 'st-stat-v', text: ART ? '…' : '–' });
    S.tickers.push(() => {
      mode.textContent = U.currentMode(S.draft) === 'live' ? '🚀 Live' : '⏳ Bald';
      countdown.textContent = fmtDuration(U.launchTime(S.draft) - Date.now());
    });
    const fill = () => {
      if (!ART) return;
      signups.textContent = S.signups ? S.signups.length.toLocaleString('de-DE') : '…';
      players.textContent = S.scores ? S.scores.length.toLocaleString('de-DE') : '…';
    };
    S.listeners.push(fill);
    fill();

    const doneCount = CHECKS.filter((c) => c.done(d)).length;
    const checklist = h('ul', { class: 'st-checklist' }, CHECKS.map((c) => {
      const ok = !!c.done(d);
      return h('li', { class: ok ? 'done' : 'todo' },
        h('button', { type: 'button', on: { click: () => showPanel(c.panel) } },
          h('span', { class: 'st-ck', text: ok ? '✓' : '' }), h('span', { class: 'st-ck-text', text: c.label }), h('span', { class: 'st-ck-go', text: '›' })));
    }));

    return [
      group(null,
        h('div', { class: 'st-stats' },
          statBox(mode, 'Modus'),
          statBox(countdown, 'bis zum Start'),
          statBox(signups, 'Anmeldungen'),
          statBox(players, 'Spieler in der Bestenliste'))),
      group('Schnellstart',
        h('div', { class: 'st-quick' },
          quickTile('🧙', 'Schnellstart', 'Name, Thema, Startdatum – in 3 Schritten', () => { WIZ.step = 1; showPanel('wizard'); }),
          quickTile('🚀', 'Launch-Show testen', 'So sieht der große Moment aus', launchTest),
          quickTile('🤖', 'KI-Chat', 'Persönlichkeit & Wissen deiner KI', () => showPanel('ai')),
          quickTile('📧', 'Anmeldungen', ART ? 'Liste ansehen & exportieren' : 'E-Mail-Liste einrichten', () => showPanel('signups'))),
        info('✏️ <b>Tipp:</b> Klick direkt auf einen Text auf der Seite und schreib los. <kbd>Enter</kbd> übernimmt, <kbd>Esc</kbd> bricht ab.')),
      group(`Einrichtung · ${doneCount}/${CHECKS.length}`,
        h('div', { class: 'st-progress' }, h('div', { style: `width:${Math.round((doneCount / CHECKS.length) * 100)}%` })),
        checklist),
      group('Tastenkürzel',
        h('div', { class: 'st-keys', html: '<kbd>Strg</kbd>+<kbd>S</kbd> veröffentlichen · <kbd>Strg</kbd>+<kbd>Z</kbd> rückgängig · <kbd>Esc</kbd> Studio schließen' })),
    ];
  }

  function quickTile(icon, title, text, fn) {
    return h('button', { class: 'st-tile', type: 'button', on: { click: fn } },
      h('span', { class: 'st-tile-i', text: icon }), h('b', { text: title }), h('small', { text: text }));
  }

  // ---------- Vorlagen & KI ----------
  function applyPreset(key, { keepEmoji = false } = {}) {
    const p = CS.PRESETS[key];
    if (!p) return;
    const next = U.merge(S.draft, p.patch);
    if (keepEmoji) next.brand.logoEmoji = S.draft.brand.logoEmoji;
    const th = CS.THEMES[p.theme];
    if (th) { const { label, ...colors } = th; next.theme = Object.assign({ preset: p.theme }, colors); }
    replaceDraft(next, { rerender: false });
    toast(`${p.icon} Vorlage „${p.label}“ übernommen – mit ↶ rückgängig machen.`, 4000);
  }

  let aiCtl = null;

  function panelTemplates() {
    const out = [];

    // KI-Assistent
    const aiGroup = group('✨ KI-Assistent');
    out.push(aiGroup);
    if (!ART) {
      aiGroup.append(info('Der KI-Assistent funktioniert, wenn deine Seite als Artifact auf claude.ai läuft.'));
    } else {
      const desc = h('textarea', { id: 'st-ai-desc', placeholder: 'z. B. „Eine App, mit der Freunde gemeinsam Ausflüge planen und Kosten teilen.“', maxLength: 600 });
      desc.value = ss.get('cs-ai-desc') || '';
      desc.addEventListener('input', () => ss.set('cs-ai-desc', desc.value));
      const tone = h('select', { id: 'st-ai-tone' },
        [['locker', 'Locker & freundlich'], ['professionell', 'Professionell'], ['verspielt', 'Verspielt & witzig'], ['episch', 'Episch & spannend']].map(([v, l]) => h('option', { value: v, text: l })));
      const status = h('p', { class: 'st-help', role: 'status' });
      const go = h('button', { class: 'st-btn primary wide', type: 'button', text: '✨ Texte schreiben lassen' });
      const stop = h('button', { class: 'st-btn small', type: 'button', text: 'Stopp', hidden: true, on: { click: () => aiCtl && aiCtl.abort() } });
      go.addEventListener('click', () => runAi(desc.value.trim(), tone.value, { go, stop, status }));
      aiGroup.append(
        h('label', { class: 'st-field', for: 'st-ai-desc' }, h('span', { text: 'Worum geht es bei deinem Projekt?' }), desc),
        h('label', { class: 'st-field', for: 'st-ai-tone' }, h('span', { text: 'Tonfall' }), tone),
        go, h('div', { class: 'st-row' }, status, stop),
        help('Claude schreibt alle Texte auf Deutsch und Englisch, wählt Emoji und Farben und füllt Features, FAQ und Roadmap. Das nutzt dein Claude-Kontingent. Danach kannst du alles anpassen oder mit ↶ zurücknehmen.'));
      B.ai().then((sample) => { if (!sample) { go.disabled = true; status.textContent = 'Die KI ist in dieser Ansicht nicht verfügbar.'; } });
    }

    // Vorlagen
    out.push(group('Vorlagen',
      h('div', { class: 'st-presets' }, Object.entries(CS.PRESETS).map(([key, p]) => {
        const th = CS.THEMES[p.theme];
        return h('button', { class: 'st-preset', type: 'button', on: { click: () => applyPreset(key) } },
          h('span', { class: 'st-preset-swatch', style: `background:linear-gradient(135deg, ${th.accent2}, ${th.accent1} 55%, ${th.accent3})` }, h('span', { text: p.icon })),
          h('b', { text: p.label }));
      })),
      help('Eine Vorlage ändert Texte, Features, Emoji und Farben. Dein Projektname bleibt.')));
    return out;
  }

  function cleanI18n(v, max) {
    const pick = (x) => String(x == null ? '' : x).trim().slice(0, max);
    if (v && typeof v === 'object') return { de: pick(v.de), en: pick(v.en || v.de) };
    if (typeof v === 'string') return { de: pick(v), en: pick(v) };
    return null;
  }

  async function runAi(desc, tone, ui) {
    if (desc.length < 8) { ui.status.textContent = 'Beschreib dein Projekt in mindestens einem Satz.'; return false; }
    const sample = await B.ai();
    if (!sample) { ui.status.textContent = 'Die KI ist hier nicht verfügbar.'; return false; }
    const name = S.draft.brand.name || 'Projekt';
    const prompt = [
      'Du schreibst die Texte für eine Coming-Soon-Webseite, die sich zum Starttermin in eine Live-Seite verwandelt.',
      `Projektname: ${name}`,
      `Beschreibung vom Betreiber: """${desc}"""`,
      `Tonfall: ${tone}. Schreib natürlich und konkret, ohne Floskeln und ohne erfundene Zahlen, Preise oder Versprechen.`,
      'Alle Texte gibt es auf Deutsch ("de") und Englisch ("en"). Du darfst {name} als Platzhalter für den Projektnamen benutzen.',
      'Antworte nur mit einem JSON-Objekt in genau dieser Form:',
      '{"logoEmoji":"ein passendes Emoji","theme":"galaxy|sunset|matrix|ocean|fire|candy|mono",',
      '"soon":{"badge":{"de":"max. 3 Wörter","en":"…"},"text":{"de":"1–2 Sätze, die zum Eintragen einladen","en":"…"}},',
      '"live":{"badge":{"de":"max. 3 Wörter","en":"…"},"headline":{"de":"kurz, z. B. {name} ist da.","en":"…"},"text":{"de":"1–2 Sätze","en":"…"},"ctaText":{"de":"2–3 Wörter","en":"…"}},',
      '"features":[{"icon":"Emoji","title":{"de":"2–3 Wörter","en":"…"},"text":{"de":"1 Satz","en":"…"}}],',
      '"about":{"de":"2–4 Sätze über das Team bzw. die Idee","en":"…"},',
      '"faq":[{"q":{"de":"…","en":"…"},"a":{"de":"…","en":"…"}}],',
      '"roadmap":[{"date":"z. B. Q1 2027","status":"done|active|planned","title":{"de":"…","en":"…"},"text":{"de":"1 Satz","en":"…"}}],',
      '"banner":{"de":"kurze Ankündigung mit Emoji","en":"…"},',
      '"seoDescription":"deutscher Satz mit 120–160 Zeichen"}',
      'Genau 6 Features, 4 FAQ-Einträge und 4 Roadmap-Schritte (der erste "done", einer "active", der Rest "planned").',
    ].join('\n');

    aiCtl = new AbortController();
    ui.go.disabled = true;
    ui.stop.hidden = false;
    ui.status.textContent = '✨ Claude denkt nach … (das dauert meist 10–40 Sekunden)';
    try {
      const data = await sample.json(prompt, {
        signal: aiCtl.signal,
        cache: false,
        onText: ({ text }) => { ui.status.textContent = `✍️ Claude schreibt … ${text.length.toLocaleString('de-DE')} Zeichen`; },
      });
      applyAi(data);
      ui.status.textContent = '✓ Fertig! Schau dir die Seite an – mit ↶ kannst du alles zurücknehmen.';
      toast('✨ Neue Texte sind drin – mit ↶ kannst du sie zurücknehmen.', 4000);
      return true;
    } catch (e) {
      const code = e && e.code;
      const msg = {
        cancelled: 'Abgebrochen.',
        not_granted: 'Du hast die KI für diese Seite nicht erlaubt.',
        rate_limited: 'Gerade zu viele Anfragen – versuch es gleich noch mal.',
        invalid_json: 'Die Antwort war unvollständig. Versuch es noch mal.',
        refused: 'Claude konnte dazu keine Texte schreiben. Formuliere die Beschreibung anders.',
        sampling_disabled: 'Die KI ist für dein Konto nicht verfügbar.',
      }[code] || 'Das hat nicht geklappt. Versuch es noch mal.';
      ui.status.textContent = msg;
      return false;
    } finally {
      ui.go.disabled = false;
      ui.stop.hidden = true;
      aiCtl = null;
    }
  }

  function applyAi(data) {
    if (!data || typeof data !== 'object') throw { code: 'invalid_json' };
    const next = U.clone(S.draft);
    const setI = (path, v, max) => { const c = cleanI18n(v, max); if (c && c.de) U.set(next, path, c); };
    if (typeof data.logoEmoji === 'string' && data.logoEmoji.trim() && !(S.panel === 'wizard' && S.draft.brand.logoEmoji !== CS.DEFAULT_CONFIG.brand.logoEmoji)) {
      next.brand.logoType = 'emoji';
      next.brand.logoEmoji = data.logoEmoji.trim().slice(0, 8);
    }
    if (CS.THEMES[data.theme]) { const { label, ...colors } = CS.THEMES[data.theme]; next.theme = Object.assign({ preset: data.theme }, colors); }
    if (data.soon) { setI('soon.badge', data.soon.badge, 40); setI('soon.text', data.soon.text, 400); }
    if (data.live) {
      setI('live.badge', data.live.badge, 40);
      setI('live.headline', data.live.headline, 80);
      setI('live.text', data.live.text, 400);
      setI('live.ctaText', data.live.ctaText, 40);
    }
    if (Array.isArray(data.features) && data.features.length) {
      next.features.items = data.features.slice(0, 12).map((f) => ({
        icon: String((f && f.icon) || '✨').slice(0, 8),
        title: cleanI18n(f && f.title, 60) || L('Feature', 'Feature'),
        text: cleanI18n(f && f.text, 240) || L('', ''),
      }));
    }
    if (data.about) setI('about.text', data.about, 1200);
    if (Array.isArray(data.faq) && data.faq.length) {
      next.faq.items = data.faq.slice(0, 12).map((f) => ({ q: cleanI18n(f && f.q, 160) || L('?', '?'), a: cleanI18n(f && f.a, 600) || L('', '') }));
    }
    if (Array.isArray(data.roadmap) && data.roadmap.length) {
      next.roadmap.items = data.roadmap.slice(0, 10).map((r) => ({
        date: String((r && r.date) || '').slice(0, 24),
        status: ['done', 'active', 'planned'].includes(r && r.status) ? r.status : 'planned',
        title: cleanI18n(r && r.title, 80) || L('', ''),
        text: cleanI18n(r && r.text, 240) || L('', ''),
      }));
    }
    if (data.banner) setI('banner.text', data.banner, 160);
    if (typeof data.seoDescription === 'string' && data.seoDescription.trim()) next.seo.description = data.seoDescription.trim().slice(0, 200);
    replaceDraft(next, { rerender: false });
  }

  // ---------- Zeitplan ----------
  function panelSchedule() {
    const d = S.draft;
    const modes = [
      ['auto', '🤖', 'Automatisch', 'Bis zum Start Coming Soon, dann live'],
      ['soon', '⏳', 'Coming Soon', 'Immer der Countdown'],
      ['live', '🚀', 'Live', 'Sofort die fertige Seite'],
    ];
    const quick = (label, fn) => h('button', { class: 'st-btn small', type: 'button', text: label, on: { click: fn } });
    const setLaunch = (ms) => set('launchDate', toLocalInput(ms, S.draft.timeZone), { rerender: true });
    const when = h('p', { class: 'st-help' });
    S.tickers.push(() => {
      const t = U.launchTime(S.draft);
      when.textContent = Number.isFinite(t)
        ? `Start: ${new Intl.DateTimeFormat('de-DE', { dateStyle: 'full', timeStyle: 'short', timeZone: S.draft.timeZone }).format(new Date(t))} · noch ${fmtDuration(t - Date.now())}`
        : 'Kein gültiges Datum';
    });
    return [
      group('Modus', h('div', { class: 'st-modes', role: 'group', 'aria-label': 'Modus' }, modes.map(([v, icon, title, desc]) =>
        h('button', { class: 'st-mode', type: 'button', 'aria-pressed': String(d.mode === v), on: { click: () => set('mode', v, { rerender: true }) } },
          h('span', { class: 'st-mode-i', text: icon }), h('b', { text: title }), h('small', { text: desc }))))),
      group('Startzeitpunkt',
        h('div', { class: 'st-grid2' },
          fieldText('launchDate', 'Datum & Uhrzeit', { type: 'datetime-local' }),
          fieldSelect('timeZone', 'Zeitzone', TIMEZONES)),
        when,
        h('div', { class: 'st-row wrap' },
          quick('In 1 Minute (Test)', () => setLaunch(Date.now() + 61000)),
          quick('+ 1 Tag', () => setLaunch(U.launchTime(S.draft) + 86400000)),
          quick('+ 1 Woche', () => setLaunch(U.launchTime(S.draft) + 7 * 86400000)),
          quick('In 30 Tagen', () => setLaunch(Date.now() + 30 * 86400000))),
        help('Tipp: „In 1 Minute“ + Modus „Automatisch“ zeigt dir die echte Launch-Show.')),
      group('Launch-Show',
        h('p', { class: 'st-help', text: 'Wenn der Countdown abläuft: Warp-Speed, „LIFTOFF!“, Konfetti – und die Seite wird live.' }),
        h('button', { class: 'st-btn primary', type: 'button', text: '🚀 Jetzt testen', on: { click: launchTest } })),
    ];
  }

  // ---------- Texte & Marke ----------
  function panelContent() {
    const d = S.draft;
    return [
      group('Marke',
        fieldText('brand.name', 'Projektname', { max: 40, help: 'Oben links, im Tab-Titel und auf der Live-Seite.' }),
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
        fieldI18n('live.headline', 'Große Überschrift', { help: '<code>{name}</code> wird durch den Projektnamen ersetzt.' }),
        fieldI18n('live.text', 'Beschreibung', { multiline: true }),
        fieldI18n('live.ctaText', 'Haupt-Button'),
        fieldText('live.ctaLink', 'Button-Link', { placeholder: '#features oder https://…', help: 'Z. B. dein Shop, deine App oder <code>#features</code>.' })),
      group('Banner ganz oben',
        fieldToggle('banner.enabled', 'Banner anzeigen', 'Farbiger Streifen für Aktionen und News.'),
        fieldI18n('banner.text', 'Text'),
        fieldText('banner.link', 'Link (optional)', { placeholder: 'https://…' })),
      group('Footer & Sprache',
        fieldI18n('footer.text', 'Text unten'),
        fieldSelect('defaultLang', 'Startsprache', [['auto', 'Automatisch (nach Browser)'], ['de', 'Deutsch'], ['en', 'Englisch']], { help: 'Besucher können oben rechts wechseln.' }),
        ART ? null : fieldToggle('footer.showAdminLink', 'Link „🔒 Admin“ im Footer')),
    ];
  }

  // ---------- Design ----------
  function panelDesign() {
    const d = S.draft;
    const custom = () => {
      if (S.draft.theme.preset !== 'custom') {
        S.draft.theme.preset = 'custom';
        $$('.st-theme').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      }
    };
    return [
      group('Farbthema',
        h('div', { class: 'st-themes' }, Object.entries(CS.THEMES).map(([key, th]) =>
          h('button', {
            class: 'st-theme', type: 'button', 'aria-pressed': String(d.theme.preset === key),
            on: { click: () => { const { label, ...colors } = th; set('theme', Object.assign({ preset: key }, colors), { rerender: true }); } },
          },
          h('span', { class: 'st-theme-sw', style: `background:linear-gradient(135deg, ${th.accent2}, ${th.accent1} 50%, ${th.accent3})` }),
          h('span', { text: th.label })))),
        h('div', { class: 'st-grid2' }, fieldColor('theme.accent1', 'Hauptfarbe', custom), fieldColor('theme.accent2', 'Akzent 1', custom)),
        h('div', { class: 'st-grid2' }, fieldColor('theme.accent3', 'Akzent 2', custom), fieldColor('theme.bg', 'Hintergrund', custom))),
      group('Countdown', fieldSelect('countdown.style', 'Aussehen', [['flip', 'Flip-Uhr (klappende Zahlen)'], ['glass', 'Glas-Kacheln']])),
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
        fieldToggle('effects.tilt', 'Handy-Neigung'),
        fieldToggle('effects.soundDefault', 'Sound automatisch an', 'Startet beim ersten Klick. Besucher können ihn ausschalten.')),
      group('Start-Moment',
        fieldToggle('effects.finalCountdown', 'Großer Countdown', 'Die letzten 10 Sekunden erscheinen riesig auf dem Bildschirm – mit Piepen.')),
      group('Live – wer gerade zuschaut',
        fieldToggle('effects.presence', 'Andere Besucher als Raketen zeigen', 'Jeder Mauszeiger wird zur kleinen Rakete, dazu „X gerade hier“.'),
        fieldToggle('effects.reactions', 'Emoji-Reaktionen', '🚀 🔥 ❤️ 👏 – fliegen live bei allen über den Bildschirm.'),
        help(ART ? 'Funktioniert für alle, die mit ihrem Claude-Konto Zugriff auf die Seite haben (z. B. dein Team).' : 'Nur verfügbar, wenn die Seite als Artifact auf claude.ai läuft.')),
    ];
  }

  // ---------- KI-Chat ----------
  function panelAi() {
    const d = S.draft;
    const personas = h('div', { class: 'st-personas' }, Object.entries(CS.PERSONAS).map(([key, p]) =>
      h('button', { class: 'st-persona', type: 'button', 'aria-pressed': String(d.ai.persona === key), on: { click: () => set('ai.persona', key, { rerender: true }) } },
        h('span', { class: 'st-persona-e', text: p.emoji }), h('b', { text: p.label }))));
    return [
      ART ? null : info('Der KI-Chat läuft, wenn deine Seite als Artifact auf claude.ai veröffentlicht ist.', 'warn'),
      group('KI-Chat',
        fieldToggle('ai.enabled', 'KI-Chat anzeigen', 'Unten rechts: Besucher fragen, Claude antwortet live.'),
        fieldToggle('ai.showBeforeLaunch', 'Schon vor dem Start zeigen', 'Aus = erst nach dem Release (im Studio siehst du ihn immer).'),
        h('button', { class: 'st-btn', type: 'button', text: '💬 Chat ausprobieren', on: { click: () => {
          if (CS.chat && CS.chat.isAvailable()) { if (window.matchMedia('(max-width: 760px)').matches) collapse(true); CS.chat.open(); }
          else toast('Der Chat ist in dieser Ansicht nicht verfügbar.');
        } } })),
      group('Persönlichkeit', personas),
      group('Auftritt',
        fieldI18n('ai.name', 'Name', { help: '<code>{name}</code> = Projektname' }),
        fieldI18n('ai.greeting', 'Begrüßung', { multiline: true })),
      group('Wissen',
        fieldText('ai.knowledge', 'Was soll die KI noch wissen?', {
          multiline: true,
          placeholder: 'z. B. Preise, Kontakt, Öffnungszeiten, Details zum Produkt …',
          help: 'Alle Texte deiner Seite (Features, FAQ, Roadmap …) kennt die KI schon. Schreib hier nichts Geheimes hinein – Besucher können danach fragen.',
        })),
      group('Mission Control',
        fieldToggle('ai.missionControl', 'KI-Funkspruch im Spiel', 'Nach jeder Runde kann man sich von „Mission Control“ einen Kommentar holen.')),
      info('Die Antworten laufen über das Claude-Konto der Besucher – beim ersten Mal fragt claude.ai um Erlaubnis. Wer kein Claude-Konto hat, sieht den Chat nicht.'),
    ];
  }

  // ---------- Schnellstart-Assistent ----------
  const WIZ = { step: 1, when: null };

  function panelWizard() {
    const total = 4;
    const go = (n) => { WIZ.step = n; showPanel('wizard'); };
    const dots = h('div', { class: 'st-wiz-dots', 'aria-label': `Schritt ${WIZ.step} von ${total}` },
      Array.from({ length: total }, (_, i) => h('span', { class: i + 1 === WIZ.step ? 'on' : i + 1 < WIZ.step ? 'done' : '' })));
    const navRow = (back, nextLabel, onNext) => h('div', { class: 'st-row between' },
      back ? h('button', { class: 'st-btn', type: 'button', text: '← Zurück', on: { click: () => go(WIZ.step - 1) } }) : h('span'),
      nextLabel ? h('button', { class: 'st-btn primary', type: 'button', text: nextLabel, on: { click: onNext } }) : null);
    const q = (text, sub) => [h('h3', { class: 'st-wiz-q', text }), sub ? h('p', { class: 'st-help', text: sub }) : null];

    if (WIZ.step === 1) {
      return [group(null, dots,
        ...q('Wie heißt dein Projekt?', 'Der Name steht oben auf der Seite und im Tab.'),
        fieldText('brand.name', 'Name', { max: 40 }),
        fieldEmoji('brand.logoEmoji', 'Wähl ein Logo-Emoji'),
        navRow(false, 'Weiter →', () => {
          if (S.draft.brand.logoType !== 'emoji') set('brand.logoType', 'emoji');
          go(2);
        }))];
    }

    if (WIZ.step === 2) {
      const parts = [dots, ...q('Worum geht es?', 'Die KI schreibt passende Texte – oder du nimmst eine Vorlage.')];
      if (ART) {
        const desc = h('textarea', { id: 'st-wiz-desc', placeholder: 'z. B. „Ein Café mit Brettspielen mitten in Köln.“', maxLength: 600 });
        desc.value = ss.get('cs-ai-desc') || '';
        desc.addEventListener('input', () => ss.set('cs-ai-desc', desc.value));
        const status = h('p', { class: 'st-help', role: 'status' });
        const goBtn = h('button', { class: 'st-btn primary wide', type: 'button', text: '✨ Mit KI schreiben lassen' });
        const stop = h('button', { class: 'st-btn small', type: 'button', text: 'Stopp', hidden: true, on: { click: () => aiCtl && aiCtl.abort() } });
        goBtn.addEventListener('click', async () => { if (await runAi(desc.value.trim(), 'locker', { go: goBtn, stop, status })) go(3); });
        parts.push(h('label', { class: 'st-field', for: 'st-wiz-desc' }, h('span', { text: 'Beschreib dein Projekt in 1–3 Sätzen' }), desc), goBtn, h('div', { class: 'st-row' }, status, stop),
          h('div', { class: 'st-or', text: 'oder' }));
      }
      parts.push(h('div', { class: 'st-presets' }, Object.entries(CS.PRESETS).map(([key, p]) => {
        const th = CS.THEMES[p.theme];
        return h('button', { class: 'st-preset', type: 'button', on: { click: () => { applyPreset(key, { keepEmoji: true }); go(3); } } },
          h('span', { class: 'st-preset-swatch', style: `background:linear-gradient(135deg, ${th.accent2}, ${th.accent1} 55%, ${th.accent3})` }, h('span', { text: p.icon })),
          h('b', { text: p.label }));
      })), navRow(true, 'Überspringen →', () => go(3)));
      return [group(null, ...parts)];
    }

    if (WIZ.step === 3) {
      const opts = [
        ['week', '🚀', 'In 1 Woche', () => Date.now() + 7 * 86400000],
        ['month', '📅', 'In 30 Tagen', () => Date.now() + 30 * 86400000],
        ['quarter', '🗓️', 'In 3 Monaten', () => Date.now() + 91 * 86400000],
        ['now', '⚡', 'Sofort live', null],
      ];
      const pick = (key, fn) => {
        WIZ.when = key;
        snapshotBefore();
        if (fn) {
          const t = new Date(fn());
          t.setMinutes(0, 0, 0);
          U.set(S.draft, 'mode', 'auto');
          U.set(S.draft, 'launchDate', toLocalInput(t.getTime(), S.draft.timeZone));
        } else {
          U.set(S.draft, 'mode', 'live');
        }
        commit({ rerender: true });
      };
      return [group(null, dots,
        ...q('Wann geht es los?', 'Bis dahin läuft der Countdown – danach wird die Seite automatisch live.'),
        h('div', { class: 'st-modes' }, opts.map(([key, icon, label, fn]) =>
          h('button', { class: 'st-mode', type: 'button', 'aria-pressed': String(WIZ.when === key), on: { click: () => pick(key, fn) } },
            h('span', { class: 'st-mode-i', text: icon }), h('b', { text: label })))),
        S.draft.mode !== 'live' ? fieldText('launchDate', 'Oder genau festlegen', { type: 'datetime-local' }) : null,
        navRow(true, 'Weiter →', () => go(4)))];
    }

    ls.set(KEY.wizard, '1');
    const t = U.launchTime(S.draft);
    const when = S.draft.mode === 'live' ? 'Sofort live' : Number.isFinite(t)
      ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'full', timeStyle: 'short', timeZone: S.draft.timeZone }).format(new Date(t)) : '–';
    return [group(null, dots,
      h('div', { class: 'st-wiz-done' },
        h('span', { class: 'st-wiz-big', text: S.draft.brand.logoEmoji || '🚀' }),
        h('h3', { class: 'st-wiz-q', text: `${S.draft.brand.name || 'Deine Seite'} ist bereit! 🎉` }),
        h('p', { class: 'st-help', text: 'Start: ' + when })),
      h('button', { class: 'st-btn primary wide st-publish', type: 'button', text: '☁️ Jetzt veröffentlichen', on: { click: publish } }),
      h('div', { class: 'st-row between' },
        h('button', { class: 'st-btn', type: 'button', text: '← Zurück', on: { click: () => go(3) } }),
        h('button', { class: 'st-btn', type: 'button', text: 'Noch anpassen', on: { click: () => showPanel('overview') } })),
      info('✏️ Tipp: Klick direkt auf Texte auf der Seite, um sie zu ändern.'))];
  }

  // ---------- Bereiche ----------
  function panelSections() {
    return [
      group('Sichtbare Bereiche',
        fieldToggle('sections.features', 'Features', 'Vor dem Start geschwärzt 🔒, danach mit Inhalt.'),
        fieldToggle('sections.about', 'Über uns', 'Nur auf der Live-Seite.'),
        fieldToggle('sections.stats', 'Zahlen', 'Nur auf der Live-Seite, zählen animiert hoch.'),
        fieldToggle('sections.roadmap', 'Roadmap'),
        fieldToggle('sections.game', 'Mini-Spiel'),
        fieldToggle('sections.faq', 'FAQ'),
        fieldToggle('sections.social', 'Social-Media-Icons')),
      group('Features',
        fieldI18n('features.title', 'Überschrift'),
        fieldToggle('features.revealBeforeLaunch', 'Schon vor dem Start verraten', 'Aus = Karten sind bis zum Launch geschwärzt.'),
        fieldList('features.items', {
          label: 'Karten', addLabel: 'Feature hinzufügen', max: 12,
          itemTitle: (it) => `${it.icon || '✨'}  ${tr(it.title) || 'Neues Feature'}`,
          newItem: () => ({ icon: '✨', title: L('Neues Feature', 'New feature'), text: L('', '') }),
          fields: (p) => [fieldEmoji(p + '.icon', 'Icon', { picks: false }), fieldI18n(p + '.title', 'Titel'), fieldI18n(p + '.text', 'Text', { multiline: true })],
        })),
      group('Über uns (Live-Seite)',
        fieldI18n('about.title', 'Überschrift'),
        fieldI18n('about.text', 'Text', { multiline: true, help: '<code>{name}</code> = Projektname. Leerzeilen bleiben erhalten.' }),
        fieldImage('about.image', 'Bild (optional)', { maxSize: 1200 })),
      group('Zahlen (Live-Seite)',
        fieldList('stats.items', {
          addLabel: 'Zahl hinzufügen', max: 8,
          itemTitle: (it) => `${Number(it.value || 0).toLocaleString('de-DE')}${it.suffix || ''} – ${tr(it.label)}`,
          newItem: () => ({ value: 100, suffix: '+', label: L('Neue Zahl', 'New number') }),
          fields: (p) => [
            h('div', { class: 'st-grid2' }, fieldText(p + '.value', 'Zahl', { type: 'number' }), fieldText(p + '.suffix', 'Zeichen danach', { placeholder: '+ / %', max: 4 })),
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
          addLabel: 'Meilenstein hinzufügen', max: 12,
          itemTitle: (it) => `${it.status === 'done' ? '✅' : it.status === 'active' ? '🔵' : '⚪'}  ${it.date ? it.date + ' · ' : ''}${tr(it.title)}`,
          newItem: () => ({ date: '', status: 'planned', title: L('Neuer Meilenstein', 'New milestone'), text: L('', '') }),
          fields: (p) => [
            h('div', { class: 'st-grid2' },
              fieldText(p + '.date', 'Zeitpunkt', { placeholder: 'z. B. Q1 2027' }),
              fieldSelect(p + '.status', 'Status', [['done', '✅ Erledigt'], ['active', '🔵 In Arbeit'], ['planned', '⚪ Geplant']])),
            fieldI18n(p + '.title', 'Titel'),
            fieldI18n(p + '.text', 'Text', { multiline: true }),
          ],
        })),
      group('FAQ',
        fieldI18n('faq.title', 'Überschrift'),
        fieldList('faq.items', {
          addLabel: 'Frage hinzufügen', max: 20,
          itemTitle: (it) => '❓ ' + (tr(it.q) || 'Neue Frage'),
          newItem: () => ({ q: L('Neue Frage?', 'New question?'), a: L('', '') }),
          fields: (p) => [fieldI18n(p + '.q', 'Frage'), fieldI18n(p + '.a', 'Antwort', { multiline: true })],
        })),
    ];
  }

  // ---------- Anmeldungen ----------
  function signupsTable() {
    const wrap = h('div', { class: 'st-table-wrap' });
    const draw = () => {
      wrap.textContent = '';
      if (!S.signups) { wrap.append(h('p', { class: 'st-help', text: 'Lade Anmeldungen …' })); return; }
      if (!S.signups.length) {
        wrap.append(h('div', { class: 'st-empty' }, h('span', { text: '📭' }), h('b', { text: 'Noch keine Anmeldungen' }),
          h('small', { text: 'Sobald sich jemand einträgt, erscheint die Adresse hier – live, ohne neu zu laden.' })));
        return;
      }
      const table = h('table', { class: 'st-table' },
        h('tbody', null, S.signups.map((r) => h('tr', null,
          h('td', null,
            h('div', { class: 'st-mail', text: r.email || '–' }),
            h('div', { class: 'st-when', text: r.ts ? fmtDate(r.ts) + (r.lang ? ' · ' + String(r.lang).toUpperCase() : '') : '' })),
          h('td', null, confirmButton('✕', 'Löschen?', () => B.deleteSignup(r.id).catch(() => toast('Löschen hat nicht geklappt.')), 'st-li-del'))))));
      wrap.append(table);
    };
    S.listeners.push(draw);
    draw();
    return wrap;
  }

  function signupCsv() {
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['email', 'datum', 'sprache', 'quelle']].concat((S.signups || []).map((r) => [r.email, r.ts ? new Date(r.ts).toISOString() : '', r.lang || '', r.source || '']));
    return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n') + '\r\n';
  }

  function panelSignups() {
    const d = S.draft;
    if (ART) {
      const count = h('span');
      const fillCount = () => {
        const n = S.signups ? S.signups.length : null;
        count.textContent = n == null ? 'Lade …' : n === 1 ? '1 Anmeldung' : n.toLocaleString('de-DE') + ' Anmeldungen';
      };
      S.listeners.push(fillCount);
      fillCount();
      return [
        group('Liste',
          h('div', { class: 'st-row between' }, h('b', null, count),
            h('div', { class: 'st-row' },
              h('button', { class: 'st-btn small', type: 'button', text: '📋 Kopieren', on: { click: async () => {
                const list = (S.signups || []).map((r) => r.email).filter(Boolean).join(', ');
                if (!list) { toast('Noch keine Adressen.'); return; }
                toast((await B.copy(list)) ? '📋 Alle Adressen kopiert' : 'Kopieren ging nicht – nutze „CSV“.');
              } } }),
              h('button', { class: 'st-btn small', type: 'button', text: '⬇️ CSV', on: { click: async () => {
                try { await B.download('anmeldungen.csv', signupCsv()); } catch (e) { if (e.code !== 'declined') toast('Speichern ist hier nicht möglich.'); }
              } } }))),
          signupsTable()),
        group('Einstellungen',
          fieldToggle('signup.enabled', 'Anmeldeformular anzeigen', null, { rerender: true }),
          fieldI18n('signup.button', 'Button'),
          fieldI18n('signup.success', 'Danke-Nachricht'),
          fieldI18n('signup.liveTitle', 'Überschrift auf der Live-Seite'),
          fieldI18n('signup.liveText', 'Text auf der Live-Seite', { multiline: true })),
        group('Wer sich eintragen kann',
          info('Anmeldungen landen automatisch in der Datenbank deiner Seite – ohne extra Dienst. Eintragen können sich alle, die mit ihrem Claude-Konto <b>mitwirken</b> dürfen (z. B. dein Team). Wer die Seite nur ansehen darf, sieht statt des Formulars den Kalender- und Teilen-Knopf.')),
      ];
    }
    const endpoint = String(d.signup.endpoint || '').trim();
    return [
      d.signup.enabled && !endpoint ? info('<b>⚠️ Demo-Modus:</b> Besucher sehen „Danke!“, aber die Adressen werden <b>nirgends gespeichert</b>.', 'warn') : null,
      group('E-Mail-Liste',
        fieldToggle('signup.enabled', 'Anmeldeformular anzeigen', null, { rerender: true }),
        fieldText('signup.endpoint', 'Formular-Adresse (Endpoint)', { type: 'url', placeholder: 'https://formspree.io/f/abcdwxyz', spellcheck: false }),
        info(`<b>Einrichten (kostenlos, ca. 3 Minuten):</b>
          <ol><li>Auf <a href="https://formspree.io" target="_blank" rel="noopener">formspree.io</a> ein Konto erstellen.</li>
          <li>„New Form“ anlegen.</li><li>Die Adresse <code>https://formspree.io/f/…</code> kopieren und hier einfügen.</li>
          <li><b>Veröffentlichen</b> klicken.</li></ol>`)),
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
      return h('span', { class: 'st-li-icon', html: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ic.d}"/></svg>` });
    };
    return [
      group('Deine Kanäle',
        fieldList('social', {
          addLabel: 'Kanal hinzufügen', max: 16,
          itemIcon: (it) => iconOf(it.type),
          itemTitle: (it) => `${(CS.ICONS[it.type] || CS.ICONS.website).label}${it.url ? '' : ' – Link fehlt'}`,
          newItem: () => ({ type: 'instagram', url: '' }),
          fields: (p) => [
            fieldSelect(p + '.type', 'Plattform', types, { rerender: true }),
            fieldText(p + '.url', 'Link', { type: 'url', placeholder: 'https://…' }),
          ],
        }),
        help('Einträge ohne Link sehen Besucher nicht. Hier im Studio erscheinen sie gestrichelt im Footer.')),
    ];
  }

  // ---------- Spiel & Eggs ----------
  function scoresTable() {
    const wrap = h('div', { class: 'st-table-wrap' });
    const draw = () => {
      wrap.textContent = '';
      if (!S.scores) { wrap.append(h('p', { class: 'st-help', text: 'Lade Bestenliste …' })); return; }
      if (!S.scores.length) { wrap.append(h('div', { class: 'st-empty' }, h('span', { text: '🏁' }), h('b', { text: 'Noch niemand hat gespielt' }))); return; }
      wrap.append(h('table', { class: 'st-table' },
        h('tbody', null, S.scores.slice(0, 20).map((r, i) => h('tr', null,
          h('td', { class: 'st-rank', text: i + 1 + '.' }),
          h('td', { text: r.name || 'Pilot' }),
          h('td', { class: 'st-num', text: Number(r.score || 0).toLocaleString('de-DE') }),
          h('td', null, confirmButton('✕', 'Löschen?', () => B.deleteScore(r.id).catch(() => toast('Löschen hat nicht geklappt.')), 'st-li-del')))))));
    };
    S.listeners.push(draw);
    draw();
    return wrap;
  }

  function panelFun() {
    const secret = String(S.draft.easterEggs.secretWord || '').trim();
    return [
      group('Mini-Spiel „Asteroid Run“',
        fieldToggle('sections.game', 'Spiel anzeigen'),
        fieldI18n('game.title', 'Name des Spiels'),
        fieldI18n('game.text', 'Beschreibung', { multiline: true })),
      ART ? group('🌍 Bestenliste', scoresTable(), help('Jeder Eintrag ist der beste Lauf einer Person. Unpassende Namen kannst du löschen.')) : null,
      group('Easter Eggs',
        fieldToggle('easterEggs.enabled', 'Easter Eggs aktiv'),
        fieldText('easterEggs.secretWord', 'Geheimes Wort', { max: 20, help: 'Wer es auf der Seite tippt, bekommt deine Nachricht + Konfetti.' }),
        fieldI18n('easterEggs.secretMessage', 'Geheime Nachricht'),
        h('div', { class: 'st-field' }, h('span', { class: 'st-label', text: 'So findet man sie (psst 🤫)' }),
          h('div', { class: 'st-eggs', html: `
            <div>🌈 <span><kbd>↑ ↑ ↓ ↓ ← → ← → B A</kbd> Regenbogen-Sterne</span></div>
            <div>🎉 <span><kbd>party</kbd> tippen – Konfetti &amp; Disco</span></div>
            <div>🛸 <span><kbd>ufo</kbd> tippen – UFO fliegt vorbei</span></div>
            <div>🌌 <span><kbd>warp</kbd> tippen – Hyperraum</span></div>
            <div>🔄 <span>5× aufs Logo klicken – Fassrolle</span></div>
            <div>🚀 <span>Rakete anklicken – Probestart</span></div>
            <div>🤫 <span>${secret ? `<kbd>${U.escapeHtml(secret)}</kbd> tippen` : 'Geheimes Wort festlegen'} – deine Nachricht</span></div>` }))),
    ];
  }

  // ---------- Teilen & SEO ----------
  function panelSeo() {
    if (ART) {
      const url = h('input', { id: 'st-site-url', type: 'url', placeholder: 'https://claude.ai/…', spellcheck: 'false' });
      url.value = S.draft.seo.siteUrl || '';
      url.addEventListener('input', () => set('seo.siteUrl', url.value.trim()));
      return [
        group('Dein Link',
          h('label', { class: 'st-field', for: 'st-site-url' }, h('span', { text: 'Adresse deiner Seite' }), url,
            help('Wird für „Teilen“ und den Kalender-Eintrag benutzt.')),
          h('div', { class: 'st-row' },
            h('button', { class: 'st-btn small', type: 'button', text: '📋 Link kopieren', on: { click: async () => {
              toast((await B.copy(url.value)) ? '📋 Link kopiert' : 'Kopieren ging nicht – markier den Link oben.');
            } } }),
            url.value ? h('a', { class: 'st-btn small', href: url.value, target: '_blank', rel: 'noopener', text: 'Öffnen ↗' }) : null)),
        group('Für alle sichtbar machen',
          info(`Deine Seite ist zuerst <b>privat</b>. So teilst du sie:
            <ol><li>Oben in claude.ai auf <b>Teilen</b> klicken.</li>
            <li>Zugriff auf <b>„Jeder mit dem Link“</b> stellen.</li>
            <li>Link kopieren und verschicken – fertig.</li></ol>
            Das Studio sehen trotzdem nur du und Leute, denen du Bearbeiten-Rechte gibst.`)),
      ];
    }
    return [
      group('Google & Link-Vorschau',
        fieldText('seo.title', 'Titel', { help: '<code>{name}</code> = Projektname.' }),
        fieldText('seo.description', 'Beschreibung', { multiline: true, help: 'Ideal: 120–160 Zeichen.' }),
        fieldText('seo.siteUrl', 'Adresse der Seite', { type: 'url', placeholder: 'https://name.github.io/repo/' })),
      group('Besucherzähler (ohne Cookies)',
        fieldText('analytics.goatcounter', 'GoatCounter-Code', { placeholder: 'z. B. meinprojekt', spellcheck: false, help: 'Der Teil vor <code>.goatcounter.com</code>.' }),
        fieldToggle('analytics.showCounter', 'Besucherzahl im Footer zeigen'),
        info('Kostenlos auf <a href="https://www.goatcounter.com/signup" target="_blank" rel="noopener">goatcounter.com</a> registrieren, Code hier eintragen, veröffentlichen.')),
    ];
  }

  // ---------- Zugang ----------
  function panelSecurity() {
    if (ART) {
      return [
        group('Wer das Studio sieht',
          info(`Das Studio erscheint nur für <b>dich</b> als Besitzer und für Personen, denen du in claude.ai das Recht zum <b>Bearbeiten</b> gibst.
            Besucher sehen keinen Bearbeiten-Knopf und können nichts ändern.<br><br>
            Es gibt kein Passwort und keinen Token, den jemand stehlen könnte. Den Zugang regelt dein Claude-Konto.`)),
      ];
    }
    const user = h('input', { type: 'text', autocomplete: 'username' });
    user.value = S.draft.admin.user;
    const p1 = h('input', { type: 'password', autocomplete: 'new-password' });
    const p2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const msg = h('p', { class: 'st-help', role: 'status' });
    const save = async () => {
      const u = user.value.trim();
      if (!u) { msg.textContent = 'Bitte einen Benutzernamen eingeben.'; return; }
      if (p1.value.length < 8) { msg.textContent = 'Das Passwort braucht mindestens 8 Zeichen.'; return; }
      if (p1.value !== p2.value) { msg.textContent = 'Die Passwörter stimmen nicht überein.'; return; }
      try {
        const hash = await U.passHash(u, p1.value);
        snapshotBefore();
        S.draft.admin = { user: u, passHash: hash };
        commit({ rerender: true });
        toast('🔒 Gespeichert – aktiv, sobald du veröffentlichst.');
      } catch (e) {
        msg.textContent = 'Verschlüsselung nicht verfügbar – bitte über https öffnen.';
      }
    };
    const pending = S.draft.admin.passHash !== S.published.admin.passHash;
    return [
      S.published.admin.passHash === DEFAULT_HASH && !pending ? info('<b>⚠️ Du nutzt noch das Standard-Passwort <code>12345</code>.</b> Ändere es jetzt.', 'danger') : null,
      pending ? info('🕒 Neue Zugangsdaten werden beim nächsten <b>Veröffentlichen</b> aktiv.', 'warn') : null,
      group('Zugangsdaten ändern',
        h('label', { class: 'st-field' }, h('span', { text: 'Benutzername' }), user),
        h('label', { class: 'st-field' }, h('span', { text: 'Neues Passwort' }), p1),
        h('label', { class: 'st-field' }, h('span', { text: 'Wiederholen' }), p2),
        h('button', { class: 'st-btn primary', type: 'button', text: 'Speichern', on: { click: save } }), msg),
      group('Gut zu wissen',
        info('Auf einer Seite ohne eigenen Server ist der Login wie ein Türschild. Ändern kann die Seite nur, wer deinen <b>GitHub-Token</b> hat – und der bleibt in deinem Browser.')),
    ];
  }

  // ---------- Veröffentlichen ----------
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
    const dirty = isDirty();
    const importInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    importInput.addEventListener('change', async () => {
      const f = importInput.files[0];
      if (!f) return;
      try {
        replaceDraft(U.merge(CS.DEFAULT_CONFIG, JSON.parse(await f.text())));
        toast('📥 Importiert – noch nicht veröffentlicht.');
      } catch (e) {
        toast('Die Datei ist keine gültige Einstellungs-Datei.');
      }
    });
    const updated = S.published.updatedAt ? 'Zuletzt veröffentlicht: ' + fmtDate(S.published.updatedAt) : '';
    logEl = h('div', { class: 'st-log', hidden: true, 'aria-live': 'polite' });

    const out = [
      group(null,
        dirty ? info('Du hast <b>Änderungen, die noch nicht online sind</b>.', 'warn') : info('✓ Alles ist veröffentlicht.'),
        h('button', { class: 'st-btn primary wide st-publish', type: 'button', text: '☁️ Jetzt veröffentlichen', on: { click: publish } }),
        help(ART ? 'Alle Besucher sehen die neue Version sofort. ' + updated : updated),
        logEl),
    ];

    if (!ART) {
      const token = h('input', { id: 'gh-token', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…' });
      token.value = getToken();
      const remember = h('input', { type: 'checkbox', role: 'switch' });
      remember.checked = !!ls.get(KEY.token) || !getToken();
      const storeToken = () => {
        ls.del(KEY.token);
        ss.del(KEY.token);
        if (token.value.trim()) (remember.checked ? ls : ss).set(KEY.token, token.value.trim());
      };
      token.addEventListener('input', storeToken);
      remember.addEventListener('change', storeToken);
      const opts = pubOpts();
      const optToggle = (key, label, text) => h('label', { class: 'st-toggle' },
        h('span', { class: 'st-t-text' }, h('b', { text: label }), h('span', { class: 'st-help', text })),
        switchEl(opts[key], (v) => { opts[key] = v; ls.set(KEY.pubOpts, JSON.stringify(opts)); }));
      out.push(
        group('Beim Veröffentlichen',
          optToggle('seo', 'Link-Vorschau & App-Daten aktualisieren', 'Titel und Beschreibung in index.html / manifest'),
          optToggle('images', 'Vorschaubild & App-Icons neu erzeugen', 'Mit Name, Logo und Farben')),
        group('GitHub-Verbindung',
          h('div', { class: 'st-grid2' }, fieldText('github.owner', 'Besitzer', { spellcheck: false }), fieldText('github.repo', 'Repository', { spellcheck: false })),
          fieldText('github.branch', 'Branch', { placeholder: 'leer = Standard-Branch', spellcheck: false }),
          h('label', { class: 'st-field', for: 'gh-token' }, h('span', { text: 'Persönlicher Zugriffstoken' }), token, help('Bleibt nur in diesem Browser.')),
          h('label', { class: 'st-toggle' }, h('span', { class: 'st-t-text' }, h('b', { text: 'Token auf diesem Gerät merken' })), h('span', { class: 'st-switch' }, remember, h('span', { class: 'st-track' }))),
          info(`<b>Token erstellen:</b> <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Fine-grained Token</a> → nur dieses Repo → <i>Contents: Read and write</i>.<br>
            <b>Ohne Token geht es auch:</b> Veröffentliche die Seite als Artifact auf claude.ai – dort speichert das Studio mit einem Klick.`)));
    }

    out.push(group('Sichern & Wiederherstellen',
      h('div', { class: 'st-row wrap' },
        h('button', { class: 'st-btn small', type: 'button', text: '📤 Exportieren', on: { click: async () => {
          try { await B.download('config.json', serialize(S.draft), 'application/json'); } catch (e) { if (e.code !== 'declined') toast('Speichern ist hier nicht möglich.'); }
        } } }),
        h('button', { class: 'st-btn small', type: 'button', text: '📥 Importieren', on: { click: () => importInput.click() } }),
        importInput),
      h('div', { class: 'st-row wrap' },
        dirty ? confirmButton('↩️ Entwurf verwerfen', 'Wirklich verwerfen?', () => { replaceDraft(U.clone(S.published)); toast('↩️ Zurück zur veröffentlichten Version.'); }) : null,
        confirmButton('🧹 Auf Standard zurücksetzen', 'Wirklich alles zurücksetzen?', () => {
          const keep = { admin: S.draft.admin, github: S.draft.github, seo: { siteUrl: S.draft.seo.siteUrl } };
          replaceDraft(U.merge(CS.DEFAULT_CONFIG, keep));
          toast('🧹 Standard wiederhergestellt – noch nicht veröffentlicht.');
        })),
      help('Zurücksetzen behält Zugangsdaten und deinen Link. Alles lässt sich mit ↶ rückgängig machen, solange du nicht veröffentlichst.')));
    return out;
  }

  // ---------------------------------------------------------
  //  Veröffentlichen
  // ---------------------------------------------------------
  let publishing = false;

  async function publish() {
    if (publishing) return;
    if (!isDirty()) { toast('✓ Alles ist schon veröffentlicht.'); return; }
    if (ART) return publishArtifact();
    return publishGithub();
  }

  async function publishArtifact() {
    publishing = true;
    setBusy(true);
    const cfg = U.clone(S.draft);
    cfg.updatedAt = Date.now();
    // Nach dem Neuladen wieder im Studio landen
    ss.set(KEY.reopen, S.panel);
    ss.set(KEY.published, '1');
    try {
      await B.publishArtifact(cfg);
      ls.del(KEY.draft);
      // Die Seite lädt jetzt neu – mit der neuen Version
    } catch (e) {
      ss.del(KEY.reopen);
      ss.del(KEY.published);
      const code = e && e.code;
      const msg = {
        conflict: 'Gerade wurde eine neuere Version veröffentlicht. Die Seite lädt neu – dein Entwurf bleibt gespeichert.',
        not_writer: 'Du darfst diese Seite nicht bearbeiten.',
        not_granted: 'Veröffentlichen ist in dieser Ansicht nicht möglich. Öffne die Seite direkt auf claude.ai.',
        capability_disabled: 'Veröffentlichen ist in dieser Ansicht nicht möglich.',
        too_large: 'Die Seite ist zu groß geworden. Nimm große Bilder heraus.',
        rate_limited: 'Kurz durchatmen – du hast gerade sehr oft veröffentlicht. Gleich noch mal versuchen.',
      }[code] || 'Veröffentlichen hat nicht geklappt. Versuch es gleich noch mal.';
      toast(msg, 6000);
      publishing = false;
      setBusy(false);
    }
  }

  function setBusy(on) {
    $$('.st-publish').forEach((b) => { b.disabled = on; b.classList.toggle('busy', on); });
  }

  // GitHub (statische Seite)
  function explain(e) {
    const s = e && e.status;
    if (s === 401) return 'Der Token ist ungültig oder abgelaufen.';
    if (s === 403) return 'Keine Berechtigung. Der Token braucht „Contents: Read and write“.';
    if (s === 404) return 'Repo oder Branch nicht gefunden – oder der Token hat keinen Zugriff.';
    if (s === 409) return 'Konflikt: Das Repo wurde gleichzeitig geändert. Bitte nochmal versuchen.';
    if (s === 422) return 'GitHub hat die Änderung abgelehnt (' + (e.message || '422') + ').';
    if (e instanceof TypeError) return 'Keine Verbindung zu GitHub. Bist du online?';
    return 'Fehler: ' + (e && e.message ? e.message : e);
  }

  function api(token) {
    return async function req(method, path, body) {
      const res = await fetch('https://api.github.com' + path, {
        method,
        headers: Object.assign({ Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' },
          body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        let message = String(res.status);
        try { message = (await res.json()).message || message; } catch (e) { /* egal */ }
        throw Object.assign(new Error(message), { status: res.status });
      }
      return res.status === 204 ? null : res.json();
    };
  }

  const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(String(s).replace(/\s/g, '')), (c) => c.charCodeAt(0)));
  const refPath = (branch) => branch.split('/').map(encodeURIComponent).join('/');

  async function publishGithub() {
    const token = getToken();
    if (!token) {
      showPanel('publish');
      toast('Trag zuerst deinen GitHub-Token ein (unten).', 5000);
      setTimeout(() => { const t = $('#gh-token'); if (t) { t.focus(); t.scrollIntoView({ block: 'center' }); } }, 50);
      return;
    }
    if (S.panel !== 'publish') showPanel('publish');
    publishing = true;
    setBusy(true);
    if (logEl) logEl.textContent = '';
    const cfg = U.clone(S.draft);
    cfg.updatedAt = Date.now();
    const req = api(token);
    const base = `/repos/${encodeURIComponent(cfg.github.owner)}/${encodeURIComponent(cfg.github.repo)}`;
    const opts = pubOpts();
    try {
      log(`Verbinde mit ${cfg.github.owner}/${cfg.github.repo} …`);
      const repo = await req('GET', base);
      const branch = cfg.github.branch || repo.default_branch;
      log('Branch: ' + branch);
      const ref = await req('GET', `${base}/git/ref/heads/${refPath(branch)}`);
      const parent = ref.object.sha;
      const parentCommit = await req('GET', `${base}/git/commits/${parent}`);
      const cfgText = serialize(cfg);
      const files = [{ path: 'config.json', content: cfgText }];
      if (opts.seo) {
        log('Aktualisiere Link-Vorschau …');
        try {
          const idx = await req('GET', `${base}/contents/index.html?ref=${encodeURIComponent(branch)}`);
          const html = b64decode(idx.content);
          if (/<!-- SEO:START/.test(html)) files.push({ path: 'index.html', content: U.replaceSeoBlock(html, cfg) });
        } catch (e) { if (e.status !== 404) throw e; }
        files.push({ path: 'manifest.webmanifest', content: CS.images.manifest(cfg) });
      }
      if (opts.images && CS.images) {
        log('Erzeuge Vorschaubild & App-Icons …');
        const imgs = await CS.images.all(cfg);
        for (const [path, dataUrl] of Object.entries(imgs)) {
          const blob = await req('POST', `${base}/git/blobs`, { content: dataUrl.split(',')[1], encoding: 'base64' });
          files.push({ path, sha: blob.sha });
        }
      }
      log('Erstelle Commit …');
      const tree = await req('POST', `${base}/git/trees`, {
        base_tree: parentCommit.tree.sha,
        tree: files.map((f) => (f.sha ? { path: f.path, mode: '100644', type: 'blob', sha: f.sha } : { path: f.path, mode: '100644', type: 'blob', content: f.content })),
      });
      if (tree.sha !== parentCommit.tree.sha) {
        const commit = await req('POST', `${base}/git/commits`, { message: 'Studio: Seite aktualisiert 🚀', tree: tree.sha, parents: [parent] });
        await req('PATCH', `${base}/git/refs/heads/${refPath(branch)}`, { sha: commit.sha });
        log(`✓ Veröffentlicht! (Commit ${commit.sha.slice(0, 7)}) – in 1–2 Minuten online.`, 'ok');
      } else {
        log('✓ Keine Änderungen – online ist schon alles aktuell.', 'ok');
      }
      S.draft = cfg;
      S.published = U.clone(cfg);
      S.publishedText = serialize(cfg);
      B.published = U.clone(cfg);
      ss.set(KEY.session, cfg.admin.passHash);
      ls.del(KEY.draft);
      commit({});
      toast('🎉 Veröffentlicht! In 1–2 Minuten ist alles online.', 5000);
    } catch (e) {
      log('✗ ' + explain(e), 'err');
      toast(explain(e), 6000);
    } finally {
      publishing = false;
      setBusy(false);
    }
  }

  // ---------------------------------------------------------
  //  Gerüst: Leiste, Navigation, Vorschau-Steuerung
  // ---------------------------------------------------------
  function launchTest() {
    S.previewMode = 'live';
    syncSegs();
    if (window.matchMedia('(max-width: 760px)').matches) collapse(true);
    CS.site.launchTest();
  }

  function seg(id, label, items, onPick) {
    return h('div', { class: 'st-seg', id, role: 'group', 'aria-label': label },
      items.map(([v, l]) => h('button', { type: 'button', 'data-v': v, text: l, on: { click: () => onPick(v) } })));
  }

  function syncSegs() {
    $$('#st-seg-mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === S.previewMode)));
    $$('#st-seg-lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === CS.site.getLang())));
  }

  function build() {
    if (S.built) return;
    const root = h('aside', { class: 'studio', id: 'studio', 'aria-label': 'Studio', hidden: true },
      h('div', { class: 'st-head' },
        h('button', { class: 'st-brand', type: 'button', title: 'Leiste ein-/ausklappen', on: { click: () => collapse(!S.collapsed) } },
          h('span', { class: 'st-logo', text: '✏️' }),
          h('span', { class: 'st-brand-t' }, h('b', { text: 'Studio' }), h('span', { class: 'st-sub', id: 'st-sub' }))),
        h('div', { class: 'st-actions' },
          h('button', { class: 'st-icon', id: 'st-undo', type: 'button', title: 'Rückgängig (Strg+Z)', 'aria-label': 'Rückgängig', text: '↶', on: { click: undo } }),
          h('button', { class: 'st-icon', id: 'st-redo', type: 'button', title: 'Wiederholen (Strg+Umschalt+Z)', 'aria-label': 'Wiederholen', text: '↷', on: { click: redo } }),
          h('button', { class: 'st-btn primary st-publish', type: 'button', text: 'Veröffentlichen', on: { click: publish } }),
          h('button', { class: 'st-icon st-collapse', type: 'button', title: 'Vorschau', 'aria-label': 'Leiste einklappen', text: '▾', on: { click: () => collapse(!S.collapsed) } }),
          h('button', { class: 'st-icon', type: 'button', title: 'Studio schließen (Esc)', 'aria-label': 'Studio schließen', text: '✕', on: { click: close } }))),
      h('div', { class: 'st-status', id: 'st-status', role: 'status' }),
      h('div', { class: 'st-preview' },
        seg('st-seg-mode', 'Ansicht', [['', 'Echt'], ['soon', 'Soon'], ['live', 'Live']], (v) => { S.previewMode = v; CS.site.setForcedMode(v || null); syncSegs(); }),
        seg('st-seg-lang', 'Sprache', [['de', 'DE'], ['en', 'EN']], (v) => { CS.site.setLang(v); syncSegs(); }),
        h('button', { class: 'st-btn small', type: 'button', text: '🚀 Launch testen', on: { click: launchTest } })),
      h('div', { class: 'st-body' },
        h('nav', { class: 'st-nav', id: 'st-nav', 'aria-label': 'Bereiche' }),
        h('div', { class: 'st-editor', id: 'st-editor' })));
    document.body.append(root);
    renderNav();
    document.addEventListener('click', onPageClick, true);

    window.addEventListener('keydown', (e) => {
      if (!S.isOpen) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 's') { e.preventDefault(); publish(); }
      else if (mod && k === 'z' && !e.shiftKey && !isTextField(e.target)) { e.preventDefault(); undo(); }
      else if (mod && ((k === 'z' && e.shiftKey) || k === 'y') && !isTextField(e.target)) { e.preventDefault(); redo(); }
      else if (k === 'escape' && !(CS.game && CS.game.isOpen())) { close(); }
    });
    setInterval(() => { if (S.isOpen) runTickers(); }, 1000);
    S.built = true;
  }

  const isTextField = (el) => !!(el && el.closest && el.closest('input, textarea, select, [contenteditable]'));

  function runTickers() { S.tickers.forEach((fn) => fn()); }

  function renderNav() {
    const nav = $('#st-nav');
    const all = ls.get(KEY.all) === '1' || !!(PANELS.find((p) => p.id === S.panel) || {}).adv;
    nav.textContent = '';
    for (const p of PANELS) {
      if (p.id === 'wizard' || (p.adv && !all)) continue;
      nav.append(h('button', { type: 'button', 'data-panel': p.id, title: p.title.replace(/\u00ad/g, ''), on: { click: () => showPanel(p.id) } },
        h('span', { class: 'st-nav-i', text: p.icon }), h('span', { class: 'st-nav-t', text: p.title })));
    }
    nav.append(h('button', { type: 'button', class: 'st-nav-more', title: all ? 'Weniger' : 'Mehr Einstellungen',
      on: { click: () => { ls.set(KEY.all, all ? '0' : '1'); renderNav(); if (all && (PANELS.find((p) => p.id === S.panel) || {}).adv) showPanel('overview'); else markNav(); } } },
      h('span', { class: 'st-nav-i', text: all ? '▴' : '⋯' }), h('span', { class: 'st-nav-t', text: all ? 'Weniger' : 'Mehr' })));
    markNav();
  }

  function markNav(scroll) {
    $$('#st-nav button').forEach((b) => b.removeAttribute('aria-current'));
    const id = S.panel === 'wizard' ? 'overview' : S.panel;
    const navBtn = $(`#st-nav button[data-panel="${id}"]`);
    if (navBtn) { navBtn.setAttribute('aria-current', 'page'); if (scroll) navBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }

  function showPanel(id, { keepScroll = false } = {}) {
    const panel = PANELS.find((p) => p.id === id) || PANELS[0];
    const editor = $('#st-editor');
    const scroll = editor.scrollTop;
    const active = document.activeElement;
    const activeLabel = active && editor.contains(active) && active.getAttribute('aria-label');
    S.panel = panel.id;
    S.tickers = [];
    S.listeners = [];
    ls.set(KEY.panel, panel.id);
    if (panel.adv && !$(`#st-nav button[data-panel="${panel.id}"]`)) renderNav();
    markNav(!keepScroll);

    editor.textContent = '';
    editor.append(h('div', { class: 'st-panel-head' }, h('h2', null, h('span', { text: panel.icon }), ' ', panel.title), h('p', { text: panel.desc })));
    editor.append(...panel.render().filter(Boolean));
    editor.scrollTop = keepScroll ? scroll : 0;
    if (activeLabel) {
      const again = editor.querySelector(`[aria-label="${CSS.escape(activeLabel)}"]`);
      if (again) again.focus();
    }
    if (S.collapsed) collapse(false);
    runTickers();
  }

  function collapse(on) {
    S.collapsed = !!on;
    const root = $('#studio');
    if (root) root.classList.toggle('collapsed', S.collapsed);
    document.body.classList.toggle('studio-collapsed', S.collapsed);
    const c = $('.st-collapse');
    if (c) { c.textContent = S.collapsed ? '▴' : '▾'; c.setAttribute('aria-label', S.collapsed ? 'Leiste ausklappen' : 'Leiste einklappen'); }
  }

  // ---------------------------------------------------------
  //  Öffnen / Schließen / Login
  // ---------------------------------------------------------
  function loadDraft() {
    S.published = U.clone(B.published || CS.site.getConfig());
    S.publishedText = serialize(S.published);
    let draft = null;
    try {
      const stored = JSON.parse(ls.get(KEY.draft) || 'null');
      if (stored && stored.base === S.publishedText && stored.draft) draft = U.merge(CS.DEFAULT_CONFIG, stored.draft);
    } catch (e) { /* kaputter Entwurf */ }
    S.draft = draft || U.clone(S.published);
    S.lastState = JSON.stringify(S.draft);
    S.history = [];
    S.future = [];
    return !!draft && isDirty();
  }

  function openDrawer(panel) {
    build();
    const restored = loadDraft();
    S.isOpen = true;
    $('#studio').hidden = false;
    $('#studio-fab').hidden = true;
    CS.site.setStudio(true);
    CS.site.applyConfig(S.draft);
    S.previewMode = '';
    syncSegs();
    updateStatus();
    const fresh = !ls.get(KEY.wizard) && S.draft.brand.name === CS.DEFAULT_CONFIG.brand.name;
    if (fresh && !panel) WIZ.step = 1;
    showPanel(panel || (fresh ? 'wizard' : ls.get(KEY.panel) || 'overview'));
    watchData();
    if (restored) toast('💾 Dein Entwurf vom letzten Mal ist wieder da.', 3500);
  }

  function close() {
    if (!S.isOpen) return;
    if (inline) inline.blur();
    S.isOpen = false;
    $('#studio').hidden = true;
    collapse(false);
    stopWatching();
    CS.site.setForcedMode(null);
    CS.site.setStudio(false);
    CS.site.applyConfig(S.published);
    if (S.enabled) $('#studio-fab').hidden = false;
    if (isDirty()) toast('💾 Entwurf gespeichert – noch nicht veröffentlicht.', 3500);
  }

  // Login nur für die statische Seite
  function lockedFor() { return Math.max(0, Number(ls.get(KEY.lock) || 0) - Date.now()); }

  function showLogin() {
    let modal = $('#st-login');
    if (!modal) {
      const err = h('p', { class: 'st-login-err', role: 'alert' });
      const user = h('input', { id: 'st-login-user', autocomplete: 'username', required: true });
      const pass = h('input', { id: 'st-login-pass', type: 'password', autocomplete: 'current-password', required: true });
      let fails = 0;
      const form = h('form', { class: 'st-login-card', novalidate: true },
        h('div', { class: 'st-login-logo', text: '🔒' }),
        h('h2', { text: 'Studio' }),
        h('p', { class: 'st-help', text: 'Melde dich an, um die Seite zu bearbeiten.' }),
        h('label', { class: 'st-field', for: 'st-login-user' }, h('span', { text: 'Benutzername' }), user),
        h('label', { class: 'st-field', for: 'st-login-pass' }, h('span', { text: 'Passwort' }), pass),
        h('button', { class: 'st-btn primary wide', type: 'submit', text: 'Anmelden' }),
        err,
        h('button', { class: 'st-btn small', type: 'button', text: 'Abbrechen', on: { click: () => { modal.hidden = true; } } }));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const wait = lockedFor();
        if (wait) { err.textContent = `Zu viele Versuche – bitte ${Math.ceil(wait / 1000)} Sekunden warten.`; return; }
        let ok = false;
        const pub = B.published || CS.DEFAULT_CONFIG;
        try {
          ok = user.value.trim() === pub.admin.user && (await U.passHash(user.value.trim(), pass.value)) === pub.admin.passHash;
        } catch (ex) {
          err.textContent = 'Dein Browser erlaubt hier keine Verschlüsselung. Öffne die Seite über https:// oder localhost.';
          return;
        }
        if (ok) {
          ss.set(KEY.session, pub.admin.passHash);
          ls.del(KEY.lock);
          modal.hidden = true;
          pass.value = '';
          openDrawer();
          return;
        }
        fails++;
        err.textContent = 'Benutzername oder Passwort falsch.';
        form.classList.remove('shake');
        void form.offsetWidth;
        form.classList.add('shake');
        if (fails >= 5) { ls.set(KEY.lock, String(Date.now() + 30000)); fails = 0; err.textContent = 'Zu viele Versuche – bitte 30 Sekunden warten.'; }
      });
      modal = h('div', { class: 'st-login', id: 'st-login', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Studio-Anmeldung' }, form);
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
      document.body.append(modal);
    }
    modal.hidden = false;
    setTimeout(() => $('#st-login-user').focus(), 30);
  }

  function open(panel) {
    if (S.isOpen) return;
    if (ART) { if (B.canEdit) openDrawer(panel); return; }
    const pub = B.published || CS.DEFAULT_CONFIG;
    if (ss.get(KEY.session) === pub.admin.passHash) openDrawer(panel);
    else showLogin();
  }

  // Wird von der Seite aufgerufen, sobald klar ist, wer zuschaut
  function enable() {
    S.enabled = true;
    const fab = $('#studio-fab');
    if (ART) {
      fab.hidden = false;
      fab.addEventListener('click', () => open());
      const reopen = ss.get(KEY.reopen);
      const justPublished = ss.get(KEY.published);
      ss.del(KEY.reopen);
      ss.del(KEY.published);
      if (reopen) open(reopen);
      if (justPublished) {
        setTimeout(() => {
          toast('🎉 Veröffentlicht! Alle sehen jetzt die neue Version.', 4500);
          CS.fx.confettiCannons();
        }, 400);
      }
    } else {
      fab.addEventListener('click', () => open());
      const pub = B.published || CS.DEFAULT_CONFIG;
      if (ss.get(KEY.session) === pub.admin.passHash) fab.hidden = false;
      if (location.hash === '#admin') open();
      window.addEventListener('hashchange', () => { if (location.hash === '#admin') open(); });
    }
  }

  CS.studio = { enable, open, close, isOpen: () => S.isOpen };
})();
