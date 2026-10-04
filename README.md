# 🚀 Coming Soon – mit Admin-Panel

Eine animierte Coming-Soon-Seite im Weltraum-Look, die sich zum Starttermin automatisch in eine fertige **Live-Seite** verwandelt. Alles lässt sich über ein **Admin-Panel** einstellen, ohne Code anzufassen.

Läuft kostenlos auf **GitHub Pages**. Kein Server, keine Datenbank und kein Build-Schritt nötig.

---

## ✨ Was alles drin ist

**Coming-Soon-Seite**
- Sternenfeld mit **Warp-Speed** (Maus, Finger oder Leertaste gedrückt halten)
- Planeten, Farbnebel und eine **Rakete**, die um die Seite fliegt
- Sterne folgen der Maus und der **Handy-Neigung**
- **Countdown** als Flip-Uhr oder Glas-Kacheln
- E-Mail-Anmeldung mit Konfetti
- „In den Kalender“ (.ics) und „Teilen“
- **Geheime Feature-Karten** 🔒, die erst zum Start enthüllt werden
- Roadmap, FAQ und Glitch-Effekt im Titel

**Launch-Show** 🎉
Wenn der Countdown abläuft, gibt es Warp-Speed, „LIFTOFF!“ und Konfetti-Kanonen. Danach wird die Seite live, ohne dass man neu laden muss.

**Live-Seite**
Hero mit Buttons, Features, Über uns, animierte Zahlen, Roadmap, Spiel, FAQ, Newsletter und Navigation.

**Überall dabei**
- Mini-Spiel **„Asteroid Run“** mit Power-ups, Leben und Bestenliste
- **7 Easter Eggs** mit Zähler
- **Deutsch / Englisch** zum Umschalten
- **Weltraum-Sound**, komplett im Browser erzeugt (standardmäßig aus)
- Social-Media-Icons für 21 Plattformen
- Ankündigungs-Banner
- Link-Vorschau für WhatsApp, Discord, X & Co.
- App-Icons, „Zum Startbildschirm hinzufügen“, SEO, `robots.txt` und `sitemap.xml`
- 404-Seite „Lost in Space“
- Besucherzähler ohne Cookies (GoatCounter)
- Funktioniert auf dem Handy und respektiert „Bewegung reduzieren“

---

## 1️⃣ Online stellen (GitHub Pages)

1. Im Repo auf **Settings → Pages** gehen.
2. Bei *Source* **„Deploy from a branch“** wählen.
3. Den Branch mit dieser Seite wählen (z. B. `main`), Ordner **`/ (root)`**, dann **Save**.
4. Nach 1–2 Minuten ist die Seite online unter
   **`https://nilstset5-oss.github.io/Comming-Soon/`**

---

## 2️⃣ Admin-Panel

Erreichbar unter **`…/admin.html`**, unten im Footer gibt es auch einen 🔒-Link.

| Benutzer | Passwort |
|---|---|
| `admin` | `12345` |

> ⚠️ **Ändere das Passwort sofort** unter *Sicherheit*. `12345` steht öffentlich in dieser README.

Im Panel stellst du alles mit **Live-Vorschau** ein: Startdatum, Modus, Texte (DE/EN), Logo, Farben, Effekte, Bereiche, Roadmap, FAQ, Social Links, Easter Eggs, SEO und mehr.

### Veröffentlichen: GitHub-Token einrichten (einmalig)

Damit der Button „Veröffentlichen“ deine Änderungen direkt ins Repo speichern kann:

1. [Fine-grained Token erstellen](https://github.com/settings/personal-access-tokens/new)
2. *Repository access*: **Only select repositories**, dann dieses Repo auswählen.
3. *Permissions → Contents*: **Read and write**
4. Token kopieren und im Admin-Panel unter **Veröffentlichen** einfügen.

Der Token wird **nur in deinem Browser** gespeichert, nie im Repo. Beim Veröffentlichen entsteht genau **ein Commit**, der `config.json`, die Link-Vorschau, das Vorschaubild und die App-Icons aktualisiert.

**Tastenkürzel:** `Strg/⌘ + S` veröffentlicht.

---

## 3️⃣ E-Mail-Anmeldungen speichern

Ohne Einrichtung läuft das Formular im **Demo-Modus**: Besucher sehen „Danke!“, aber die Adressen werden nicht gespeichert.

So richtest du es ein:
1. Kostenloses Konto bei [Formspree](https://formspree.io) anlegen, dann **New Form**.
2. Die Adresse `https://formspree.io/f/…` kopieren.
3. Im Admin-Panel unter **Anmeldung** einfügen und veröffentlichen.

Es funktioniert auch jeder andere Dienst, der JSON per POST annimmt (Feld `email`).

---

## 4️⃣ Besucherzähler (optional)

1. Bei [GoatCounter](https://www.goatcounter.com/signup) registrieren (kostenlos, ohne Cookies).
2. Den Code im Admin-Panel unter **SEO & Statistik** eintragen.
3. Für die Anzeige im Footer in GoatCounter „Allow adding visitor counts“ aktivieren.

---

## 🥚 Easter Eggs (Spoiler!)

<details>
<summary>Aufklappen</summary>

| Was | Wie |
|---|---|
| 🌈 Regenbogen-Sterne | `↑ ↑ ↓ ↓ ← → ← → B A` |
| 🎉 Party-Modus | `party` tippen |
| 🛸 UFO | `ufo` tippen |
| 🌌 Hyperraum | `warp` tippen |
| 🔄 Fassrolle | 5× schnell aufs Logo klicken |
| 🚀 Probestart | Auf die fliegende Rakete klicken |
| 🤫 Geheimes Wort | Im Admin-Panel festlegen (Standard: `nova`) |

</details>

---

## 🧪 Lokal testen

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen (Admin: http://localhost:8000/admin.html)
```

Du kannst `index.html` auch direkt per Doppelklick öffnen. Dann werden die Standard-Einstellungen benutzt, weil der Browser `config.json` ohne Server nicht laden darf.

---

## 📁 Aufbau

```
index.html              Die Seite (Coming Soon + Live)
admin.html              Admin-Panel
config.json             Alle Einstellungen (schreibt das Admin-Panel)
404.html                „Lost in Space“-Fehlerseite
manifest.webmanifest    App-Daten fürs Handy
assets/css/             site.css, admin.css
assets/js/config.js     Standard-Einstellungen, Texte, Hilfsfunktionen
assets/js/site.js       Hauptlogik der Seite
assets/js/space.js      Sterne, Planeten, Rakete, Handy-Neigung
assets/js/fx.js         Konfetti, Flip-Uhr, Zähler, Meldungen
assets/js/sound.js      Sound (Web Audio, ohne Dateien)
assets/js/game.js       Mini-Spiel „Asteroid Run“
assets/js/images.js     Erzeugt Vorschaubild & App-Icons
assets/js/admin.js      Admin-Panel
assets/js/icons.js      Social-Media-Icons
assets/img/             Vorschaubild & Icons
```

---

## 🔒 Gut zu wissen

Das ist eine **statische Seite**. Der Admin-Login ist deshalb wie ein Türschild: Er hält Neugierige fern, ist aber kein Tresor. Das ist in Ordnung, denn **ändern** kann die Seite nur, wer deinen GitHub-Token hat. Gib ihn niemals weiter und setze beim Erstellen ein Ablaufdatum.

---

Marken-Icons: [Simple Icons](https://simpleicons.org) (CC0). Die Markenrechte liegen bei den jeweiligen Inhabern.
