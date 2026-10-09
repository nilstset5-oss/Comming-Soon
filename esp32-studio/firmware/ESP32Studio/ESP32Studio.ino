/*
  ESP32 Studio – Firmware
  -----------------------
  Gegenstück zur PC-App "ESP32 Studio". Die App schickt Befehle über USB
  (Serial, 115200 Baud), der ESP32 antwortet mit JSON.

  Läuft mit dem ESP32-Boardpaket 2.x und 3.x (Arduino IDE oder arduino-cli),
  getestet für ESP32, ESP32-S2, ESP32-S3, ESP32-C3 und ESP32-C6.
  Es werden keine zusätzlichen Bibliotheken gebraucht.

  Protokoll
    PC  -> ESP:  [#<id> ]<befehl> [argumente]     z. B.  #7 ap.start "Mein WLAN" geheim123 6
    ESP -> PC:   @R <id> {json}                   Antwort auf einen Befehl (id 0 = von Hand getippt)
                 @E {json}                        Ereignis (Start, WLAN verbunden, Gerät im Hotspot ...)
    Alles andere sind normale Log-Zeilen.

  Tipp: Im Seriellen Monitor einfach "help" eintippen.
*/

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <Wire.h>
#include <esp_wifi.h>
#include <esp_system.h>
#include <esp_sleep.h>
#include <esp_idf_version.h>
#include <soc/soc_caps.h>
#include <nvs.h>
#if ESP_IDF_VERSION_MAJOR >= 5
#include <esp_mac.h>
#endif

#include "web_page.h"

#define FW_NAME "ESP32 Studio"
#define FW_VERSION "1.0.0"
#define SERIAL_BAUD 115200
#define MAX_ARGS 12
#define MAX_LINE 600

#ifdef LED_BUILTIN
static const int DEFAULT_LED_PIN = LED_BUILTIN;
#else
static const int DEFAULT_LED_PIN = 2;
#endif

// ---------------------------------------------------------------------------
// Kleiner JSON-Schreiber (ohne externe Bibliothek)
// ---------------------------------------------------------------------------
class Json {
 public:
  Json() {
    s.reserve(384);
    s = "{";
    first[0] = true;
  }
  Json& add(const char* k, const char* v) {
    key(k);
    if (v) str(v);
    else s += "null";
    return *this;
  }
  Json& add(const char* k, const String& v) { return add(k, v.c_str()); }
  Json& add(const char* k, bool v) {
    key(k);
    s += v ? "true" : "false";
    return *this;
  }
  Json& add(const char* k, int v) { return num(k, (long long)v); }
  Json& add(const char* k, unsigned int v) { return num(k, (long long)v); }
  Json& add(const char* k, long v) { return num(k, (long long)v); }
  Json& add(const char* k, unsigned long v) { return num(k, (long long)v); }
  Json& add(const char* k, long long v) { return num(k, v); }
  Json& add(const char* k, unsigned long long v) { return num(k, (long long)v); }
  Json& add(const char* k, double v) {
    key(k);
    if (isnan(v) || isinf(v)) s += "null";
    else s += String(v, 1);
    return *this;
  }
  Json& obj(const char* k = nullptr) {
    key(k);
    s += '{';
    push();
    return *this;
  }
  Json& arr(const char* k = nullptr) {
    key(k);
    s += '[';
    push();
    return *this;
  }
  Json& endObj() {
    s += '}';
    pop();
    return *this;
  }
  Json& endArr() {
    s += ']';
    pop();
    return *this;
  }
  const String& done() {
    if (!closed) {
      s += '}';
      closed = true;
    }
    return s;
  }

 private:
  String s;
  bool first[10];
  int d = 0;
  bool closed = false;
  void push() {
    if (d < 9) first[++d] = true;
  }
  void pop() {
    if (d > 0) d--;
  }
  void key(const char* k) {
    if (!first[d]) s += ',';
    first[d] = false;
    if (k) {
      str(k);
      s += ':';
    }
  }
  Json& num(const char* k, long long v) {
    key(k);
    char b[24];
    snprintf(b, sizeof(b), "%lld", v);
    s += b;
    return *this;
  }
  void str(const char* v) {
    s += '"';
    for (const char* p = v; *p; ++p) {
      char c = *p;
      switch (c) {
        case '"': s += "\\\""; break;
        case '\\': s += "\\\\"; break;
        case '\n': s += "\\n"; break;
        case '\r': s += "\\r"; break;
        case '\t': s += "\\t"; break;
        default:
          if ((uint8_t)c < 0x20) {
            char b[8];
            snprintf(b, sizeof(b), "\\u%04x", (unsigned)c);
            s += b;
          } else {
            s += c;
          }
      }
    }
    s += '"';
  }
};

// ---------------------------------------------------------------------------
// Zustand & Einstellungen
// ---------------------------------------------------------------------------
struct Settings {
  String name;
  String hostname;
  String staSsid, staPass;
  String apSsid, apPass;
  int apChannel = 6;
  bool apHidden = false;
  int apMax = 4;
  bool apAuto = false;
  bool webAuto = false;
  int ledPin = DEFAULT_LED_PIN;
} cfg;

Preferences prefs;
WebServer server(80);
bool webOn = false;
bool mdnsOn = false;
bool apOn = false;
bool staWasConnected = false;
volatile int lastDiscReason = 0;

// Ereignisse aus dem WLAN-Task werden gesammelt und in loop() ausgegeben,
// damit sich keine Zeilen auf der seriellen Schnittstelle vermischen.
struct EvMsg {
  uint8_t type;
  uint8_t mac[6];
  uint32_t ip;
  int reason;
};
enum { EV_STA_IP = 1, EV_STA_LOST, EV_AP_JOIN, EV_AP_LEAVE, EV_AP_IP };
QueueHandle_t evQueue = nullptr;

// LED
bool ledState = false;
int blinkLeft = 0;
uint32_t blinkNext = 0;

// GPIO-Buchhaltung
#define PIN_SLOTS 64
int8_t pinModeOf[PIN_SLOTS];  // -1 = unbekannt, sonst Arduino-Modus
int pwmPins[6] = {-1, -1, -1, -1, -1, -1};
uint32_t pwmFreq[6];

String lineBuf;

// Ein empfangener Befehl
struct Ctx {
  uint32_t id;
  int argc;
  String* argv;  // argv[0] = Befehl
  const String& arg(int i) const {
    static String empty;
    return i < argc ? argv[i] : empty;
  }
  bool has(int i) const { return i < argc && argv[i].length() > 0; }
  long num(int i, long def) const { return has(i) ? argv[i].toInt() : def; }
  bool flag(int i, bool def) const {
    if (!has(i)) return def;
    String v = argv[i];
    v.toLowerCase();
    return v == "1" || v == "true" || v == "on" || v == "yes" || v == "ja";
  }
};

typedef void (*CmdFn)(Ctx&);
struct Command {
  const char* name;
  CmdFn fn;
  const char* help;
};

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------
String macToStr(const uint8_t* m) {
  char b[18];
  snprintf(b, sizeof(b), "%02X:%02X:%02X:%02X:%02X:%02X", m[0], m[1], m[2], m[3], m[4], m[5]);
  return String(b);
}

