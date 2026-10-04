/* =========================================================
   Mini-Spiel „Asteroid Run“
   Steuerung: Maus / Finger / ← → (A/D). Geschossen wird automatisch.
   ========================================================= */
(function () {
  'use strict';
  const CS = (window.CS = window.CS || {});
  const U = CS.util;

  const modal = document.getElementById('game');
  if (!modal) return;
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('game-overlay');
  const btnClose = document.getElementById('game-close');
  const btnPause = document.getElementById('game-pause');

  const STORE = 'cs-game-scores';
  const NAME_STORE = 'cs-game-name';
  const sfx = (n) => CS.sound && CS.sound.sfx(n);

  let w = 0, h = 0, dpr = 1;
  let state = 'closed'; // closed | ready | playing | paused | over
  let ui = CS.UI.de;
  let lang = 'de';
  let title = 'Asteroid Run';
  let missionControl = false;
  let opener = null;
  let colors = { a1: '#7c5cff', a2: '#00d4ff', a3: '#ff4fd8' };
  let raf = 0;
  let last = 0;

  let ship, bullets, rocks, items, particles, texts, bg;
  let score, time, lives, invuln, shield, triple, fireCd, rockTimer, itemTimer, shake;
  const input = { left: false, right: false, pointerX: null };
  let lastEntry = null;

  // ---------- Bestenliste ----------
  function loadScores() {
    try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch (e) { return []; }
  }
  function saveScores(list) {
    try { localStorage.setItem(STORE, JSON.stringify(list.slice(0, 5))); } catch (e) { /* egal */ }
  }
  function loadName() {
    try { return localStorage.getItem(NAME_STORE) || 'Pilot'; } catch (e) { return 'Pilot'; }
  }

  // ---------- Aufbau ----------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (ship) ship.y = h - Math.min(110, h * 0.16);
  }

  function readColors() {
    const s = getComputedStyle(document.documentElement);
    colors = {
      a1: s.getPropertyValue('--a1').trim() || colors.a1,
      a2: s.getPropertyValue('--a2').trim() || colors.a2,
      a3: s.getPropertyValue('--a3').trim() || colors.a3,
    };
  }

  function reset() {
    ship = { x: w / 2, y: h - Math.min(110, h * 0.16), r: 16, tilt: 0 };
    bullets = [];
    rocks = [];
    items = [];
    particles = [];
    texts = [];
    score = 0;
    time = 0;
    lives = 3;
    invuln = 0;
    shield = false;
    triple = 0;
    fireCd = 0;
    rockTimer = 0.6;
    itemTimer = 3;
    shake = 0;
    input.pointerX = null;
  }

  function makeBg() {
    bg = [];
    for (let i = 0; i < 140; i++) {
      bg.push({ x: Math.random() * w, y: Math.random() * h, z: 0.2 + Math.random() * 0.8 });
    }
  }

  // ---------- Spiellogik ----------
  function spawnRock() {
    const r = 14 + Math.random() * 30;
    const pts = [];
    const n = 9;
    for (let i = 0; i < n; i++) pts.push(0.72 + Math.random() * 0.4);
    rocks.push({
      x: r + Math.random() * (w - r * 2),
      y: -r,
      r,
      vx: (Math.random() - 0.5) * 50,
      vy: (70 + Math.random() * 90) * (1 + time / 55),
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 2,
      hp: r > 32 ? 3 : r > 22 ? 2 : 1,
      pts,
      flash: 0,
    });
  }

  function spawnItem() {
    const roll = Math.random();
    const kind = roll < 0.74 ? 'star' : roll < 0.87 ? 'shield' : 'triple';
    items.push({ kind, x: 30 + Math.random() * (w - 60), y: -20, r: 15, vy: 110 + time, t: 0 });
  }

  function burst(x, y, color, count, power) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.3 + Math.random()) * power;
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.5, max: 1, color, size: 1.5 + Math.random() * 2.5 });
    }
  }

  function floatText(x, y, text, color) {
    texts.push({ x, y, text, color, life: 1 });
  }

  const hit = (a, b, pad = 0) => {
    const dx = a.x - b.x, dy = a.y - b.y, rr = a.r + b.r - pad;
    return dx * dx + dy * dy < rr * rr;
  };

  function update(dt) {
    time += dt;
    score += dt * 10;
    invuln = Math.max(0, invuln - dt);
    triple = Math.max(0, triple - dt);
    shake = Math.max(0, shake - dt);

    // Schiff bewegen
    const prevX = ship.x;
    if (input.left || input.right) {
      ship.x += (input.right - input.left) * 520 * dt;
      input.pointerX = null;
    } else if (input.pointerX != null) {
      ship.x += (input.pointerX - ship.x) * Math.min(1, dt * 12);
    }
    ship.x = Math.max(ship.r, Math.min(w - ship.r, ship.x));
    ship.tilt += (((ship.x - prevX) / Math.max(dt, 0.001)) / 1600 - ship.tilt) * Math.min(1, dt * 10);

    // Schießen
    fireCd -= dt;
    if (fireCd <= 0) {
      fireCd = 0.2;
      const shots = triple > 0 ? [-170, 0, 170] : [0];
      for (const vx of shots) bullets.push({ x: ship.x, y: ship.y - 20, vx, vy: -680, r: 3 });
      sfx('shoot');
    }

    // Gegner & Items erzeugen
    rockTimer -= dt;
    if (rockTimer <= 0) {
      spawnRock();
      rockTimer = Math.max(0.22, 1.05 - time * 0.012) * (0.6 + Math.random() * 0.8);
    }
    itemTimer -= dt;
    if (itemTimer <= 0) {
      spawnItem();
      itemTimer = 2.6 + Math.random() * 2.4;
    }

    // Hintergrund
    for (const s of bg) {
      s.y += (40 + time * 1.5) * s.z * dt;
      if (s.y > h) { s.y = 0; s.x = Math.random() * w; }
    }

    // Schüsse
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < -20 || b.x < -20 || b.x > w + 20) bullets.splice(i, 1);
    }

    // Asteroiden
    for (let i = rocks.length - 1; i >= 0; i--) {
      const r = rocks[i];
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.rot += r.vr * dt;
      r.flash = Math.max(0, r.flash - dt);
      if (r.x < r.r || r.x > w - r.r) r.vx *= -1;
      if (r.y > h + r.r) { rocks.splice(i, 1); continue; }

      let destroyed = false;
      for (let j = bullets.length - 1; j >= 0; j--) {
        if (!hit(r, bullets[j])) continue;
        bullets.splice(j, 1);
        r.hp -= 1;
        r.flash = 0.08;
        burst(r.x, r.y + r.r * 0.5, colors.a2, 4, 120);
        if (r.hp <= 0) { destroyed = true; break; }
      }
      if (destroyed) {
        rocks.splice(i, 1);
        const pts = Math.round(r.r * 2);
        score += pts;
        floatText(r.x, r.y, '+' + pts, colors.a2);
        burst(r.x, r.y, colors.a1, 18, 220);
        burst(r.x, r.y, '#ffffff', 8, 160);
        sfx('boom');
        if (r.r > 26) {
          for (const dir of [-1, 1]) {
            const nr = r.r * 0.55;
            rocks.push({ x: r.x + dir * nr, y: r.y, r: nr, vx: dir * (60 + Math.random() * 60), vy: r.vy * 0.9, rot: 0, vr: dir * 2, hp: 1, pts: r.pts.slice().reverse(), flash: 0 });
          }
        }
        continue;
      }

      if (invuln <= 0 && hit(r, ship, 6)) {
        rocks.splice(i, 1);
        burst(r.x, r.y, colors.a1, 20, 240);
        if (shield) {
          shield = false;
          invuln = 1;
          sfx('boom');
          floatText(ship.x, ship.y - 30, '🛡', colors.a2);
        } else {
          lives -= 1;
          invuln = 2;
          shake = 0.4;
          burst(ship.x, ship.y, colors.a3, 30, 260);
          sfx('hit');
          if (lives <= 0) { gameOver(); return; }
        }
      }
    }

    // Items
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      it.t += dt;
      it.y += it.vy * dt;
      it.x += Math.sin(it.t * 3) * 30 * dt;
      if (it.y > h + 30) { items.splice(i, 1); continue; }
      if (hit(it, ship)) {
        items.splice(i, 1);
        if (it.kind === 'star') { score += 50; floatText(it.x, it.y, '+50', '#ffd84d'); sfx('coin'); }
        if (it.kind === 'shield') { shield = true; floatText(it.x, it.y, '🛡', colors.a2); sfx('power'); }
        if (it.kind === 'triple') { triple = 8; floatText(it.x, it.y, '⚡ x3', colors.a3); sfx('power'); }
        burst(it.x, it.y, '#ffd84d', 12, 160);
      }
    }

    // Partikel & Texte
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.97;
      p.vy *= 0.97;
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.life -= dt;
      t.y -= 40 * dt;
      if (t.life <= 0) texts.splice(i, 1);
    }
  }

  // ---------- Zeichnen ----------
  function drawShip() {
    if (invuln > 0 && Math.floor(invuln * 12) % 2 === 0) return;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(Math.max(-0.4, Math.min(0.4, ship.tilt)));

    // Flamme
    const fl = 14 + Math.random() * 8;
    const grad = ctx.createLinearGradient(0, 14, 0, 14 + fl);
    grad.addColorStop(0, '#fff6b0');
    grad.addColorStop(0.5, '#ffb347');
    grad.addColorStop(1, 'rgba(255,59,107,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-6, 13);
    ctx.quadraticCurveTo(0, 14 + fl * 1.6, 6, 13);
    ctx.fill();

    // Flügel
    ctx.fillStyle = colors.a3;
    ctx.beginPath(); ctx.moveTo(-9, 4); ctx.lineTo(-17, 16); ctx.lineTo(-6, 13); ctx.fill();
    ctx.beginPath(); ctx.moveTo(9, 4); ctx.lineTo(17, 16); ctx.lineTo(6, 13); ctx.fill();

    // Rumpf
    ctx.fillStyle = '#eef0ff';
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.bezierCurveTo(10, -12, 10, 4, 7, 14);
    ctx.lineTo(-7, 14);
    ctx.bezierCurveTo(-10, 4, -10, -12, 0, -22);
    ctx.fill();
    ctx.fillStyle = colors.a2;
    ctx.beginPath();
    ctx.arc(0, -5, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (shield) {
      ctx.save();
      ctx.strokeStyle = colors.a2;
      ctx.globalAlpha = 0.5 + Math.sin(time * 8) * 0.2;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ship.x, ship.y, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawRock(r) {
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.rot);
    ctx.beginPath();
    r.pts.forEach((k, i) => {
      const a = (i / r.pts.length) * Math.PI * 2;
      const x = Math.cos(a) * r.r * k;
      const y = Math.sin(a) * r.r * k;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = r.flash > 0 ? '#ffffff' : 'rgba(40, 34, 70, 0.95)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = colors.a1;
    ctx.globalAlpha = 0.25;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.arc(r.r * 0.25, -r.r * 0.2, r.r * 0.22, 0, Math.PI * 2);
    ctx.arc(-r.r * 0.3, r.r * 0.3, r.r * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const ITEM_ICON = { star: '⭐', shield: '🛡️', triple: '⚡' };

  function draw() {
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 30, (Math.random() - 0.5) * shake * 30);

    for (const s of bg) {
      ctx.fillStyle = `rgba(230, 235, 255, ${0.25 + s.z * 0.6})`;
      ctx.fillRect(s.x, s.y, s.z * 2, s.z * 2 + (state === 'playing' ? s.z * 6 : 0));
    }

    if (state !== 'ready') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '24px system-ui, sans-serif';
      for (const it of items) ctx.fillText(ITEM_ICON[it.kind], it.x, it.y + Math.sin(it.t * 5) * 3);

      for (const r of rocks) drawRock(r);

      ctx.lineCap = 'round';
      for (const b of bullets) {
        ctx.strokeStyle = colors.a2;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.02, b.y + 14); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.02, b.y + 14); ctx.stroke();
      }

      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
      ctx.globalAlpha = 1;

      if (state !== 'over') drawShip();

      ctx.font = 'bold 18px system-ui, sans-serif';
      for (const t of texts) {
        ctx.globalAlpha = Math.max(0, t.life);
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // HUD
    if (state === 'playing' || state === 'paused') {
      const best = Math.max(CS.game.best(), Math.floor(score));
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.fillText(Math.floor(score).toLocaleString(), 18, 16);
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(232,236,255,0.65)';
      ctx.fillText(`${ui.g_best}: ${best.toLocaleString()}`, 18, 48);
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillText('❤️'.repeat(Math.max(0, lives)) + (shield ? ' 🛡️' : '') + (triple > 0 ? ` ⚡${Math.ceil(triple)}` : ''), 18, 68);
    }
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (state === 'playing') update(dt);
    else if (bg) for (const s of bg) { s.y += 20 * s.z * dt; if (s.y > h) s.y = 0; }
    if (state !== 'closed') {
      draw();
      raf = requestAnimationFrame(loop);
    }
  }

  // ---------- Overlays ----------
  function btn(text, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + cls;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  function leaderboard(list, highlight) {
    const ol = document.createElement('ol');
    ol.className = 'leaderboard';
    list.forEach((e, i) => {
      const li = document.createElement('li');
      if (e === highlight || e.me) li.className = 'me';
      const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = i + 1 + '.';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = e.name;
      const sc = document.createElement('span'); sc.className = 'sc'; sc.textContent = e.score.toLocaleString();
      li.append(rank, nm, sc);
      ol.append(li);
    });
    return ol;
  }

  function showOverlay(nodes, focusEl) {
    overlay.textContent = '';
    overlay.append(...nodes.filter(Boolean));
    overlay.hidden = false;
    if (focusEl) setTimeout(() => focusEl.focus(), 30);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderStart() {
    const h2 = el('h2', 'gradient-text', title);
    h2.id = 'game-dialog-title';
    const start = btn(ui.g_start + ' 🚀', 'btn-primary', startGame);
    const nodes = [el('div', 'game-emoji', '🛸'), h2, el('p', null, ui.g_controls), el('p', null, ui.g_items)];
    const list = loadScores();
    if (list.length) {
      nodes.push(el('p', null, `${ui.g_best}: ${list[0].score.toLocaleString()}`));
    }
    nodes.push(start);
    showOverlay(nodes, start);
  }

  function renderPause() {
    const resume = btn(ui.g_resume, 'btn-primary', resumeGame);
    const h2 = el('h2', null, '⏸ ' + ui.g_paused);
    h2.id = 'game-dialog-title';
    showOverlay([h2, resume, btn(ui.g_close, 'btn-ghost', close)], resume);
  }

  function renderOver(isBest) {
    const final = Math.floor(score);
    const list = loadScores();
    const h2 = el('h2', null, ui.g_over);
    h2.id = 'game-dialog-title';
    const nodes = [h2, el('div', 'big-score gradient-text', final.toLocaleString())];
    if (isBest) nodes.push(el('p', null, ui.g_newBest));

    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 16;
    name.value = loadName();
    name.setAttribute('aria-label', ui.g_name);
    name.placeholder = ui.g_name;
    const board = el('div');
    board.style.width = '100%';
    const updateName = () => {
      const v = name.value.trim().slice(0, 16) || 'Pilot';
      try { localStorage.setItem(NAME_STORE, v); } catch (e) { /* egal */ }
      if (lastEntry) {
        lastEntry.name = v;
        const all = loadScores();
        const match = all.find((e) => e.ts === lastEntry.ts);
        if (match) { match.name = v; saveScores(all); }
      }
      board.textContent = '';
      const fresh = loadScores();
      board.append(el('p', null, ui.g_top), leaderboard(fresh, fresh.find((e) => lastEntry && e.ts === lastEntry.ts)));
    };
    name.addEventListener('input', updateName);
    updateName();

    // Weltweite Bestenliste (nur wenn die Seite eine Datenbank hat)
    const world = el('div');
    world.style.width = '100%';
    world.hidden = true;
    const B = CS.backend;
    const refreshWorld = async () => {
      if (!B || !B.hasWorldScores()) return;
      await B.submitScore(name.value.trim() || 'Pilot', final);
      const rows = await B.topScores(5);
      if (!rows || !rows.length || state !== 'over') return;
      world.textContent = '';
      world.append(el('p', null, ui.g_world), leaderboard(rows));
      world.hidden = false;
    };
    name.addEventListener('change', refreshWorld);
    refreshWorld();

    const again = btn(ui.g_again + ' 🔁', 'btn-primary', startGame);
    const share = btn(ui.g_share, 'btn-ghost', () => shareScore(final));
    const row = el('div', 'cta-row');
    row.append(again, share);

    // Mission Control: ein KI-Funkspruch zum Ergebnis (nur auf Knopfdruck)
    let mc = null;
    if (missionControl) {
      const said = el('p', 'mc-said');
      said.hidden = true;
      const ask = btn(ui.g_mc, 'btn-ghost mc-btn', () => askMissionControl(final, isBest, ask, said));
      mc = el('div', 'mc');
      mc.append(ask, said);
    }
    nodes.push(name, world, board, mc, row);
    if (!list.length) board.hidden = true;
    showOverlay(nodes, again);
  }

  async function askMissionControl(final, isBest, button, out) {
    const sample = CS.backend && (await CS.backend.ai());
    if (!sample) { button.remove(); return; }
    button.disabled = true;
    out.hidden = false;
    out.textContent = ui.g_mcThinking;
    const best = CS.game.best();
    const prompt = [
      `Du bist „Mission Control“ im kleinen Weltraum-Arcade-Spiel „${title}“.`,
      `Ein Spieler hat gerade ${final} Punkte erreicht und ${Math.round(time)} Sekunden überlebt.`,
      isBest ? 'Das ist ein neuer persönlicher Rekord!' : `Sein Rekord liegt bei ${best} Punkten.`,
      `Schreib genau EINEN kurzen, witzigen Funkspruch auf ${lang === 'de' ? 'Deutsch' : 'Englisch'} (höchstens 20 Wörter), freundlich, ohne Anführungszeichen.`,
    ].join(' ');
    try {
      const res = await sample(prompt, { modelTier: 'quick', onText: ({ text }) => { out.textContent = '📡 ' + text; } });
      out.textContent = '📡 ' + res.text.trim();
      button.remove();
    } catch (e) {
      if (e && e.code === 'cancelled') return;
      out.textContent = e && e.code === 'not_granted' ? '📡 …' : '📡 ' + (CS.UI[lang].ai_unavailable || '');
      button.disabled = false;
    }
  }

  async function shareScore(n) {
    const text = U.format(ui.g_shareText, { n: n.toLocaleString(), game: title });
    const url = location.href.split('#')[0].replace(/\?.*$/, '');
    try {
      if (navigator.share) { await navigator.share({ text, url }); return; }
      await navigator.clipboard.writeText(text + ' ' + url);
      CS.fx && CS.fx.toast(ui.linkCopied);
    } catch (e) { /* abgebrochen */ }
  }

  // ---------- Ablauf ----------
  function startGame() {
    readColors();
    reset();
    overlay.hidden = true;
    btnPause.hidden = false;
    state = 'playing';
    canvas.focus();
    sfx('power');
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    renderPause();
  }

  function resumeGame() {
    if (state !== 'paused') return;
    overlay.hidden = true;
    state = 'playing';
    last = performance.now();
  }

  function gameOver() {
    state = 'over';
    btnPause.hidden = true;
    sfx('over');
    const final = Math.floor(score);
    const before = CS.game.best();
    const list = loadScores();
    lastEntry = { name: loadName(), score: final, ts: Date.now() };
    list.push(lastEntry);
    list.sort((a, b) => b.score - a.score);
    saveScores(list);
    const isBest = final > before && final > 0;
    if (isBest && CS.fx) CS.fx.confettiCannons();
    renderOver(isBest);
    if (CS.game.onScore) CS.game.onScore(final);
  }

  function open(options = {}) {
    if (state !== 'closed') return;
    lang = options.lang === 'en' ? 'en' : 'de';
    ui = CS.UI[lang] || CS.UI.de;
    title = options.title || title;
    missionControl = !!options.missionControl && !!CS.backend && CS.backend.kind === 'artifact';
    opener = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    btnClose.setAttribute('aria-label', ui.g_close);
    btnPause.setAttribute('aria-label', ui.g_paused);
    btnPause.hidden = true;
    resize();
    readColors();
    reset();
    makeBg();
    state = 'ready';
    renderStart();
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function close() {
    if (state === 'closed') return;
    state = 'closed';
    cancelAnimationFrame(raf);
    modal.hidden = true;
    document.body.style.overflow = '';
    if (opener && opener.focus) opener.focus();
    if (CS.game.onClose) CS.game.onClose();
  }

  // ---------- Eingaben ----------
  function pointer(e) {
    if (state !== 'playing') return;
    input.pointerX = e.clientX;
  }
  canvas.addEventListener('pointerdown', pointer);
  canvas.addEventListener('pointermove', pointer);

  window.addEventListener('keydown', (e) => {
    if (state === 'closed') return;
    const k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      if (state === 'playing') pauseGame(); else close();
      return;
    }
    if (state === 'playing') {
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { input.left = true; e.preventDefault(); }
      if (k === 'ArrowRight' || k === 'd' || k === 'D') { input.right = true; e.preventDefault(); }
      if (k === 'p' || k === 'P' || k === ' ') { e.preventDefault(); pauseGame(); }
    } else if (state === 'paused' && (k === 'p' || k === 'P')) {
      resumeGame();
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') input.left = false;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') input.right = false;
  });

  btnClose.addEventListener('click', close);
  btnPause.addEventListener('click', pauseGame);
  window.addEventListener('resize', () => { if (state !== 'closed') resize(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

  // Fokus im Dialog halten
  modal.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = Array.from(modal.querySelectorAll('button, input')).filter((x) => !x.hidden && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], lastEl = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
  });
  canvas.tabIndex = -1;

  CS.game = {
    open,
    close,
    isOpen: () => state !== 'closed',
    best: () => { const l = loadScores(); return l.length ? l[0].score : 0; },
    onScore: null,
    onClose: null,
  };
})();
