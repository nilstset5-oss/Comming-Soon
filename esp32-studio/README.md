# ESP32 Studio

Eine PC-App, mit der du einen ESP32 per USB-Kabel steuerst: neu starten, Infos anzeigen, WLAN verbinden, einen eigenen Hotspot aufmachen, Pins schalten, Spannungen messen, Sensoren finden, Firmware flashen und vieles mehr.

Dazu gehören zwei Teile:

| Teil | Wo | Was |
|---|---|---|
| **App** | `app/` | Das Programm für Windows, macOS und Linux (Python) |
| **Firmware** | `firmware/ESP32Studio/` | Kommt einmalig auf den ESP32, damit er die Befehle der App versteht |

Ohne Hardware kannst du alles mit dem eingebauten **Demo-Gerät** ausprobieren.

---

## Schnellstart

### Windows – fertige EXE (am einfachsten)

1. Auf GitHub im Repository **Actions** öffnen und den neuesten Lauf von **ESP32 Studio** anklicken.
2. Unten bei *Artifacts* **ESP32Studio-Windows** herunterladen und entpacken.
3. `ESP32Studio.exe` starten. Die fertigen Firmware-Dateien liegen schon im Ordner `firmware/bin` daneben.

Windows zeigt beim ersten Start vielleicht „Der Computer wurde durch Windows geschützt“. Dann auf *Weitere Informationen → Trotzdem ausführen* klicken. Die EXE ist nicht signiert.

### Windows – mit Python

