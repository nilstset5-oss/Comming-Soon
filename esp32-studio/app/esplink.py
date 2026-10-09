"""Verbindung zum ESP32: serielle Schnittstelle, Protokoll und Demo-Gerät.

Protokoll (siehe Firmware):
    PC  -> ESP:  #<id> <befehl> [argumente]
    ESP -> PC:   @R <id> {json}   Antwort
                 @E {json}        Ereignis
    Alles andere sind normale Log-Zeilen.
"""

from __future__ import annotations

import json
import math
import queue
import random
import threading
import time
from dataclasses import dataclass

try:
    import serial
    from serial.tools import list_ports
except ImportError:  # pragma: no cover - wird in der App angezeigt
    serial = None
    list_ports = None

DEMO_PORT = "DEMO"

# Bekannte USB-Seriell-Chips auf ESP32-Boards
KNOWN_USB = {
    (0x10C4, 0xEA60): "CP210x",
    (0x1A86, 0x7523): "CH340",
    (0x1A86, 0x55D4): "CH9102",
    (0x1A86, 0x55D3): "CH343",
    (0x1A86, 0x55D2): "CH342",
    (0x0403, 0x6001): "FTDI",
    (0x0403, 0x6010): "FTDI",
    (0x0403, 0x6015): "FTDI",
    (0x303A, 0x1001): "ESP32 USB",
    (0x303A, 0x0002): "ESP32-S2 USB",
}


@dataclass
class PortInfo:
    device: str
    label: str
    likely_esp: bool = False
    native_usb: bool = False
    chip: str = ""


def list_serial_ports() -> list[PortInfo]:
    """Alle seriellen Ports, wahrscheinliche ESP32 zuerst."""
    ports: list[PortInfo] = []
    if list_ports is not None:
        for p in list_ports.comports():
            chip = KNOWN_USB.get((p.vid, p.pid)) if p.vid is not None else None
            native = p.vid == 0x303A
            if chip is None and native:
                chip = "ESP32 USB"
            desc = (p.description or "").strip()
            if desc in ("", "n/a", p.device):
                desc = ""
            if chip:
                label = f"{p.device}  –  {chip}" + (f" ({desc})" if desc and chip not in desc else "")
            else:
                label = f"{p.device}" + (f"  –  {desc}" if desc else "")
            ports.append(PortInfo(p.device, label, bool(chip), native, chip or ""))
    ports.sort(key=lambda x: (not x.likely_esp, x.device))
    ports.append(PortInfo(DEMO_PORT, "Demo-Gerät (ohne Hardware)"))
    return ports


def quote_arg(value) -> str:
    """Argument für die Firmware vorbereiten (Leerzeichen und Anführungszeichen)."""
    s = str(value)
    if s == "" or any(c in s for c in ' "\\\n\t'):
        s = s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        return f'"{s}"'
    return s


def tokenize(line: str) -> list[str]:
    """Gleiche Zerlegung wie in der Firmware."""
    out, i, n = [], 0, len(line)
    while i < n:
        while i < n and line[i] == " ":
            i += 1
        if i >= n:
            break
        tok, quoted = [], False
        if line[i] == '"':
            quoted, i = True, i + 1
        while i < n:
            ch = line[i]
            if quoted:
                if ch == "\\" and i + 1 < n:
                    nx = line[i + 1]
                    tok.append("\n" if nx == "n" else nx)
                    i += 2
                    continue
                if ch == '"':
                    i += 1
                    break
            elif ch == " ":
                break
            tok.append(ch)
            i += 1
        out.append("".join(tok))
    return out


def parse_protocol_line(line: str):
    """('R', id, data) / ('E', None, data) / None für normale Zeilen."""
    if line.startswith("@R "):
        rest = line[3:]
        sp = rest.find(" ")
        if sp > 0:
            try:
                return "R", int(rest[:sp]), json.loads(rest[sp + 1:])
            except (ValueError, json.JSONDecodeError):
                return None
    elif line.startswith("@E "):
        try:
            return "E", None, json.loads(line[3:])
        except json.JSONDecodeError:
            return None
    return None


