/* =========================================================
   Erzeugt das Link-Vorschaubild (1200×630) und die App-Icons
   aus den Einstellungen – direkt im Browser per Canvas.
   ========================================================= */
(function (root) {
  'use strict';
  const CS = (root.CS = root.CS || {});
  const U = CS.util;

  // Zufall mit festem Startwert → gleiche Einstellungen ergeben das gleiche Bild
  function rng(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rgba = (hex, a) => {
    const { r, g, b } = U.hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  };

  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function canvasOf(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function drawEmoji(ctx, emoji, cx, cy, size) {
    ctx.save();
    ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(emoji);
    const asc = m.actualBoundingBoxAscent || size * 0.8;
    const desc = m.actualBoundingBoxDescent || size * 0.1;
    ctx.fillText(emoji, cx, cy + (asc - desc) / 2);
    ctx.restore();
  }

  async function logoImage(cfg) {
    const b = cfg.brand;
    if (b.logoType !== 'image') return null;
    return loadImage(U.safeUrl(b.logoImage, { allowData: true }));
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------------------------------------------------
  //  Link-Vorschaubild
  // ---------------------------------------------------------
  async function og(cfg, lang = 'de') {
    const W = 1200, H = 630;
    const c = canvasOf(W, H);
    const ctx = c.getContext('2d');
    const th = cfg.theme;
    const rand = rng(1337);
    const live = U.currentMode(cfg) === 'live';
    const name = cfg.brand.name || 'Coming Soon';

    ctx.fillStyle = th.bg || '#05060f';
    ctx.fillRect(0, 0, W, H);

    // Nebel
    for (const [x, y, col, a, r] of [[0.22, 0.3, th.accent1, 0.42, 520], [0.8, 0.75, th.accent3, 0.32, 480], [0.62, 0.1, th.accent2, 0.22, 400]]) {
      const g = ctx.createRadialGradient(W * x, H * y, 0, W * x, H * y, r);
      g.addColorStop(0, rgba(col, a));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // Sterne als Lichtstreifen aus der Mitte
    const cx = W / 2, cy = H / 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 320; i++) {
      const a = rand() * Math.PI * 2;
      const d0 = 30 + rand() * 650;
      const len = 2 + (d0 / 650) * 46 * rand();
      const k = d0 / 650;
      const colored = rand() < 0.25;
      const hue = [th.accent1, th.accent2, th.accent3][(rand() * 3) | 0];
      ctx.strokeStyle = colored ? rgba(hue, 0.5 + k * 0.5) : `rgba(235, 240, 255, ${0.2 + k * 0.7})`;
      ctx.lineWidth = 0.6 + k * 2.4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * d0, cy + Math.sin(a) * d0 * 0.75);
      ctx.lineTo(cx + Math.cos(a) * (d0 + len), cy + Math.sin(a) * (d0 + len) * 0.75);
      ctx.stroke();
    }

    // Abdunkeln zur Mitte für Lesbarkeit
    const v = ctx.createRadialGradient(cx, cy, 0, cx, cy, 520);
    v.addColorStop(0, rgba(th.bg || '#05060f', 0.75));
    v.addColorStop(1, rgba(th.bg || '#05060f', 0));
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);

    // Logo
    const img = await logoImage(cfg);
    if (img) {
      const s = 120;
      ctx.save();
      roundRect(ctx, cx - s / 2, 70, s, s, 24);
      ctx.clip();
      ctx.drawImage(img, cx - s / 2, 70, s, s);
      ctx.restore();
    } else {
      drawEmoji(ctx, cfg.brand.logoEmoji || '🚀', cx, 132, 104);
    }

    // Name mit Farbverlauf
    let fontSize = 150;
    const font = (s) => `900 ${s}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.font = font(fontSize);
    while (ctx.measureText(name).width > 1060 && fontSize > 40) {
      fontSize -= 4;
      ctx.font = font(fontSize);
    }
    const tw = ctx.measureText(name).width;
    const grad = ctx.createLinearGradient(cx - tw / 2, 0, cx + tw / 2, 0);
    grad.addColorStop(0, th.accent2);
    grad.addColorStop(0.5, th.accent1);
    grad.addColorStop(1, th.accent3);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = rgba(th.accent1, 0.6);
    ctx.shadowBlur = 40;
    ctx.fillStyle = grad;
    ctx.fillText(name, cx, 318);
    ctx.shadowBlur = 0;

    // Pille „Coming Soon“ / „Jetzt live“
    const pill = (live ? U.tr(cfg.live.badge, lang) : U.tr(cfg.soon.headline, lang)).toUpperCase();
    ctx.font = '700 30px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const pw = ctx.measureText(pill).width + 64;
    roundRect(ctx, cx - pw / 2, 420, pw, 60, 30);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(pill, cx, 451);

    // Datum
    if (!live) {
      const t = U.launchTime(cfg);
      if (Number.isFinite(t)) {
        const date = new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-US', { dateStyle: 'long', timeZone: cfg.timeZone || 'Europe/Berlin' }).format(new Date(t));
        ctx.font = '500 28px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = 'rgba(232, 236, 255, 0.75)';
        ctx.fillText('🚀 ' + date, cx, 535);
      }
    }

    return c.toDataURL('image/jpeg', 0.86);
  }

  // ---------------------------------------------------------
  //  App-Icon
  // ---------------------------------------------------------
  async function icon(cfg, size, { square = false } = {}) {
    const c = canvasOf(size, size);
    const ctx = c.getContext('2d');
    const th = cfg.theme;
    const rand = rng(7);

    ctx.save();
    if (!square) {
      roundRect(ctx, 0, 0, size, size, size * 0.22);
      ctx.clip();
    }
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, th.accent1);
    g.addColorStop(1, th.accent3);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const glow = ctx.createRadialGradient(size * 0.3, size * 0.25, 0, size * 0.3, size * 0.25, size * 0.8);
    glow.addColorStop(0, rgba(th.accent2, 0.55));
    glow.addColorStop(1, rgba(th.accent2, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.3 + rand() * 0.6})`;
      ctx.beginPath();
      ctx.arc(rand() * size, rand() * size, (0.4 + rand()) * size / 160, 0, Math.PI * 2);
      ctx.fill();
    }

    const img = await logoImage(cfg);
    if (img) {
      const s = size * 0.62;
      ctx.drawImage(img, (size - s) / 2, (size - s) / 2, s, s);
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = size * 0.06;
      drawEmoji(ctx, cfg.brand.logoEmoji || '🚀', size / 2, size / 2, size * 0.56);
    }
    ctx.restore();
    return c.toDataURL('image/png');
  }

  function manifest(cfg) {
    const name = cfg.brand.name || 'Coming Soon';
    return JSON.stringify({
      name,
      short_name: name.slice(0, 12),
      description: U.format(cfg.seo.description, { name }),
      start_url: './',
      scope: './',
      display: 'standalone',
      background_color: cfg.theme.bg,
      theme_color: cfg.theme.bg,
      icons: [
        { src: 'assets/img/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'assets/img/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    }, null, 2) + '\n';
  }

  CS.images = {
    og,
    icon,
    manifest,
    async all(cfg) {
      return {
        'assets/img/og-image.jpg': await og(cfg),
        'assets/img/icon-192.png': await icon(cfg, 192),
        'assets/img/icon-512.png': await icon(cfg, 512),
        'assets/img/apple-touch-icon.png': await icon(cfg, 180, { square: true }),
      };
    },
  };
})(window);
