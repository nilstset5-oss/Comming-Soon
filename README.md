# 🚀 Coming Soon – mit Studio

Eine animierte Coming-Soon-Seite im Weltraum-Look, die sich zum Starttermin automatisch in eine fertige **Live-Seite** verwandelt. Bearbeitet wird alles im **Studio**, einer Seitenleiste direkt auf der Seite. Jede Änderung siehst du sofort live dahinter.

**Live:** https://claude.ai/artifact/2DAwXXHeNd6jWewEZJ3RM7

---

## Zwei Arten, die Seite zu betreiben

| | **Als Artifact auf claude.ai** (empfohlen) | **Auf GitHub Pages** |
|---|---|---|
| Einrichtung | keine, der Link funktioniert sofort | *Settings → Pages* aktivieren |
| Studio öffnen | Knopf „✏️ Seite bearbeiten“ (nur für dich sichtbar) | `…/#admin`, Login `admin` / `12345` |
| Speichern | **ein Klick**, ohne Token und ohne Passwort | GitHub-Token nötig |
| Anmeldungen | eingebaute Datenbank mit Liste und CSV-Export | über Formspree o. Ä. |
| Weltweite Bestenliste | ✅ | – (nur lokal) |
| KI-Textassistent | ✅ | – |
| 🤖 KI-Chat für Besucher | ✅ | – |
| 👀 Live: Raketen-Cursor, „X gerade hier“, Emoji-Reaktionen | ✅ | – |
| Eigene Adresse, Google-Suche | – | ✅ |

Die Seite erkennt selbst, wo sie läuft, und schaltet die passenden Funktionen ein.

---

## 🤖 Nach dem Release: KI-Chat

Sobald die Seite live ist, erscheint unten rechts **„Frag {Name}“**. Besucher stellen Fragen, und Claude antwortet live gestreamt. Die KI kennt automatisch alles, was auf der Seite steht: Beschreibung, Features, FAQ, Roadmap und Social-Links. Im Studio unter **KI-Chat** kannst du ihr zusätzliches Wissen mitgeben (Preise, Kontakt …) und eine Persönlichkeit wählen: 🧑‍🚀 Weltraum-Kapitän, 😊 Freundlich, 🤖 Roboter, 🏴‍☠️ Weltraum-Pirat, 😄 Witzig oder 💼 Professionell.

Dazu kommt **Mission Control** im Spiel: Nach jeder Runde gibt es auf Knopfdruck einen KI-Funkspruch zum Ergebnis.

Die Antworten laufen über das Claude-Konto der Besucher (claude.ai fragt einmal um Erlaubnis). Wer kein Claude-Konto hat, sieht den Chat nicht.

## 👀 Live-Gefühl

- Wer gleichzeitig auf der Seite ist, fliegt als **kleine Rakete** mit, und oben steht **„X gerade hier“**.
- **Emoji-Reaktionen** (🚀 🔥 ❤️ 👏 🤯 🎉) fliegen bei allen live über den Bildschirm.
- In den **letzten 10 Sekunden** vor dem Start zählt ein riesiger Countdown mit Piepen runter, danach folgt die Launch-Show.

Die Raketen und die Zuschauerzahl sehen alle, die mit ihrem Claude-Konto Zugriff haben (z. B. dein Team). Reaktionen senden können nur Mitwirkende.

## ✏️ Das Studio

- **Direkt auf der Seite tippen:** Bei offenem Studio einfach auf einen Text der Seite klicken und losschreiben. `Enter` übernimmt, `Esc` bricht ab.
- **Schnellstart-Assistent:** Name und Emoji, dann das Thema (per KI oder Vorlage), dann das Startdatum, fertig. Er erscheint beim ersten Öffnen automatisch.
- Aufgeräumte Navigation: Die wichtigsten Bereiche sind sofort sichtbar, alles Weitere liegt unter **„⋯ Mehr“**.

- **Übersicht:** Countdown, Anzahl der Anmeldungen und Spieler, Einrichtungs-Checkliste
- **Vorlagen & KI:** 6 Vorlagen (App, Spiel, Shop, Event, Creator, Weltraum) oder Texte auf Deutsch und Englisch von Claude schreiben lassen
- **Zeitplan:** Modus (automatisch, Coming Soon, Live), Startdatum, Launch-Show testen
- **Texte & Marke:** Name, Logo (Emoji oder Bild), alle Texte, Banner
- **Design:** 7 Farbthemen oder eigene Farben, Sterne, Planeten, Rakete, Sound
- **Bereiche, Roadmap & FAQ:** Listen bearbeiten, sortieren und löschen
- **Anmeldungen:** Liste live, Adressen kopieren, CSV speichern
- **Social Media, Spiel & Easter Eggs, Teilen & SEO, Zugang, Veröffentlichen**

Extras: **Rückgängig/Wiederholen** (`Strg+Z`, `Strg+Umschalt+Z`) und **Veröffentlichen** mit `Strg+S`. Ein Entwurf bleibt gespeichert, bis du veröffentlichst. Beim Ansehen umschalten kannst du zwischen **Echt / Soon / Live** und **DE / EN**.

### So funktioniert das Speichern ohne Token (Artifact)

Die veröffentlichte Seite trägt ihren eigenen Bauplan in sich. Klickst du auf „Veröffentlichen“, setzt das Studio deine Einstellungen ein und veröffentlicht die Seite über claude.ai neu. Alle Besucher sehen dann sofort die neue Version. Das dürfen nur du und Personen, denen du in claude.ai Bearbeiten-Rechte gibst.