String baseMac() {
  uint8_t m[6] = {0};
  esp_read_mac(m, ESP_MAC_WIFI_STA);
  return macToStr(m);
}

String macSuffix() {
  uint8_t m[6] = {0};
  esp_read_mac(m, ESP_MAC_WIFI_STA);
  char b[5];
  snprintf(b, sizeof(b), "%02X%02X", m[4], m[5]);
  return String(b);
}

const char* resetReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "Einschalten";
    case ESP_RST_EXT: return "Reset-Pin";
    case ESP_RST_SW: return "Software-Neustart";
    case ESP_RST_PANIC: return "Absturz (Panic)";
    case ESP_RST_INT_WDT: return "Watchdog (Interrupt)";
    case ESP_RST_TASK_WDT: return "Watchdog (Task)";
    case ESP_RST_WDT: return "Watchdog";
    case ESP_RST_DEEPSLEEP: return "Aufwachen aus Deep-Sleep";
    case ESP_RST_BROWNOUT: return "Unterspannung (Brownout)";
    case ESP_RST_SDIO: return "SDIO";
    default: return "Unbekannt";
  }
}

const char* authName(int a) {
  // Reihenfolge von wifi_auth_mode_t ist in IDF 4.4 und 5.x gleich
  switch (a) {
    case 0: return "offen";
    case 1: return "WEP";
    case 2: return "WPA";
    case 3: return "WPA2";
    case 4: return "WPA/WPA2";
    case 5: return "WPA2-Enterprise";
    case 6: return "WPA3";
    case 7: return "WPA2/WPA3";
    case 8: return "WAPI";
    case 9: return "OWE";
    default: return "andere";
  }
}

const char* staStatusName(wl_status_t st) {
  switch (st) {
    case WL_CONNECTED: return "connected";
    case WL_NO_SSID_AVAIL: return "no_ssid";
    case WL_CONNECT_FAILED: return "failed";
    case WL_CONNECTION_LOST: return "lost";
    case WL_DISCONNECTED: return "disconnected";
    case WL_IDLE_STATUS: return "idle";
    case WL_SCAN_COMPLETED: return "idle";
    default: return "off";
  }
}

const char* discReasonText(int r) {
  switch (r) {
    case 0: return "";
    case 2:
    case 15:
    case 23:
    case 202:
    case 204: return "Passwort falsch?";
    case 201:
    case 210:
    case 211: return "Netzwerk nicht gefunden";
    case 8: return "Getrennt";
    case 200: return "Signal verloren";
    case 203: return "Verbindung abgelehnt";
    default: return "Verbindung fehlgeschlagen";
  }
}

bool staEnabled() { return (WiFi.getMode() & WIFI_STA) != 0; }

void ensureMode(bool sta, bool ap) {
  int m = WiFi.getMode();
  int want = m;
  if (sta) want |= WIFI_STA;
  if (ap) want |= WIFI_AP;
  if (want != m) {
    if (cfg.hostname.length()) WiFi.setHostname(cfg.hostname.c_str());
    WiFi.mode((wifi_mode_t)want);
    delay(50);
  }
}

bool pinExists(int pin) { return pin >= 0 && pin < SOC_GPIO_PIN_COUNT && digitalPinIsValid(pin); }

// Pins, die man besser nicht anfasst (Flash, USB, serielle Konsole)
bool isProtectedPin(int pin) {
#if CONFIG_IDF_TARGET_ESP32
  if (pin >= 6 && pin <= 11) return true;  // SPI-Flash
  if (pin == 1 || pin == 3) return true;   // UART0 (USB-Seriell)
#elif CONFIG_IDF_TARGET_ESP32S2
  if (pin >= 26 && pin <= 32) return true;
  if (pin == 19 || pin == 20) return true;  // USB
  if (pin == 43 || pin == 44) return true;
#elif CONFIG_IDF_TARGET_ESP32S3
  if (pin >= 26 && pin <= 32) return true;
  if (pin == 19 || pin == 20) return true;  // USB
  if (pin == 43 || pin == 44) return true;  // UART0
#elif CONFIG_IDF_TARGET_ESP32C3
  if (pin >= 12 && pin <= 17) return true;
  if (pin == 18 || pin == 19) return true;  // USB
  if (pin == 20 || pin == 21) return true;  // UART0
#elif CONFIG_IDF_TARGET_ESP32C6
  if (pin >= 24 && pin <= 30) return true;
  if (pin == 12 || pin == 13) return true;  // USB
  if (pin == 16 || pin == 17) return true;  // UART0
#endif
  return false;
}

// ---------------------------------------------------------------------------
// Ausgabe
// ---------------------------------------------------------------------------
void reply(uint32_t id, Json& j) {
  Serial.print("@R ");
  Serial.print(id);
  Serial.print(' ');
  Serial.println(j.done());
}

void replyOk(uint32_t id) {
  Json j;
  j.add("ok", true);
  reply(id, j);
}

void replyErr(uint32_t id, const String& msg) {
  Json j;
  j.add("ok", false).add("error", msg);
  reply(id, j);
}

void emit(Json& j) {
  Serial.print("@E ");
  Serial.println(j.done());
}

// ---------------------------------------------------------------------------
// Einstellungen laden / speichern
// ---------------------------------------------------------------------------
void loadSettings() {
  prefs.begin("studio", true);
  cfg.name = prefs.getString("name", "ESP32-" + macSuffix());
  cfg.hostname = prefs.getString("host", "esp32-studio-" + macSuffix());
  cfg.hostname.toLowerCase();
  cfg.staSsid = prefs.getString("sta_ssid", "");
  cfg.staPass = prefs.getString("sta_pass", "");
  cfg.apSsid = prefs.getString("ap_ssid", "ESP32-Studio-" + macSuffix());
  cfg.apPass = prefs.getString("ap_pass", "");
  cfg.apChannel = prefs.getInt("ap_ch", 6);
  cfg.apHidden = prefs.getBool("ap_hidden", false);
  cfg.apMax = prefs.getInt("ap_max", 4);
  cfg.apAuto = prefs.getBool("ap_auto", false);
  cfg.webAuto = prefs.getBool("web_auto", false);
  cfg.ledPin = prefs.getInt("led_pin", DEFAULT_LED_PIN);
  prefs.end();
}

void saveSettings() {
  prefs.begin("studio", false);
  prefs.putString("name", cfg.name);
  prefs.putString("host", cfg.hostname);
  prefs.putString("sta_ssid", cfg.staSsid);
  prefs.putString("sta_pass", cfg.staPass);
  prefs.putString("ap_ssid", cfg.apSsid);
  prefs.putString("ap_pass", cfg.apPass);
  prefs.putInt("ap_ch", cfg.apChannel);
  prefs.putBool("ap_hidden", cfg.apHidden);
  prefs.putInt("ap_max", cfg.apMax);
  prefs.putBool("ap_auto", cfg.apAuto);
  prefs.putBool("web_auto", cfg.webAuto);
  prefs.putInt("led_pin", cfg.ledPin);
  prefs.end();
}

