# Coming Soon 🚀

Eine animierte „Coming Soon“-Seite im Weltraum-Look. Sie besteht aus einer einzigen Datei (`index.html`) und braucht weder Build-Schritt noch Abhängigkeiten.

## Features

- **Sternenfeld**: Die Sterne fliegen auf dich zu, der Fluchtpunkt folgt leicht der Maus.
- **Warp-Speed**: Maus, Finger oder Leertaste gedrückt halten.
- **Countdown** bis zum Starttermin. Wenn er abgelaufen ist, steht da „Wir sind live!“.
- **E-Mail-Anmeldung** mit Prüfung der Adresse.
- **Glitch-Effekt** im Titel.
- **Easter Egg**: Konami-Code `↑ ↑ ↓ ↓ ← → ← → B A` schaltet den Regenbogen-Modus ein.
- Funktioniert auf dem Handy und respektiert „Bewegung reduzieren“ in den Systemeinstellungen.

## Anpassen

Oben im `<script>` in `index.html`:

```js
const CONFIG = {
  launchDate: '2026-12-01T00:00:00+01:00', // Starttermin
  timeZone: 'Europe/Berlin',               // Zeitzone für die Datumsanzeige
  formEndpoint: '',                        // URL für E-Mail-Anmeldungen
};
```

Texte (Titel, Beschreibung usw.) änderst du direkt im HTML. Die Farben stehen als CSS-Variablen in `:root`.

### E-Mail-Anmeldungen wirklich speichern

Solange `formEndpoint` leer ist, läuft das Formular im **Demo-Modus**. Es zeigt nur die Danke-Meldung, die Adresse wird nirgends gespeichert.

Damit die Adressen wirklich ankommen, trägst du einen Dienst ein, der JSON per POST annimmt, z. B. [Formspree](https://formspree.io):

```js
formEndpoint: 'https://formspree.io/f/DEINE-ID',
```

## Ansehen

- **Lokal:** `index.html` einfach im Browser öffnen.
- **Online mit GitHub Pages:** Im Repository unter *Settings → Pages* als Quelle den Branch und den Ordner `/ (root)` auswählen. Nach kurzer Zeit ist die Seite unter `https://<benutzername>.github.io/<repo>/` erreichbar.