# ---------------------------------------------------------------------------
# Transporte
# ---------------------------------------------------------------------------
class SerialTransport:
    """Echte serielle Schnittstelle (USB).

    Steuerleitungen beim ESP32:
    * Boards mit USB-UART-Chip (CP210x, CH340 …): DTR/RTS hängen an EN und
      BOOT. Beide aus = ESP32 läuft normal weiter, kein Neustart.
    * Nativer USB (ESP32-S2/S3/C3/C6): Hier muss DTR an sein, sonst schickt
      die Firmware (TinyUSB) gar nichts. DTR und RTS gemeinsam an ist dort
      der neutrale Zustand. Immer erst DTR, dann RTS setzen – andersherum
      wertet der ESP32 das als Reset-Folge.
    """

    def __init__(self, port: str, baud: int, native_usb: bool = False):
        if serial is None:
            raise RuntimeError("pyserial fehlt – bitte 'pip install pyserial' ausführen")
        self.native = native_usb
        self.ser = serial.Serial()
        self.ser.port = port
        self.ser.baudrate = baud
        self.ser.timeout = 0.05
        self.ser.write_timeout = 2
        try:
            self.ser.dtr = False
            self.ser.rts = False
        except Exception:
            pass
        self.ser.open()
        if native_usb:
            self.idle()

    def idle(self) -> None:
        """Steuerleitungen in den neutralen Zustand bringen."""
        try:
            if self.native:
                self.ser.dtr = True
                self.ser.rts = True
            else:
                self.ser.dtr = False
                self.ser.rts = False
        except Exception:
            pass  # manche Treiber/virtuelle Ports kennen keine Steuerleitungen

    def read(self) -> bytes:
        n = self.ser.in_waiting
        return self.ser.read(n or 1)

    def write(self, data: bytes) -> None:
        self.ser.write(data)

    def close(self) -> None:
        try:
            self.ser.close()
        except Exception:
            pass

    def set_baud(self, baud: int) -> None:
        self.ser.baudrate = baud

    def hard_reset(self) -> None:
        """Reset über die EN-Leitung (RTS), wie beim Druck auf die EN/RST-Taste."""
        self.ser.dtr = False
        self.ser.rts = True
        time.sleep(0.2 if self.native else 0.12)
        self.ser.rts = False
        if self.native:
            time.sleep(0.3)
            self.idle()

    def bootloader(self) -> None:
        """In den Download-Modus starten (wie BOOT gedrückt halten + EN)."""
        s = self.ser
        if self.native:
            s.rts = False
            s.dtr = False
            time.sleep(0.1)
            s.dtr = True
            s.rts = False
            time.sleep(0.1)
            s.rts = True
            s.dtr = False
            s.rts = True
            time.sleep(0.1)
            s.dtr = False
            s.rts = False
        else:
            s.dtr = False
            s.rts = True
            time.sleep(0.1)
            s.dtr = True
            s.rts = False
            time.sleep(0.05)
            s.dtr = False


class Link:
    """Hält die Verbindung, liest und schreibt im Hintergrund.

    Die Threads legen Ereignisse in ``events`` ab, die GUI holt sie im
    Hauptthread ab (Tkinter darf nur aus einem Thread benutzt werden).
    Jedes Ereignis trägt die Nummer der Verbindung (``gen``), damit Reste
    einer alten Verbindung ignoriert werden können.
    """

    def __init__(self):
        self.events: queue.Queue = queue.Queue()
        self.transport = None
        self.port = None
        self.gen = 0
        self._threads = []
        self._stop = threading.Event()
        self._wq: queue.Queue = queue.Queue()
        self._next_id = 1
        self.rx_bytes = 0
        self.tx_bytes = 0
        self.rx_since_open = 0

    @property
    def is_open(self) -> bool:
        return self.transport is not None

    @property
    def is_demo(self) -> bool:
        return isinstance(self.transport, DemoTransport)

    def open(self, port: str, baud: int, native_usb: bool = False) -> None:
        self.close()
        transport = DemoTransport() if port == DEMO_PORT else SerialTransport(port, baud, native_usb)
        self.transport = transport
        self.port = port
        self.gen += 1
        self.rx_since_open = 0
        self._stop = threading.Event()
        self._wq = queue.Queue()
        self._threads = [
            threading.Thread(target=self._reader, args=(transport, self.gen, self._stop), daemon=True),
            threading.Thread(target=self._writer, args=(transport, self.gen, self._stop, self._wq), daemon=True),
        ]
        for t in self._threads:
            t.start()

    def close(self) -> None:
        self._stop.set()
        self._wq.put(None)
        t = self.transport
        self.transport = None
        if t is not None:
            t.close()
        for th in self._threads:
            if th is not threading.current_thread():
                th.join(timeout=1)
        self._threads = []

    def next_id(self) -> int:
        i = self._next_id
        self._next_id = 1 if self._next_id >= 999999 else self._next_id + 1
        return i

    def write_line(self, text: str, ending: str = "\n") -> None:
        """Zeile zum Senden einreihen – blockiert nie die Oberfläche."""
        if not self.transport:
            raise RuntimeError("Nicht verbunden")
        self._wq.put((text + ending).encode("utf-8"))

    def send_command(self, cmd: str, *args) -> int:
        rid = self.next_id()
        parts = [f"#{rid}", cmd] + [quote_arg(a) for a in args]
        self.write_line(" ".join(parts))
        return rid

    def _writer(self, transport, gen, stop, wq) -> None:
        while not stop.is_set():
            data = wq.get()
            if data is None or stop.is_set():
                return
            try:
                transport.write(data)
                self.tx_bytes += len(data)
            except Exception as e:
                if stop.is_set():
                    return
                timeout = serial is not None and isinstance(e, getattr(serial, "SerialTimeoutException", ()))
                self.events.put(("write_timeout" if timeout else "lost", str(e) or type(e).__name__, gen))
                if not timeout:
                    return

    def _reader(self, transport, gen, stop) -> None:
        buf = b""
        while not stop.is_set():
            try:
                data = transport.read()
            except Exception as e:  # Kabel gezogen, Port weg ...
                if not stop.is_set():
                    self.events.put(("lost", str(e) or type(e).__name__, gen))
                return
            if not data:
                continue
            self.rx_bytes += len(data)
            self.rx_since_open += len(data)
            buf += data
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                self.events.put(("line", raw.decode("utf-8", "replace").rstrip("\r"), time.perf_counter(), gen))
            if len(buf) > 4096:  # sehr lange Zeile ohne Umbruch
                self.events.put(("line", buf.decode("utf-8", "replace"), time.perf_counter(), gen))
                buf = b""