// ---------------------------------------------------------------------------
// JSON-Bausteine
// ---------------------------------------------------------------------------
void addWifi(Json& j) {
  j.obj("wifi");
  bool on = staEnabled();
  wl_status_t st = on ? WiFi.status() : WL_NO_SHIELD;
  j.add("enabled", on);
  j.add("status", staStatusName(st));
  j.add("saved_ssid", cfg.staSsid);
  j.add("hostname", cfg.hostname);
  j.add("mac", WiFi.macAddress());
  if (st == WL_CONNECTED) {
    j.add("ssid", WiFi.SSID());
    j.add("bssid", WiFi.BSSIDstr());
    j.add("ip", WiFi.localIP().toString());
    j.add("gateway", WiFi.gatewayIP().toString());
    j.add("subnet", WiFi.subnetMask().toString());
    j.add("dns", WiFi.dnsIP().toString());
    j.add("rssi", (int)WiFi.RSSI());
    j.add("channel", (int)WiFi.channel());
  }
  if (lastDiscReason) {
    j.add("reason", (int)lastDiscReason);
    j.add("reason_text", discReasonText(lastDiscReason));
  }
  j.endObj();
}

void addAp(Json& j) {
  j.obj("ap");
  j.add("on", apOn);
  j.add("ssid", apOn ? WiFi.softAPSSID() : cfg.apSsid);
  j.add("password", cfg.apPass);
  j.add("channel", apOn ? (int)WiFi.channel() : cfg.apChannel);
  j.add("hidden", cfg.apHidden);
  j.add("max", cfg.apMax);
  j.add("auto", cfg.apAuto);
  if (apOn) {
    j.add("ip", WiFi.softAPIP().toString());
    j.add("mac", WiFi.softAPmacAddress());
    j.add("clients", (int)WiFi.softAPgetStationNum());
  } else {
    j.add("clients", 0);
  }
  j.endObj();
}

String webUrl() {
  if (WiFi.status() == WL_CONNECTED) return "http://" + WiFi.localIP().toString() + "/";
  if (apOn) return "http://" + WiFi.softAPIP().toString() + "/";
  return "";
}

void addWeb(Json& j) {
  j.obj("web");
  j.add("on", webOn);
  j.add("auto", cfg.webAuto);
  j.add("url", webOn ? webUrl() : String(""));
  j.add("mdns", (webOn && mdnsOn) ? ("http://" + cfg.hostname + ".local/") : String(""));
  j.endObj();
}

void addStats(Json& j) {
  j.add("uptime", (unsigned long)(millis() / 1000));
  j.add("heap_free", (unsigned long)ESP.getFreeHeap());
  j.add("heap_min", (unsigned long)ESP.getMinFreeHeap());
  j.add("heap_size", (unsigned long)ESP.getHeapSize());
  j.add("temp", (double)temperatureRead());
  j.add("cpu_mhz", (int)getCpuFrequencyMhz());
  bool conn = staEnabled() && WiFi.status() == WL_CONNECTED;
  j.add("sta", staEnabled() ? staStatusName(WiFi.status()) : "off");
  j.add("rssi", conn ? (int)WiFi.RSSI() : 0);
  j.add("ip", conn ? WiFi.localIP().toString() : String(""));
  j.add("ap_on", apOn);
  j.add("ap_clients", apOn ? (int)WiFi.softAPgetStationNum() : 0);
  j.add("led", ledState);
  j.add("web", webOn);
}

// ---------------------------------------------------------------------------
// LED
// ---------------------------------------------------------------------------
void ledWrite(bool on) {
  ledState = on;
  if (cfg.ledPin < 0) return;
  if (cfg.ledPin < PIN_SLOTS && pinModeOf[cfg.ledPin] != OUTPUT) {
    pinMode(cfg.ledPin, OUTPUT);
    pinModeOf[cfg.ledPin] = OUTPUT;
  }
  digitalWrite(cfg.ledPin, on ? HIGH : LOW);
}

void ledTask() {
  if (blinkLeft > 0 && (int32_t)(millis() - blinkNext) >= 0) {
    ledWrite(!ledState);
    blinkLeft--;
    blinkNext = millis() + 180;
  }
}

// ---------------------------------------------------------------------------
// Hotspot & WLAN
// ---------------------------------------------------------------------------
bool startAp(String& err) {
  if (cfg.apPass.length() > 0 && cfg.apPass.length() < 8) {
    err = "Passwort muss mindestens 8 Zeichen haben (oder leer = offen)";
    return false;
  }
  ensureMode(false, true);
  bool ok = WiFi.softAP(cfg.apSsid.c_str(), cfg.apPass.length() ? cfg.apPass.c_str() : nullptr,
                        cfg.apChannel, cfg.apHidden ? 1 : 0, cfg.apMax);
  if (!ok) {
    err = "Hotspot konnte nicht gestartet werden";
    return false;
  }
  delay(100);
  apOn = true;
  return true;
}

void stopAp() {
  WiFi.softAPdisconnect(true);
  apOn = false;
}

void onWiFiEvent(arduino_event_id_t event, arduino_event_info_t info) {
  if (!evQueue) return;
  EvMsg m;
  memset(&m, 0, sizeof(m));
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      m.type = EV_STA_IP;
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      m.type = EV_STA_LOST;
      m.reason = info.wifi_sta_disconnected.reason;
      lastDiscReason = m.reason;
      break;
    case ARDUINO_EVENT_WIFI_AP_STACONNECTED:
      m.type = EV_AP_JOIN;
      memcpy(m.mac, info.wifi_ap_staconnected.mac, 6);
      break;
    case ARDUINO_EVENT_WIFI_AP_STADISCONNECTED:
      m.type = EV_AP_LEAVE;
      memcpy(m.mac, info.wifi_ap_stadisconnected.mac, 6);
      break;
    case ARDUINO_EVENT_WIFI_AP_STAIPASSIGNED:
      m.type = EV_AP_IP;
      m.ip = info.wifi_ap_staipassigned.ip.addr;
      break;
    default:
      return;
  }
  xQueueSend(evQueue, &m, 0);
}

