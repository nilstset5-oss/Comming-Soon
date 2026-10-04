/* =========================================================
   Live-Gefühl: Wer gerade auf der Seite ist, fliegt als kleine
   Rakete mit; dazu „X gerade hier“ und Emoji-Reaktionen.
   Läuft nur als Artifact (Fähigkeit „room“), sonst unsichtbar.
   ========================================================= */
(function () {
  'use strict';
  const CS = window.CS;
  const U = CS.util;
  const B = CS.backend;
  const $ = (s, r = document) => r.querySelector(s);

  const EMOJIS = ['🚀', '🔥', '❤️', '👏', '🤯', '🎉'];
  const COLORS = ['#ff4fd8', '#00d4ff', '#7c5cff', '#3dffa8', '#ffc94d', '#ff7a59', '#7afcff'];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const S = {
    room: null,
    cfg: null,
    lang: 'de',
    connected: false,
    peers: [],
    canReact: true,
    cursors: new Map(),
    color: null,
    lastMove: 0,
    pending: null,
    reactTimes: [],
  };

  const ui = (key, vars) => U.format((CS.UI[S.lang] || CS.UI.de)[key] || key, vars);
  const presenceOn = () => S.cfg && S.cfg.effects.presence !== false;
  const reactionsOn = () => S.cfg && S.cfg.effects.reactions !== false;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function myColor() {
    if (S.color) return S.color;
    try { S.color = sessionStorage.getItem('cs-live-color'); } catch (e) { /* egal */ }
    if (!S.color) {
      S.color = COLORS[(Math.random() * COLORS.length) | 0];
      try { sessionStorage.setItem('cs-live-color', S.color); } catch (e) { /* egal */ }
    }
    return S.color;
  }

  // ---------------------------------------------------------
  //  Anzeige: „X gerade hier“ und Reaktionsleiste
  // ---------------------------------------------------------
  function build() {
    if ($('#live-count')) return;
    const count = el('span', 'live-count');
    count.id = 'live-count';
    count.hidden = true;
    const controls = $('.controls');
    if (controls) controls.prepend(count);

    const bar = el('div', 'reactions');
    bar.id = 'reactions';
    bar.hidden = true;
    bar.setAttribute('role', 'group');
    for (const e of EMOJIS) {
      const b = el('button', null, e);
      b.type = 'button';
      b.addEventListener('click', () => react(e));
      bar.append(b);
    }
    document.body.append(bar);

    const layer = el('div', 'peer-layer');
    layer.id = 'peer-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer);
  }

  function people() {
    const seen = new Set();
    for (const p of S.peers) if (p.kind === 'viewer') seen.add(p.peer);
    return seen.size;
  }

  function refresh() {
    if (!S.room || !S.cfg) return;
    build();
    const n = people();
    const count = $('#live-count');
    count.hidden = !(S.connected && presenceOn() && n >= 2);
    const num = n.toLocaleString(S.lang === 'de' ? 'de-DE' : 'en-US');
    count.textContent = '👀 ';
    count.append(el('b', null, num), el('span', 'lc-t', ' ' + ui('here', { n: '' }).trim()));
    count.title = ui('here', { n: num });
    const bar = $('#reactions');
    bar.hidden = !(S.connected && reactionsOn() && S.canReact && n >= 2);
    bar.setAttribute('aria-label', ui('react'));
    document.body.classList.toggle('has-reactions', !bar.hidden);
    $('#peer-layer').hidden = !presenceOn();
    drawCursors();
  }

  // ---------------------------------------------------------
  //  Raketen der anderen
  // ---------------------------------------------------------
  function docHeight() {
    return Math.max(document.documentElement.scrollHeight, window.innerHeight);
  }

  function drawCursors() {
    const layer = $('#peer-layer');
    if (!layer) return;
    layer.style.height = docHeight() + 'px';
    const alive = new Set();
    const now = Date.now();
    for (const p of S.peers) {
      if (p.sameTab || p.kind !== 'viewer') continue;
      const pr = p.presence || {};
      if (typeof pr.x !== 'number' || typeof pr.y !== 'number') continue;
      alive.add(p.peer);
      let c = S.cursors.get(p.peer);
      if (!c) {
        c = { node: el('div', 'peer-rocket'), x: pr.x, y: pr.y, angle: 0 };
        c.node.append(el('span', 'peer-ship', '🚀'));
        layer.append(c.node);
        S.cursors.set(p.peer, c);
      }
      const color = /^#[0-9a-f]{6}$/i.test(pr.c || '') ? pr.c : '#00d4ff';
      const dx = pr.x - c.x;
      const dy = pr.y - c.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.002) c.angle = Math.atan2(dy * docHeight(), dx * window.innerWidth) * 180 / Math.PI + 45;
      c.x = pr.x;
      c.y = pr.y;
      c.node.style.setProperty('--peer', color);
      c.node.style.transform = `translate3d(${(pr.x * window.innerWidth).toFixed(1)}px, ${(pr.y * docHeight()).toFixed(1)}px, 0)`;
      c.node.firstChild.style.transform = `rotate(${c.angle.toFixed(0)}deg)`;
      c.node.classList.toggle('idle', now - p.updatedAt > 15000);
    }
    for (const [peer, c] of S.cursors) {
      if (!alive.has(peer)) { c.node.remove(); S.cursors.delete(peer); }
    }
  }

  function onMove(e) {
    if (!S.room || !S.connected || !presenceOn() || e.pointerType === 'touch') return;
    S.pending = {
      x: +(e.clientX / window.innerWidth).toFixed(4),
      y: +((e.clientY + window.scrollY) / docHeight()).toFixed(4),
    };
    const now = performance.now();
    if (now - S.lastMove < 40) return;
    S.lastMove = now;
    S.room.presence(Object.assign({ c: myColor() }, S.pending)).catch(() => {});
    S.pending = null;
  }

  // ---------------------------------------------------------
  //  Emoji-Reaktionen
  // ---------------------------------------------------------
  function floater(emoji, mine) {
    if (reduceMotion) return;
    const f = el('span', 'react-float' + (mine ? ' mine' : ''), emoji);
    const x = 50 + (Math.random() - 0.5) * (mine ? 20 : 60);
    f.style.left = x + 'vw';
    f.style.setProperty('--drift', ((Math.random() - 0.5) * 120).toFixed(0) + 'px');
    f.style.setProperty('--dur', (2.2 + Math.random() * 1.2).toFixed(2) + 's');
    document.body.append(f);
    f.addEventListener('animationend', () => f.remove());
  }

  function react(emoji) {
    if (!S.room || !EMOJIS.includes(emoji)) return;
    const now = Date.now();
    S.reactTimes = S.reactTimes.filter((t) => now - t < 1000);
    if (S.reactTimes.length >= 4) return;
    S.reactTimes.push(now);
    floater(emoji, true);
    if (CS.sound) CS.sound.sfx('click');
    S.room.emit('react', { e: emoji }).catch((err) => {
      if (err && err.code === 'not_permitted') { S.canReact = false; refresh(); }
    });
  }

  function onReact(msg) {
    if (msg.sameTab) return;
    const e = msg.data && msg.data.e;
    if (EMOJIS.includes(e)) floater(e, false);
  }

  // ---------------------------------------------------------
  //  Start
  // ---------------------------------------------------------
  CS.live = {
    configure({ cfg, lang }) {
      S.cfg = cfg;
      S.lang = lang;
      refresh();
    },
    async init() {
      if (B.kind !== 'artifact') return;
      const room = await window.claude.use('room').catch(() => null);
      if (!room) return;
      S.room = room;
      // Reaktionen senden dürfen nur Mitwirkende (wie beim Eintragen)
      S.canReact = B.canWrite !== false;
      const dead = () => { S.connected = false; refresh(); };
      room.onConnection((c) => { S.connected = c; refresh(); }, dead);
      room.onPeers((change) => { S.peers = change.peers; refresh(); }, dead);
      room.on('react', onReact, () => {});
      room.presence({ c: myColor() }).catch(() => {});
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('resize', drawCursors);
      setInterval(drawCursors, 5000);
      refresh();
    },
  };
})();
