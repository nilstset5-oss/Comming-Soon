/* =========================================================
   Weltraum: Sternenfeld (Canvas), Planeten-Parallaxe, Rakete, Handy-Neigung
   ========================================================= */
(function () {
  'use strict';
  const CS = (window.CS = window.CS || {});
  const U = CS.util;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = document.getElementById('space');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const planetsEl = document.getElementById('planets');
  const planetEls = planetsEl ? Array.from(planetsEl.querySelectorAll('.planet')) : [];
  const PLANET_DEPTH = [0.55, 1.1, 0.3];
  const rocketEl = document.getElementById('rocket');

  const BASE = 0.0022;
  const WARP = 0.045;

  const opts = {
    stars: true,
    density: 1,
    speed: 1,
    planets: true,
    rocket: true,
    parallax: true,
    tilt: true,
    hues: [{ h: 250, s: 1 }, { h: 190, s: 1 }, { h: 300, s: 1 }],
  };

  let w = 0, h = 0, dpr = 1;
  let stars = [];
  let speed = BASE;
  let warpOn = false;
  let rainbow = false;
  let last = performance.now();
  let started = false;
  let time = 0;
  let scrollY = 0;
  const center = { x: 0, y: 0, tx: 0, ty: 0 };
  const rocket = { a: Math.PI * 0.15, launchT: -1, x: 0, y: 0, dir: 0, fade: 1 };

  function baseSpeed() { return BASE * opts.speed; }
  function warpAmount() { return Math.max(0, Math.min(1, (speed - baseSpeed()) / (WARP - baseSpeed()))); }

  function makeStar(s, fresh) {
    s.x = (Math.random() * 2 - 1) * w * 0.5;
    s.y = (Math.random() * 2 - 1) * h * 0.5;
    s.z = fresh ? 0.05 + Math.random() * 0.95 : 1;
    s.pz = s.z;
    s.colored = Math.random() < 0.28;
    s.hue = opts.hues[(Math.random() * opts.hues.length) | 0];
    return s;
  }

  function starStyle(s, alpha) {
    if (rainbow) return `hsla(${(s.hue.h + s.x * 0.5 + time * 0.15) % 360}, 95%, 70%, ${alpha})`;
    if (s.colored && s.hue.s > 0.15) return `hsla(${s.hue.h}, 90%, 78%, ${alpha})`;
    return `rgba(235, 240, 255, ${alpha})`;
  }

  function targetCount() {
    return Math.round(Math.max(80, Math.min(1400, ((w * h) / 1400) * opts.density)));
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    center.x = center.tx = w / 2;
    center.y = center.ty = h / 2;
    const count = targetCount();
    while (stars.length < count) stars.push(makeStar({}, true));
    stars.length = count;
    if (reduceMotion) drawStatic();
  }

  function drawStatic() {
    ctx.clearRect(0, 0, w, h);
    if (!opts.stars) return;
    for (const s of stars) {
      const t = 1 - s.z;
      ctx.fillStyle = starStyle(s, Math.min(1, t * 3));
      ctx.beginPath();
      ctx.arc(center.x + s.x / s.z, center.y + s.y / s.z, t * 1.2 + 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function updatePlanets(warp) {
    if (!planetsEl) return;
    planetsEl.style.display = opts.planets ? '' : 'none';
    if (!opts.planets) return;
    const ox = center.x - w / 2;
    const oy = center.y - h / 2;
    planetEls.forEach((p, i) => {
      const d = PLANET_DEPTH[i] || 0.5;
      const float = Math.sin(time * 0.0006 + i * 2) * 8;
      const tx = -ox * d;
      const ty = -oy * d + float - scrollY * d * 0.12;
      const scale = 1 + warp * 0.25 * d;
      p.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
    });
  }

  function updateRocket(dt, warp) {
    if (!rocketEl) return;
    const show = opts.rocket && !reduceMotion;
    rocketEl.hidden = !show;
    if (!show) return;

    const rx = w * (w < 600 ? 0.4 : 0.44);
    const ry = h * 0.4;
    const size = 46;

    if (rocket.launchT >= 0) {
      // Probestart: geradeaus aus dem Bild, danach Rückkehr in die Umlaufbahn
      rocket.launchT += dt / 60;
      const t = rocket.launchT;
      const dist = t * t * 1400;
      const x = rocket.x + Math.cos(rocket.dir) * dist;
      const y = rocket.y + Math.sin(rocket.dir) * dist;
      rocketEl.style.opacity = t > 2.2 ? Math.min(1, (t - 2.2) * 2) : 1;
      if (t > 2.2) {
        rocket.launchT = -1;
        rocket.a += Math.PI; // taucht auf der anderen Seite wieder auf
      } else {
        rocketEl.style.transform = `translate3d(${x - size / 2}px, ${y - size / 2}px, 0) rotate(${rocket.dir + Math.PI / 2}rad) scale(${1 + t * 0.3})`;
        return;
      }
    }

    rocket.a += dt * (0.0024 * opts.speed + warp * 0.03);
    const x = w / 2 + rx * Math.cos(rocket.a);
    const y = h / 2 + ry * Math.sin(rocket.a);
    const dir = Math.atan2(ry * Math.cos(rocket.a), -rx * Math.sin(rocket.a));
    const wobble = Math.sin(time * 0.004) * 0.08;
    rocket.x = x;
    rocket.y = y;
    rocket.dir = dir;
    if (rocketEl.style.opacity !== '' && Number(rocketEl.style.opacity) < 1) {
      rocketEl.style.opacity = Math.min(1, Number(rocketEl.style.opacity) + dt * 0.03);
    }
    rocketEl.style.transform = `translate3d(${(x - size / 2).toFixed(1)}px, ${(y - size / 2).toFixed(1)}px, 0) rotate(${(dir + Math.PI / 2 + wobble).toFixed(3)}rad)`;
  }

  function frame(now) {
    const dt = Math.min(3, Math.max(0.1, (now - last) / 16.667));
    last = now;
    time = now;

    const target = warpOn ? WARP : baseSpeed();
    speed += (target - speed) * Math.min(1, 0.06 * dt);
    center.x += (center.tx - center.x) * Math.min(1, 0.05 * dt);
    center.y += (center.ty - center.y) * Math.min(1, 0.05 * dt);
    const warp = warpAmount();

    // Alte Sterne ausblenden – je schneller, desto längere Lichtspuren
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0, 0, 0, ${0.9 - warp * 0.6})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    if (opts.stars) {
      for (const s of stars) {
        s.pz = s.z;
        s.z -= speed * dt;
        if (s.z <= 0.005) { makeStar(s, false); continue; }
        const sx = center.x + s.x / s.z;
        const sy = center.y + s.y / s.z;
        if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) { makeStar(s, false); continue; }
        const px = center.x + s.x / s.pz;
        const py = center.y + s.y / s.pz;
        const t = 1 - s.z;
        ctx.strokeStyle = starStyle(s, Math.min(1, t * 3));
        ctx.lineWidth = t * 2.4 + 0.35;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }
    }

    updatePlanets(warp);
    updateRocket(dt, warp);
    requestAnimationFrame(frame);
  }

  // ---------- Eingaben: Maus & Handy-Neigung ----------
  window.addEventListener('pointermove', (e) => {
    if (!opts.parallax || e.pointerType === 'touch') return;
    center.tx = w / 2 + (e.clientX - w / 2) * 0.2;
    center.ty = h / 2 + (e.clientY - h / 2) * 0.2;
  }, { passive: true });

  let tiltActive = false;
  function onTilt(e) {
    if (!opts.tilt || e.gamma == null) return;
    const gx = Math.max(-1, Math.min(1, e.gamma / 30));
    const gy = Math.max(-1, Math.min(1, ((e.beta || 45) - 45) / 30));
    center.tx = w / 2 + gx * w * 0.25;
    center.ty = h / 2 + gy * h * 0.18;
  }

  function enableTilt() {
    if (tiltActive || !opts.tilt || !('DeviceOrientationEvent' in window)) return;
    const add = () => { tiltActive = true; window.addEventListener('deviceorientation', onTilt, { passive: true }); };
    const DOE = window.DeviceOrientationEvent;
    if (typeof DOE.requestPermission === 'function') {
      // iOS fragt nach Erlaubnis (nur nach einer Berührung möglich)
      DOE.requestPermission().then((state) => { if (state === 'granted') add(); }).catch(() => {});
    } else {
      add();
    }
  }

  window.addEventListener('scroll', () => { scrollY = window.scrollY; }, { passive: true });
  window.addEventListener('resize', resize);

  // ---------- Öffentliche Schnittstelle ----------
  CS.space = {
    configure(cfg) {
      const e = cfg.effects || {};
      const hueList = [cfg.theme.accent1, cfg.theme.accent2, cfg.theme.accent3].map(U.hexToHue);
      const densityChanged = opts.density !== Number(e.starDensity || 1);
      Object.assign(opts, {
        stars: e.stars !== false,
        density: Number(e.starDensity) || 1,
        speed: Number(e.starSpeed) || 1,
        planets: e.planets !== false,
        rocket: e.rocket !== false,
        parallax: e.parallax !== false,
        tilt: e.tilt !== false,
        hues: hueList,
      });
      if (!opts.parallax && !tiltActive) { center.tx = w / 2; center.ty = h / 2; }
      for (const s of stars) s.hue = opts.hues[(Math.random() * opts.hues.length) | 0];
      if (densityChanged && w) {
        const count = targetCount();
        while (stars.length < count) stars.push(makeStar({}, true));
        stars.length = count;
      }
      if (reduceMotion) { drawStatic(); updatePlanets(0); }
    },

    start() {
      if (started) return;
      started = true;
      resize();
      if (reduceMotion) { drawStatic(); updatePlanets(0); if (rocketEl) rocketEl.hidden = true; return; }
      last = performance.now();
      requestAnimationFrame(frame);
    },

    setWarp(on) { if (!reduceMotion) warpOn = !!on; },
    isWarping: () => warpOn,
    setRainbow(on) { rainbow = !!on; if (reduceMotion) drawStatic(); },
    isRainbow: () => rainbow,
    enableTilt,

    launchRocket() {
      if (reduceMotion || rocket.launchT >= 0) return false;
      rocket.launchT = 0;
      return true;
    },
  };
})();