void pumpEvents() {
  EvMsg m;
  while (evQueue && xQueueReceive(evQueue, &m, 0) == pdTRUE) {
    Json j;
    switch (m.type) {
      case EV_STA_IP:
        staWasConnected = true;
        lastDiscReason = 0;
        j.add("type", "wifi").add("event", "connected").add("ssid", WiFi.SSID());
        j.add("ip", WiFi.localIP().toString()).add("rssi", (int)WiFi.RSSI());
        emit(j);
        break;
      case EV_STA_LOST:
        if (!staWasConnected) continue;  // keine Flut beim Wiederverbinden
        staWasConnected = false;
        j.add("type", "wifi").add("event", "disconnected").add("reason", m.reason);
        j.add("reason_text", discReasonText(m.reason));
        emit(j);
        break;
      case EV_AP_JOIN:
        j.add("type", "ap").add("event", "join").add("mac", macToStr(m.mac));
        emit(j);
        break;
      case EV_AP_LEAVE:
        j.add("type", "ap").add("event", "leave").add("mac", macToStr(m.mac));
        emit(j);
        break;
      case EV_AP_IP:
        j.add("type", "ap").add("event", "ip").add("ip", IPAddress(m.ip).toString());
        emit(j);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Web-Oberfläche auf dem ESP32
// ---------------------------------------------------------------------------
void sendJson(Json& j) { server.send(200, "application/json", j.done()); }

void webStats() {
  Json j;
  j.add("ok", true).add("name", cfg.name);
  addStats(j);
  sendJson(j);
}

void setupWebRoutes() {
  server.on("/", []() { server.send_P(200, "text/html", WEB_PAGE); });
  server.on("/api/stats", webStats);
  server.on("/api/info", webStats);
  server.on("/api/led", []() {
    String s = server.arg("s");
    if (s == "on") ledWrite(true);
    else if (s == "off") ledWrite(false);
    else if (s == "blink") {
      blinkLeft = 6;
      blinkNext = millis();
    } else ledWrite(!ledState);
    webStats();
  });
  server.on("/api/gpio", []() {
    int pin = server.arg("pin").toInt();
    if (!pinExists(pin) || !digitalPinCanOutput(pin) || isProtectedPin(pin)) {
      server.send(400, "application/json", "{\"ok\":false,\"error\":\"Pin nicht erlaubt\"}");
      return;
    }
    pinMode(pin, OUTPUT);
    if (pin < PIN_SLOTS) pinModeOf[pin] = OUTPUT;
    digitalWrite(pin, server.arg("v").toInt() ? HIGH : LOW);
    webStats();
  });
  server.on("/api/restart", []() {
    server.send(200, "application/json", "{\"ok\":true}");
    delay(300);
    ESP.restart();
  });
  server.onNotFound([]() { server.send(404, "text/plain", "Nicht gefunden"); });
}

void startWeb() {
  if (!webOn) {
    server.begin();
    webOn = true;
  }
  if (!mdnsOn && MDNS.begin(cfg.hostname.c_str())) {
    MDNS.addService("http", "tcp", 80);
    mdnsOn = true;
  }
}

void stopWeb() {
  if (webOn) server.stop();
  if (mdnsOn) MDNS.end();
  webOn = false;
  mdnsOn = false;
}

// ---------------------------------------------------------------------------
// Befehle
// ---------------------------------------------------------------------------
bool checkPin(Ctx& c, int pin, bool output) {
  bool force = false;
  for (int i = 1; i < c.argc; i++)
    if (c.argv[i] == "force") force = true;
  if (!pinExists(pin)) {
    replyErr(c.id, "GPIO " + String(pin) + " gibt es auf diesem Chip nicht");
    return false;
  }
  if (output && !digitalPinCanOutput(pin)) {
    replyErr(c.id, "GPIO " + String(pin) + " kann nur als Eingang benutzt werden");
    return false;
  }
  if (isProtectedPin(pin) && !force) {
    replyErr(c.id, "GPIO " + String(pin) + " ist geschützt (Flash/USB/Seriell). Mit 'force' trotzdem benutzen.");
    return false;
  }
  return true;
}

int pwmSlot(int pin) {
  for (int i = 0; i < 6; i++)
    if (pwmPins[i] == pin) return i;
  return -1;
}

void pwmStop(int pin) {
  int s = pwmSlot(pin);
  if (s < 0) return;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcDetach(pin);
#else
  ledcDetachPin(pin);
#endif
  pwmPins[s] = -1;
  if (pin < PIN_SLOTS) pinModeOf[pin] = -1;
}

void ensureGpio(int pin, int mode) {
  if (pwmSlot(pin) >= 0) pwmStop(pin);
  if (pin >= PIN_SLOTS || pinModeOf[pin] != mode) {
    pinMode(pin, mode);
    if (pin < PIN_SLOTS) pinModeOf[pin] = mode;
  }
}

void cmdHelp(Ctx& c);

void cmdPing(Ctx& c) {
  Json j;
  j.add("ok", true).add("pong", true).add("fw", FW_NAME).add("version", FW_VERSION);
  j.add("name", cfg.name).add("ms", (unsigned long)millis());
  reply(c.id, j);
}

void cmdInfo(Ctx& c) {
  Json j;
  j.add("ok", true).add("fw", FW_NAME).add("version", FW_VERSION).add("name", cfg.name);
  j.obj("chip");
  j.add("model", ESP.getChipModel());
  j.add("rev", (int)ESP.getChipRevision());
  j.add("cores", (int)ESP.getChipCores());
  j.add("mhz", (int)getCpuFrequencyMhz());
  j.add("mac", baseMac());
  j.add("sdk", ESP.getSdkVersion());
  char core[16];
  snprintf(core, sizeof(core), "%d.%d.%d", ESP_ARDUINO_VERSION_MAJOR, ESP_ARDUINO_VERSION_MINOR, ESP_ARDUINO_VERSION_PATCH);
  j.add("core", core);
  j.endObj();
  j.obj("mem");
  j.add("heap_size", (unsigned long)ESP.getHeapSize());
  j.add("heap_free", (unsigned long)ESP.getFreeHeap());
  j.add("heap_min", (unsigned long)ESP.getMinFreeHeap());
  j.add("heap_max_alloc", (unsigned long)ESP.getMaxAllocHeap());
  j.add("psram_size", (unsigned long)ESP.getPsramSize());
  j.add("psram_free", (unsigned long)ESP.getFreePsram());
  j.endObj();
  j.obj("flash");
  j.add("size", (unsigned long)ESP.getFlashChipSize());
  j.add("speed", (unsigned long)ESP.getFlashChipSpeed());
  j.add("sketch", (unsigned long)ESP.getSketchSize());
  j.add("sketch_free", (unsigned long)ESP.getFreeSketchSpace());
  j.endObj();
  j.obj("sys");
  j.add("uptime", (unsigned long)(millis() / 1000));
  j.add("reset", resetReason());
  j.add("temp", (double)temperatureRead());
  j.add("led_pin", cfg.ledPin);
  j.add("led", ledState);
  j.endObj();
  addWifi(j);
  addAp(j);
  addWeb(j);
  reply(c.id, j);
}

void cmdStats(Ctx& c) {
  Json j;
  j.add("ok", true);
  addStats(j);
  reply(c.id, j);
}

void cmdName(Ctx& c) {
  if (c.has(1)) {
    cfg.name = c.arg(1);
    saveSettings();
  }
  Json j;
  j.add("ok", true).add("name", cfg.name);
  reply(c.id, j);
}

void cmdRestart(Ctx& c) {
  replyOk(c.id);
  Serial.println("Neustart ...");
  Serial.flush();
  delay(200);
  ESP.restart();
}

void cmdSleep(Ctx& c) {
  long sec = c.num(1, 10);
  if (sec < 1 || sec > 86400) {
    replyErr(c.id, "Sekunden: 1 bis 86400");
    return;
  }
  Json j;
  j.add("ok", true).add("seconds", sec);
  reply(c.id, j);
  Serial.printf("Deep-Sleep fuer %ld s ...\n", sec);
  Serial.flush();
  delay(200);
  esp_sleep_enable_timer_wakeup((uint64_t)sec * 1000000ULL);
  esp_deep_sleep_start();
}

void cmdCpu(Ctx& c) {
  if (c.has(1)) {
    long mhz = c.num(1, 240);
    if (!setCpuFrequencyMhz((uint32_t)mhz)) {
      replyErr(c.id, "Diese Taktrate wird nicht unterstuetzt");
      return;
    }
  }
  Json j;
  j.add("ok", true).add("mhz", (int)getCpuFrequencyMhz());
  reply(c.id, j);
}

void cmdLed(Ctx& c) {
  String a = c.arg(1);
  a.toLowerCase();
  if (a == "on" || a == "1") ledWrite(true);
  else if (a == "off" || a == "0") ledWrite(false);
  else if (a == "blink") {
    long n = c.num(2, 3);
    if (n < 1) n = 1;
    if (n > 50) n = 50;
    blinkLeft = n * 2;
    blinkNext = millis();
  } else ledWrite(!ledState);
  Json j;
  j.add("ok", true).add("led", ledState).add("pin", cfg.ledPin);
  reply(c.id, j);
}

void cmdLedPin(Ctx& c) {
  if (c.has(1)) {
    int pin = (int)c.num(1, DEFAULT_LED_PIN);
    if (pin >= 0 && !checkPin(c, pin, true)) return;
    if (cfg.ledPin >= 0 && cfg.ledPin < PIN_SLOTS) {
      digitalWrite(cfg.ledPin, LOW);
    }
    cfg.ledPin = pin;
    saveSettings();
  }
  Json j;
  j.add("ok", true).add("pin", cfg.ledPin);
  reply(c.id, j);
}

void cmdWifiScan(Ctx& c) {
  ensureMode(true, false);
  int n = WiFi.scanNetworks(false, true);
  if (n < 0 && WiFi.status() != WL_CONNECTED) {
    WiFi.disconnect();
    delay(100);
    n = WiFi.scanNetworks(false, true);
  }
  if (n < 0) {
    replyErr(c.id, "Suche fehlgeschlagen");
    return;
  }
  Json j;
  j.add("ok", true).add("count", n);
  j.arr("networks");
  for (int i = 0; i < n && i < 40; i++) {
    int enc = (int)WiFi.encryptionType(i);
    j.obj();
    j.add("ssid", WiFi.SSID(i));
    j.add("rssi", (int)WiFi.RSSI(i));
    j.add("channel", (int)WiFi.channel(i));
    j.add("auth", authName(enc));
    j.add("open", enc == 0);
    j.add("bssid", WiFi.BSSIDstr(i));
    j.endObj();
  }
  j.endArr();
  WiFi.scanDelete();
  reply(c.id, j);
}

void cmdWifiConnect(Ctx& c) {
  if (!c.has(1)) {
    replyErr(c.id, "SSID fehlt: wifi.connect <ssid> [passwort] [speichern 1/0]");
    return;
  }
  String ssid = c.arg(1);
  String pass = c.arg(2);
  bool save = c.flag(3, true);
  ensureMode(true, false);
  if (WiFi.status() == WL_CONNECTED) {
    WiFi.disconnect();
    delay(200);
  }
  staWasConnected = false;
  lastDiscReason = 0;
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid.c_str(), pass.length() ? pass.c_str() : nullptr);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(100);
    int r = lastDiscReason;
    if ((r == 201 || r == 15 || r == 202 || r == 204 || r == 210 || r == 211) && millis() - t0 > 6000) break;
  }
  if (WiFi.status() != WL_CONNECTED) {
    int r = lastDiscReason;
    WiFi.disconnect();
    // Gespeichertes Netz im Hintergrund weiter versuchen
    if (cfg.staSsid.length() && cfg.staSsid != ssid) WiFi.begin(cfg.staSsid.c_str(), cfg.staPass.length() ? cfg.staPass.c_str() : nullptr);
    Json j;
    j.add("ok", false).add("error", String("Keine Verbindung zu \"") + ssid + "\": " + (r ? discReasonText(r) : "Zeitueberschreitung"));
    j.add("reason", r);
    reply(c.id, j);
    return;
  }
  if (save) {
    cfg.staSsid = ssid;
    cfg.staPass = pass;
    saveSettings();
  }
  Json j;
  j.add("ok", true).add("saved", save).add("ms", (unsigned long)(millis() - t0));
  addWifi(j);
  reply(c.id, j);
}

void cmdWifiDisconnect(Ctx& c) {
  staWasConnected = false;
  WiFi.disconnect(true);
  delay(100);
  Json j;
  j.add("ok", true);
  addWifi(j);
  reply(c.id, j);
}

void cmdWifiStatus(Ctx& c) {
  Json j;
  j.add("ok", true);
  addWifi(j);
  addAp(j);
  addWeb(j);
  reply(c.id, j);
}

void cmdWifiForget(Ctx& c) {
  cfg.staSsid = "";
  cfg.staPass = "";
  saveSettings();
  replyOk(c.id);
}

void cmdHostname(Ctx& c) {
  if (c.has(1)) {
    String h = c.arg(1);
    h.toLowerCase();
    h.replace(" ", "-");
    cfg.hostname = h;
    saveSettings();
    WiFi.setHostname(cfg.hostname.c_str());
    if (mdnsOn) {
      MDNS.end();
      mdnsOn = MDNS.begin(cfg.hostname.c_str());
      if (mdnsOn) MDNS.addService("http", "tcp", 80);
    }
  }
  Json j;
  j.add("ok", true).add("hostname", cfg.hostname).add("note", "Wirkt beim naechsten Verbinden");
  reply(c.id, j);
}

void cmdNetTest(Ctx& c) {
  if (WiFi.status() != WL_CONNECTED) {
    replyErr(c.id, "Nicht mit einem WLAN verbunden");
    return;
  }
  String host = c.has(1) ? c.arg(1) : String("example.com");
  Json j;
  j.add("host", host);
  IPAddress ip;
  uint32_t t0 = millis();
  bool dns = WiFi.hostByName(host.c_str(), ip) == 1;
  uint32_t dnsMs = millis() - t0;
  j.add("dns_ok", dns).add("dns_ms", (unsigned long)dnsMs);
  if (!dns) {
    j.add("ok", false).add("error", "DNS fehlgeschlagen (kein Internet?)");
    reply(c.id, j);
    return;
  }
  j.add("ip", ip.toString());
  WiFiClient client;
  t0 = millis();
  bool tcp = client.connect(ip, 80, 4000);
  uint32_t tcpMs = millis() - t0;
  j.add("tcp_ok", tcp).add("tcp_ms", (unsigned long)tcpMs);
  if (tcp) {
    client.print(String("HEAD / HTTP/1.1\r\nHost: ") + host + "\r\nConnection: close\r\n\r\n");
    t0 = millis();
    while (!client.available() && millis() - t0 < 4000) delay(10);
    String status = client.readStringUntil('\n');
    status.trim();
    j.add("http", status).add("http_ms", (unsigned long)(millis() - t0));
    client.stop();
  }
  j.add("ok", tcp);
  if (!tcp) j.add("error", "Server nicht erreichbar");
  reply(c.id, j);
}

void cmdApStart(Ctx& c) {
  if (c.has(1)) cfg.apSsid = c.arg(1);
  if (c.argc > 2) cfg.apPass = c.arg(2);
  if (c.has(3)) cfg.apChannel = constrain((int)c.num(3, 6), 1, 13);
  if (c.has(4)) cfg.apHidden = c.flag(4, false);
  if (c.has(5)) cfg.apMax = constrain((int)c.num(5, 4), 1, 10);
  bool save = c.flag(6, true);
  if (apOn) stopAp();
  String err;
  if (!startAp(err)) {
    replyErr(c.id, err);
    return;
  }
  cfg.apAuto = save;
  saveSettings();
  Json j;
  j.add("ok", true);
  addAp(j);
  if (WiFi.status() == WL_CONNECTED && (int)WiFi.channel() != cfg.apChannel)
    j.add("note", "Kanal folgt dem verbundenen WLAN");
  reply(c.id, j);
}

void cmdApStop(Ctx& c) {
  stopAp();
  cfg.apAuto = false;
  saveSettings();
  Json j;
  j.add("ok", true);
  addAp(j);
  reply(c.id, j);
}

void cmdApClients(Ctx& c) {
  Json j;
  j.add("ok", true).add("on", apOn);
  j.arr("clients");
  if (apOn) {
    wifi_sta_list_t list;
    memset(&list, 0, sizeof(list));
    if (esp_wifi_ap_get_sta_list(&list) == ESP_OK) {
      for (int i = 0; i < list.num; i++) {
        j.obj();
        j.add("mac", macToStr(list.sta[i].mac));
        j.add("rssi", (int)list.sta[i].rssi);
        j.endObj();
      }
    }
  }
  j.endArr();
  reply(c.id, j);
}

void cmdWebStart(Ctx& c) {
  if (WiFi.getMode() == WIFI_MODE_NULL) {
    replyErr(c.id, "Erst mit einem WLAN verbinden oder den Hotspot starten");
    return;
  }
  startWeb();
  cfg.webAuto = c.flag(1, true);
  saveSettings();
  Json j;
  j.add("ok", true);
  addWeb(j);
  reply(c.id, j);
}

void cmdWebStop(Ctx& c) {
  stopWeb();
  cfg.webAuto = false;
  saveSettings();
  Json j;
  j.add("ok", true);
  addWeb(j);
  reply(c.id, j);
}

int parseMode(String m) {
  m.toLowerCase();
  if (m == "out" || m == "output") return OUTPUT;
  if (m == "pullup" || m == "in_pullup") return INPUT_PULLUP;
  if (m == "pulldown" || m == "in_pulldown") return INPUT_PULLDOWN;
  if (m == "od" || m == "opendrain") return OUTPUT_OPEN_DRAIN;
  if (m == "in" || m == "input") return INPUT;
  return -1;
}

void cmdGpioMode(Ctx& c) {
  int pin = (int)c.num(1, -1);
  int mode = parseMode(c.arg(2));
  if (mode < 0) {
    replyErr(c.id, "Modus: out, in, pullup, pulldown, od");
    return;
  }
  bool out = (mode == OUTPUT || mode == OUTPUT_OPEN_DRAIN);
  if (!checkPin(c, pin, out)) return;
  if (pwmSlot(pin) >= 0) pwmStop(pin);
  pinMode(pin, mode);
  if (pin < PIN_SLOTS) pinModeOf[pin] = mode;
  Json j;
  j.add("ok", true).add("pin", pin).add("mode", c.arg(2)).add("value", digitalRead(pin));
  reply(c.id, j);
}

void cmdGpioWrite(Ctx& c) {
  int pin = (int)c.num(1, -1);
  if (!checkPin(c, pin, true)) return;
  int v = c.flag(2, false) ? HIGH : LOW;
  if (pin >= PIN_SLOTS || pinModeOf[pin] != OUTPUT_OPEN_DRAIN) ensureGpio(pin, OUTPUT);
  digitalWrite(pin, v);
  if (pin == cfg.ledPin) ledState = v;
  Json j;
  j.add("ok", true).add("pin", pin).add("value", v);
  reply(c.id, j);
}

void cmdGpioToggle(Ctx& c) {
  int pin = (int)c.num(1, -1);
  if (!checkPin(c, pin, true)) return;
  if (pin >= PIN_SLOTS || pinModeOf[pin] != OUTPUT_OPEN_DRAIN) ensureGpio(pin, OUTPUT);
  int v = digitalRead(pin) ? LOW : HIGH;
  digitalWrite(pin, v);
  if (pin == cfg.ledPin) ledState = v;
  Json j;
  j.add("ok", true).add("pin", pin).add("value", v);
  reply(c.id, j);
}

void cmdGpioRead(Ctx& c) {
  if (c.argc < 2) {
    replyErr(c.id, "Pin fehlt: gpio.read <pin> [pin ...]");
    return;
  }
  Json j;
  j.add("ok", true);
  j.obj("pins");
  for (int i = 1; i < c.argc; i++) {
    if (c.argv[i] == "force") continue;
    int pin = c.argv[i].toInt();
    if (!pinExists(pin) || isProtectedPin(pin)) continue;
    if (pin < PIN_SLOTS && pinModeOf[pin] < 0) {
      pinMode(pin, INPUT);
      pinModeOf[pin] = INPUT;
    }
    j.add(c.argv[i].c_str(), digitalRead(pin));
  }
  j.endObj();
  reply(c.id, j);
}

void cmdPwm(Ctx& c) {
  int pin = (int)c.num(1, -1);
  if (!checkPin(c, pin, true)) return;
  long duty = constrain(c.num(2, 128), 0L, 255L);
  long freq = constrain(c.num(3, 5000), 1L, 40000L);
  int s = pwmSlot(pin);
  if (s >= 0 && pwmFreq[s] != (uint32_t)freq) {
    pwmStop(pin);
    s = -1;
  }
  if (s < 0) {
    for (int i = 0; i < 6; i++)
      if (pwmPins[i] < 0) {
        s = i;
        break;
      }
    if (s < 0) {
      replyErr(c.id, "Maximal 6 PWM-Pins gleichzeitig");
      return;
    }
    bool ok;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ok = ledcAttach(pin, freq, 8);
#else
    ok = ledcSetup(s, freq, 8) != 0;
    if (ok) ledcAttachPin(pin, s);
#endif
    if (!ok) {
      replyErr(c.id, "PWM konnte nicht gestartet werden");
      return;
    }
    pwmPins[s] = pin;
    pwmFreq[s] = freq;
    if (pin < PIN_SLOTS) pinModeOf[pin] = -2;
  }
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(pin, duty);
#else
  ledcWrite(s, duty);
#endif
  Json j;
  j.add("ok", true).add("pin", pin).add("duty", duty).add("freq", freq);
  reply(c.id, j);
}

void cmdPwmStop(Ctx& c) {
  int pin = (int)c.num(1, -1);
  pwmStop(pin);
  if (pinExists(pin) && digitalPinCanOutput(pin) && !isProtectedPin(pin)) {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
    if (pin < PIN_SLOTS) pinModeOf[pin] = OUTPUT;
  }
  replyOk(c.id);
}

void cmdAdc(Ctx& c) {
  int pin = (int)c.num(1, -1);
  if (!pinExists(pin) || digitalPinToAnalogChannel(pin) < 0) {
    replyErr(c.id, "GPIO " + String(pin) + " hat keinen ADC");
    return;
  }
  if (pwmSlot(pin) >= 0) pwmStop(pin);
  long samples = constrain(c.num(2, 8), 1L, 64L);
  uint32_t raw = 0, mv = 0;
  for (int i = 0; i < samples; i++) {
    raw += analogRead(pin);
    mv += analogReadMilliVolts(pin);
  }
  if (pin < PIN_SLOTS) pinModeOf[pin] = -1;
  Json j;
  j.add("ok", true).add("pin", pin).add("raw", (unsigned long)(raw / samples)).add("mv", (unsigned long)(mv / samples));
  reply(c.id, j);
}

void cmdDac(Ctx& c) {
#if defined(SOC_DAC_SUPPORTED) && SOC_DAC_SUPPORTED
  int pin = (int)c.num(1, -1);
  long v = constrain(c.num(2, 0), 0L, 255L);
  dacWrite(pin, v);
  if (pin >= 0 && pin < PIN_SLOTS) pinModeOf[pin] = -1;
  Json j;
  j.add("ok", true).add("pin", pin).add("value", v);
  reply(c.id, j);
#else
  replyErr(c.id, "Dieser Chip hat keinen DAC");
#endif
}

void cmdTouch(Ctx& c) {
#if (defined(SOC_TOUCH_SENSOR_NUM) && SOC_TOUCH_SENSOR_NUM > 0) && (defined(CONFIG_IDF_TARGET_ESP32) || defined(CONFIG_IDF_TARGET_ESP32S2) || defined(CONFIG_IDF_TARGET_ESP32S3))
  int pin = (int)c.num(1, 4);
  if (!pinExists(pin) || digitalPinToTouchChannel(pin) < 0) {
    replyErr(c.id, "GPIO " + String(pin) + " ist kein Touch-Pin");
    return;
  }
  Json j;
  j.add("ok", true).add("pin", pin).add("value", (unsigned long)touchRead(pin));
  reply(c.id, j);
#else
  replyErr(c.id, "Dieser Chip hat keine Touch-Pins");
#endif
}

void cmdI2cScan(Ctx& c) {
  int sda = (int)c.num(1, -1);
  int scl = (int)c.num(2, -1);
  Wire.end();
  bool ok = (sda >= 0 && scl >= 0) ? Wire.begin(sda, scl) : Wire.begin();
  if (!ok) {
    replyErr(c.id, "I2C konnte nicht gestartet werden");
    return;
  }
  Json j;
  j.add("ok", true).add("sda", sda < 0 ? (int)SDA : sda).add("scl", scl < 0 ? (int)SCL : scl);
  j.arr("devices");
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) j.add(nullptr, (int)a);
  }
  j.endArr();
  reply(c.id, j);
}