### Für alle sichtbar machen

Ein neues Artifact ist zuerst **privat**. Um das zu ändern, klickst du in claude.ai oben auf **Teilen** und stellst den Zugriff auf **„Jeder mit dem Link“**.

### Gut zu wissen (Artifact)

- **Anmelden** können sich alle, die die Seite mit ihrem Claude-Konto mitbenutzen dürfen (z. B. dein Team). Wer die Seite nur ansieht, bekommt statt des Formulars den Kalender- und den Teilen-Knopf.
- Die E-Mail-Adressen sieht **nur der Besitzer**.
- Fremde Dienste wie Formspree oder GoatCounter blockiert claude.ai. Dafür gibt es die eingebaute Datenbank.

---

## 🛠 Artifact neu bauen

Nach Änderungen am Code baust du die Datei für das Artifact so neu:

```bash
node tools/build-artifact.js --url https://claude.ai/artifact/2DAwXXHeNd6jWewEZJ3RM7
```

Das ergibt `dist/coming-soon.html`: eine einzige Datei mit allen Styles, Skripten und dem eingebauten Bauplan. Die Datei wird als Artifact veröffentlicht. Dabei braucht es die Fähigkeiten `artifact`, `user`, `db` (mit Regeln für `signups` und `scores`), `downloads` und `sample`.

---

## 🌐 GitHub Pages

1. Im Repo unter **Settings → Pages** bei *Deploy from a branch* den Branch und `/ (root)` wählen.
2. Die Seite öffnen und `#admin` an die Adresse hängen. Anmelden mit `admin` / `12345` und **sofort das Passwort ändern** (Studio → Zugang).
3. Zum Veröffentlichen einen [Fine-grained Token](https://github.com/settings/personal-access-tokens/new) mit *Contents: Read and write* für dieses Repo im Studio eintragen. Der Token bleibt nur in deinem Browser.
4. Anmeldungen per [Formspree](https://formspree.io), Besucherzähler per [GoatCounter](https://www.goatcounter.com) (beides im Studio).

Auf einer statischen Seite ist der Login nur ein Türschild. Ändern kann die Seite trotzdem nur, wer den GitHub-Token hat.

---

## ✨ Was die Seite kann

- Sternenfeld mit **Warp-Speed** (Maus, Finger oder Leertaste halten), Planeten, Farbnebel und eine Rakete, die um die Seite fliegt
- **Countdown** als Flip-Uhr oder Glas-Kacheln, „In den Kalender“, „Teilen“
- Geheime Feature-Karten 🔒, die erst zum Start enthüllt werden
- **Launch-Show** beim Ablauf des Countdowns: Warp, „LIFTOFF!“, Konfetti, danach die Live-Seite
- **Live-Seite** mit Navigation, Features, Über uns, animierten Zahlen, Roadmap, FAQ und Newsletter
- Mini-Spiel **„Asteroid Run“** mit Power-ups und Bestenliste
- **7 Easter Eggs**, Deutsch/Englisch, Weltraum-Sound, Social-Icons für 21 Plattformen
- Link-Vorschau, App-Icons, `robots.txt`, `sitemap.xml`, 404-Seite „Lost in Space“
- Funktioniert auf dem Handy und respektiert „Bewegung reduzieren“

<details>
<summary>🥚 Easter Eggs (Spoiler)</summary>

| Was | Wie |
|---|---|
| 🌈 Regenbogen-Sterne | `↑ ↑ ↓ ↓ ← → ← → B A` |
| 🎉 Party | `party` tippen |
| 🛸 UFO | `ufo` tippen |
| 🌌 Hyperraum | `warp` tippen |
| 🔄 Fassrolle | 5× schnell aufs Logo klicken |
| 🚀 Probestart | Auf die Rakete klicken |
| 🤫 Geheimes Wort | im Studio festlegen (Standard: `nova`) |

</details>

---

## 📁 Aufbau

```
index.html              Die Seite (Coming Soon + Live)
config.json             Einstellungen für GitHub Pages
admin.html              Leitet zum Studio weiter (#admin)
404.html                „Lost in Space“
assets/css/site.css     Seitendesign
assets/css/studio.css   Studio
assets/js/config.js     Standard-Einstellungen, Texte, Vorlagen, Hilfsfunktionen
assets/js/backend.js    Speichern, Anmeldungen, Bestenliste (Artifact oder statisch)
assets/js/studio.js     Studio
assets/js/site.js       Hauptlogik der Seite
assets/js/space.js      Sterne, Planeten, Rakete, Handy-Neigung
assets/js/fx.js         Konfetti, Flip-Uhr, Zähler, Meldungen
assets/js/sound.js      Sound (Web Audio, ohne Dateien)
assets/js/game.js       Mini-Spiel
assets/js/images.js     Vorschaubild & App-Icons (GitHub Pages)
assets/js/icons.js      Social-Media-Icons
tools/build-artifact.js Baut die Artifact-Datei
```

## 🧪 Lokal testen

```bash
python3 -m http.server 8000
# http://localhost:8000          → Seite
# http://localhost:8000/#admin   → Studio (admin / 12345)
```

---

Marken-Icons: [Simple Icons](https://simpleicons.org) (CC0). Die Markenrechte liegen bei den jeweiligen Inhabern.