1. [Python](https://www.python.org/downloads/) installieren und dabei den Haken **„Add python.exe to PATH“** setzen.
2. Doppelklick auf **`start-windows.bat`**. Beim ersten Mal werden die nötigen Pakete installiert.

### macOS / Linux

```bash
./start-mac-linux.sh
```

Oder von Hand: `pip install -r app/requirements.txt` und danach `python3 app/esp32_studio.py`.
Unter Linux brauchst du eventuell `sudo apt install python3-tk`, und für den USB-Zugriff `sudo usermod -aG dialout $USER` (danach einmal ab- und wieder anmelden).

---

## Firmware auf den ESP32 bringen

Das musst du nur einmal machen. Danach erkennt die App den ESP32 automatisch.

**Weg 1 – in der App (empfohlen):**
ESP32 einstecken, oben den Port wählen, links auf **Firmware & Flashen** gehen. Dort auf **Chip erkennen** und dann auf **Firmware installieren** klicken. Die passende Datei wird automatisch gewählt.

Die Dateien `esp32studio-*.bin` baut GitHub automatisch (*Actions → ESP32 Studio → Artifacts → esp32studio-firmware*). In der Windows-EXE sind sie schon dabei. Wer die App mit Python startet, legt sie in den Ordner `firmware/bin`.

| Datei | Für |
|---|---|
| `esp32studio-esp32.bin` | ESP32 (klassisch, z. B. DevKit V1, NodeMCU-32S, WROOM) |
| `esp32studio-esp32s3.bin` | ESP32-S3 über den USB-UART-Chip (Port „COM“/„UART“) |
| `esp32studio-esp32s3-usb.bin` | ESP32-S3 über den nativen USB-Port |
| `esp32studio-esp32c3.bin` | ESP32-C3 mit USB-UART-Chip |
| `esp32studio-esp32c3-usb.bin` | ESP32-C3 mit nativem USB (z. B. C3 SuperMini) |
| `esp32studio-esp32s2-usb.bin` | ESP32-S2 (z. B. S2 Mini) |
| `esp32studio-esp32c6-usb.bin` | ESP32-C6 |

**Weg 2 – Arduino IDE:**
1. In der Arduino IDE im Boardverwalter **esp32 von Espressif** installieren (Version 2.x oder 3.x).
2. `firmware/ESP32Studio/ESP32Studio.ino` öffnen.
3. Board und Port wählen. Bei ESP32-S3/C3/C6 mit nativem USB: *Werkzeuge → USB CDC On Boot → Enabled*.
4. Hochladen. Weitere Bibliotheken braucht es nicht.

Klappt das Flashen nicht, hilft fast immer: **BOOT**-Taste gedrückt halten, kurz **EN/RST** drücken, BOOT loslassen und es noch einmal versuchen.

---

## Was die App kann

**Verbindung**
- Findet ESP32-Boards automatisch (CP210x, CH340, CH9102, FTDI, nativer USB) und verbindet sich beim Einstecken
- Ist kein ESP32 zu sehen, öffnet sich eine Hilfe mit Treiber-Links. Unter Windows erkennt die App sogar, wenn ein USB-Chip ohne Treiber steckt
- Antwortet der ESP32 nicht, versucht die App es mehrmals, stellt bei Zeichensalat auf 115200 Baud um und startet den ESP32 notfalls einmal neu
- Klappt es trotzdem nicht, sagt sie, woran es liegt: falscher Port, anderes Programm, falsche Baudrate, Bootloader-Modus oder Port belegt. Die passende Lösung gibt es als Knopf, z. B. **Studio-Firmware installieren** mit einem Klick
- Port belegt (z. B. von der Arduino IDE)? Die App wartet und verbindet sich, sobald er frei ist
- Verbindet sich nach einem Neustart oder Wackelkontakt von selbst wieder, auch wenn der ESP32 danach einen anderen COM-Port bekommt
- Nativer USB (ESP32-S2/S3/C3/C6) wird mit den richtigen Steuerleitungen geöffnet. Boards mit USB-UART-Chip starten beim Verbinden nicht ungewollt neu

**Übersicht**
- Name, Chip, Kerne, Takt, MAC, Flash, PSRAM, ESP-IDF- und Arduino-Version, Grund des letzten Neustarts
- Live-Werte: freier Speicher, Laufzeit, Chip-Temperatur, WLAN-Signal, Hotspot-Geräte
- Live-Diagramme für Speicher, Signal und Temperatur
- **Neustart**, **Hard-Reset** (wie die EN-Taste), **Bootloader-Modus**, **Deep-Sleep**, LED an/aus/blinken, umbenennen

**WLAN**
- Netzwerke suchen mit Signalstärke, Kanal und Verschlüsselung, sortierbar
- Mit einem Netz verbinden, Zugang auf dem ESP32 speichern (verbindet sich dann bei jedem Start)
- Status mit IP, Router, DNS, BSSID und Hostname, Hostname ändern
- **Kanalbelegung** als Diagramm, mit Hinweis auf den freiesten Kanal
- **Internet-Test** (DNS, Verbindung, HTTP)
- **Web-Oberfläche** direkt vom ESP32 (auch unter `name.local`), mit LED-Knopf, Neustart und Pin-Steuerung

**Hotspot**
- Eigenes WLAN mit Name, Passwort (oder offen), Kanal, versteckt, Anzahl Geräte und Autostart
- Zufallspasswort, „freiesten Kanal wählen“
- **QR-Code** zum Verbinden mit dem Handy
- Liste der verbundenen Geräte mit Signalstärke, Meldung, sobald sich jemand verbindet

**GPIO & Pins**
- Pin-Modus (Ausgang, Eingang, Pull-up, Pull-down, Open-Drain), HIGH/LOW, umschalten, lesen
- **Pins beobachten**: mehrere Eingänge live (z. B. Taster)
- **PWM** mit Schieberegler und „Atmen“-Effekt
- **ADC**: Spannung messen mit Live-Diagramm
- **DAC** (ESP32/S2): echte Spannung ausgeben
- Schutz vor Pins, die den ESP32 lahmlegen würden (Flash, USB, Seriell), mit Hinweisen zum jeweiligen Chip

**Werkzeuge**
- **I2C-Scanner** mit Erkennung bekannter Sensoren und Displays (OLED, BME280, MPU6050 …)
- **Dauerhafter Speicher (NVS)**: Werte speichern, lesen, löschen
- **Touch-Sensor** live
- **Verbindungstest**: 20 Pings mit Antwortzeiten
- Liste aller Firmware-Befehle

**Serieller Monitor**
- Farbige Ausgabe, Zeitstempel, Suche, Pause, als Datei speichern
- Befehle senden mit Verlauf (Pfeiltasten), wählbares Zeilenende, beliebige Baudrate
- **Schnellbefehle**: eigene Knöpfe für häufige Befehle (Rechtsklick zum Ändern)
- Funktioniert auch mit jeder anderen Firmware, nicht nur mit der Studio-Firmware

**Firmware & Flashen** (über esptool)
- Studio-Firmware mit einem Klick installieren, Chip automatisch erkennen
- Eigene `.bin`-Dateien flashen (z. B. aus der Arduino IDE, WLED, Tasmota)
- Flash komplett löschen, Flash-Backup als Datei, Chip-Infos auslesen

**Einstellungen**
- Dunkles und helles Design, Abfrage-Intervall, Auto-Verbinden, Benachrichtigungen
- Auf dem Gerät: Name, LED-Pin, CPU-Takt (80/160/240 MHz), Werkseinstellungen

**Tastenkürzel:** `Strg+1` … `Strg+8` Bereiche · `F5` aktualisieren · `Strg+R` Neustart · `Strg+L` Monitor leeren · `Strg+K` verbinden/trennen

---

## Befehle der Firmware

Diese Befehle kannst du auch im Seriellen Monitor (oder in jedem anderen Terminal mit 115200 Baud) eintippen. `help` zeigt alle.

| Befehl | Beispiel |
|---|---|
| `info`, `stats`, `ping` | |
| `restart`, `sleep <s>`, `cpu <MHz>` | `sleep 30` |
| `name <text>`, `led on\|off\|toggle\|blink [n]`, `led.pin <pin>` | `led blink 5` |
| `wifi.scan`, `wifi.status`, `wifi.disconnect`, `wifi.forget` | |
| `wifi.connect <ssid> [passwort] [merken 1/0]` | `wifi.connect "Mein WLAN" geheim123` |
| `wifi.hostname <name>`, `net.test [host]` | |
| `ap.start <ssid> [passwort] [kanal] [versteckt] [max] [autostart]`, `ap.stop`, `ap.clients` | `ap.start ESP-Hotspot 12345678 6` |
| `web.start [autostart]`, `web.stop` | |
| `gpio.mode <pin> out\|in\|pullup\|pulldown\|od`, `gpio.write <pin> 0\|1`, `gpio.toggle <pin>`, `gpio.read <pin> …` | `gpio.write 2 1` |
| `pwm <pin> <0-255> [Hz]`, `pwm.stop <pin>`, `adc <pin>`, `dac <pin> <0-255>`, `touch <pin>` | `pwm 2 64` |
| `i2c.scan [sda] [scl]` | `i2c.scan 21 22` |
| `nvs.set <key> <wert>`, `nvs.get`, `nvs.del`, `nvs.list`, `nvs.clear` | `nvs.set ort Keller` |
| `factory` | setzt alles zurück |

Texte mit Leerzeichen kommen in Anführungszeichen.

### Eigene Befehle ergänzen

In `ESP32Studio.ino` eine Funktion schreiben und in die Liste `COMMANDS` eintragen:

```cpp
void cmdHallo(Ctx& c) {
  Json j;
  j.add("ok", true).add("text", "Hallo " + c.arg(1));
  reply(c.id, j);
}
// ...
{"hallo", cmdHallo, "hallo <name>"},
```

Über das Protokoll schickt die App `#<id> <befehl> <argumente>`. Der ESP32 antwortet mit `@R <id> {json}` und meldet Ereignisse mit `@E {json}`. Alle anderen Ausgaben (`Serial.println(...)`) erscheinen ganz normal im Monitor.

---

## Probleme?

| Problem | Lösung |
|---|---|
| Kein Port in der Liste | USB-Kabel mit Datenleitung nehmen (viele Ladekabel können nur Strom). Treiber installieren: [CP210x](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers) oder [CH340](https://www.wch-ic.com/downloads/CH341SER_EXE.html). |
| „Port wird schon benutzt“ | Arduino IDE (Serieller Monitor) oder andere Programme schließen. |
| „Keine Studio-Firmware gefunden“ / „anderes Programm“ | Im gelben Hinweis auf **Studio-Firmware installieren** klicken. Der Monitor funktioniert trotzdem. |
| „Von COMx kommt gar nichts“ | Falscher Port (z. B. COM1) – im gelben Hinweis **Anderen Port probieren** klicken – oder einmal EN/RST am Board drücken. |
| „Warte auf COMx … (belegt)“ | Ein anderes Programm hat den Port offen (Arduino IDE, PuTTY …). Schließen, dann verbindet die App von selbst. |
| Flashen schlägt fehl | BOOT gedrückt halten, kurz EN/RST drücken, BOOT loslassen, nochmal. Tempo auf 115200 stellen. |
| ESP32-S3/C3 zeigt nichts an | Die `-usb`-Firmware nehmen bzw. „USB CDC On Boot: Enabled“. |
| Kein QR-Code | `pip install segno` |

**Sicherheit:** Die Web-Oberfläche des ESP32 hat kein Passwort. Schalte sie nur in deinem eigenen Netz ein. Ein Hotspot ohne Passwort ist für jeden in der Nähe offen.

---

## Aufbau

```
esp32-studio/
├── app/
│   ├── esp32_studio.py      Die App (Oberfläche)
│   ├── esplink.py           USB-Verbindung, Protokoll und Demo-Gerät
│   └── requirements.txt     pyserial, esptool, segno
├── firmware/
│   ├── ESP32Studio/         Arduino-Sketch für den ESP32
│   └── bin/                 Platz für die fertigen .bin-Dateien
├── start-windows.bat
└── start-mac-linux.sh
```

Der GitHub-Workflow `.github/workflows/esp32-studio.yml` kompiliert die Firmware für alle Chips, prüft sie zusätzlich mit dem älteren Boardpaket 2.x und baut die Windows-EXE.