void cmdNvsSet(Ctx& c) {
  String k = c.arg(1);
  if (!k.length() || k.length() > 15) {
    replyErr(c.id, "Schluessel: 1 bis 15 Zeichen");
    return;
  }
  prefs.begin("user", false);
  bool ok = prefs.putString(k.c_str(), c.arg(2)) > 0 || c.arg(2).length() == 0;
  prefs.end();
  if (!ok) {
    replyErr(c.id, "Speichern fehlgeschlagen");
    return;
  }
  Json j;
  j.add("ok", true).add("key", k).add("value", c.arg(2));
  reply(c.id, j);
}

void cmdNvsGet(Ctx& c) {
  String k = c.arg(1);
  prefs.begin("user", true);
  bool exists = k.length() && prefs.isKey(k.c_str());
  String v = exists ? prefs.getString(k.c_str(), "") : String("");
  prefs.end();
  if (!exists) {
    replyErr(c.id, "Schluessel \"" + k + "\" nicht gefunden");
    return;
  }
  Json j;
  j.add("ok", true).add("key", k).add("value", v);
  reply(c.id, j);
}

void cmdNvsDel(Ctx& c) {
  prefs.begin("user", false);
  bool ok = prefs.remove(c.arg(1).c_str());
  prefs.end();
  if (!ok) {
    replyErr(c.id, "Schluessel nicht gefunden");
    return;
  }
  replyOk(c.id);
}

