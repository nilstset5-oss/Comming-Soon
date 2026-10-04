/* =========================================================
   Sound – komplett im Browser erzeugt (Web Audio), keine Dateien nötig.
   ========================================================= */
(function () {
  'use strict';
  const CS = (window.CS = window.CS || {});

  let ctx = null;
  let master = null;
  let ambientBus = null;
  let sfxBus = null;
  let noiseBuf = null;
  let ambientStarted = false;
  let enabled = false;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      ambientBus = ctx.createGain();
      ambientBus.gain.value = 0.55;
      ambientBus.connect(master);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.6;
      sfxBus.connect(master);

      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function lfo(freq, depth, target) {
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g);
    g.connect(target);
    o.start();
  }

  // Ruhiger Weltraum-Klangteppich
  function startAmbient() {
    if (ambientStarted) return;
    ambientStarted = true;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    lp.Q.value = 1.2;
    const pad = ctx.createGain();
    pad.gain.value = 0.1;

    const voices = [[55, 'sine', 1], [82.41, 'triangle', 0.5], [110, 'sine', 0.35], [164.81, 'sine', 0.14]];
    voices.forEach(([freq, type, gain], i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = i % 2 ? 6 : -6;
      const g = ctx.createGain();
      g.gain.value = gain;
      lfo(0.05 + i * 0.03, gain * 0.4, g.gain);
      o.connect(g);
      g.connect(lp);
      o.start();
    });
    lfo(0.04, 260, lp.frequency);
    lp.connect(pad);
    pad.connect(ambientBus);

    // leiser „Sternenwind“
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.6;
    const ng = ctx.createGain();
    ng.gain.value = 0.022;
    lfo(0.07, 400, bp.frequency);
    noise.connect(bp);
    bp.connect(ng);
    ng.connect(ambientBus);
    noise.start();
  }

  function tone(freq, dur, opts = {}) {
    if (!enabled || !ctx) return;
    const t0 = ctx.currentTime + (opts.delay || 0);
    const o = ctx.createOscillator();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
    const g = ctx.createGain();
    const peak = opts.gain == null ? 0.2 : opts.gain;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(sfxBus);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function noiseBurst(dur, opts = {}) {
    if (!enabled || !ctx) return;
    const t0 = ctx.currentTime + (opts.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = opts.filter || 'lowpass';
    f.frequency.setValueAtTime(opts.from || 1200, t0);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    f.Q.value = opts.q || 0.8;
    const g = ctx.createGain();
    const peak = opts.gain == null ? 0.3 : opts.gain;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  const SFX = {
    click: () => tone(1400, 0.05, { type: 'triangle', gain: 0.06 }),
    shoot: () => tone(1800, 0.06, { type: 'square', gain: 0.012, slideTo: 900 }),
    coin: () => { tone(988, 0.08, { type: 'square', gain: 0.05 }); tone(1319, 0.18, { type: 'square', gain: 0.05, delay: 0.07 }); },
    boom: () => noiseBurst(0.45, { from: 1600, to: 80, gain: 0.35 }),
    hit: () => { tone(160, 0.5, { type: 'sawtooth', gain: 0.18, slideTo: 40 }); noiseBurst(0.4, { from: 800, to: 60, gain: 0.3 }); },
    power: () => tone(400, 0.35, { type: 'sine', gain: 0.15, slideTo: 1400 }),
    over: () => [440, 349, 262, 196].forEach((f, i) => tone(f, 0.28, { type: 'triangle', gain: 0.15, delay: i * 0.18 })),
    success: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { type: 'triangle', gain: 0.13, delay: i * 0.08 })),
    egg: () => [1047, 1319, 1568, 2093, 2637].forEach((f, i) => tone(f, 0.18, { type: 'sine', gain: 0.08, delay: i * 0.06 })),
    liftoff: () => { noiseBurst(2.2, { from: 200, to: 3000, filter: 'bandpass', q: 1, gain: 0.35, attack: 0.6 }); tone(60, 2.2, { type: 'sawtooth', gain: 0.12, slideTo: 240 }); },
  };

  CS.sound = {
    isEnabled: () => enabled,

    setEnabled(on) {
      if (!ensure()) return;
      enabled = !!on;
      if (enabled) startAmbient();
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(enabled ? 0.9 : 0, t, 0.35);
      try { localStorage.setItem('cs-sound', enabled ? '1' : '0'); } catch (e) { /* egal */ }
    },

    toggle() { this.setEnabled(!enabled); return enabled; },

    // Gespeicherte Wahl (oder Standard) – null wenn noch nie gewählt
    saved() {
      try {
        const v = localStorage.getItem('cs-sound');
        return v == null ? null : v === '1';
      } catch (e) { return null; }
    },

    warp(on) {
      if (!enabled || !ctx) return;
      if (on) {
        noiseBurst(1.4, { from: 250, to: 2600, filter: 'bandpass', q: 1.4, gain: 0.3, attack: 0.25 });
        tone(70, 1.4, { type: 'sawtooth', gain: 0.07, slideTo: 280 });
      } else {
        noiseBurst(0.8, { from: 2400, to: 180, filter: 'bandpass', q: 1.2, gain: 0.18, attack: 0.02 });
      }
    },

    sfx(name) { if (SFX[name]) SFX[name](); },
  };
})();
