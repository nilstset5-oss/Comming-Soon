/* =========================================================
   Standard-Einstellungen, Texte und Hilfsfunktionen.
   Wird von der Seite, dem Admin-Panel und (für Tests) von Node geladen.
   ========================================================= */
(function (root) {
  'use strict';
  const CS = (root.CS = root.CS || {});

  const L = (de, en) => ({ de, en });

  // ---------------------------------------------------------
  //  Farbthemen
  // ---------------------------------------------------------
  CS.THEMES = {
    galaxy: { label: 'Galaxy', bg: '#05060f', accent1: '#7c5cff', accent2: '#00d4ff', accent3: '#ff4fd8' },
    sunset: { label: 'Sunset', bg: '#0f0507', accent1: '#ff6b35', accent2: '#ffb347', accent3: '#ff2e88' },
    matrix: { label: 'Matrix', bg: '#020a05', accent1: '#00ff88', accent2: '#7dffb3', accent3: '#00c2ff' },
    ocean:  { label: 'Ocean',  bg: '#020b14', accent1: '#0077ff', accent2: '#00e5ff', accent3: '#6affc8' },
    fire:   { label: 'Fire',   bg: '#0d0303', accent1: '#ff3b30', accent2: '#ffcc00', accent3: '#ff7a00' },
    candy:  { label: 'Candy',  bg: '#0c0614', accent1: '#ff7eb9', accent2: '#7afcff', accent3: '#feff9c' },
    mono:   { label: 'Mono',   bg: '#050505', accent1: '#ffffff', accent2: '#9a9a9a', accent3: '#d4d4d4' },
  };

  // ---------------------------------------------------------
  //  Standard-Konfiguration (wird von config.json überschrieben)
  // ---------------------------------------------------------
  CS.DEFAULT_CONFIG = {
    version: 1,

    // 'auto' = nach Datum, 'soon' = immer Coming Soon, 'live' = immer Live-Seite
    mode: 'auto',
    launchDate: '2026-12-01T00:00',
    timeZone: 'Europe/Berlin',
    defaultLang: 'auto',

    brand: {
      name: 'NOVA',
      logoType: 'emoji', // 'emoji' | 'image'
      logoEmoji: '🚀',
      logoImage: '',
    },

    theme: { preset: 'galaxy', ...stripLabel(CS.THEMES.galaxy) },

    effects: {
      stars: true,
      starDensity: 1,
      starSpeed: 1,
      nebula: true,
      planets: true,
      rocket: true,
      glitch: true,
      tilt: true,
      parallax: true,
      soundDefault: false,
      finalCountdown: true,
      presence: true,
      reactions: true,
    },

    countdown: { style: 'flip' },

    banner: {
      enabled: false,
      text: L('🎉 Frühstarter-Aktion: Die ersten 100 Anmeldungen bekommen eine Überraschung!',
              '🎉 Early birds: the first 100 sign-ups get a surprise!'),
      link: '',
    },

    soon: {
      badge: L('In Arbeit', 'In the works'),
      headline: L('Coming Soon', 'Coming Soon'),
      text: L('Hier entsteht gerade etwas Großes. Trag dich ein und sei beim Start als Erstes dabei.',
              'Something big is on its way. Sign up and be the first to know when we launch.'),
    },

    live: {
      badge: L('Jetzt live', 'Now live'),
      headline: L('{name} ist da.', '{name} is here.'),
      text: L('Das Warten hat ein Ende. Entdecke, was wir für dich gebaut haben – schneller, schöner und mit mehr Sternenstaub als je zuvor.',
              'The wait is over. Discover what we built for you – faster, prettier and with more stardust than ever.'),
      ctaText: L('Jetzt entdecken', 'Explore now'),
      ctaLink: '#features',
    },

    signup: {
      enabled: true,
      endpoint: '',
      button: L('Benachrichtige mich', 'Notify me'),
      success: L('Danke! Wir melden uns, sobald es losgeht. 🚀', 'Thanks! We’ll let you know when we launch. 🚀'),
      liveTitle: L('Bleib auf dem Laufenden', 'Stay in the loop'),
      liveText: L('Neuigkeiten, Updates und Überraschungen – direkt in dein Postfach.',
                  'News, updates and surprises – straight to your inbox.'),
    },

    sections: {
      features: true,
      about: true,
      stats: true,
      roadmap: true,
      game: true,
      faq: true,
      social: true,
    },

    features: {
      title: L('Was dich erwartet', 'What to expect'),
      revealBeforeLaunch: false,
      items: [
        { icon: '⚡', title: L('Blitzschnell', 'Lightning fast'), text: L('Gebaut für Tempo. Keine Ladebalken, kein Warten.', 'Built for speed. No loading bars, no waiting.') },
        { icon: '🎨', title: L('Wunderschön', 'Beautiful'), text: L('Ein Design, das man so schnell nicht vergisst.', 'A design you won’t forget anytime soon.') },
        { icon: '🔒', title: L('Sicher', 'Secure'), text: L('Deine Daten bleiben deine Daten. Punkt.', 'Your data stays yours. Period.') },
        { icon: '🌍', title: L('Überall', 'Everywhere'), text: L('Auf Handy, Tablet und Computer – überall zu Hause.', 'On phone, tablet and desktop – at home everywhere.') },
        { icon: '🤝', title: L('Community', 'Community'), text: L('Gemeinsam bauen wir etwas, das bleibt.', 'Together we build something that lasts.') },
        { icon: '✨', title: L('Und noch mehr …', 'And much more …'), text: L('Ein paar Überraschungen verraten wir erst zum Start.', 'Some surprises we only reveal at launch.') },
      ],
    },

    about: {
      title: L('Über uns', 'About us'),
      text: L('Wir sind ein kleines Team mit großen Träumen. {name} ist unser Herzensprojekt – entstanden aus der Idee, etwas zu bauen, das Menschen wirklich begeistert.\n\nMonatelang haben wir getüftelt, verworfen und neu gedacht. Jetzt ist es so weit.',
              'We are a small team with big dreams. {name} is our passion project – born from the idea of building something that genuinely excites people.\n\nFor months we tinkered, scrapped and rethought. Now the time has come.'),
      image: '',
    },

    stats: {
      items: [
        { value: 900, suffix: '+', label: L('Sterne im Hintergrund', 'stars in the background') },
        { value: 7, suffix: '', label: L('versteckte Easter Eggs', 'hidden Easter eggs') },
        { value: 100, suffix: '%', label: L('Liebe zum Detail', 'attention to detail') },
        { value: 1, suffix: '', label: L('Mini-Spiel', 'mini game') },
      ],
    },

    roadmap: {
      title: L('Roadmap', 'Roadmap'),
      items: [
        { date: 'Q3 2026', status: 'done', title: L('Die Idee', 'The idea'), text: L('Aus einem Gedanken wird ein Plan.', 'A thought becomes a plan.') },
        { date: 'Q4 2026', status: 'active', title: L('Bauphase', 'Building'), text: L('Wir bauen, testen und polieren jedes Detail.', 'We build, test and polish every detail.') },
        { date: '01.12.2026', status: 'planned', title: L('Launch 🚀', 'Launch 🚀'), text: L('Der große Tag – sei dabei!', 'The big day – be there!') },
        { date: '2027', status: 'planned', title: L('Und weiter …', 'And beyond …'), text: L('Neue Features, neue Welten.', 'New features, new worlds.') },
      ],
    },

    faq: {
      title: L('Häufige Fragen', 'FAQ'),
      items: [
        { q: L('Wann geht es los?', 'When does it launch?'), a: L('Der Countdown oben zeigt dir genau, wann. Trag dich ein, dann sagen wir dir rechtzeitig Bescheid.', 'The countdown above shows you exactly when. Sign up and we’ll remind you in time.') },
        { q: L('Kostet das etwas?', 'Does it cost anything?'), a: L('Das verraten wir zum Start. Nur so viel: Es lohnt sich.', 'We’ll reveal that at launch. Let’s just say: it’s worth it.') },
        { q: L('Wie bleibe ich auf dem Laufenden?', 'How do I stay up to date?'), a: L('Trag deine E-Mail-Adresse ein oder folge uns auf Social Media.', 'Enter your email address or follow us on social media.') },
        { q: L('Gibt es hier wirklich Easter Eggs?', 'Are there really Easter eggs here?'), a: L('Vielleicht. Probier mal ein paar Tasten aus … 😉', 'Maybe. Try pressing a few keys … 😉') },
      ],
    },

    ai: {
      enabled: true,
      showBeforeLaunch: false,
      persona: 'captain',
      name: L('{name} KI', '{name} AI'),
      greeting: L('Hallo! 👋 Ich bin die KI von {name}. Frag mich alles über das Projekt!',
                  'Hi! 👋 I’m the {name} AI. Ask me anything about the project!'),
      knowledge: '',
      missionControl: true,
    },

    game: {
      title: L('Asteroid Run', 'Asteroid Run'),
      text: L('Langweilig beim Warten? Weich Asteroiden aus, sammle Sterne und knack den Highscore.',
              'Bored while waiting? Dodge asteroids, collect stars and beat the high score.'),
    },

    social: [
      { type: 'github', url: 'https://github.com/nilstset5-oss/Comming-Soon' },
      { type: 'instagram', url: '' },
      { type: 'tiktok', url: '' },
      { type: 'youtube', url: '' },
      { type: 'discord', url: '' },
    ],

    footer: {
      text: L('Mit ❤️ und Sternenstaub gebaut.', 'Built with ❤️ and stardust.'),
      showAdminLink: true,
    },

    easterEggs: {
      enabled: true,
      secretWord: 'nova',
      secretMessage: L('🤫 Psst … du hast das geheime Wort gefunden!', '🤫 Psst … you found the secret word!'),
    },

    analytics: {
      goatcounter: '',
      showCounter: false,
    },

    seo: {
      title: '{name} – Coming Soon',
      description: 'Hier entsteht gerade etwas Großes. Trag dich ein und sei beim Start als Erstes dabei.',
      siteUrl: 'https://nilstset5-oss.github.io/Comming-Soon/',
    },

    github: {
      owner: 'nilstset5-oss',
      repo: 'Comming-Soon',
      branch: '',
    },

    admin: {
      user: 'admin',
      // SHA-256 von "cs-admin:admin:12345" – im Admin-Panel unter „Sicherheit“ änderbar
      passHash: 'a7e2d76baf59f15d1d5932de61f3e8418c802c6386d9ea4851fcd82617aa0b53',
    },
  };

  function stripLabel(theme) {
    const { label, ...rest } = theme;
    return rest;
  }

  // ---------------------------------------------------------
  //  Feste Texte der Oberfläche (nicht im Admin-Panel)
  // ---------------------------------------------------------
  CS.UI = {
    de: {
      days: 'Tage', hours: 'Stunden', minutes: 'Minuten', seconds: 'Sekunden',
      launchAt: 'Start: {date}',
      calendar: 'In den Kalender',
      share: 'Teilen',
      linkCopied: 'Link kopiert! 📋',
      emailLabel: 'E-Mail-Adresse',
      emailPlaceholder: 'deine@email.de',
      invalidEmail: 'Bitte gib eine gültige E-Mail-Adresse ein.',
      sending: 'Wird gesendet …',
      sendError: 'Hat leider nicht geklappt. Versuch es bitte später noch mal.',
      alreadySigned: 'Du bist schon dabei ✓ Wir melden uns!',
      hint: 'Tipp: Maus, Finger oder {key} gedrückt halten für Warp-Speed',
      spaceKey: 'Leertaste',
      soundOn: 'Sound einschalten',
      soundOff: 'Sound ausschalten',
      play: 'Spielen',
      playNow: 'Jetzt spielen 🎮',
      highscore: 'Dein Highscore: {n}',
      locked: 'Wird zum Start enthüllt',
      scroll: 'Mehr entdecken',
      visitors: '{n} Besucher',
      eggs: '{n}/{total} Easter Eggs gefunden',
      eggFound: '🥚 Easter Egg {n}/{total}: {name}',
      liftoff: 'LIFTOFF!',
      admin: 'Admin',
      studio: 'Seite bearbeiten',
      closeBanner: 'Banner schließen',
      menu: 'Menü',
      status_done: 'Erledigt', status_active: 'In Arbeit', status_planned: 'Geplant',
      linkMissing: 'Link fehlt',
      // Spiel
      g_start: 'Start',
      g_again: 'Nochmal',
      g_close: 'Schließen',
      g_controls: 'Steuern: Maus, Finger oder ← →. Geschossen wird automatisch.',
      g_score: 'Punkte',
      g_best: 'Rekord',
      g_paused: 'Pause',
      g_resume: 'Weiter',
      g_over: 'Game Over',
      g_newBest: '🏆 Neuer Rekord!',
      g_name: 'Dein Name',
      g_top: 'Deine Rekorde',
      g_world: '🌍 Bestenliste',
      g_share: 'Ergebnis teilen',
      g_shareText: 'Ich habe {n} Punkte bei {game} geschafft! Schaffst du mehr? 🚀',
      g_items: '⭐ = Punkte · 🛡 = Schild · ⚡ = Dreifach-Schuss',
      // Easter Eggs
      egg_konami: 'Regenbogen-Modus',
      egg_party: 'Party-Modus',
      egg_ufo: 'UFO-Sichtung',
      egg_warp: 'Hyperraum',
      egg_roll: 'Fassrolle',
      egg_rocket: 'Probestart',
      egg_secret: 'Das geheime Wort',
      // KI-Chat
      ai_open: 'Frag {name}',
      ai_placeholder: 'Deine Frage …',
      ai_send: 'Senden',
      ai_stop: 'Stopp',
      ai_thinking: 'denkt nach …',
      ai_note: 'Antworten kommen von Claude über dein Claude-Konto. Die KI kann sich irren.',
      ai_unavailable: 'Die KI ist gerade nicht erreichbar. Versuch es später noch mal.',
      ai_denied: 'Ohne deine Erlaubnis kann die KI nicht antworten.',
      ai_rate: 'Kurz durchatmen – zu viele Fragen auf einmal. Gleich noch mal!',
      ai_refused: 'Dazu kann ich leider nichts sagen.',
      ai_new: 'Neues Gespräch',
      ai_close: 'Chat schließen',
      ai_q1: 'Was ist {name}?',
      ai_q2: 'Was kann man damit machen?',
      ai_q3: 'Wie bleibe ich auf dem Laufenden?',
      // Live
      here: '{n} gerade hier',
      react: 'Reagieren',
      // Spiel-KI
      g_mc: '🎙️ Was sagt Mission Control?',
      g_mcThinking: '📡 Mission Control funkt …',
    },
    en: {
      days: 'Days', hours: 'Hours', minutes: 'Minutes', seconds: 'Seconds',
      launchAt: 'Launch: {date}',
      calendar: 'Add to calendar',
      share: 'Share',
      linkCopied: 'Link copied! 📋',
      emailLabel: 'Email address',
      emailPlaceholder: 'you@email.com',
      invalidEmail: 'Please enter a valid email address.',
      sending: 'Sending …',
      sendError: 'Something went wrong. Please try again later.',
      alreadySigned: 'You’re on the list ✓ We’ll be in touch!',
      hint: 'Tip: hold the mouse, your finger or {key} for warp speed',
      spaceKey: 'Space',
      soundOn: 'Turn sound on',
      soundOff: 'Turn sound off',
      play: 'Play',
      playNow: 'Play now 🎮',
      highscore: 'Your high score: {n}',
      locked: 'Revealed at launch',
      scroll: 'Discover more',
      visitors: '{n} visitors',
      eggs: '{n}/{total} Easter eggs found',
      eggFound: '🥚 Easter egg {n}/{total}: {name}',
      liftoff: 'LIFTOFF!',
      admin: 'Admin',
      studio: 'Edit page',
      closeBanner: 'Close banner',
      menu: 'Menu',
      status_done: 'Done', status_active: 'In progress', status_planned: 'Planned',
      linkMissing: 'Link missing',
      g_start: 'Start',
      g_again: 'Play again',
      g_close: 'Close',
      g_controls: 'Steer with mouse, finger or ← →. Shooting is automatic.',
      g_score: 'Score',
      g_best: 'Best',
      g_paused: 'Paused',
      g_resume: 'Resume',
      g_over: 'Game Over',
      g_newBest: '🏆 New record!',
      g_name: 'Your name',
      g_top: 'Your records',
      g_world: '🌍 Leaderboard',
      g_share: 'Share result',
      g_shareText: 'I scored {n} points in {game}! Can you beat it? 🚀',
      g_items: '⭐ = points · 🛡 = shield · ⚡ = triple shot',
      egg_konami: 'Rainbow mode',
      egg_party: 'Party mode',
      egg_ufo: 'UFO sighting',
      egg_warp: 'Hyperspace',
      egg_roll: 'Barrel roll',
      egg_rocket: 'Test launch',
      egg_secret: 'The secret word',
      ai_open: 'Ask {name}',
      ai_placeholder: 'Your question …',
      ai_send: 'Send',
      ai_stop: 'Stop',
      ai_thinking: 'thinking …',
      ai_note: 'Answers come from Claude using your Claude account. The AI can make mistakes.',
      ai_unavailable: 'The AI isn’t reachable right now. Please try again later.',
      ai_denied: 'The AI can’t answer without your permission.',
      ai_rate: 'Easy there – too many questions at once. Try again in a moment!',
      ai_refused: 'Sorry, I can’t help with that.',
      ai_new: 'New chat',
      ai_close: 'Close chat',
      ai_q1: 'What is {name}?',
      ai_q2: 'What can I do with it?',
      ai_q3: 'How do I stay up to date?',
      here: '{n} here right now',
      react: 'React',
      g_mc: '🎙️ What does Mission Control say?',
      g_mcThinking: '📡 Mission Control is radioing …',
    },
  };

  // Persönlichkeiten für den KI-Chat
  CS.PERSONAS = {
    captain: { label: 'Weltraum-Kapitän', emoji: '🧑‍🚀', prompt: 'Du bist ein gut gelaunter Weltraum-Kapitän. Du klingst ein wenig nach Funkverkehr („Hier spricht der Kapitän …“, ab und zu ein „Over!“) und benutzt gern Weltraum-Vergleiche, bleibst aber hilfreich und gut verständlich.' },
    friendly: { label: 'Freundlich', emoji: '😊', prompt: 'Du bist herzlich, hilfsbereit und erklärst Dinge einfach und klar.' },
    robot: { label: 'Roboter', emoji: '🤖', prompt: 'Du bist ein freundlicher Roboter. Du sprichst präzise und ein bisschen technisch, mit gelegentlichem „Beep-boop“, bleibst aber verständlich.' },
    pirate: { label: 'Weltraum-Pirat', emoji: '🏴‍☠️', prompt: 'Du bist ein Weltraum-Pirat mit großem Herz. Du sprichst wie ein Pirat („Arr!“, „Landratte“), bist aber ehrlich und hilfsbereit.' },
    funny: { label: 'Witzig', emoji: '😄', prompt: 'Du bist locker und witzig, machst kleine Wortspiele, kommst aber schnell auf den Punkt.' },
    pro: { label: 'Professionell', emoji: '💼', prompt: 'Du bist sachlich, höflich und professionell.' },
  };

  CS.EGGS = ['konami', 'party', 'ufo', 'warp', 'roll', 'rocket', 'secret'];

  // ---------------------------------------------------------
  //  Hilfsfunktionen
  // ---------------------------------------------------------
  const U = (CS.util = {});

  U.clone = (obj) => JSON.parse(JSON.stringify(obj));

  U.isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  // Tiefes Zusammenführen: Arrays aus `src` ersetzen die Standardwerte komplett
  U.merge = function merge(base, src) {
    const out = U.clone(base);
    if (!U.isObj(src)) return out;
    for (const key of Object.keys(src)) {
      const value = src[key];
      if (U.isObj(value) && U.isObj(out[key])) out[key] = merge(out[key], value);
      else if (value !== undefined) out[key] = U.clone(value);
    }
    return out;
  };

  U.get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

  U.set = (obj, path, value) => {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
      o = o[keys[i]];
    }
    o[keys[keys.length - 1]] = value;
  };

  U.format = (str, vars) => String(str == null ? '' : str).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? vars[k] : m));

  // Text in der gewünschten Sprache holen (mit Rückfall auf die andere Sprache)
  U.tr = (field, lang, vars) => {
    let s = field;
    if (U.isObj(field)) s = field[lang] || field.de || field.en || '';
    return U.format(s || '', vars);
  };

  // Nur sichere Links zulassen
  U.safeUrl = (url, { allowData = false } = {}) => {
    const s = String(url || '').trim();
    if (!s) return '';
    if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
    if (allowData && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return ''; // javascript:, data: usw. blockieren
    return s; // relative Links und #anker
  };

  U.hexToRgb = (hex) => {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return { r: 124, g: 92, b: 255 };
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };

  U.hexToHue = (hex) => {
    const { r, g, b } = U.hexToRgb(hex);
    const rr = r / 255, gg = g / 255, bb = b / 255;
    const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb), d = max - min;
    if (!d) return { h: 0, s: 0 };
    let h;
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
    const l = (max + min) / 2;
    return { h, s: d / (1 - Math.abs(2 * l - 1)) };
  };

  U.luminance = (hex) => {
    const { r, g, b } = U.hexToRgb(hex);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };

  // Zeitzonen-Versatz in ms für einen Zeitpunkt
  function tzOffset(utcMs, timeZone) {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = {};
    for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return asUtc - Math.floor(utcMs / 1000) * 1000;
  }

  // "2026-12-01T00:00" in der Zeitzone `tz` → Zeitstempel (ms)
  U.zonedToUtc = (local, timeZone) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(local || ''));
    if (!m) return NaN;
    const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    try {
      const off1 = tzOffset(guess, timeZone);
      let t = guess - off1;
      const off2 = tzOffset(t, timeZone);
      if (off2 !== off1) t = guess - off2;
      return t;
    } catch (e) {
      return new Date(local).getTime();
    }
  };

  U.launchTime = (cfg) => U.zonedToUtc(cfg.launchDate, cfg.timeZone || 'Europe/Berlin');

  U.currentMode = (cfg, now = Date.now()) => {
    if (cfg.mode === 'soon' || cfg.mode === 'live') return cfg.mode;
    const t = U.launchTime(cfg);
    return Number.isFinite(t) && now >= t ? 'live' : 'soon';
  };

  U.escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  U.sha256 = async (text) => {
    const c = root.crypto;
    if (!c || !c.subtle) throw new Error('crypto.subtle nicht verfügbar');
    const buf = await c.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  U.passHash = (user, pass) => U.sha256('cs-admin:' + user + ':' + pass);

  // ---------------------------------------------------------
  //  SEO-Block für index.html (Link-Vorschau, Google)
  // ---------------------------------------------------------
  U.seoBlock = (cfg) => {
    const e = U.escapeHtml;
    const name = cfg.brand.name || 'Coming Soon';
    const title = U.format(cfg.seo.title, { name }) || name;
    const desc = U.format(cfg.seo.description, { name });
    let url = String(cfg.seo.siteUrl || '').trim();
    if (url && !url.endsWith('/')) url += '/';
    const img = url ? url + 'assets/img/og-image.jpg' : 'assets/img/og-image.jpg';
    const ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name, url: url || undefined, description: desc })
      .replace(/</g, '\\u003c');
    return [
      '<!-- SEO:START (wird vom Admin-Panel beim Veröffentlichen aktualisiert) -->',
      `  <title>${e(title)}</title>`,
      `  <meta name="description" content="${e(desc)}">`,
      url ? `  <link rel="canonical" href="${e(url)}">` : '',
      '  <meta property="og:type" content="website">',
      `  <meta property="og:site_name" content="${e(name)}">`,
      `  <meta property="og:title" content="${e(title)}">`,
      `  <meta property="og:description" content="${e(desc)}">`,
      url ? `  <meta property="og:url" content="${e(url)}">` : '',
      `  <meta property="og:image" content="${e(img)}">`,
      '  <meta property="og:image:width" content="1200">',
      '  <meta property="og:image:height" content="630">',
      '  <meta name="twitter:card" content="summary_large_image">',
      `  <meta name="twitter:title" content="${e(title)}">`,
      `  <meta name="twitter:description" content="${e(desc)}">`,
      `  <meta name="twitter:image" content="${e(img)}">`,
      `  <script type="application/ld+json">${ld}</script>`,
      '  <!-- SEO:END -->',
    ].filter(Boolean).join('\n');
  };

  U.replaceSeoBlock = (html, cfg) =>
    html.replace(/<!-- SEO:START[\s\S]*?<!-- SEO:END -->/, U.seoBlock(cfg).trim());

  // ---------------------------------------------------------
  //  Seite als Vorlage: Die veröffentlichte Artifact-Seite trägt sich
  //  selbst als Text in sich und kann sich so mit neuen Einstellungen
  //  neu erzeugen (ohne Server, ohne Token).
  // ---------------------------------------------------------
  U.templateToken = (name) => '<!--' + 'CS:' + name + '-->';

  const jsonForHtml = (value) => JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  U.fillTemplate = (template, cfg) => {
    const tok = U.templateToken;
    const title = U.escapeHtml(cfg.brand && cfg.brand.name ? cfg.brand.name : 'Coming Soon');
    return template
      .split(tok('TITLE')).join(title)
      .split(tok('CONFIG')).join(jsonForHtml(cfg))
      .split(tok('SELF')).join(jsonForHtml(template));
  };

  // Gerüst, in das claude.ai jede Artifact-Seite verpackt
  CS.SKELETON_START = "<!doctype html><html><head><meta charset=utf8><meta name=viewport content=\"width=device-width,initial-scale=1,viewport-fit=cover\"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>\n";
  CS.SKELETON_END = "\n</body></html>";

  U.buildDocument = (template, cfg) => CS.SKELETON_START + U.fillTemplate(template, cfg) + CS.SKELETON_END;

  // ---------------------------------------------------------
  //  Vorlagen für typische Projekte (im Studio unter „Vorlagen“)
  // ---------------------------------------------------------
  const F = (icon, tde, ten, xde, xen) => ({ icon, title: L(tde, ten), text: L(xde, xen) });

  CS.PRESETS = {
    space: {
      label: 'Weltraum (Standard)', icon: '🚀', theme: 'galaxy',
      patch: {
        brand: { logoEmoji: '🚀' },
        soon: { badge: CS.DEFAULT_CONFIG.soon.badge, text: CS.DEFAULT_CONFIG.soon.text },
        live: { headline: CS.DEFAULT_CONFIG.live.headline, text: CS.DEFAULT_CONFIG.live.text, ctaText: CS.DEFAULT_CONFIG.live.ctaText },
        features: { items: CS.DEFAULT_CONFIG.features.items },
      },
    },
    app: {
      label: 'App / Software', icon: '📱', theme: 'ocean',
      patch: {
        brand: { logoEmoji: '📱' },
        soon: {
          badge: L('Beta startet bald', 'Beta coming soon'),
          text: L('Unsere neue App macht deinen Alltag einfacher. Trag dich ein und gehör zu den Ersten, die sie ausprobieren dürfen.',
                  'Our new app makes everyday life easier. Sign up and be among the first to try it.'),
        },
        live: {
          headline: L('{name} ist da.', '{name} is here.'),
          text: L('Lade die App herunter und leg sofort los – kostenlos, schnell und ohne Schnickschnack.',
                  'Download the app and get started right away – free, fast and no fuss.'),
          ctaText: L('App holen', 'Get the app'),
        },
        features: { items: [
          F('⚡', 'Startet sofort', 'Starts instantly', 'Öffnen, loslegen. Keine Wartezeit, keine lange Einrichtung.', 'Open it and go. No waiting, no long setup.'),
          F('🔔', 'Smarte Erinnerungen', 'Smart reminders', 'Die App erinnert dich genau dann, wenn es passt.', 'The app reminds you exactly when it matters.'),
          F('☁️', 'Überall synchron', 'Synced everywhere', 'Handy, Tablet, Computer – deine Daten sind überall gleich.', 'Phone, tablet, computer – your data is the same everywhere.'),
          F('🔒', 'Privat', 'Private', 'Keine Werbung, kein Datenverkauf. Versprochen.', 'No ads, no selling your data. Promise.'),
          F('🌙', 'Dark Mode', 'Dark mode', 'Schont die Augen – tagsüber wie nachts.', 'Easy on the eyes – day and night.'),
          F('🎁', 'Frühstarter-Bonus', 'Early bird bonus', 'Wer sich jetzt einträgt, bekommt zum Start ein Extra.', 'Sign up now and get a little extra at launch.'),
        ] },
      },
    },
    game: {
      label: 'Spiel', icon: '🎮', theme: 'matrix',
      patch: {
        brand: { logoEmoji: '🎮' },
        soon: {
          badge: L('Early Access bald', 'Early access soon'),
          text: L('Ein neues Spiel ist in Entwicklung. Trag dich ein, sichere dir einen Platz in der Beta und erfahre als Erstes, wann es losgeht.',
                  'A new game is in development. Sign up to grab a spot in the beta and be the first to know when it launches.'),
        },
        live: {
          headline: L('{name} – jetzt spielen!', '{name} – play now!'),
          text: L('Das Warten hat ein Ende. Schnapp dir deinen Controller und zeig, was du draufhast.',
                  'The wait is over. Grab your controller and show what you’ve got.'),
          ctaText: L('Jetzt spielen', 'Play now'),
        },
        features: { items: [
          F('🗺️', 'Riesige Welt', 'Huge world', 'Entdecke Orte, die noch niemand gesehen hat.', 'Explore places nobody has seen before.'),
          F('⚔️', 'Epische Kämpfe', 'Epic battles', 'Schnell, taktisch und immer anders.', 'Fast, tactical and never the same twice.'),
          F('👥', 'Mit Freunden', 'With friends', 'Koop und Multiplayer – zusammen macht es doppelt Spaß.', 'Co-op and multiplayer – twice the fun together.'),
          F('🏆', 'Ranglisten', 'Leaderboards', 'Miss dich mit Spielern aus der ganzen Welt.', 'Compete with players from around the world.'),
          F('🎨', 'Eigener Look', 'Your own style', 'Skins, Farben und Details – mach deinen Charakter einzigartig.', 'Skins, colors and details – make your character unique.'),
          F('🔄', 'Ständig neu', 'Always fresh', 'Regelmäßige Updates mit neuen Inhalten.', 'Regular updates with new content.'),
        ] },
      },
    },
    shop: {
      label: 'Shop / Marke', icon: '🛍️', theme: 'sunset',
      patch: {
        brand: { logoEmoji: '🛍️' },
        soon: {
          badge: L('Shop-Eröffnung', 'Store opening'),
          text: L('Unser Shop öffnet bald seine Türen. Trag dich ein und sichere dir einen Rabatt zur Eröffnung.',
                  'Our store opens its doors soon. Sign up and get a discount on opening day.'),
        },
        live: {
          headline: L('{name} hat geöffnet!', '{name} is open!'),
          text: L('Entdecke unsere Kollektion – mit Liebe ausgesucht, fair produziert und schnell bei dir.',
                  'Discover our collection – carefully chosen, fairly made and delivered fast.'),
          ctaText: L('Zum Shop', 'Visit the store'),
        },
        features: { items: [
          F('✨', 'Handverlesen', 'Hand-picked', 'Jedes Produkt haben wir selbst ausgesucht und getestet.', 'We picked and tested every product ourselves.'),
          F('🚚', 'Schneller Versand', 'Fast shipping', 'Bestellt heute, in wenigen Tagen bei dir.', 'Order today, at your door in a few days.'),
          F('🌱', 'Nachhaltig', 'Sustainable', 'Faire Herstellung und möglichst wenig Verpackung.', 'Fair production and as little packaging as possible.'),
          F('↩️', 'Einfache Rückgabe', 'Easy returns', '30 Tage Zeit – ohne Wenn und Aber.', '30 days to return – no questions asked.'),
          F('💳', 'Sicher bezahlen', 'Secure payment', 'Alle gängigen Zahlarten, sicher verschlüsselt.', 'All common payment methods, securely encrypted.'),
          F('🎁', 'Eröffnungsrabatt', 'Opening discount', 'Wer sich einträgt, spart zum Start.', 'Sign up and save at launch.'),
        ] },
      },
    },
    event: {
      label: 'Event / Party', icon: '🎉', theme: 'candy',
      patch: {
        brand: { logoEmoji: '🎉' },
        soon: {
          badge: L('Save the Date', 'Save the date'),
          text: L('Es wird groß, laut und unvergesslich. Trag dich ein und verpass keine Ankündigung.',
                  'It’s going to be big, loud and unforgettable. Sign up and don’t miss a single announcement.'),
        },
        live: {
          headline: L('{name} – es geht los!', '{name} – here we go!'),
          text: L('Tickets, Programm und alle Infos – hier findest du alles für den großen Tag.',
                  'Tickets, schedule and all the details – everything for the big day is right here.'),
          ctaText: L('Tickets sichern', 'Get tickets'),
        },
        features: { items: [
          F('🎵', 'Live-Musik', 'Live music', 'Acts, die du nicht verpassen willst.', 'Acts you don’t want to miss.'),
          F('🍕', 'Essen & Drinks', 'Food & drinks', 'Für jeden Geschmack ist etwas dabei.', 'Something for every taste.'),
          F('📸', 'Fotobox', 'Photo booth', 'Erinnerungen zum Mitnehmen.', 'Memories to take home.'),
          F('🎟️', 'Begrenzte Plätze', 'Limited spots', 'Schnell sein lohnt sich.', 'It pays to be quick.'),
          F('🌃', 'Bis spät in die Nacht', 'Until late', 'Gefeiert wird, bis die Sonne aufgeht.', 'We party until the sun comes up.'),
          F('🤫', 'Überraschungsgast', 'Surprise guest', 'Wer es ist? Verraten wir erst am Abend.', 'Who is it? We’ll only tell you on the night.'),
        ] },
      },
    },
    creator: {
      label: 'Creator / Kanal', icon: '🎬', theme: 'fire',
      patch: {
        brand: { logoEmoji: '🎬' },
        soon: {
          badge: L('Neuer Kanal', 'New channel'),
          text: L('Bald geht es los: neue Videos, neue Ideen und jede Menge Spaß. Trag dich ein, damit du das erste Video nicht verpasst.',
                  'Coming soon: new videos, new ideas and loads of fun. Sign up so you don’t miss the first video.'),
        },
        live: {
          headline: L('{name} ist online!', '{name} is live!'),
          text: L('Das erste Video ist da. Schau rein, abonnier und sei von Anfang an dabei.',
                  'The first video is out. Watch, subscribe and be there from the start.'),
          ctaText: L('Jetzt ansehen', 'Watch now'),
        },
        features: { items: [
          F('🎥', 'Jede Woche neu', 'New every week', 'Regelmäßig frische Videos.', 'Fresh videos on a regular schedule.'),
          F('😂', 'Zum Lachen', 'For laughs', 'Gute Laune garantiert.', 'Good vibes guaranteed.'),
          F('💡', 'Tipps & Tricks', 'Tips & tricks', 'Dinge, die du wirklich gebrauchen kannst.', 'Things you can actually use.'),
          F('🔴', 'Livestreams', 'Livestreams', 'Live dabei sein und mitreden.', 'Join live and have your say.'),
          F('🤝', 'Community', 'Community', 'Ein Ort für alle, die mitmachen wollen.', 'A place for everyone who wants to join in.'),
          F('🎁', 'Giveaways', 'Giveaways', 'Zum Start gibt es etwas zu gewinnen.', 'There’s something to win at launch.'),
        ] },
      },
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CS;
})(typeof window !== 'undefined' ? window : globalThis);