void cmdNvsList(Ctx& c) {
  Json j;
  j.add("ok", true);
  j.arr("items");
  prefs.begin("user", true);
#if ESP_IDF_VERSION_MAJOR >= 5
  nvs_iterator_t it = nullptr;
  esp_err_t res = nvs_entry_find(NVS_DEFAULT_PART_NAME, "user", NVS_TYPE_STR, &it);
  while (res == ESP_OK) {
    nvs_entry_info_t info;
    nvs_entry_info(it, &info);
    j.obj().add("key", info.key).add("value", prefs.getString(info.key, "")).endObj();
    res = nvs_entry_next(&it);
  }
  nvs_release_iterator(it);
#else
  nvs_iterator_t it = nvs_entry_find(NVS_DEFAULT_PART_NAME, "user", NVS_TYPE_STR);
  while (it) {
    nvs_entry_info_t info;
    nvs_entry_info(it, &info);
    j.obj().add("key", info.key).add("value", prefs.getString(info.key, "")).endObj();
    it = nvs_entry_next(it);
  }
  nvs_release_iterator(it);
#endif
  prefs.end();
  j.endArr();
  reply(c.id, j);
}

void cmdNvsClear(Ctx& c) {
  prefs.begin("user", false);
  prefs.clear();
  prefs.end();
  replyOk(c.id);
}