# ---------------------------------------------------------------------------
# Demo-Gerät: verhält sich wie ein ESP32 mit Studio-Firmware
# ---------------------------------------------------------------------------
DEMO_NETWORKS = [
    ("FRITZ!Box 7590 KL", -47, 6, "WPA2"),
    ("Vodafone-A1B2", -61, 1, "WPA2"),
    ("Gastnetz", -58, 6, "WPA2/WPA3"),
    ("Telekom_FON", -72, 11, "offen"),
    ("o2-WLAN-4D", -76, 11, "WPA2"),
    ("DIRECT-42-HP Laser", -81, 6, "WPA2"),
    ("Werkstatt", -66, 13, "WPA2"),
    ("", -84, 1, "WPA2"),
]


class DemoTransport:
    native = False

    def __init__(self):
        self._lock = threading.Lock()
        self._out: list[tuple[float, bytes]] = []
        self._inbuf = b""
        self._closed = False
        self._asleep_until = 0.0
        self._in_bootloader = False
        self.mac = "24:6F:28:%02X:%02X:%02X" % tuple(random.randrange(256) for _ in range(3))
        self._factory()
        self._boot("Einschalten")

    # -- interne Helfer ----------------------------------------------------
    def _factory(self):
        suffix = self.mac.replace(":", "")[-4:]
        self.name = f"ESP32-{suffix}"
        self.hostname = f"esp32-studio-{suffix.lower()}"
        self.saved_ssid, self.saved_pass = "", ""
        self.ap_cfg = dict(ssid=f"ESP32-Studio-{suffix}", password="", channel=6, hidden=False, max=4, auto=False)
        self.web_auto = False
        self.led_pin = 2
        self.nvs: dict[str, str] = {}

    def _reset_runtime(self):
        self.t0 = time.time()
        self.sta = None  # dict mit ssid/ip/rssi wenn verbunden
        self.ap_on = False
        self.ap_clients: list[dict] = []
        self.web_on = False
        self.led = False
        self.cpu = 240
        self.pins: dict[int, dict] = {}
        self.pwm: dict[int, tuple[int, int]] = {}

    def _send(self, text: str, delay: float = 0.0):
        with self._lock:
            self._out.append((time.time() + delay, (text + "\r\n").encode("utf-8")))

    def _reply(self, rid: int, data: dict, delay: float = 0.02):
        self._send(f"@R {rid} " + json.dumps(data, ensure_ascii=False), delay)

    def _event(self, data: dict, delay: float = 0.0):
        self._send("@E " + json.dumps(data, ensure_ascii=False), delay)

    def _boot(self, reason: str, delay: float = 0.0):
        self._reset_runtime()
        d = delay
        for line in (
            "ets Jul 29 2019 12:21:46",
            "",
            "rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)",
            "configsip: 0, SPIWP:0xee",
            "mode:DIO, clock div:1",
            "load:0x3fff0030,len:1184",
            "entry 0x400805cc",
            "",
            "==============================",
            " ESP32 Studio v1.0.0  (Demo)",
            f" {self.name} | ESP32-D0WD-V3",
            " Tippe 'help' fuer alle Befehle",
            "==============================",
        ):
            self._send(line, d)
            d += 0.01
        self._event({"type": "hello", "fw": "ESP32 Studio", "version": "1.0.0", "name": self.name,
                     "chip": "ESP32-D0WD-V3", "reset": reason, "uptime": 0}, d)
        if self.saved_ssid:
            self.sta = {"ssid": self.saved_ssid, "ip": "192.168.178.57", "rssi": -52}
            self._event({"type": "wifi", "event": "connected", "ssid": self.saved_ssid,
                         "ip": "192.168.178.57", "rssi": -52}, d + 1.5)
        if self.ap_cfg["auto"]:
            self.ap_on = True
        if self.web_auto and (self.saved_ssid or self.ap_on):
            self.web_on = True

    def _uptime(self) -> int:
        return int(time.time() - self.t0)

    def _heap(self) -> int:
        base = 248_000 - (6_000 if self.sta else 0) - (9_000 if self.ap_on else 0) - (4_000 if self.web_on else 0)
        return base + int(2500 * math.sin(time.time() / 7)) + random.randint(-600, 600)

    def _temp(self) -> float:
        return round(41.5 + 2.0 * math.sin(time.time() / 40) + random.uniform(-0.4, 0.4) + (self.cpu - 160) / 40, 1)

    def _rssi(self) -> int:
        return int(-52 + 4 * math.sin(time.time() / 9) + random.randint(-2, 2)) if self.sta else 0

    def _wifi(self) -> dict:
        w = {"enabled": True, "status": "connected" if self.sta else "disconnected", "saved_ssid": self.saved_ssid,
             "hostname": self.hostname, "mac": self.mac}
        if self.sta:
            w.update(ssid=self.sta["ssid"], bssid="3C:A6:2F:11:22:33", ip=self.sta["ip"], gateway="192.168.178.1",
                     subnet="255.255.255.0", dns="192.168.178.1", rssi=self._rssi(), channel=6)
        return w

    def _ap(self) -> dict:
        a = dict(on=self.ap_on, ssid=self.ap_cfg["ssid"], password=self.ap_cfg["password"],
                 channel=self.ap_cfg["channel"], hidden=self.ap_cfg["hidden"], max=self.ap_cfg["max"],
                 auto=self.ap_cfg["auto"], clients=len(self.ap_clients) if self.ap_on else 0)
        if self.ap_on:
            a.update(ip="192.168.4.1", mac=self.mac[:-2] + "%02X" % ((int(self.mac[-2:], 16) + 1) % 256))
        return a

    def _web(self) -> dict:
        url = ""
        if self.web_on:
            url = f"http://{self.sta['ip']}/" if self.sta else ("http://192.168.4.1/" if self.ap_on else "")
        return {"on": self.web_on, "auto": self.web_auto, "url": url,
                "mdns": f"http://{self.hostname}.local/" if self.web_on else ""}

    def _stats(self) -> dict:
        return {"uptime": self._uptime(), "heap_free": self._heap(), "heap_min": 201_344, "heap_size": 327_680,
                "temp": self._temp(), "cpu_mhz": self.cpu, "sta": "connected" if self.sta else "disconnected",
                "rssi": self._rssi(), "ip": self.sta["ip"] if self.sta else "", "ap_on": self.ap_on,
                "ap_clients": len(self.ap_clients) if self.ap_on else 0, "led": self.led, "web": self.web_on}

    # -- Transport-Schnittstelle --------------------------------------------
    def read(self) -> bytes:
        deadline = time.time() + 0.05
        while not self._closed:
            now = time.time()
            with self._lock:
                ready = [x for x in self._out if x[0] <= now]
                if ready:
                    self._out = [x for x in self._out if x[0] > now]
            if ready:
                ready.sort(key=lambda x: x[0])
                return b"".join(x[1] for x in ready)
            if now >= deadline:
                return b""
            time.sleep(0.01)
        raise OSError("Demo beendet")

    def write(self, data: bytes) -> None:
        self._inbuf += data
        while b"\n" in self._inbuf:
            raw, self._inbuf = self._inbuf.split(b"\n", 1)
            line = raw.decode("utf-8", "replace").strip()
            if line:
                self._handle(line)

    def close(self) -> None:
        self._closed = True

    def set_baud(self, baud: int) -> None:
        pass

    def hard_reset(self) -> None:
        with self._lock:
            self._out.clear()
        self._in_bootloader = False
        self._asleep_until = 0
        self._boot("Reset-Pin", 0.3)

    def bootloader(self) -> None:
        with self._lock:
            self._out.clear()
        self._in_bootloader = True
        self._send("rst:0x1 (POWERON_RESET),boot:0x3 (DOWNLOAD_BOOT(UART0/UART1/SDIO_REI_REO_V2))", 0.2)
        self._send("waiting for download", 0.25)

    # -- Befehle --------------------------------------------------------------
    def _handle(self, line: str) -> None:
        if self._in_bootloader or time.time() < self._asleep_until:
            return  # schläft oder wartet auf Firmware
        rid = 0
        if line.startswith("#"):
            sp = line.find(" ")
            if sp < 0:
                return
            try:
                rid = int(line[1:sp])
            except ValueError:
                rid = 0
            line = line[sp + 1:].strip()
        argv = tokenize(line)
        if not argv:
            return
        cmd = argv[0].lower()
        fn = getattr(self, "_c_" + cmd.replace(".", "_"), None)
        if fn is None:
            self._reply(rid, {"ok": False, "error": f'Unbekannter Befehl "{cmd}" - tippe help'})
            return
        try:
            fn(rid, argv)
        except Exception as e:  # sollte nicht passieren, aber die Demo soll nicht abstürzen
            self._reply(rid, {"ok": False, "error": f"Demo-Fehler: {e}"})

    @staticmethod
    def _arg(argv, i, default=""):
        return argv[i] if i < len(argv) else default

    @staticmethod
    def _num(argv, i, default):
        try:
            return int(argv[i]) if i < len(argv) and argv[i] != "" else default
        except ValueError:
            return default

    @staticmethod
    def _flag(argv, i, default):
        if i >= len(argv) or argv[i] == "":
            return default
        return argv[i].lower() in ("1", "true", "on", "yes", "ja")

    def _c_help(self, rid, argv):
        names = [n[3:].replace("_", ".") for n in dir(self) if n.startswith("_c_")]
        if rid == 0:
            self._send("Befehle: " + ", ".join(sorted(names)))
        self._reply(rid, {"ok": True, "commands": [{"cmd": n, "help": ""} for n in sorted(names)]})

    def _c_ping(self, rid, argv):
        self._reply(rid, {"ok": True, "pong": True, "fw": "ESP32 Studio", "version": "1.0.0", "name": self.name,
                          "ms": int((time.time() - self.t0) * 1000)}, delay=random.uniform(0.005, 0.02))

    def _c_info(self, rid, argv):
        self._reply(rid, {
            "ok": True, "fw": "ESP32 Studio", "version": "1.0.0", "name": self.name,
            "chip": {"model": "ESP32-D0WD-V3", "rev": 301, "cores": 2, "mhz": self.cpu, "mac": self.mac,
                     "sdk": "v5.1.4-demo", "core": "3.0.7"},
            "mem": {"heap_size": 327_680, "heap_free": self._heap(), "heap_min": 201_344, "heap_max_alloc": 110_580,
                    "psram_size": 0, "psram_free": 0},
            "flash": {"size": 4_194_304, "speed": 80_000_000, "sketch": 1_043_216, "sketch_free": 1_310_720},
            "sys": {"uptime": self._uptime(), "reset": "Einschalten", "temp": self._temp(), "led_pin": self.led_pin,
                    "led": self.led},
            "wifi": self._wifi(), "ap": self._ap(), "web": self._web(),
        })

    def _c_stats(self, rid, argv):
        self._reply(rid, {"ok": True, **self._stats()})

    def _c_name(self, rid, argv):
        if self._arg(argv, 1):
            self.name = argv[1]
        self._reply(rid, {"ok": True, "name": self.name})

    def _c_restart(self, rid, argv):
        self._reply(rid, {"ok": True})
        self._send("Neustart ...", 0.05)
        self._boot("Software-Neustart", 0.6)

    def _c_sleep(self, rid, argv):
        sec = self._num(argv, 1, 10)
        self._reply(rid, {"ok": True, "seconds": sec})
        self._send(f"Deep-Sleep fuer {sec} s ...", 0.05)
        wake = min(sec, 15)
        self._asleep_until = time.time() + wake
        self._boot("Aufwachen aus Deep-Sleep", wake)

    def _c_cpu(self, rid, argv):
        mhz = self._num(argv, 1, self.cpu)
        if mhz not in (80, 160, 240):
            self._reply(rid, {"ok": False, "error": "Diese Taktrate wird nicht unterstuetzt"})
            return
        self.cpu = mhz
        self._reply(rid, {"ok": True, "mhz": mhz})

    def _c_led(self, rid, argv):
        a = self._arg(argv, 1).lower()
        if a in ("on", "1"):
            self.led = True
        elif a in ("off", "0"):
            self.led = False
        elif a != "blink":
            self.led = not self.led
        self._reply(rid, {"ok": True, "led": self.led, "pin": self.led_pin})

    def _c_led_pin(self, rid, argv):
        if self._arg(argv, 1):
            self.led_pin = self._num(argv, 1, 2)
        self._reply(rid, {"ok": True, "pin": self.led_pin})

    def _c_wifi_scan(self, rid, argv):
        nets = []
        for ssid, rssi, ch, auth in DEMO_NETWORKS:
            nets.append({"ssid": ssid, "rssi": rssi + random.randint(-3, 3), "channel": ch, "auth": auth,
                         "open": auth == "offen",
                         "bssid": "%02X:%02X:%02X:%02X:%02X:%02X" % tuple(random.Random(ssid + str(ch)).randrange(256)
                                                                          for _ in range(6))})
        nets.sort(key=lambda n: -n["rssi"])
        self._reply(rid, {"ok": True, "count": len(nets), "networks": nets}, delay=1.8)

    def _c_wifi_connect(self, rid, argv):
        ssid, pw = self._arg(argv, 1), self._arg(argv, 2)
        save = self._flag(argv, 3, True)
        if not ssid:
            self._reply(rid, {"ok": False, "error": "SSID fehlt"})
            return
        net = next((n for n in DEMO_NETWORKS if n[0] == ssid), None)
        if net is None:
            self._reply(rid, {"ok": False, "error": f'Keine Verbindung zu "{ssid}": Netzwerk nicht gefunden',
                              "reason": 201}, delay=3.0)
            return
        if net[3] != "offen" and len(pw) < 8:
            self._reply(rid, {"ok": False, "error": f'Keine Verbindung zu "{ssid}": Passwort falsch?',
                              "reason": 15}, delay=3.5)
            return
        self.sta = {"ssid": ssid, "ip": "192.168.178.57", "rssi": net[1]}
        if save:
            self.saved_ssid, self.saved_pass = ssid, pw
        self._event({"type": "wifi", "event": "connected", "ssid": ssid, "ip": "192.168.178.57",
                     "rssi": net[1]}, delay=1.9)
        self._reply(rid, {"ok": True, "saved": save, "ms": 1960, "wifi": self._wifi()}, delay=2.0)

    def _c_wifi_disconnect(self, rid, argv):
        was = self.sta is not None
        self.sta = None
        if was:
            self._event({"type": "wifi", "event": "disconnected", "reason": 8, "reason_text": "Getrennt"})
        self._reply(rid, {"ok": True, "wifi": self._wifi()})

    def _c_wifi_status(self, rid, argv):
        self._reply(rid, {"ok": True, "wifi": self._wifi(), "ap": self._ap(), "web": self._web()})

    def _c_wifi_forget(self, rid, argv):
        self.saved_ssid = self.saved_pass = ""
        self._reply(rid, {"ok": True})

    def _c_wifi_hostname(self, rid, argv):
        if self._arg(argv, 1):
            self.hostname = argv[1].lower().replace(" ", "-")
        self._reply(rid, {"ok": True, "hostname": self.hostname, "note": "Wirkt beim naechsten Verbinden"})

    def _c_net_test(self, rid, argv):
        if not self.sta:
            self._reply(rid, {"ok": False, "error": "Nicht mit einem WLAN verbunden"})
            return
        host = self._arg(argv, 1) or "example.com"
        dns, tcp = random.randint(12, 40), random.randint(18, 60)
        self._reply(rid, {"ok": True, "host": host, "dns_ok": True, "dns_ms": dns, "ip": "93.184.215.14",
                          "tcp_ok": True, "tcp_ms": tcp, "http": "HTTP/1.1 200 OK", "http_ms": tcp + 8},
                    delay=(dns + tcp * 2) / 1000)

    def _c_ap_start(self, rid, argv):
        c = self.ap_cfg
        if self._arg(argv, 1):
            c["ssid"] = argv[1]
        if len(argv) > 2:
            c["password"] = argv[2]
        if self._arg(argv, 3):
            c["channel"] = max(1, min(13, self._num(argv, 3, 6)))
        if self._arg(argv, 4):
            c["hidden"] = self._flag(argv, 4, False)
        if self._arg(argv, 5):
            c["max"] = max(1, min(10, self._num(argv, 5, 4)))
        if 0 < len(c["password"]) < 8:
            self._reply(rid, {"ok": False, "error": "Passwort muss mindestens 8 Zeichen haben (oder leer = offen)"})
            return
        c["auto"] = self._flag(argv, 6, True)
        self.ap_on = True
        self.ap_clients = []
        self._reply(rid, {"ok": True, "ap": self._ap()}, delay=0.3)
        # Ein paar Geräte "verbinden" sich nach und nach
        for i, d in enumerate((4.0, 9.0)):
            if i >= c["max"]:
                break
            mac = "%02X:%02X:%02X:%02X:%02X:%02X" % ((random.randrange(64) << 2) | 2, *(random.randrange(256) for _ in range(5)))
            threading.Timer(d, self._demo_join, args=(mac, i + 2)).start()

    def _demo_join(self, mac, n):
        if not self.ap_on or self._closed:
            return
        self.ap_clients.append({"mac": mac, "rssi": random.randint(-65, -35)})
        self._event({"type": "ap", "event": "join", "mac": mac})
        self._event({"type": "ap", "event": "ip", "ip": f"192.168.4.{n}"}, 0.4)

    def _c_ap_stop(self, rid, argv):
        self.ap_on = False
        self.ap_clients = []
        self.ap_cfg["auto"] = False
        self._reply(rid, {"ok": True, "ap": self._ap()})

    def _c_ap_clients(self, rid, argv):
        clients = [dict(c, rssi=c["rssi"] + random.randint(-2, 2)) for c in self.ap_clients] if self.ap_on else []
        self._reply(rid, {"ok": True, "on": self.ap_on, "clients": clients})

    def _c_web_start(self, rid, argv):
        if not (self.sta or self.ap_on):
            self._reply(rid, {"ok": False, "error": "Erst mit einem WLAN verbinden oder den Hotspot starten"})
            return
        self.web_on = True
        self.web_auto = self._flag(argv, 1, True)
        self._reply(rid, {"ok": True, "web": self._web()})

    def _c_web_stop(self, rid, argv):
        self.web_on = self.web_auto = False
        self._reply(rid, {"ok": True, "web": self._web()})

    def _check_pin(self, rid, pin, output, argv):
        if pin < 0 or pin > 39 or pin in (20, 24, 28, 29, 30, 31):
            self._reply(rid, {"ok": False, "error": f"GPIO {pin} gibt es auf diesem Chip nicht"})
            return False
        if output and 34 <= pin <= 39:
            self._reply(rid, {"ok": False, "error": f"GPIO {pin} kann nur als Eingang benutzt werden"})
            return False
        if (6 <= pin <= 11 or pin in (1, 3)) and "force" not in argv:
            self._reply(rid, {"ok": False, "error": f"GPIO {pin} ist geschützt (Flash/USB/Seriell). "
                                                     "Mit 'force' trotzdem benutzen."})
            return False
        return True

    def _pin(self, pin):
        return self.pins.setdefault(pin, {"mode": "in", "value": 0})

    def _read_pin(self, pin):
        p = self._pin(pin)
        if p["mode"] in ("out", "od"):
            return p["value"]
        if p["mode"] == "pullup":
            return 0 if random.random() < 0.08 else 1
        if p["mode"] == "pulldown":
            return 1 if random.random() < 0.08 else 0
        return int((time.time() * (0.5 + pin % 3 * 0.3)) % 2)  # "schwebender" Eingang

    def _c_gpio_mode(self, rid, argv):
        pin, mode = self._num(argv, 1, -1), self._arg(argv, 2).lower()
        modes = {"out": "out", "output": "out", "in": "in", "input": "in", "pullup": "pullup",
                 "pulldown": "pulldown", "od": "od"}
        if mode not in modes:
            self._reply(rid, {"ok": False, "error": "Modus: out, in, pullup, pulldown, od"})
            return
        if not self._check_pin(rid, pin, modes[mode] in ("out", "od"), argv):
            return
        self.pwm.pop(pin, None)
        self._pin(pin)["mode"] = modes[mode]
        self._reply(rid, {"ok": True, "pin": pin, "mode": mode, "value": self._read_pin(pin)})

    def _c_gpio_write(self, rid, argv):
        pin = self._num(argv, 1, -1)
        if not self._check_pin(rid, pin, True, argv):
            return
        v = 1 if self._flag(argv, 2, False) else 0
        self.pwm.pop(pin, None)
        p = self._pin(pin)
        if p["mode"] != "od":
            p["mode"] = "out"
        p["value"] = v
        if pin == self.led_pin:
            self.led = bool(v)
        self._reply(rid, {"ok": True, "pin": pin, "value": v})

    def _c_gpio_toggle(self, rid, argv):
        pin = self._num(argv, 1, -1)
        if not self._check_pin(rid, pin, True, argv):
            return
        p = self._pin(pin)
        if p["mode"] != "od":
            p["mode"] = "out"
        p["value"] = 0 if p["value"] else 1
        if pin == self.led_pin:
            self.led = bool(p["value"])
        self._reply(rid, {"ok": True, "pin": pin, "value": p["value"]})

    def _c_gpio_read(self, rid, argv):
        pins = {}
        for a in argv[1:]:
            try:
                pin = int(a)
            except ValueError:
                continue
            if 0 <= pin <= 39 and not (6 <= pin <= 11 or pin in (1, 3)):
                pins[a] = self._read_pin(pin)
        self._reply(rid, {"ok": True, "pins": pins})

    def _c_pwm(self, rid, argv):
        pin = self._num(argv, 1, -1)
        if not self._check_pin(rid, pin, True, argv):
            return
        duty = max(0, min(255, self._num(argv, 2, 128)))
        freq = max(1, min(40000, self._num(argv, 3, 5000)))
        self.pwm[pin] = (duty, freq)
        self._reply(rid, {"ok": True, "pin": pin, "duty": duty, "freq": freq})

    def _c_pwm_stop(self, rid, argv):
        self.pwm.pop(self._num(argv, 1, -1), None)
        self._reply(rid, {"ok": True})

    def _c_adc(self, rid, argv):
        pin = self._num(argv, 1, -1)
        if pin not in (0, 2, 4, 12, 13, 14, 15, 25, 26, 27, 32, 33, 34, 35, 36, 39):
            self._reply(rid, {"ok": False, "error": f"GPIO {pin} hat keinen ADC"})
            return
        if pin in self.pwm:
            self.pwm.pop(pin)
        mv = int(1650 + 1200 * math.sin(time.time() * (0.6 + pin % 5 * 0.15)) + random.randint(-25, 25))
        mv = max(0, min(3300, mv))
        self._reply(rid, {"ok": True, "pin": pin, "raw": int(mv / 3300 * 4095), "mv": mv})

    def _c_dac(self, rid, argv):
        pin, v = self._num(argv, 1, 25), max(0, min(255, self._num(argv, 2, 0)))
        self._reply(rid, {"ok": True, "pin": pin, "value": v})

    def _c_touch(self, rid, argv):
        pin = self._num(argv, 1, 4)
        if pin not in (0, 2, 4, 12, 13, 14, 15, 27, 32, 33):
            self._reply(rid, {"ok": False, "error": f"GPIO {pin} ist kein Touch-Pin"})
            return
        touched = int(time.time() / 3) % 3 == 0
        self._reply(rid, {"ok": True, "pin": pin, "value": random.randint(12, 20) if touched else random.randint(55, 68)})

    def _c_i2c_scan(self, rid, argv):
        sda, scl = self._num(argv, 1, -1), self._num(argv, 2, -1)
        self._reply(rid, {"ok": True, "sda": 21 if sda < 0 else sda, "scl": 22 if scl < 0 else scl,
                          "devices": [0x3C, 0x76]}, delay=0.25)

    def _c_nvs_set(self, rid, argv):
        k = self._arg(argv, 1)
        if not k or len(k) > 15:
            self._reply(rid, {"ok": False, "error": "Schluessel: 1 bis 15 Zeichen"})
            return
        self.nvs[k] = self._arg(argv, 2)
        self._reply(rid, {"ok": True, "key": k, "value": self.nvs[k]})

    def _c_nvs_get(self, rid, argv):
        k = self._arg(argv, 1)
        if k not in self.nvs:
            self._reply(rid, {"ok": False, "error": f'Schluessel "{k}" nicht gefunden'})
            return
        self._reply(rid, {"ok": True, "key": k, "value": self.nvs[k]})

    def _c_nvs_del(self, rid, argv):
        if self.nvs.pop(self._arg(argv, 1), None) is None:
            self._reply(rid, {"ok": False, "error": "Schluessel nicht gefunden"})
            return
        self._reply(rid, {"ok": True})

    def _c_nvs_list(self, rid, argv):
        self._reply(rid, {"ok": True, "items": [{"key": k, "value": v} for k, v in sorted(self.nvs.items())]})

    def _c_nvs_clear(self, rid, argv):
        self.nvs.clear()
        self._reply(rid, {"ok": True})

    def _c_factory(self, rid, argv):
        self._reply(rid, {"ok": True})
        self._send("Werkseinstellungen geladen, Neustart ...", 0.05)
        self._factory()
        self._boot("Software-Neustart", 0.6)

    def _c_echo(self, rid, argv):
        self._reply(rid, {"ok": True, "text": " ".join(argv[1:])})
