/* =========================================================
   Backend – wo Einstellungen, Anmeldungen und Highscores landen.

   Zwei Betriebsarten, automatisch erkannt:
   - "artifact": Die Seite läuft als Artifact auf claude.ai.
       Einstellungen stecken in der Seite selbst; Speichern
       veröffentlicht die Seite neu (nur Besitzer/Bearbeiter).
       Anmeldungen und Bestenliste liegen in der Artifact-Datenbank.
       Kein Token, kein Passwort.
   - "static": Die Seite läuft z. B. auf GitHub Pages.
       Einstellungen kommen aus config.json; Speichern geht über
       einen GitHub-Token. Anmeldungen über Formspree & Co.
   ========================================================= */
(function () {
  'use strict';
  const CS = (window.CS = window.CS || {});
  const U = CS.util;

  const hasClaude = !!(window.claude && typeof window.claude.use === 'function');
  const hasTemplate = typeof window.CS_TEMPLATE === 'string';

  const B = (CS.backend = {
    kind: hasClaude && hasTemplate ? 'artifact' : 'static',
    published: null,
    db: null,
    user: null,
    uid: null,
    canEdit: false,
    canWrite: null,
    ready: null,
  });

  const use = (name) => (hasClaude ? window.claude.use(name).catch(() => null) : Promise.resolve(null));

  // ---------------------------------------------------------
  //  Einstellungen laden
  // ---------------------------------------------------------
  function embeddedConfig() {
    const el = document.getElementById('cs-config');
    if (!el) return null;
    const text = (el.textContent || '').trim();
    if (!text || text.charAt(0) !== '{') return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  B.loadConfig = async function () {
    const embedded = embeddedConfig();
    let cfg = null;
    if (embedded) cfg = U.merge(CS.DEFAULT_CONFIG, embedded);
    if (!cfg) {
      try {
        const res = await fetch('config.json?t=' + Date.now(), { cache: 'no-store' });
        if (res.ok) cfg = U.merge(CS.DEFAULT_CONFIG, await res.json());
      } catch (e) { /* lokal als Datei geöffnet oder nicht vorhanden */ }
    }
    if (!cfg) cfg = U.clone(CS.DEFAULT_CONFIG);
    B.published = U.clone(cfg);
    return cfg;
  };

  // ---------------------------------------------------------
  //  Fähigkeiten der Artifact-Umgebung abfragen
  // ---------------------------------------------------------
  B.init = function () {
    if (B.ready) return B.ready;
    B.ready = (async () => {
      if (B.kind !== 'artifact') return B;
      const [user, db] = await Promise.all([use('user'), use('db')]);
      B.user = user;
      B.db = db;
      if (user) {
        try {
          const [canEdit, uid, canWrite] = await Promise.all([user.canEdit(), user.id(), user.can('data.write')]);
          B.canEdit = !!canEdit;
          B.uid = uid;
          B.canWrite = canWrite;
        } catch (e) { /* Lesen schlägt nie fehl – sicher ist sicher */ }
      }
      return B;
    })();
    return B.ready;
  };

  // ---------------------------------------------------------
  //  Speichern / Veröffentlichen
  // ---------------------------------------------------------
  B.saveMode = () => (B.kind === 'artifact' ? 'artifact' : 'github');

  B.publishArtifact = async function (cfg) {
    const art = await use('artifact');
    if (!art) { const e = new Error('not_granted'); e.code = 'not_granted'; throw e; }
    const html = U.buildDocument(window.CS_TEMPLATE, cfg);
    return art.publish(html);
  };

  // ---------------------------------------------------------
  //  Anmeldungen
  // ---------------------------------------------------------
  // 'db' = Artifact-Datenbank · 'endpoint' = Formspree & Co. · 'demo' = nur Anzeige · 'none' = nicht möglich
  B.signupMode = function (cfg) {
    if (B.kind === 'artifact') {
      if (!B.db || !B.uid || B.canWrite === false) return 'none';
      return 'db';
    }
    const endpoint = U.safeUrl(cfg.signup.endpoint);
    return endpoint && /^https:/i.test(endpoint) ? 'endpoint' : 'demo';
  };

  B.signup = async function (cfg, data) {
    const mode = B.signupMode(cfg);
    if (mode === 'db') {
      await B.db.doc('signups/' + B.uid).set({
        email: String(data.email).slice(0, 200),
        lang: data.lang,
        source: data.source,
        ts: Date.now(),
      });
      return 'db';
    }
    if (mode === 'endpoint') {
      const res = await fetch(U.safeUrl(cfg.signup.endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: data.email, language: data.lang, source: data.source, page: location.href.split('?')[0] }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return 'endpoint';
    }
    if (mode === 'demo') {
      console.warn('[Coming Soon] Kein Anmelde-Dienst eingestellt – die E-Mail-Adresse wurde NICHT gespeichert.');
      return 'demo';
    }
    throw new Error('unavailable');
  };

  B.mySignup = async function () {
    if (B.kind !== 'artifact' || !B.db || !B.uid) return null;
    try {
      const snap = await B.db.doc('signups/' + B.uid).get();
      return snap.exists ? snap.data() : null;
    } catch (e) { return null; }
  };

  // Für das Studio: alle Anmeldungen live (nur Besitzer/Bearbeiter sehen alle)
  B.watchSignups = function (onRows, onError) {
    if (B.kind !== 'artifact' || !B.db) return null;
    return B.db.collection('signups').orderBy('ts', 'desc').limit(1000).onSnapshot(
      (snap) => onRows(snap.docs.map((d) => Object.assign({ id: d.id }, d.data()))),
      (err) => onError && onError(err),
    );
  };

  B.deleteSignup = (id) => B.db.doc('signups/' + id).delete();

  // ---------------------------------------------------------
  //  Bestenliste (Mini-Spiel)
  // ---------------------------------------------------------
  B.hasWorldScores = () => B.kind === 'artifact' && !!B.db;

  B.submitScore = async function (name, score) {
    if (B.kind !== 'artifact' || !B.db || !B.uid) return false;
    const ref = B.db.doc('scores/' + B.uid);
    try {
      const snap = await ref.get();
      const old = snap.exists ? snap.data() : null;
      if (old && Number(old.score) >= score && old.name === name) return true;
      await ref.set({
        name: String(name || 'Pilot').slice(0, 16),
        score: Math.max(score, old ? Number(old.score) || 0 : 0),
        ts: Date.now(),
      });
      return true;
    } catch (e) {
      return false;
    }
  };

  B.topScores = async function (n = 10) {
    if (!B.hasWorldScores()) return null;
    try {
      const snap = await B.db.collection('scores').orderBy('score', 'desc').limit(n).get();
      return snap.docs.map((d) => Object.assign({ id: d.id, me: d.id === B.uid }, d.data()));
    } catch (e) {
      return null;
    }
  };

  B.watchScores = function (onRows) {
    if (!B.hasWorldScores()) return null;
    return B.db.collection('scores').orderBy('score', 'desc').limit(50).onSnapshot(
      (snap) => onRows(snap.docs.map((d) => Object.assign({ id: d.id }, d.data()))),
      () => {},
    );
  };

  B.deleteScore = (id) => B.db.doc('scores/' + id).delete();

  // ---------------------------------------------------------
  //  Dateien speichern & Zwischenablage
  // ---------------------------------------------------------
  B.download = async function (filename, data, type = 'text/plain') {
    if (B.kind === 'artifact') {
      const dl = await use('downloads');
      if (!dl) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
      return dl.save({ filename, data });
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type }));
    a.download = filename;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return { status: 'saved' };
  };

  B.copy = async function (text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      return false;
    }
  };

  // ---------------------------------------------------------
  //  KI (nur als Artifact)
  // ---------------------------------------------------------
  B.ai = () => (B.kind === 'artifact' ? use('sample') : Promise.resolve(null));

  // Link, den man teilen kann
  B.shareUrl = function (cfg) {
    const configured = String((cfg && cfg.seo && cfg.seo.siteUrl) || '').trim();
    if (B.kind === 'artifact') return configured || '';
    return configured || location.href.split(/[?#]/)[0];
  };
})();