void cmdFactory(Ctx& c) {
  prefs.begin("studio", false);
  prefs.clear();
  prefs.end();
  prefs.begin("user", false);
  prefs.clear();
  prefs.end();
  WiFi.disconnect(true, true);
  replyOk(c.id);
  Serial.println("Werkseinstellungen geladen, Neustart ...");
  Serial.flush();
  delay(300);
  ESP.restart();
}

void cmdEcho(Ctx& c) {
  String t;
  for (int i = 1; i < c.argc; i++) {
    if (i > 1) t += ' ';
    t += c.argv[i];
  }
  Json j;
  j.add("ok", true).add("text", t);
  reply(c.id, j);
}

const Command COMMANDS[] = {
    {"help", cmdHelp, "Diese Liste"},
    {"ping", cmdPing, "Verbindung testen"},
    {"info", cmdInfo, "Alle Infos zum Geraet"},
    {"stats", cmdStats, "Live-Werte (Speicher, Temperatur, WLAN)"},
    {"name", cmdName, "name [neuer Name]  Geraetename"},
    {"restart", cmdRestart, "Neu starten"},
    {"sleep", cmdSleep, "sleep <sekunden>  Deep-Sleep"},
    {"cpu", cmdCpu, "cpu [80|160|240]  CPU-Takt"},
    {"led", cmdLed, "led on|off|toggle|blink [anzahl]"},
    {"led.pin", cmdLedPin, "led.pin <pin>  LED-Pin festlegen"},
    {"wifi.scan", cmdWifiScan, "WLAN-Netze suchen"},
    {"wifi.connect", cmdWifiConnect, "wifi.connect <ssid> [passwort] [speichern 1/0]"},
    {"wifi.disconnect", cmdWifiDisconnect, "WLAN trennen"},
    {"wifi.status", cmdWifiStatus, "WLAN-, Hotspot- und Web-Status"},
    {"wifi.forget", cmdWifiForget, "Gespeichertes WLAN vergessen"},
    {"wifi.hostname", cmdHostname, "wifi.hostname <name>"},
    {"net.test", cmdNetTest, "net.test [host]  Internet testen"},
    {"ap.start", cmdApStart, "ap.start <ssid> [passwort] [kanal] [versteckt] [max] [autostart]"},
    {"ap.stop", cmdApStop, "Hotspot ausschalten"},
    {"ap.clients", cmdApClients, "Geraete im Hotspot"},
    {"web.start", cmdWebStart, "web.start [autostart 1/0]  Web-Oberflaeche an"},
    {"web.stop", cmdWebStop, "Web-Oberflaeche aus"},
    {"gpio.mode", cmdGpioMode, "gpio.mode <pin> out|in|pullup|pulldown|od"},
    {"gpio.write", cmdGpioWrite, "gpio.write <pin> 0|1"},
    {"gpio.toggle", cmdGpioToggle, "gpio.toggle <pin>"},
    {"gpio.read", cmdGpioRead, "gpio.read <pin> [pin ...]"},
    {"pwm", cmdPwm, "pwm <pin> <0-255> [frequenz]"},
    {"pwm.stop", cmdPwmStop, "pwm.stop <pin>"},
    {"adc", cmdAdc, "adc <pin> [messungen]  Spannung messen"},
    {"dac", cmdDac, "dac <pin> <0-255>  (nur ESP32/S2)"},
    {"touch", cmdTouch, "touch <pin>  Touch-Wert lesen"},
    {"i2c.scan", cmdI2cScan, "i2c.scan [sda] [scl]  I2C-Geraete suchen"},
    {"nvs.set", cmdNvsSet, "nvs.set <schluessel> <wert>  dauerhaft speichern"},
    {"nvs.get", cmdNvsGet, "nvs.get <schluessel>"},
    {"nvs.del", cmdNvsDel, "nvs.del <schluessel>"},
    {"nvs.list", cmdNvsList, "Alle gespeicherten Werte"},
    {"nvs.clear", cmdNvsClear, "Alle eigenen Werte loeschen"},
    {"factory", cmdFactory, "Alles zuruecksetzen und neu starten"},
    {"echo", cmdEcho, "echo <text>"},
};
const int COMMAND_COUNT = sizeof(COMMANDS) / sizeof(COMMANDS[0]);

