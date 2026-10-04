/* =========================================================
   Hauptlogik der Seite
   ========================================================= */
(function () {
  'use strict';
  const CS = window.CS;
  const U = CS.util;
  const fx = CS.fx;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const params = new URLSearchParams(location.search);
  const isPreview = params.has('preview');
  const reduceMotion = fx.reduceMotion;
  const body = document.body;

  const state = {
    cfg: U.clone(CS.DEFAULT_CONFIG),
    lang: 'de',
    mode: 'soon',
    forcedMode: null,
    launch: NaN,
    rendered: false,
    countdown: new fx.Countdown($('#countdown')),
    eggs: loadEggs(),
    typed: '',
    konamiPos: 0,
    logoClicks: [],
    statsCounted: false,
    analyticsLoaded: false,
    showRunning: false,
  };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } },
  };

  // ---------------------------------------------------------
  //  Texte
  // ---------------------------------------------------------
  const t = (field) => U.tr(field, state.lang, { name: state.cfg.brand.name });
  const ui = (key, vars) => U.format((CS.UI[state.lang] || CS.UI.de)[key] || CS.UI.de[key] || key, vars);
  const locale = () => (state.lang === 'de' ? 'de-DE' : 'en-US');

  function pickLang(cfg) {
    if (isPreview) return cfg.defaultLang === 'en' ? 'en' : 'de';
    const saved = store.get('cs-lang');
    if (saved === 'de' || saved === 'en') return saved;
    if (cfg.defaultLang === 'de' || cfg.defaultLang === 'en') return cfg.defaultLang;
    return (navigator.language || 'de').toLowerCase().startsWith('de') ? 'de' : 'en';
  }

  // ---------------------------------------------------------
  //  Konfiguration laden
  // ---------------------------------------------------------
  async function loadConfig() {
    if (isPreview) {
      try {
        const draft = localStorage.getItem('cs-preview-config');
        if (draft) return U.merge(CS.DEFAULT_CONFIG, JSON.parse(draft));
      } catch (e) { /* weiter */ }
    }
    try {
      const res = await fetch('config.json?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) return U.merge(CS.DEFAULT_CONFIG, await res.json());
    } catch (e) { /* z. B. lokal als Datei geöffnet */ }
    return U.clone(CS.DEFAULT_CONFIG);
  }

  // ---------------------------------------------------------
  //  Darstellung
  // ---------------------------------------------------------
  function applyTheme() {
    const th = state.cfg.theme;
    const root = document.documentElement.style;
    const set = (name, hex) => {
      const { r, g, b } = U.hexToRgb(hex);
      root.setProperty('--' + name, hex);
      root.setProperty('--' + name + '-rgb', `${r}, ${g}, ${b}`);
    };
    root.setProperty('--bg', th.bg || '#05060f');
    set('a1', th.accent1);
    set('a2', th.accent2);
    set('a3', th.accent3);
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', th.bg || '#05060f');
  }

  function computeMode() {
    return state.forcedMode || U.currentMode(state.cfg);
  }

  function setText(sel, text) {
    const el = typeof sel === 'string' ? $(sel) : sel;
    if (el) el.textContent = text;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function render() {
    const cfg = state.cfg;
    const live = state.mode === 'live';
    const name = cfg.brand.name || 'Coming Soon';

    document.documentElement.lang = state.lang;
    body.classList.toggle('mode-live', live);
    body.classList.toggle('mode-soon', !live);
    $('#nebula').hidden = cfg.effects.nebula === false;

    // Feste UI-Texte
    $$('[data-ui]').forEach((n) => { n.textContent = ui(n.dataset.ui); });
    $$('.lang-switch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang)));
    $('#banner-close').setAttribute('aria-label', ui('closeBanner'));
    $('#btn-menu').setAttribute('aria-label', ui('menu'));
    $('#btn-game').setAttribute('aria-label', ui('play'));
    $('#btn-game').title = ui('play');
    $('#btn-game').hidden = !cfg.sections.game;
    updateSoundButton();

    // Marke, Tab-Titel, Favicon
    renderLogo($('#brand-logo'));
    setText('#brand-name', name);
    setText('#footer-brand', name);
    document.title = live ? `${name} – ${t(cfg.live.badge)}` : U.format(cfg.seo.title, { name });
    updateFavicon();

    // Banner
    const bannerText = t(cfg.banner.text);
    const bannerKey = 'cs-banner-closed:' + bannerText;
    let closed = false;
    try { closed = sessionStorage.getItem(bannerKey) === '1'; } catch (e) { /* egal */ }
    $('#banner').hidden = !cfg.banner.enabled || !bannerText || closed;
    const bt = $('#banner-text');
    bt.textContent = '';
    const bLink = U.safeUrl(cfg.banner.link);
    if (bLink) {
      const a = el('a', null, bannerText);
      a.href = bLink;
      if (/^https?:/i.test(bLink)) { a.target = '_blank'; a.rel = 'noopener'; }
      bt.append(a);
    } else {
      bt.textContent = bannerText;
    }
    bt.dataset.key = bannerKey;
    updateHeaderOffset();

    // Hero
    setText('#badge-text', t(live ? cfg.live.badge : cfg.soon.badge));
    const title = live ? t(cfg.live.headline) : t(cfg.soon.headline);
    const titleEl = $('#title');
    titleEl.textContent = title;
    titleEl.dataset.text = title;
    setText('#lead', t(live ? cfg.live.text : cfg.soon.text));

    // Countdown
    state.countdown.build(cfg.countdown.style, { days: ui('days'), hours: ui('hours'), minutes: ui('minutes'), seconds: ui('seconds') });
    state.countdown.units && Object.values(state.countdown.units).forEach((u) => { u.value = null; });
    if (Number.isFinite(state.launch)) {
      const dateStr = new Intl.DateTimeFormat(locale(), {
        dateStyle: 'long', timeStyle: 'short', timeZone: cfg.timeZone || 'Europe/Berlin',
      }).format(new Date(state.launch));
      setText('#launch-date', ui('launchAt', { date: dateStr }));
    }
    updateCountdown();

    // Live-Buttons
    const cta = $('#cta-main');
    cta.textContent = t(cfg.live.ctaText);
    cta.href = U.safeUrl(cfg.live.ctaLink) || '#features';
    cta.hidden = !t(cfg.live.ctaText);
    $('#cta-game').hidden = !cfg.sections.game;

    // Anmeldeformulare
    renderSignup();

    // Hinweis mit Taste
    const hint = $('#hint');
    hint.textContent = '';
    const parts = ui('hint').split('{key}');
    hint.append(parts[0] || '');
    if (parts.length > 1) { hint.append(el('kbd', null, ui('spaceKey')), parts[1]); }
    hint.hidden = reduceMotion || live;

    // Abschnitte
    renderFeatures(live);
    renderAbout();
    renderStats();
    renderRoadmap();
    renderGame();
    renderFaq();
    setText('#newsletter-title', t(cfg.signup.liveTitle));
    setText('#newsletter-text', t(cfg.signup.liveText));
    $('#newsletter').hidden = !cfg.signup.enabled;

    $('#features').hidden = !cfg.sections.features || !cfg.features.items.length;
    $('#about').hidden = !cfg.sections.about || !t(cfg.about.text);
    $('#stats').hidden = !cfg.sections.stats || !cfg.stats.items.length;
    $('#roadmap').hidden = !cfg.sections.roadmap || !cfg.roadmap.items.length;
    $('#game-section').hidden = !cfg.sections.game;
    $('#faq').hidden = !cfg.sections.faq || !cfg.faq.items.length;

    renderNav(live);
    renderFooter();

    // Scroll-Hinweis zeigt auf den ersten sichtbaren Abschnitt
    const firstSection = $$('main > .section').find((s) => !s.hidden && getComputedStyle(s).display !== 'none');
    $('#scroll-cue').hidden = !firstSection;
    if (firstSection) $('#scroll-cue').href = '#' + firstSection.id;

    CS.space.configure(cfg);
    observeReveals();
    state.rendered = true;
  }

  function renderLogo(target) {
    const b = state.cfg.brand;
    target.textContent = '';
    const src = b.logoType === 'image' ? U.safeUrl(b.logoImage, { allowData: true }) : '';
    if (src) {
      const img = el('img');
      img.src = src;
      img.alt = '';
      target.append(img);
    } else {
      target.textContent = b.logoEmoji || '🚀';
    }
  }

  function updateFavicon() {
    const b = state.cfg.brand;
    let href = '';
    if (b.logoType === 'image') href = U.safeUrl(b.logoImage, { allowData: true });
    if (!href) {
      const emoji = U.escapeHtml(b.logoEmoji || '🚀');
      href = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${emoji}</text></svg>`);
    }
    let link = $('link[rel="icon"]');
    if (!link) { link = el('link'); link.rel = 'icon'; document.head.append(link); }
    link.removeAttribute('type');
    link.href = href;
  }

  function updateHeaderOffset() {
    const h = $('#header').offsetHeight || 64;
    document.documentElement.style.setProperty('--header-h', Math.max(64, h) + 'px');
  }

  function renderSignup() {
    const cfg = state.cfg;
    const signed = store.get('cs-signed-up');
    $$('.signup-form').forEach((form) => {
      const input = $('input[type="email"]', form);
      input.placeholder = ui('emailPlaceholder');
      $('button[type="submit"]', form).textContent = t(cfg.signup.button);
      const msg = $(`[data-msg-for="${form.id}"]`);
      const visible = cfg.signup.enabled && !(form.id === 'signup-hero' && state.mode === 'live');
      form.hidden = !visible || !!signed;
      if (msg) {
        msg.hidden = !visible;
        if (signed) { msg.textContent = ui('alreadySigned'); msg.className = 'form-msg ok'; }
        else if (msg.classList.contains('ok')) { msg.textContent = ''; msg.className = 'form-msg'; }
      }
    });
  }

  function renderFeatures(live) {
    const cfg = state.cfg;
    setText('#features-title', t(cfg.features.title));
    const grid = $('#features-grid');
    grid.textContent = '';
    const locked = !live && !cfg.features.revealBeforeLaunch;
    cfg.features.items.forEach((item, i) => {
      const card = el('article', 'card feature reveal' + (locked ? ' locked' : ''));
      card.style.transitionDelay = (i % 3) * 80 + 'ms';
      if (locked) {
        card.append(el('div', 'feature-icon', '🔒'));
        const tb = el('span', 'redacted title-bar');
        tb.style.width = 45 + ((i * 17) % 35) + '%';
        const l1 = el('span', 'redacted');
        l1.style.width = '92%';
        const l2 = el('span', 'redacted');
        l2.style.width = 55 + ((i * 23) % 30) + '%';
        card.append(tb, l1, l2, el('span', 'lock-note', '✨ ' + ui('locked')));
        card.title = ui('locked');
      } else {
        card.append(el('div', 'feature-icon', item.icon || '✨'), el('h3', null, t(item.title)), el('p', null, t(item.text)));
      }
      grid.append(card);
    });
  }

  function renderAbout() {
    const cfg = state.cfg;
    setText('#about-title', t(cfg.about.title));
    setText('#about-text', t(cfg.about.text));
    const img = $('#about-img');
    const src = U.safeUrl(cfg.about.image, { allowData: true });
    img.hidden = !src;
    if (src) { img.src = src; img.alt = t(cfg.about.title); }
    const wrap = $('#about-body');
    wrap.classList.toggle('has-image', !!src);
    wrap.classList.toggle('no-image', !src);
  }

  function renderStats() {
    const grid = $('#stats-grid');
    grid.textContent = '';
    state.cfg.stats.items.forEach((s) => {
      const card = el('div', 'card stat reveal');
      const value = el('div', 'stat-value gradient-text', state.statsCounted ? Number(s.value || 0).toLocaleString(locale()) + (s.suffix || '') : '0');
      value.dataset.value = s.value;
      value.dataset.suffix = s.suffix || '';
      card.append(value, el('div', 'stat-label', t(s.label)));
      grid.append(card);
    });
  }

  function renderRoadmap() {
    const cfg = state.cfg;
    setText('#roadmap-title', t(cfg.roadmap.title));
    const tl = $('#timeline');
    tl.textContent = '';
    cfg.roadmap.items.forEach((item) => {
      const status = ['done', 'active', 'planned'].includes(item.status) ? item.status : 'planned';
      const row = el('div', 'card tl-item reveal ' + status);
      row.append(el('span', 'tl-dot', status === 'done' ? '✓' : ''));
      const head = el('div', 'tl-head');
      if (item.date) head.append(el('span', 'tl-date', item.date));
      head.append(el('span', 'tl-status', ui('status_' + status)));
      row.append(head, el('h3', null, t(item.title)));
      const text = t(item.text);
      if (text) row.append(el('p', null, text));
      tl.append(row);
    });
  }

  function renderGame() {
    const cfg = state.cfg;
    setText('#game-title', t(cfg.game.title));
    setText('#game-text', t(cfg.game.text));
    const best = CS.game ? CS.game.best() : 0;
    const bestEl = $('#game-best');
    bestEl.hidden = !best;
    bestEl.textContent = '🏆 ' + ui('highscore', { n: best.toLocaleString(locale()) });
  }

  function renderFaq() {
    const cfg = state.cfg;
    setText('#faq-title', t(cfg.faq.title));
    const list = $('#faq-list');
    const open = $$('details', list).map((d) => d.open);
    list.textContent = '';
    cfg.faq.items.forEach((item, i) => {
      const d = el('details', 'card reveal');
      d.open = !!open[i];
      d.append(el('summary', null, t(item.q)), el('div', 'answer', t(item.a)));
      list.append(d);
    });
  }

  function renderNav(live) {
    const nav = $('#nav');
    nav.textContent = '';
    if (!live) return;
    const cfg = state.cfg;
    const links = [
      ['features', cfg.features.title],
      ['about', cfg.about.title],
      ['roadmap', cfg.roadmap.title],
      ['game-section', cfg.game.title],
      ['faq', cfg.faq.title],
    ];
    for (const [id, title] of links) {
      const sec = document.getElementById(id);
      if (!sec || sec.hidden) continue;
      const a = el('a', null, t(title));
      a.href = '#' + id;
      a.addEventListener('click', () => $('#header').classList.remove('menu-open'));
      nav.append(a);
    }
  }

  function renderFooter() {
    const cfg = state.cfg;
    const social = $('#social');
    social.textContent = '';
    let count = 0;
    if (cfg.sections.social) {
      for (const entry of cfg.social || []) {
        const icon = CS.ICONS[entry.type] || CS.ICONS.website;
        let url = String(entry.url || '').trim();
        if (entry.type === 'email' && url && !/^mailto:/i.test(url) && url.includes('@')) url = 'mailto:' + url;
        url = U.safeUrl(url);
        if (!url && !isPreview) continue;
        const a = el('a');
        a.href = url || '#';
        a.setAttribute('aria-label', icon.label + (url ? '' : ' – ' + ui('linkMissing')));
        a.title = url ? icon.label : icon.label + ' – ' + ui('linkMissing');
        if (/^https?:/i.test(url)) { a.target = '_blank'; a.rel = 'noopener me'; }
        if (!url) { a.classList.add('missing'); a.addEventListener('click', (e) => e.preventDefault()); }
        let brand = icon.color;
        if (U.luminance(brand) < 0.12) brand = '#ffffff';
        if (U.luminance(brand) > 0.7) a.classList.add('light-brand');
        a.style.setProperty('--brand', brand);
        a.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icon.d}"/></svg>`;
        social.append(a);
        count++;
      }
    }
    social.hidden = !count;
    setText('#footer-text', t(cfg.footer.text));
    setText('#year', new Date().getFullYear());
    $('#admin-link').hidden = !cfg.footer.showAdminLink;
    renderEggCount();
    loadAnalytics();
  }

  // ---------------------------------------------------------
  //  Countdown & Launch
  // ---------------------------------------------------------
  function updateCountdown() {
    if (state.mode !== 'soon') return;
    const wrap = $('#countdown-wrap');
    const diff = state.launch - Date.now();
    if (!Number.isFinite(diff) || diff <= 0) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const total = Math.floor(diff / 1000);
    state.countdown.set('days', Math.floor(total / 86400));
    state.countdown.set('hours', Math.floor((total % 86400) / 3600));
    state.countdown.set('minutes', Math.floor((total % 3600) / 60));
    state.countdown.set('seconds', total % 60);
  }

  function tick() {
    const mode = computeMode();
    if (mode !== state.mode && !state.showRunning) {
      const wasSoon = state.mode === 'soon';
      if (wasSoon && mode === 'live' && state.rendered) { launchShow(); return; }
      state.mode = mode;
      render();
      return;
    }
    updateCountdown();
  }

  function launchShow() {
    if (state.showRunning) return;
    state.showRunning = true;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    setWarp(true);
    CS.sound.sfx('liftoff');
    const banner = el('div', 'liftoff gradient-text', ui('liftoff'));
    body.append(banner);
    setTimeout(() => {
      setWarp(false);
      state.mode = 'live';
      render();
      fx.confettiCannons();
      fx.confettiRain(2500);
      CS.sound.sfx('success');
    }, 1900);
    setTimeout(() => { banner.remove(); state.showRunning = false; }, 2300);
  }

  // ---------------------------------------------------------
  //  Warp-Steuerung
  // ---------------------------------------------------------
  const INTERACTIVE = 'a, button, input, textarea, select, label, summary, details, form, .game-modal, .card';

  function setWarp(on) {
    if (reduceMotion) return;
    if (on === CS.space.isWarping()) return;
    CS.space.setWarp(on);
    body.classList.toggle('warping', on);
    CS.sound.warp(on);
  }

  function inWarpZone(target) {
    if (!target || !target.closest) return false;
    if (target.closest(INTERACTIVE)) return false;
    return !!target.closest('.hero') || target === body || target === document.documentElement ||
      target.matches('main, .section, .footer, .planets, .nebula');
  }

  let touchTimer = 0;
  window.addEventListener('pointerdown', (e) => {
    if (CS.game.isOpen() || !inWarpZone(e.target)) return;
    if (e.pointerType === 'touch') {
      clearTimeout(touchTimer);
      touchTimer = setTimeout(() => setWarp(true), 220);
    } else if (e.button === 0) {
      setWarp(true);
    }
  });
  const stopWarp = () => { clearTimeout(touchTimer); setWarp(false); };
  window.addEventListener('pointerup', stopWarp);
  window.addEventListener('pointercancel', stopWarp);
  window.addEventListener('blur', stopWarp);
  window.addEventListener('scroll', () => clearTimeout(touchTimer), { passive: true });
  window.addEventListener('contextmenu', (e) => { if (inWarpZone(e.target) && e.target.closest && e.target.closest('.hero')) e.preventDefault(); });

  function typingInField() {
    const a = document.activeElement;
    return !!(a && a.closest && a.closest('input, textarea, select, button, summary, a'));
  }

  window.addEventListener('keydown', (e) => {
    if (CS.game.isOpen()) return;
    if (e.code === 'Space' && !typingInField()) {
      e.preventDefault();
      if (!e.repeat) setWarp(true);
    }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') setWarp(false); });

  // ---------------------------------------------------------
  //  Easter Eggs
  // ---------------------------------------------------------
  function loadEggs() {
    try { return new Set(JSON.parse(localStorage.getItem('cs-eggs')) || []); } catch (e) { return new Set(); }
  }

  function eggsTotal() {
    return CS.EGGS.filter((id) => id !== 'secret' || state.cfg.easterEggs.secretWord).length;
  }

  function renderEggCount() {
    const elc = $('#eggs-count');
    const n = state.eggs.size;
    elc.hidden = !n || !state.cfg.easterEggs.enabled;
    elc.textContent = '🥚 ' + ui('eggs', { n: Math.min(n, eggsTotal()), total: eggsTotal() });
  }

  function foundEgg(id) {
    if (!state.eggs.has(id)) {
      state.eggs.add(id);
      store.set('cs-eggs', JSON.stringify(Array.from(state.eggs)));
      setTimeout(() => {
        fx.toast(ui('eggFound', { n: Math.min(state.eggs.size, eggsTotal()), total: eggsTotal(), name: ui('egg_' + id) }), 3200);
        CS.sound.sfx('egg');
      }, 400);
      renderEggCount();
    }
  }

  const eggsOn = () => state.cfg.easterEggs.enabled;

  const EGG = {
    konami() {
      const on = !CS.space.isRainbow();
      CS.space.setRainbow(on);
      if (on) foundEgg('konami'); else fx.toast('🌈 Off');
    },
    party() {
      body.classList.add('party');
      fx.confettiRain(5000);
      CS.sound.sfx('success');
      setTimeout(() => body.classList.remove('party'), 6000);
      foundEgg('party');
    },
    ufo() {
      const u = el('div', 'ufo');
      u.innerHTML = `<svg viewBox="0 0 120 110" aria-hidden="true">
        <path class="beam" d="M44 46 L76 46 L100 110 L20 110 Z" fill="rgba(var(--a2-rgb),.35)"/>
        <ellipse cx="60" cy="28" rx="20" ry="18" fill="rgba(var(--a2-rgb),.55)" stroke="#fff" stroke-opacity=".6"/>
        <ellipse cx="60" cy="40" rx="56" ry="14" fill="#c9cde8"/>
        <ellipse cx="60" cy="36" rx="56" ry="8" fill="#e9ecff"/>
        <circle cx="26" cy="41" r="3.5" fill="var(--a3)"/><circle cx="48" cy="45" r="3.5" fill="var(--a2)"/>
        <circle cx="72" cy="45" r="3.5" fill="var(--a3)"/><circle cx="94" cy="41" r="3.5" fill="var(--a2)"/>
        <circle cx="54" cy="24" r="2" fill="#fff"/><circle cx="66" cy="24" r="2" fill="#fff"/>
      </svg>`;
      body.append(u);
      u.addEventListener('animationend', (e) => { if (e.target === u) u.remove(); });
      foundEgg('ufo');
    },
    warp() {
      setWarp(true);
      setTimeout(() => setWarp(false), 4000);
      foundEgg('warp');
    },
    roll() {
      body.classList.remove('barrel-roll');
      void body.offsetWidth;
      body.classList.add('barrel-roll');
      setTimeout(() => body.classList.remove('barrel-roll'), 1300);
      foundEgg('roll');
    },
    rocket() {
      if (CS.space.launchRocket()) {
        CS.sound.sfx('liftoff');
        foundEgg('rocket');
      }
    },
    secret() {
      fx.toast(t(state.cfg.easterEggs.secretMessage), 4000);
      fx.confetti({ count: 160 });
      foundEgg('secret');
    },
  };

  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

  window.addEventListener('keydown', (e) => {
    if (!eggsOn() || CS.game.isOpen() || typingInField()) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    // Konami-Code
    if (key === KONAMI[state.konamiPos]) state.konamiPos++;
    else state.konamiPos = key === KONAMI[0] ? 1 : 0;
    if (state.konamiPos === KONAMI.length) { state.konamiPos = 0; EGG.konami(); }

    // Getippte Wörter
    if (/^[a-zäöüß0-9]$/.test(key)) {
      state.typed = (state.typed + key).slice(-24);
      const secret = String(state.cfg.easterEggs.secretWord || '').toLowerCase().trim();
      const words = { party: EGG.party, ufo: EGG.ufo, warp: EGG.warp };
      for (const [word, fn] of Object.entries(words)) {
        if (state.typed.endsWith(word)) { state.typed = ''; fn(); return; }
      }
      if (secret && state.typed.endsWith(secret)) { state.typed = ''; EGG.secret(); }
    }
  });

  $('#brand').addEventListener('click', () => {
    if (!eggsOn()) return;
    const now = Date.now();
    state.logoClicks = state.logoClicks.filter((ts) => now - ts < 2000).concat(now);
    if (state.logoClicks.length >= 5) { state.logoClicks = []; EGG.roll(); }
  });

  $('#rocket').addEventListener('click', () => { if (eggsOn()) EGG.rocket(); else CS.space.launchRocket(); });

  // ---------------------------------------------------------
  //  Anmeldung
  // ---------------------------------------------------------
  async function submitSignup(form) {
    const cfg = state.cfg;
    const input = $('input[type="email"]', form);
    const honeypot = $('.hp', form);
    const button = $('button[type="submit"]', form);
    const msg = $(`[data-msg-for="${form.id}"]`);
    const show = (text, kind) => { msg.textContent = text; msg.className = 'form-msg ' + (kind || ''); };

    const email = input.value.trim();
    if (!email || !input.checkValidity()) {
      show(ui('invalidEmail'), 'error');
      input.focus();
      return;
    }

    button.disabled = true;
    show(ui('sending'));
    try {
      const endpoint = U.safeUrl(cfg.signup.endpoint);
      if (honeypot && honeypot.value) {
        // Spam-Bot – so tun, als hätte es geklappt
      } else if (endpoint && /^https:/i.test(endpoint) && !isPreview) {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ email, language: state.lang, source: state.mode === 'live' ? 'live' : 'coming-soon', page: location.href.split('?')[0] }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
      } else {
        console.warn('[Coming Soon] Kein Anmelde-Endpunkt eingestellt – die E-Mail-Adresse wurde NICHT gespeichert. Im Admin-Panel unter „Anmeldung“ einrichten.');
      }
      input.value = '';
      if (!isPreview) store.set('cs-signed-up', '1');
      show(t(cfg.signup.success), 'ok');
      const r = button.getBoundingClientRect();
      fx.confetti({ x: r.left + r.width / 2, y: r.top, count: 120 });
      CS.sound.sfx('success');
      setWarp(true);
      setTimeout(() => setWarp(false), 1200);
      setTimeout(() => {
        $$('.signup-form').forEach((f) => { if (!isPreview) f.hidden = true; });
        if (!isPreview) renderSignup();
        button.disabled = false;
      }, 2500);
    } catch (err) {
      show(ui('sendError'), 'error');
      button.disabled = false;
    }
  }

  $$('.signup-form').forEach((form) => form.addEventListener('submit', (e) => { e.preventDefault(); submitSignup(form); }));

  // ---------------------------------------------------------
  //  Kalender & Teilen
  // ---------------------------------------------------------
  function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1'); }

  $('#btn-calendar').addEventListener('click', () => {
    if (!Number.isFinite(state.launch)) return;
    const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const name = state.cfg.brand.name || 'Launch';
    const url = location.href.split(/[?#]/)[0];
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Coming Soon//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${state.launch}-launch@coming-soon`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(new Date(state.launch))}`,
      `DTEND:${fmt(new Date(state.launch + 3600000))}`,
      `SUMMARY:${icsEscape(name + ' – Launch 🚀')}`,
      `DESCRIPTION:${icsEscape(t(state.cfg.soon.text) + '\n' + url)}`,
      `URL:${url}`,
      'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(name)}`, 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const a = el('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    a.download = (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'launch') + '-launch.ics';
    body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });

  $('#btn-share').addEventListener('click', async () => {
    const url = location.href.split(/[?#]/)[0];
    const title = document.title;
    try {
      if (navigator.share) { await navigator.share({ title, text: t(state.cfg.soon.text), url }); return; }
      await navigator.clipboard.writeText(url);
      fx.toast(ui('linkCopied'));
    } catch (e) { /* abgebrochen */ }
  });

  // ---------------------------------------------------------
  //  Statistik (GoatCounter, ohne Cookies)
  // ---------------------------------------------------------
  function loadAnalytics() {
    const a = state.cfg.analytics;
    const code = String(a.goatcounter || '').trim().toLowerCase();
    const valid = /^[a-z0-9-]{2,50}$/.test(code);
    const visitors = $('#visitors');
    if (!valid) { visitors.hidden = true; return; }

    if (!isPreview && !state.analyticsLoaded) {
      state.analyticsLoaded = true;
      const s = el('script');
      s.async = true;
      s.src = 'https://gc.zgo.at/count.js';
      s.dataset.goatcounter = `https://${code}.goatcounter.com/count`;
      document.head.append(s);
    }

    if (!a.showCounter) { visitors.hidden = true; return; }
    if (isPreview) {
      visitors.hidden = false;
      visitors.textContent = '👀 ' + ui('visitors', { n: '1.234' });
      return;
    }
    fetch(`https://${code}.goatcounter.com/counter/TOTAL.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || d.count == null) return;
        visitors.hidden = false;
        visitors.textContent = '👀 ' + ui('visitors', { n: String(d.count).replace(/\s/g, '') });
      })
      .catch(() => {});
  }

  // ---------------------------------------------------------
  //  Kleinkram: Einblenden, Header, Menü, Sound, Sprache
  // ---------------------------------------------------------
  let revealObserver = null;
  function observeReveals() {
    const items = $$('.reveal:not(.in-view)');
    if (!('IntersectionObserver' in window) || reduceMotion) {
      items.forEach((n) => n.classList.add('in-view'));
      countStats();
      return;
    }
    if (!revealObserver) {
      revealObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('in-view');
          revealObserver.unobserve(entry.target);
          if (entry.target.classList.contains('stat')) countStats();
        }
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    }
    items.forEach((n) => revealObserver.observe(n));
  }

  function countStats() {
    if (state.statsCounted || state.mode !== 'live') return;
    state.statsCounted = true;
    $$('#stats-grid .stat-value').forEach((v) => fx.countUp(v, v.dataset.value, v.dataset.suffix, locale()));
  }

  window.addEventListener('scroll', () => {
    $('#header').classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });

  $('#btn-menu').addEventListener('click', () => {
    const open = $('#header').classList.toggle('menu-open');
    $('#btn-menu').setAttribute('aria-expanded', String(open));
  });

  $('#banner-close').addEventListener('click', () => {
    try { sessionStorage.setItem($('#banner-text').dataset.key, '1'); } catch (e) { /* egal */ }
    $('#banner').hidden = true;
    updateHeaderOffset();
  });

  // Lichtkegel auf Feature-Karten
  $('#features-grid').addEventListener('pointermove', (e) => {
    const card = e.target.closest('.feature');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', e.clientX - r.left + 'px');
    card.style.setProperty('--my', e.clientY - r.top + 'px');
  });

  function updateSoundButton() {
    const on = CS.sound.isEnabled();
    const b = $('#btn-sound');
    b.textContent = on ? '🔊' : '🔇';
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? ui('soundOff') : ui('soundOn');
    b.setAttribute('aria-label', b.title);
  }

  $('#btn-sound').addEventListener('click', () => {
    CS.sound.toggle();
    updateSoundButton();
    CS.sound.sfx('click');
  });

  // Sound automatisch beim ersten Klick starten, falls im Admin so eingestellt
  function firstGesture() {
    window.removeEventListener('pointerdown', firstGesture);
    window.removeEventListener('keydown', firstGesture);
    CS.space.enableTilt();
    const saved = CS.sound.saved();
    if (saved === true || (saved === null && state.cfg.effects.soundDefault)) {
      CS.sound.setEnabled(true);
      updateSoundButton();
    }
  }
  window.addEventListener('pointerdown', firstGesture);
  window.addEventListener('keydown', firstGesture);

  function setLang(lang) {
    if (lang !== 'de' && lang !== 'en') return;
    state.lang = lang;
    if (!isPreview) store.set('cs-lang', lang);
    render();
  }
  $$('.lang-switch button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

  // Spiel
  function openGame() { CS.game.open({ lang: state.lang, title: t(state.cfg.game.title) }); }
  $('#btn-game').addEventListener('click', openGame);
  $('#cta-game').addEventListener('click', openGame);
  $('#game-start-btn').addEventListener('click', openGame);
  CS.game.onClose = () => renderGame();

  // Glitch-Effekt im Titel
  (function scheduleGlitch() {
    setTimeout(() => {
      const title = $('#title');
      if (!reduceMotion && state.cfg.effects.glitch !== false && !document.hidden) {
        title.classList.add('glitch');
        setTimeout(() => title.classList.remove('glitch'), 400);
      }
      scheduleGlitch();
    }, 3000 + Math.random() * 4000);
  })();

  // ---------------------------------------------------------
  //  Live-Vorschau für das Admin-Panel
  // ---------------------------------------------------------
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    const d = e.data || {};
    if (d.type === 'cs:config' && d.config) {
      state.cfg = U.merge(CS.DEFAULT_CONFIG, d.config);
      applyConfig();
    } else if (d.type === 'cs:force-mode') {
      state.forcedMode = d.mode === 'soon' || d.mode === 'live' ? d.mode : null;
      state.mode = computeMode();
      render();
    } else if (d.type === 'cs:launch-test') {
      state.forcedMode = 'live';
      state.mode = 'soon';
      render();
      launchShow();
    } else if (d.type === 'cs:lang') {
      setLang(d.lang);
    }
  });

  function applyConfig() {
    state.launch = U.launchTime(state.cfg);
    applyTheme();
    if (!state.showRunning) state.mode = computeMode();
    render();
  }

  // ---------------------------------------------------------
  //  Start
  // ---------------------------------------------------------
  async function init() {
    state.cfg = await loadConfig();
    state.lang = pickLang(state.cfg);
    CS.space.start();
    applyConfig();
    setInterval(tick, 1000);
    window.addEventListener('resize', updateHeaderOffset);
    if (!isPreview) {
      console.log('%c🚀 Hey du!', 'font-size:20px;font-weight:bold;color:#7c5cff');
      console.log('%cSchön, dass du reinschaust. Hier sind ein paar Easter Eggs versteckt … Tipp: ↑ ↑ ↓ ↓ ← → ← → B A', 'color:#00d4ff');
    }
  }

  init();
})();
