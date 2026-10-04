#!/usr/bin/env node
/* =========================================================
   Baut aus index.html + assets/ eine einzige Datei für ein
   Artifact auf claude.ai (dist/coming-soon.html).

   Die Datei trägt sich selbst als Vorlage in sich. So kann das
   Studio die Seite mit neuen Einstellungen neu veröffentlichen –
   ohne Server und ohne Token.

   Aufruf:  node tools/build-artifact.js [--url <Artifact-Link>] [--config <datei.json>]
   ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const CS = require(path.join(ROOT, 'assets/js/config.js'));
const U = CS.util;

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

// JS sicher in <script> einbetten
const inlineJs = (src) => src.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const inlineCss = (src) => src.replace(/<\/style/gi, '<\\/style');

// 1) Körper der Seite aus index.html holen (ohne <script src>)
const index = read('index.html');
const bodyMatch = index.match(/<body[^>]*>([\s\S]*)<\/body>/i);
if (!bodyMatch) throw new Error('Kein <body> in index.html gefunden');
const scripts = [];
let body = bodyMatch[1]
  .replace(/[ \t]*<script src="([^"]+)"><\/script>\n?/g, (m, src) => { scripts.push(src); return ''; })
  .replace(/[ \t]*<!-- Einstellungen:[^>]*-->\n?/, '')
  .replace(/[ \t]*<script type="application\/json" id="cs-config"><\/script>\n?/, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const tok = U.templateToken;
const template = [
  `<title>${tok('TITLE')}</title>`,
  '<meta name="description" content="Coming Soon">',
  `<style>\n${inlineCss(read('assets/css/site.css'))}\n</style>`,
  `<style>\n${inlineCss(read('assets/css/studio.css'))}\n</style>`,
  body,
  `<script type="application/json" id="cs-config">${tok('CONFIG')}</script>`,
  `<script>window.CS_TEMPLATE=${tok('SELF')};</script>`,
  ...scripts.map((src) => `<script>\n${inlineJs(read(src))}\n</script>`),
  '',
].join('\n');

// Jeder Platzhalter genau einmal – sonst würde die Seite sich falsch neu erzeugen
for (const name of ['TITLE', 'CONFIG', 'SELF']) {
  const n = template.split(tok(name)).length - 1;
  if (n !== 1) throw new Error(`Platzhalter ${name} kommt ${n}× vor (erwartet: 1)`);
}

// 2) Einstellungen
let cfg = U.clone(CS.DEFAULT_CONFIG);
const cfgFile = arg('--config');
if (cfgFile) cfg = U.merge(cfg, JSON.parse(fs.readFileSync(cfgFile, 'utf8')));
const url = arg('--url');
cfg.seo.siteUrl = url || '';
// Im Artifact gibt es kein Passwort und keinen GitHub-Token
cfg.footer.showAdminLink = false;

// 3) Schreiben
const out = U.fillTemplate(template, cfg);
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/coming-soon.html'), out);

console.log(`dist/coming-soon.html  ${(out.length / 1024).toFixed(0)} KB  (${scripts.length} Skripte eingebettet)`);