void cmdHelp(Ctx& c) {
  if (c.id == 0) {
    Serial.println("Befehle:");
    for (int i = 0; i < COMMAND_COUNT; i++) Serial.printf("  %-16s %s\n", COMMANDS[i].name, COMMANDS[i].help);
  }
  Json j;
  j.add("ok", true);
  j.arr("commands");
  for (int i = 0; i < COMMAND_COUNT; i++) j.obj().add("cmd", COMMANDS[i].name).add("help", COMMANDS[i].help).endObj();
  j.endArr();
  reply(c.id, j);
}

// ---------------------------------------------------------------------------
// Zeilen einlesen und zerlegen
// ---------------------------------------------------------------------------
int tokenize(const String& line, String* out, int max) {
  int n = 0;
  unsigned int i = 0, L = line.length();
  while (i < L && n < max) {
    while (i < L && line[i] == ' ') i++;
    if (i >= L) break;
    String tok;
    bool quoted = false;
    if (line[i] == '"') {
      quoted = true;
      i++;
    }
    while (i < L) {
      char ch = line[i];
      if (quoted) {
        if (ch == '\\' && i + 1 < L) {
          char nx = line[i + 1];
          tok += (nx == 'n') ? '\n' : nx;
          i += 2;
          continue;
        }
        if (ch == '"') {
          i++;
          break;
        }
      } else if (ch == ' ') {
        break;
      }
      tok += ch;
      i++;
    }
    out[n++] = tok;
  }
  return n;
}

void handleLine(String line) {
  line.trim();
  if (!line.length()) return;
  uint32_t id = 0;
  if (line[0] == '#') {
    int sp = line.indexOf(' ');
    if (sp < 0) return;
    id = (uint32_t)line.substring(1, sp).toInt();
    line = line.substring(sp + 1);
    line.trim();
  }
  String argv[MAX_ARGS];
  int argc = tokenize(line, argv, MAX_ARGS);
  if (!argc) return;
  argv[0].toLowerCase();
  Ctx c{id, argc, argv};
  for (int i = 0; i < COMMAND_COUNT; i++) {
    if (argv[0] == COMMANDS[i].name) {
      COMMANDS[i].fn(c);
      return;
    }
  }
  replyErr(id, "Unbekannter Befehl \"" + argv[0] + "\" - tippe help");
}

void readSerial() {
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == '\r') continue;
    if (ch == '\n') {
      String l = lineBuf;
      lineBuf = "";
      handleLine(l);
    } else if (lineBuf.length() < MAX_LINE) {
      lineBuf += ch;
    }
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
void setup() {
  Serial.setRxBufferSize(1024);
  Serial.begin(SERIAL_BAUD);
  delay(300);
  for (int i = 0; i < PIN_SLOTS; i++) pinModeOf[i] = -1;
  lineBuf.reserve(MAX_LINE);
  evQueue = xQueueCreate(16, sizeof(EvMsg));

  loadSettings();
  if (cfg.ledPin >= 0) ledWrite(false);

  WiFi.persistent(false);
  WiFi.onEvent(onWiFiEvent);
  setupWebRoutes();

  if (cfg.staSsid.length()) {
    ensureMode(true, false);
    WiFi.setAutoReconnect(true);
    WiFi.begin(cfg.staSsid.c_str(), cfg.staPass.length() ? cfg.staPass.c_str() : nullptr);
  }
  if (cfg.apAuto) {
    String err;
    startAp(err);
  }
  if (cfg.webAuto && WiFi.getMode() != WIFI_MODE_NULL) startWeb();

  Serial.println();
  Serial.println("==============================");
  Serial.println(" " FW_NAME " v" FW_VERSION);
  Serial.printf(" %s | %s\n", cfg.name.c_str(), ESP.getChipModel());
  Serial.println(" Tippe 'help' fuer alle Befehle");
  Serial.println("==============================");
  Json j;
  j.add("type", "hello").add("fw", FW_NAME).add("version", FW_VERSION).add("name", cfg.name);
  j.add("chip", ESP.getChipModel()).add("reset", resetReason());
  emit(j);
}

void loop() {
  readSerial();
  pumpEvents();
  if (webOn) server.handleClient();
  ledTask();
  delay(2);
}
