/* =========================================================
   Effekte: Konfetti, Toast-Meldungen, Countdown (Flip/Glas), Hochzählen
   ========================================================= */
(function () {
  'use strict';
  const CS = (window.CS = window.CS || {});
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fx = (CS.fx = { reduceMotion });

  // ---------------------------------------------------------
  //  Konfetti
  // ---------------------------------------------------------
  let canvas = null;
  let ctx = null;
  let parts = [];
  let raining = 0;
  let running = false;
  let last = 0;
  let w = 0;
  let h = 0;

  function setup() {
    if (canvas) return true;
    canvas = document.getElementById('fx');
    if (!canvas) return false;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    return true;
  }

  function resize() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function palette() {
    const s = getComputedStyle(document.documentElement);
    const v = (n) => s.getPropertyValue(n).trim();
    return [v('--a1'), v('--a2'), v('--a3'), '#ffffff', '#ffd84d'].filter(Boolean);
  }

  function spawn(x, y, angle, spread, speed, colors) {
    const a = angle + (Math.random() - 0.5) * spread;
    const v = speed * (0.45 + Math.random() * 0.75);
    parts.push({
      x, y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.4,
      size: 5 + Math.random() * 7,
      color: colors[(Math.random() * colors.length) | 0],
      shape: Math.random() < 0.3 ? 'circle' : 'rect',
      wobble: Math.random() * Math.PI * 2,
      life: 1,
    });
  }

  function loop(now) {
    const dt = Math.min(3, (now - last) / 16.667 || 1);
    last = now;
    ctx.clearRect(0, 0, w, h);

    if (raining > now) {
      const colors = palette();
      for (let i = 0; i < 3; i++) spawn(Math.random() * w, -10, Math.PI / 2, 0.6, 3, colors);
    }

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.vy += 0.18 * dt;
      p.vx *= Math.pow(0.985, dt);
      p.vy *= Math.pow(0.985, dt);
      p.wobble += 0.12 * dt;
      p.x += (p.vx + Math.sin(p.wobble) * 0.6) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.y > h + 30) p.life = 0;
      if (p.life <= 0) { parts.splice(i, 1); continue; }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.scale(1, Math.abs(Math.cos(p.wobble)) * 0.8 + 0.2);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    }

    if (parts.length || raining > now) requestAnimationFrame(loop);
    else { running = false; ctx.clearRect(0, 0, w, h); }
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(loop);
  }

  fx.confetti = function ({ x, y, count = 140, angle = -Math.PI / 2, spread = Math.PI * 0.9, speed = 16 } = {}) {
    if (reduceMotion || !setup()) return;
    const colors = palette();
    const px = x == null ? w / 2 : x;
    const py = y == null ? h * 0.6 : y;
    for (let i = 0; i < count; i++) spawn(px, py, angle, spread, speed, colors);
    start();
  };

  fx.confettiRain = function (ms = 3000) {
    if (reduceMotion || !setup()) return;
    raining = performance.now() + ms;
    start();
  };

  fx.confettiCannons = function () {
    if (!setup()) return;
    fx.confetti({ x: 0, y: h, angle: -Math.PI / 3, spread: 0.7, count: 110, speed: 24 });
    fx.confetti({ x: w, y: h, angle: -Math.PI * 2 / 3, spread: 0.7, count: 110, speed: 24 });
  };

  // ---------------------------------------------------------
  //  Toast
  // ---------------------------------------------------------
  let toastTimer = 0;
  fx.toast = function (text, ms = 2800) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  };

  // ---------------------------------------------------------
  //  Countdown (Flip-Uhr oder Glas-Kacheln)
  // ---------------------------------------------------------
  const KEYS = ['days', 'hours', 'minutes', 'seconds'];

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  fx.Countdown = class {
    constructor(root) {
      this.root = root;
      this.style = null;
      this.units = {};
    }

    build(style, labels) {
      style = style === 'glass' ? 'glass' : 'flip';
      if (this.style !== style) {
        this.style = style;
        this.root.className = 'countdown style-' + style;
        this.root.textContent = '';
        this.units = {};
        for (const key of KEYS) {
          const unit = el('div', 'cd-unit');
          const u = { value: null, label: el('span', 'cd-label') };
          if (style === 'flip') {
            const card = el('div', 'flip');
            u.top = el('span');
            u.bottom = el('span');
            const top = el('div', 'flip-half flip-top');
            const bottom = el('div', 'flip-half flip-bottom');
            top.append(u.top);
            bottom.append(u.bottom);
            card.append(top, bottom);
            u.card = card;
            unit.append(card, u.label);
          } else {
            u.num = el('span', 'cd-num', '00');
            unit.append(u.num, u.label);
          }
          this.units[key] = u;
          this.root.append(unit);
        }
      }
      for (const key of KEYS) this.units[key].label.textContent = labels[key];
    }

    set(key, value) {
      const u = this.units[key];
      if (!u) return;
      const text = String(value).padStart(2, '0');
      if (u.value === text) return;
      const old = u.value;
      u.value = text;

      if (this.style === 'glass') {
        u.num.textContent = text;
        if (!reduceMotion && old != null) {
          u.num.classList.remove('tick');
          void u.num.offsetWidth;
          u.num.classList.add('tick');
        }
        return;
      }

      // Flip-Uhr
      if (u.cleanup) u.cleanup();
      if (old == null || reduceMotion || document.hidden) {
        u.top.textContent = text;
        u.bottom.textContent = text;
        return;
      }
      u.top.textContent = text;
      u.bottom.textContent = old;
      const animTop = el('div', 'flip-anim top');
      animTop.append(el('span', null, old));
      const animBottom = el('div', 'flip-anim bottom');
      animBottom.append(el('span', null, text));
      u.card.append(animTop, animBottom);
      const done = () => {
        clearTimeout(timer);
        u.bottom.textContent = text;
        animTop.remove();
        animBottom.remove();
        u.cleanup = null;
      };
      const timer = setTimeout(done, 800);
      animBottom.addEventListener('animationend', done, { once: true });
      u.cleanup = done;
    }
  };

  // ---------------------------------------------------------
  //  Zahlen hochzählen
  // ---------------------------------------------------------
  fx.countUp = function (elm, target, suffix, locale, ms = 1600) {
    const end = Number(target) || 0;
    const fmt = (n) => Math.round(n).toLocaleString(locale) + (suffix || '');
    if (reduceMotion) { elm.textContent = fmt(end); return; }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      elm.textContent = fmt(end * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
})();
