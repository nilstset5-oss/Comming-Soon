#!/usr/bin/env python3
"""ESP32 Studio – Desktop-App zum Steuern eines ESP32 über USB.

Start:  python esp32_studio.py
Benötigt: Python 3.8+, pyserial (Pflicht), esptool und segno (optional)
"""

from __future__ import annotations

import collections
import contextlib
import importlib.util
import io
import json
import math
import os
import queue
import random
import re
import string
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

import tkinter as tk
import tkinter.font as tkfont
from tkinter import filedialog, messagebox, ttk

from esplink import DEMO_PORT, Link, PortInfo, list_serial_ports, parse_protocol_line, serial

try:
    import segno
except ImportError:
    segno = None

APP_NAME = "ESP32 Studio"
APP_VERSION = "1.0.0"
HAS_ESPTOOL = importlib.util.find_spec("esptool") is not None

if getattr(sys, "frozen", False):
    APP_DIR = Path(sys.executable).resolve().parent
else:
    APP_DIR = Path(__file__).resolve().parent
PROJECT_DIR = APP_DIR.parent
SKETCH_DIR = next((d for d in (PROJECT_DIR / "firmware" / "ESP32Studio", APP_DIR / "firmware" / "ESP32Studio")
                   if d.is_dir()), PROJECT_DIR / "firmware" / "ESP32Studio")
FIRMWARE_DIRS = [PROJECT_DIR / "firmware" / "bin", APP_DIR / "firmware" / "bin", APP_DIR / "firmware", APP_DIR]
CONFIG_PATH = Path.home() / ".esp32studio.json"

DEFAULT_CONFIG = {
    "theme": "dark",
    "port": "",
    "baud": 115200,
    "auto_connect": True,
    "auto_reconnect": True,
    "poll_s": 2,
    "timestamps": True,
    "show_protocol": False,
    "toasts": True,
    "line_ending": "LF",
    "flash_baud": 460800,
    "geometry": "1280x820",
    "history": [],
    "watch_pins": [],
    "macros": [
        {"name": "Hilfe", "cmd": "help"},
        {"name": "Info", "cmd": "info"},
        {"name": "WLAN suchen", "cmd": "wifi.scan"},
        {"name": "LED blinken", "cmd": "led blink 5"},
        {"name": "Internet-Test", "cmd": "net.test"},
    ],
}

THEMES = {
    "dark": dict(bg="#0e131d", panel="#131a27", card="#18212f", card2="#222d40", border="#2b3850", fg="#e7ecf5",
                 muted="#8794ab", accent="#3b82f6", accent_hi="#60a5fa", on_accent="#ffffff", ok="#22c55e",
                 warn="#f59e0b", err="#ef4444", info="#38bdf8", sel="#26385a", input="#0b1019", grid="#243047",
                 danger_bg="#4a1d24"),
    "light": dict(bg="#eef1f6", panel="#ffffff", card="#ffffff", card2="#eef2f8", border="#d3dae6", fg="#18202e",
                  muted="#5b677c", accent="#2563eb", accent_hi="#3b82f6", on_accent="#ffffff", ok="#15803d",
                  warn="#b45309", err="#dc2626", info="#0369a1", sel="#dbe7fd", input="#ffffff", grid="#e4e9f1",
                  danger_bg="#fde2e2"),
}

PIN_HINTS = {
    "ESP32": "Gut nutzbar: 4, 5, 13, 14, 16–19, 21–23, 25–27, 32, 33  ·  Nur Eingang: 34–39  ·  "
             "Vorsicht beim Booten: 0, 2, 12, 15  ·  Gesperrt: 1, 3, 6–11",
    "ESP32-S2": "Gut nutzbar: 1–18, 21, 33–42  ·  Vorsicht beim Booten: 0, 45, 46  ·  Gesperrt: 19, 20 (USB), 26–32",
    "ESP32-S3": "Gut nutzbar: 1–18, 21, 38–42, 47, 48  ·  Vorsicht beim Booten: 0, 3, 45, 46  ·  "
                "Gesperrt: 19, 20 (USB), 26–32, 43, 44  ·  35–37 bei Octal-PSRAM belegt",
    "ESP32-C3": "Gut nutzbar: 0–7, 10  ·  Vorsicht beim Booten: 2, 8, 9  ·  Gesperrt: 12–17 (Flash), "
                "18, 19 (USB), 20, 21 (Seriell)",
    "ESP32-C6": "Gut nutzbar: 0–7, 10, 11, 14, 15, 18–23  ·  Vorsicht beim Booten: 8, 9  ·  "
                "Gesperrt: 12, 13 (USB), 16, 17 (Seriell), 24–30",
}
CHIP_DEFAULTS = {  # (ADC-Pin, Touch-Pin, DAC-Pins, I2C SDA, SCL)
    "ESP32": (34, 4, (25, 26), 21, 22),
    "ESP32-S2": (1, 1, (17, 18), 8, 9),
    "ESP32-S3": (1, 1, (), 8, 9),
    "ESP32-C3": (0, None, (), 8, 9),
    "ESP32-C6": (0, None, (), 23, 22),
}

I2C_NAMES = {
    0x0D: "QMC5883L Kompass", 0x1E: "HMC5883L Kompass", 0x20: "PCF8574 / MCP23017 Port-Expander",
    0x23: "BH1750 Lichtsensor", 0x27: "LCD-Display mit PCF8574", 0x29: "VL53L0X / TSL2591 / TCS34725",
    0x38: "AHT10 / AHT20 Temperatur & Feuchte", 0x39: "TSL2561 / APDS-9960", 0x3C: "SSD1306 / SH1106 OLED",
    0x3D: "SSD1306 OLED", 0x3F: "LCD-Display mit PCF8574", 0x40: "INA219 / PCA9685 / HTU21D",
    0x44: "SHT3x / SHT4x Temperatur & Feuchte", 0x48: "ADS1115 / PCF8591 / TMP102", 0x50: "EEPROM (AT24Cxx)",
    0x51: "PCF8563 Echtzeituhr", 0x53: "ADXL345 Beschleunigung", 0x57: "EEPROM / MAX30102 Puls",
    0x5A: "MLX90614 / CCS811", 0x60: "Si5351 / MCP4725", 0x62: "SCD40 / SCD41 CO₂",
    0x68: "MPU6050 / DS3231 / DS1307", 0x69: "MPU6050 (AD0 = 1)", 0x70: "TCA9548A Multiplexer / HT16K33",
    0x76: "BME280 / BMP280 / BME680", 0x77: "BME280 / BMP180 / BME680",
}

FIRMWARE_LABELS = {
    "esp32": "ESP32 (klassisch, z. B. DevKit V1)",
    "esp32s2-usb": "ESP32-S2 (nativer USB-Port)",
    "esp32s3": "ESP32-S3 (USB-UART-Chip, Port „COM“/„UART“)",
    "esp32s3-usb": "ESP32-S3 (nativer USB-Port)",
    "esp32c3": "ESP32-C3 (USB-UART-Chip)",
    "esp32c3-usb": "ESP32-C3 (nativer USB-Port, z. B. SuperMini)",
    "esp32c6-usb": "ESP32-C6 (USB-Port)",
}


# ---------------------------------------------------------------------------
# Hilfsfunktionen
# ---------------------------------------------------------------------------
def load_config() -> dict:
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    try:
        cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass
    if cfg.get("theme") not in THEMES:
        cfg["theme"] = "dark"
    return cfg


def save_config(cfg: dict) -> None:
    try:
        CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def fmt_bytes(n) -> str:
    if n is None:
        return "–"
    n = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if abs(n) < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}".replace(".", ",")
        n /= 1024
    return str(n)


def fmt_uptime(sec) -> str:
    if sec is None:
        return "–"
    sec = int(sec)
    d, rest = divmod(sec, 86400)
    h, rest = divmod(rest, 3600)
    m, s = divmod(rest, 60)
    if d:
        return f"{d} T {h} Std {m} Min"
    if h:
        return f"{h} Std {m} Min"
    if m:
        return f"{m} Min {s} s"
    return f"{s} s"


def fmt_rev(rev) -> str:
    if rev is None:
        return "–"
    rev = int(rev)
    return f"v{rev // 100}.{rev % 100}" if rev >= 100 else f"v{rev}"


def rssi_quality(rssi) -> int:
    if not rssi:
        return 0
    return max(0, min(100, 2 * (int(rssi) + 100)))


def rssi_bars(rssi) -> str:
    q = rssi_quality(rssi)
    n = 4 if q >= 75 else 3 if q >= 50 else 2 if q >= 30 else 1 if q > 0 else 0
    return "▂▄▆█"[:n] + "·" * (4 - n)


def chip_family(model: str) -> str:
    m = (model or "").upper()
    for k in ("ESP32-S2", "ESP32-S3", "ESP32-C3", "ESP32-C6"):
        if k in m:
            return k
    return "ESP32"


def wifi_qr_text(ssid: str, password: str, hidden: bool) -> str:
    def esc(s):
        return re.sub(r'([\\;,:"])', r"\\\1", s)
    kind = "WPA" if password else "nopass"
    text = f"WIFI:T:{kind};S:{esc(ssid)};"
    if password:
        text += f"P:{esc(password)};"
    if hidden:
        text += "H:true;"
    return text + ";"


def open_path(path: Path) -> None:
    try:
        if sys.platform.startswith("win"):
            os.startfile(str(path))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path)])
    except Exception as e:
        messagebox.showerror(APP_NAME, f"Konnte nicht geöffnet werden:\n{e}")


def find_firmware_bins() -> list[Path]:
    seen, out = set(), []
    for d in FIRMWARE_DIRS:
        if d.is_dir():
            for p in sorted(d.glob("esp32studio-*.bin")):
                if p.name not in seen:
                    seen.add(p.name)
                    out.append(p)
    return out


def describe_event(e: dict) -> str:
    t, ev = e.get("type"), e.get("event")
    if t == "hello":
        if (e.get("uptime") or 0) > 5:
            return f"ESP32 meldet sich: {e.get('name')} ({e.get('chip')}), läuft seit {fmt_uptime(e.get('uptime'))}"
        return f"ESP32 gestartet: {e.get('name')} ({e.get('chip')}) – Grund: {e.get('reset')}"
    if t == "wifi" and ev == "connected":
        return f"WLAN verbunden: {e.get('ssid')} – IP {e.get('ip')}"
    if t == "wifi" and ev == "disconnected":
        return f"WLAN getrennt ({e.get('reason_text') or e.get('reason')})"
    if t == "ap" and ev == "join":
        return f"Neues Gerät im Hotspot: {e.get('mac')}"
    if t == "ap" and ev == "leave":
        return f"Gerät hat den Hotspot verlassen: {e.get('mac')}"
    if t == "ap" and ev == "ip":
        return f"Hotspot hat die IP {e.get('ip')} vergeben"
    return json.dumps(e, ensure_ascii=False)


DRIVERS = {
    "10C4": ("CP210x", "https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers"),
    "1A86": ("CH340", "https://www.wch-ic.com/downloads/CH341SER_EXE.html"),
    "0403": ("FTDI", "https://ftdichip.com/drivers/vcp-drivers/"),
}
CH343_PIDS = ("55D2", "55D3", "55D4")
CH343_URL = "https://www.wch-ic.com/downloads/CH343SER_EXE.html"


def open_error_text(e, short=False) -> str:
    """Verständliche Erklärung, warum sich ein Port nicht öffnen lässt."""
    msg = str(e)
    if re.search(r"(Access is denied|Zugriff verweigert|busy|Resource busy|in use|PermissionError\(13)", msg, re.I) \
            and not (sys.platform.startswith("linux") and "Permission denied" in msg):
        return "belegt" if short else ("Der Port wird gerade von einem anderen Programm benutzt. Schließe den "
                                       "Seriellen Monitor der Arduino IDE, PuTTY, Cura o. Ä.")
    if re.search(r"Permission denied", msg, re.I):
        return "keine Berechtigung" if short else ("Keine Berechtigung für den Port. Linux: "
                                                   "sudo usermod -aG dialout $USER und danach neu anmelden.")
    if re.search(r"(FileNotFound|No such file|could not open port|nicht gefunden|cannot find)", msg, re.I):
        return "nicht da" if short else "Der Port ist nicht (mehr) da. Ist der ESP32 noch eingesteckt?"
    return msg[:40] if short else msg


def find_usb_problems() -> list:
    """Sucht USB-Seriell-Chips, die zwar stecken, aber keinen Port haben.

    Gibt eine Liste aus (Chip, Treiber-Link, Erklärung) zurück.
    """
    out = []
    try:
        if sys.platform.startswith("win"):
            ps = ("Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match 'VID_(10C4|1A86|0403)' "
                  "-and $_.Status -ne 'OK' } | ForEach-Object { $_.InstanceId }")
            res = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                                 capture_output=True, text=True, timeout=10, creationflags=0x08000000)
            seen = set()
            for line in res.stdout.splitlines():
                m = re.search(r"VID_([0-9A-F]{4})&PID_([0-9A-F]{4})", line, re.I)
                if not m or (m.group(1).upper(), m.group(2).upper()) in seen:
                    continue
                vid, pid = m.group(1).upper(), m.group(2).upper()
                seen.add((vid, pid))
                name, url = DRIVERS[vid]
                if vid == "1A86" and pid in CH343_PIDS:
                    name, url = "CH9102/CH343", CH343_URL
                out.append((name, url, f"USB-Chip {name} gefunden, aber der Treiber fehlt – darum gibt es keinen "
                                       f"COM-Port. Treiber installieren, dann ESP32 neu einstecken."))
        elif sys.platform.startswith("linux"):
            vids = {"10c4": "CP210x", "1a86": "CH340", "0403": "FTDI", "303a": "ESP32 USB"}
            have_tty = any(Path("/dev").glob("ttyUSB*")) or any(Path("/dev").glob("ttyACM*"))
            for f in Path("/sys/bus/usb/devices").glob("*/idVendor"):
                vid = f.read_text().strip().lower()
                if vid in vids and not have_tty:
                    hint = ("sudo apt remove brltty (klaut CH340-Ports)" if vid == "1a86"
                            else "Kernel-Treiber fehlt oder Kabel lädt nur")
                    out.append((vids[vid], "", f"USB-Chip {vids[vid]} steckt, aber es gibt keinen Port. Tipp: {hint}."))
                    break
    except Exception:
        pass
    return out


def is_garbled(line: str) -> bool:
    """Zeichensalat (falsche Baudrate)?"""
    if not line:
        return False
    bad = sum(1 for c in line if c == "\ufffd" or (ord(c) < 32 and c not in "\t"))
    return bad / len(line) > 0.25


def pick_font(candidates, fallback):
    try:
        fams = set(tkfont.families())
    except tk.TclError:
        return fallback
    for c in candidates:
        if c in fams:
            return c
    return fallback


# ---------------------------------------------------------------------------
# Wiederverwendbare Bausteine
# ---------------------------------------------------------------------------
def autowrap(label, pad=0, reserve=None):
    """Zeilenumbruch an die verfügbare Breite anpassen."""
    def on(e):
        extra = reserve.winfo_reqwidth() + 24 if reserve is not None else 0
        label.configure(wraplength=max(140, e.width - pad - extra))
    label.master.bind("<Configure>", on, add="+")
    return label


def make_card(parent, title=None, sub=None, padding=16):
    f = ttk.Frame(parent, style="Card.TFrame", padding=padding)
    if title:
        ttk.Label(f, text=title, style="CardTitle.TLabel").pack(anchor="w")
    if sub:
        autowrap(ttk.Label(f, text=sub, style="CardMuted.TLabel", wraplength=520, justify="left"), 2 * padding).pack(
            anchor="w", pady=(2, 0))
    body = ttk.Frame(f, style="Card.TFrame")
    body.pack(fill="both", expand=True, pady=(12 if (title or sub) else 0, 0))
    f.body = body
    return f


class ScrollFrame(ttk.Frame):
    """Seite mit senkrechtem Scrollen (Mausrad), Leiste nur wenn nötig."""

    def __init__(self, parent, app):
        super().__init__(parent)
        self.app = app
        self.canvas = tk.Canvas(self, highlightthickness=0, bd=0)
        app.register_raw(self.canvas, "bg")
        self.vsb = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
        self.inner = ttk.Frame(self.canvas, padding=(24, 20))
        self.win = self.canvas.create_window(0, 0, window=self.inner, anchor="nw")
        self.canvas.configure(yscrollcommand=self.vsb.set)
        self.canvas.pack(side="left", fill="both", expand=True)
        self._vsb_shown = False
        self.inner.bind("<Configure>", self._on_inner)
        self.canvas.bind("<Configure>", self._on_canvas)
        self.bind("<Enter>", self._bind_wheel)
        self.bind("<Leave>", self._unbind_wheel)

    def _update_vsb(self):
        need = self.inner.winfo_reqheight() > self.canvas.winfo_height() + 2
        if need and not self._vsb_shown:
            self.vsb.pack(side="right", fill="y")
            self._vsb_shown = True
        elif not need and self._vsb_shown:
            self.vsb.pack_forget()
            self._vsb_shown = False
            self.canvas.yview_moveto(0)

    def _on_inner(self, _e):
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        self._update_vsb()

    def _on_canvas(self, e):
        self.canvas.itemconfigure(self.win, width=e.width)
        self._update_vsb()

    def _bind_wheel(self, _e):
        self.bind_all("<MouseWheel>", self._wheel)
        self.bind_all("<Button-4>", self._wheel)
        self.bind_all("<Button-5>", self._wheel)

    def _unbind_wheel(self, _e):
        self.unbind_all("<MouseWheel>")
        self.unbind_all("<Button-4>")
        self.unbind_all("<Button-5>")

    def _wheel(self, e):
        w = self.winfo_containing(e.x_root, e.y_root)
        if isinstance(w, (tk.Text, tk.Listbox, ttk.Treeview)) or not self._vsb_shown:
            return
        if getattr(e, "num", None) == 4:
            delta = -1
        elif getattr(e, "num", None) == 5:
            delta = 1
        else:
            delta = -1 if e.delta > 0 else 1
            if sys.platform == "darwin":
                delta = -e.delta
        self.canvas.yview_scroll(delta * (1 if sys.platform == "darwin" else 3), "units")


class Flow(ttk.Frame):
    """Reiht Knöpfe nebeneinander und bricht um, wenn der Platz nicht reicht."""

    def __init__(self, parent, style="Card.TFrame", gap=8):
        super().__init__(parent, style=style, height=1)
        self.gap, self.items = gap, []
        self.bind("<Configure>", self._relayout)

    def add(self, widget):
        self.items.append(widget)
        self.after_idle(self._relayout)
        return widget

    def _relayout(self, _e=None):
        width = self.winfo_width()
        if width <= 1:
            return
        x = y = line = 0
        for w in self.items:
            rw, rh = w.winfo_reqwidth(), w.winfo_reqheight()
            if x > 0 and x + rw > width:
                x, y, line = 0, y + line + self.gap, 0
            w.place(x=x, y=y)
            x += rw + self.gap
            line = max(line, rh)
        h = y + line
        if h and int(self.cget("height")) != h:
            self.configure(height=h)


class InfoGrid(ttk.Frame):
    """Schlüssel/Wert-Liste. Klick auf einen Wert kopiert ihn."""

    def __init__(self, parent, app, rows, cols=1):
        super().__init__(parent, style="Card.TFrame")
        self.app = app
        self.vals = {}
        for i, (key, label) in enumerate(rows):
            r, c = divmod(i, cols)
            ttk.Label(self, text=label, style="CardMuted.TLabel").grid(row=r, column=c * 2, sticky="w",
                                                                       padx=(0 if c == 0 else 24, 12), pady=3)
            v = ttk.Label(self, text="–", style="Card.TLabel", cursor="hand2")
            v.grid(row=r, column=c * 2 + 1, sticky="w", pady=3)
            v.bind("<Button-1>", lambda e, w=v: self._copy(w))
            self.vals[key] = v
        for c in range(cols):
            self.columnconfigure(c * 2 + 1, weight=1)

    def _copy(self, w):
        text = w.cget("text")
        if text and text != "–":
            self.app.clipboard_clear()
            self.app.clipboard_append(text)
            self.app.notify(f"Kopiert: {text}")

    def set(self, key, value, style="Card.TLabel"):
        if key in self.vals:
            self.vals[key].configure(text="–" if value in (None, "") else str(value), style=style)

    def clear(self):
        for v in self.vals.values():
            v.configure(text="–", style="Card.TLabel")


class Tile(ttk.Frame):
    def __init__(self, parent, title, progress=False):
        super().__init__(parent, style="Card.TFrame", padding=(16, 14))
        ttk.Label(self, text=title, style="CardMuted.TLabel").pack(anchor="w")
        self.value = ttk.Label(self, text="–", style="Value.TLabel")
        self.value.pack(anchor="w", pady=(2, 0))
        self.sub = ttk.Label(self, text=" ", style="CardMuted.TLabel")
        self.sub.pack(anchor="w")
        self.bar = None
        if progress:
            self.bar = ttk.Progressbar(self, maximum=100, style="Card.Horizontal.TProgressbar")
            self.bar.pack(fill="x", pady=(8, 0))

    def set(self, value, sub=" ", pct=None, style="Value.TLabel"):
        self.value.configure(text=value, style=style)
        self.sub.configure(text=sub or " ")
        if self.bar is not None:
            self.bar["value"] = 0 if pct is None else max(0, min(100, pct))


class LineChart(tk.Canvas):
    def __init__(self, parent, app, title, unit="", color="accent", maxlen=120, fixed=None, height=150,
                 fmt="{:.0f}"):
        super().__init__(parent, height=height, highlightthickness=0, bd=0)
        self.app, self.title, self.unit, self.color, self.fixed, self.fmt = app, title, unit, color, fixed, fmt
        self.data = collections.deque(maxlen=maxlen)
        app.register_raw(self, "chart")
        self.bind("<Configure>", lambda e: self.redraw())

    def add(self, v):
        if v is None:
            return
        self.data.append(float(v))
        self.redraw()

    def clear(self):
        self.data.clear()
        self.redraw()

    def redraw(self):
        t = self.app.theme
        self.configure(bg=t["card"])
        self.delete("all")
        w, h = max(self.winfo_width(), 50), max(self.winfo_height(), 50)
        f_small = (self.app.ui_font, 9)
        self.create_text(4, 2, text=self.title, anchor="nw", fill=t["muted"], font=f_small)
        if self.data:
            self.create_text(w - 4, 0, text=self.fmt.format(self.data[-1]).replace(".", ",") + " " + self.unit,
                             anchor="ne",
                             fill=t["fg"], font=(self.app.ui_font, 11, "bold"))
        top, bottom, left, right = 26, h - 6, 44, w - 6
        if len(self.data) < 2:
            for i in range(4):
                y = top + (bottom - top) * i / 3
                self.create_line(left, y, right, y, fill=t["grid"])
            self.create_text((left + right) / 2, (top + bottom) / 2, text="Warte auf Daten …", fill=t["muted"],
                             font=f_small)
            return
        lo, hi = self.fixed if self.fixed else (min(self.data), max(self.data))
        if hi - lo < 1e-9:
            lo, hi = lo - 1, hi + 1
        if not self.fixed:
            pad = (hi - lo) * 0.15
            lo, hi = lo - pad, hi + pad
        span = hi - lo
        axis_fmt = "{:.0f}" if span >= 10 else "{:.1f}" if span >= 1 else "{:.2f}"
        labels = [axis_fmt.format(v).replace(".", ",") for v in (hi, (hi + lo) / 2, lo)]
        if not hasattr(self, "_font"):
            self._font = tkfont.Font(family=self.app.ui_font, size=9)
        left = max(self._font.measure(x) for x in labels) + 14
        for i in range(4):
            y = top + (bottom - top) * i / 3
            self.create_line(left, y, right, y, fill=t["grid"])
        for i, text in enumerate(labels):
            y = top + (bottom - top) * i / 2
            self.create_text(left - 6, y, text=text, anchor="e", fill=t["muted"], font=f_small)
        n = self.data.maxlen or len(self.data)
        step = (right - left) / max(1, n - 1)
        x0 = right - step * (len(self.data) - 1)
        pts = []
        for i, val in enumerate(self.data):
            pts += [x0 + i * step, bottom - (val - lo) / (hi - lo) * (bottom - top)]
        self.create_line(*pts, fill=t[self.color], width=2, smooth=True)
        self.create_oval(pts[-2] - 3, pts[-1] - 3, pts[-2] + 3, pts[-1] + 3, fill=t[self.color], outline="")


class Dot(tk.Canvas):
    def __init__(self, parent, app, size=12, bg_key="card"):
        super().__init__(parent, width=size, height=size, highlightthickness=0, bd=0)
        self.app, self.size, self.bg_key, self.color = app, size, bg_key, "muted"
        app.register_raw(self, "dot")
        self.redraw()

    def set(self, color_key):
        self.color = color_key
        self.redraw()

    def redraw(self):
        t = self.app.theme
        self.configure(bg=t[self.bg_key])
        self.delete("all")
        self.create_oval(1, 1, self.size - 1, self.size - 1, fill=t[self.color], outline="")


class FormDialog(tk.Toplevel):
    """Kleiner Dialog im App-Design. fields: [(key, label, initial, show)]"""

    def __init__(self, app, title, fields, ok_text="OK", message=None):
        super().__init__(app)
        self.app, self.result = app, None
        self.title(title)
        self.configure(bg=app.theme["card"])
        self.transient(app)
        self.resizable(False, False)
        f = ttk.Frame(self, style="Card.TFrame", padding=20)
        f.pack(fill="both", expand=True)
        ttk.Label(f, text=title, style="CardTitle.TLabel").grid(row=0, column=0, columnspan=2, sticky="w")
        row = 1
        if message:
            ttk.Label(f, text=message, style="CardMuted.TLabel", wraplength=360, justify="left").grid(
                row=row, column=0, columnspan=2, sticky="w", pady=(4, 0))
            row += 1
        self.vars = {}
        first = None
        for key, label, initial, show in fields:
            ttk.Label(f, text=label, style="Card.TLabel").grid(row=row, column=0, sticky="w", pady=(12, 0))
            var = tk.StringVar(value=str(initial))
            e = ttk.Entry(f, textvariable=var, width=36, show=show or "")
            e.grid(row=row + 1, column=0, columnspan=2, sticky="we", pady=(4, 0))
            first = first or e
            self.vars[key] = var
            row += 2
        btns = ttk.Frame(f, style="Card.TFrame")
        btns.grid(row=row, column=0, columnspan=2, sticky="e", pady=(18, 0))
        ttk.Button(btns, text="Abbrechen", command=self.destroy).pack(side="right")
        ttk.Button(btns, text=ok_text, style="Accent.TButton", command=self._ok).pack(side="right", padx=(0, 8))
        self.bind("<Return>", lambda e: self._ok())
        self.bind("<Escape>", lambda e: self.destroy())
        self.update_idletasks()
        x = app.winfo_rootx() + (app.winfo_width() - self.winfo_width()) // 2
        y = app.winfo_rooty() + (app.winfo_height() - self.winfo_height()) // 3
        self.geometry(f"+{max(0, x)}+{max(0, y)}")
        if first:
            first.focus_set()
            first.select_range(0, "end")
        try:
            self.grab_set()
        except tk.TclError:
            pass
        self.wait_window()

    def _ok(self):
        self.result = {k: v.get() for k, v in self.vars.items()}
        self.destroy()


class NoDeviceDialog(tk.Toplevel):
    """Hilfe, wenn kein ESP32 gefunden wird. Verbindet automatisch, sobald einer auftaucht."""

    def __init__(self, app):
        super().__init__(app)
        self.app = app
        self.title("Kein ESP32 gefunden")
        self.configure(bg=app.theme["card"])
        self.transient(app)
        self.resizable(False, False)
        f = ttk.Frame(self, style="Card.TFrame", padding=22)
        f.pack(fill="both", expand=True)
        ttk.Label(f, text="Kein ESP32 gefunden", style="H1.TLabel").pack(anchor="w")
        ttk.Label(f, text="Sobald einer auftaucht, verbindet sich die App von selbst.", style="CardMuted.TLabel").pack(
            anchor="w", pady=(2, 14))
        steps = [
            "1.  Den ESP32 mit einem Datenkabel anschließen – viele USB-Kabel können nur laden.",
            "2.  Treiber für den USB-Chip auf dem Board installieren (steht meist neben dem USB-Anschluss):",
        ]
        for text in steps:
            ttk.Label(f, text=text, style="Card.TLabel", wraplength=520, justify="left").pack(anchor="w", pady=2)
        drv = ttk.Frame(f, style="Card.TFrame")
        drv.pack(anchor="w", padx=(22, 0), pady=(4, 6))
        for name, url in (("CP210x", DRIVERS["10C4"][1]), ("CH340", DRIVERS["1A86"][1]), ("CH9102 / CH343", CH343_URL)):
            ttk.Button(drv, text=f"Treiber {name}", command=lambda u=url: webbrowser.open(u)).pack(side="left", padx=(0, 6))
        for text in (
            "3.  Einen anderen USB-Anschluss probieren. Leuchtet eine LED auf dem Board?",
            "4.  ESP32-S2/S3/C3 ohne extra USB-Chip: BOOT-Taste halten, einstecken, loslassen.",
        ):
            ttk.Label(f, text=text, style="Card.TLabel", wraplength=520, justify="left").pack(anchor="w", pady=2)
        if sys.platform.startswith("linux"):
            ttk.Label(f, text="Linux: sudo usermod -aG dialout $USER (danach neu anmelden). Verschwindet ein CH340 "
                              "sofort wieder: sudo apt remove brltty", style="CardMuted.TLabel", wraplength=520,
                      justify="left").pack(anchor="w", pady=(6, 0))
        self.status = ttk.Label(f, text="Suche …", style="CardMuted.TLabel", wraplength=520, justify="left")
        self.status.pack(anchor="w", pady=(14, 0))
        self.fix = ttk.Frame(f, style="Card.TFrame")
        self.fix.pack(anchor="w")
        btns = ttk.Frame(f, style="Card.TFrame")
        btns.pack(fill="x", pady=(18, 0))
        ttk.Button(btns, text="Schließen", command=self.destroy).pack(side="right")
        ttk.Button(btns, text="Demo ausprobieren", command=self._demo).pack(side="right", padx=8)
        ttk.Button(btns, text="Erneut suchen", style="Accent.TButton", command=self._scan).pack(side="right")
        self.bind("<Escape>", lambda e: self.destroy())
        self.update_idletasks()
        x = app.winfo_rootx() + (app.winfo_width() - self.winfo_width()) // 2
        y = app.winfo_rooty() + (app.winfo_height() - self.winfo_height()) // 3
        self.geometry(f"+{max(0, x)}+{max(0, y)}")
        self._scan()
        self.after(1500, self._poll)

    def _demo(self):
        self.destroy()
        self.app.start_demo()

    def _found(self):
        esp = [p for p in self.app.port_infos if p.likely_esp]
        if esp and self.app.state == "off":
            self.destroy()
            self.app.notify(f"ESP32 gefunden: {esp[0].label}", "ok")
            self.app.connect(esp[0])
            return True
        return False

    def _scan(self):
        self.app.refresh_ports()
        if self._found():
            return
        others = [p.device for p in self.app.port_infos if p.device and p.device != DEMO_PORT]
        self.status.configure(text=("Andere Ports: " + ", ".join(others) + " – oben in der Liste wählen, falls einer "
                                    "davon der ESP32 ist.") if others else "Noch kein passender USB-Port da …")
        self.app.check_usb_problems(self._show_problems)

    def _show_problems(self, found):
        if not self.winfo_exists():
            return
        for w in self.fix.winfo_children():
            w.destroy()
        for name, url, text in found:
            ttk.Label(self.fix, text="⚠ " + text, style="Warn.TLabel", wraplength=520, justify="left").pack(
                anchor="w", pady=(8, 2))
            if url:
                ttk.Button(self.fix, text=f"Treiber {name} herunterladen", style="Accent.TButton",
                           command=lambda u=url: webbrowser.open(u)).pack(anchor="w")

    def _poll(self):
        if not self.winfo_exists():
            return
        self.app.refresh_ports()
        if not self._found():
            self.after(1500, self._poll)


def ask_string(app, title, label, initial="", message=None):
    d = FormDialog(app, title, [("v", label, initial, None)], message=message)
    return None if d.result is None else d.result["v"]


# ---------------------------------------------------------------------------
# Seiten
# ---------------------------------------------------------------------------
class Page(ttk.Frame):
    title = ""
    subtitle = ""
    scroll = True

    def __init__(self, master, app):
        super().__init__(master)
        self.app = app
        if self.scroll:
            self.sf = ScrollFrame(self, app)
            self.sf.pack(fill="both", expand=True)
            self.body = self.sf.inner
        else:
            self.body = ttk.Frame(self, padding=(24, 20))
            self.body.pack(fill="both", expand=True)
        head = ttk.Frame(self.body)
        head.pack(fill="x", pady=(0, 16))
        ttk.Label(head, text=self.title, style="PageTitle.TLabel").pack(anchor="w")
        if self.subtitle:
            ttk.Label(head, text=self.subtitle, style="Muted.TLabel").pack(anchor="w", pady=(2, 0))
        self.content = ttk.Frame(self.body)
        self.content.pack(fill="both", expand=True)
        self.build(self.content)

    def build(self, f):
        pass

    def on_show(self):
        pass

    def on_info(self, d):
        pass

    def on_stats(self, s):
        pass

    def on_event(self, e):
        pass

    def on_connection(self):
        pass

    def tick(self, now):
        pass

    @property
    def visible(self):
        return self.app.current_page is self


class DashboardPage(Page):
    title = "Übersicht"
    subtitle = "Alles Wichtige zu deinem ESP32 auf einen Blick"

    def build(self, f):
        f.columnconfigure(0, weight=1)
        top = make_card(f, padding=20)
        top.grid(row=0, column=0, sticky="we")
        b = top.body
        b.columnconfigure(0, weight=1)
        self.name_lbl = ttk.Label(b, text="Kein ESP32 verbunden", style="H1.TLabel")
        self.name_lbl.grid(row=0, column=0, sticky="w")
        self.sub_lbl = ttk.Label(b, text="", style="CardMuted.TLabel", wraplength=700, justify="left")
        self.sub_lbl.grid(row=1, column=0, sticky="w", pady=(4, 0))
        self.cta = ttk.Frame(b, style="Card.TFrame")
        self.cta.grid(row=0, column=1, rowspan=2, sticky="e")
        autowrap(self.sub_lbl, reserve=self.cta)
        self.actions = Flow(b)
        self.actions.grid(row=2, column=0, columnspan=2, sticky="we", pady=(16, 0))
        a = self.app
        for text, cmd, style in (
            ("⟳  Neustart", lambda: a.cmd("restart", ok=lambda d: a.notify("ESP32 startet neu …")), "Accent.TButton"),
            ("Hard-Reset", a.hard_reset, "TButton"),
            ("Bootloader-Modus", a.enter_bootloader, "TButton"),
            ("Deep-Sleep …", self._sleep, "TButton"),
            ("LED an/aus", lambda: a.cmd("led", "toggle", ok=lambda d: a.notify(
                "LED ist jetzt " + ("an" if d.get("led") else "aus"))), "TButton"),
            ("LED blinken", lambda: a.cmd("led", "blink", 5), "TButton"),
            ("Umbenennen …", a.rename_device, "TButton"),
            ("Aktualisieren", a.refresh_info, "TButton"),
        ):
            self.actions.add(ttk.Button(self.actions, text=text, style=style, command=cmd))

        tiles = ttk.Frame(f)
        tiles.grid(row=1, column=0, sticky="we", pady=(14, 0))
        self.tiles = {}
        specs = [("heap", "Freier Arbeitsspeicher", True), ("uptime", "Laufzeit", False),
                 ("temp", "Chip-Temperatur", False), ("cpu", "Prozessor", False),
                 ("wifi", "WLAN", False), ("rssi", "Signalstärke", True),
                 ("ap", "Hotspot", False), ("flash", "Flash (Programm)", True)]
        for i, (key, title, prog) in enumerate(specs):
            t = Tile(tiles, title, prog)
            t.grid(row=i // 4, column=i % 4, sticky="nsew", padx=(0 if i % 4 == 0 else 10, 0), pady=(0, 10))
            self.tiles[key] = t
        for c in range(4):
            tiles.columnconfigure(c, weight=1, uniform="tiles")

        charts = ttk.Frame(f)
        charts.grid(row=2, column=0, sticky="we", pady=(4, 0))
        made = []
        for i, (title, unit, color, fmt) in enumerate((("Freier Speicher (KB)", "KB", "accent", "{:.0f}"),
                                                       ("WLAN-Signal (dBm)", "dBm", "ok", "{:.0f}"),
                                                       ("Temperatur (°C)", "°C", "warn", "{:.1f}"))):
            c = make_card(charts, padding=12)
            c.grid(row=0, column=i, sticky="nsew", padx=(0 if i == 0 else 10, 0))
            ch = LineChart(c.body, a, title, unit, color, fmt=fmt)
            ch.pack(fill="both", expand=True)
            made.append(ch)
            charts.columnconfigure(i, weight=1, uniform="charts")
        self.ch_heap, self.ch_rssi, self.ch_temp = made

        det = make_card(f, "Details", "Klick auf einen Wert kopiert ihn in die Zwischenablage.")
        det.grid(row=3, column=0, sticky="we", pady=(14, 0))
        self.grid_info = InfoGrid(det.body, a, [
            ("model", "Chip"), ("rev", "Revision"), ("cores", "Kerne"), ("mac", "MAC-Adresse"),
            ("flash", "Flash-Größe"), ("flash_speed", "Flash-Takt"), ("psram", "PSRAM"), ("heap_size", "Heap gesamt"),
            ("heap_min", "Heap-Minimum"), ("max_alloc", "Größter freier Block"), ("sketch", "Programmgröße"),
            ("reset", "Letzter Neustart"), ("sdk", "ESP-IDF"), ("core", "Arduino-Core"), ("fw", "Studio-Firmware"),
            ("led_pin", "LED-Pin"), ("hostname", "Hostname"), ("port", "Port"),
        ], cols=3)
        self.grid_info.pack(fill="x")
        self.on_connection()

    def _sleep(self):
        v = ask_string(self.app, "Deep-Sleep", "Wie viele Sekunden soll der ESP32 schlafen?", "10",
                       "Im Deep-Sleep ist der ESP32 nicht erreichbar. Danach startet er neu.")
        if v:
            try:
                sec = int(v)
            except ValueError:
                self.app.notify("Bitte eine Zahl eingeben", "err")
                return
            self.app.cmd("sleep", sec, ok=lambda d: self.app.notify(f"ESP32 schläft {sec} s"))

    def _set_cta(self, buttons):
        for w in self.cta.winfo_children():
            w.destroy()
        for text, cmd, style in buttons:
            ttk.Button(self.cta, text=text, command=cmd, style=style).pack(side="left", padx=(8, 0))

    def on_connection(self):
        a = self.app
        key = (a.state, bool(a.fw), a.handshaking, a.wait_reason, any(p.likely_esp for p in a.port_infos))
        if key == getattr(self, "_conn_key", None):
            return
        self._conn_key = key
        if a.state == "off":
            if key[4]:
                self.name_lbl.configure(text="ESP32 gefunden – bereit zum Verbinden")
                self.sub_lbl.configure(text="Klick auf »Verbinden«. Ohne Hardware kannst du alles mit dem Demo-Gerät "
                                            "ausprobieren.")
            else:
                self.name_lbl.configure(text="Kein ESP32 verbunden")
                self.sub_lbl.configure(text="Schließe deinen ESP32 per USB-Kabel an – die App verbindet sich dann "
                                            "von selbst. Ohne Hardware kannst du alles mit dem Demo-Gerät ausprobieren.")
            self._set_cta(([] if key[4] else [("Hilfe zur Verbindung", a.show_no_device, "TButton")]) +
                          [("Demo ausprobieren", a.start_demo, "TButton"), ("Verbinden", a.connect, "Accent.TButton")])
        elif a.state == "waiting":
            self.name_lbl.configure(text="Warte auf den ESP32 …")
            why = {"belegt": "Der Port ist gerade von einem anderen Programm belegt (Arduino IDE?). ",
                   "keine Berechtigung": "Keine Berechtigung für den Port. "}.get(a.wait_reason, "")
            self.sub_lbl.configure(text=why + "Sobald der Port frei ist bzw. der ESP32 wieder da ist, verbindet sich "
                                              "die App automatisch.")
            self._set_cta([("Abbrechen", a.disconnect, "TButton")])
        elif not a.fw:
            self.name_lbl.configure(text="Verbunden – suche Studio-Firmware …" if a.handshaking
                                    else "Verbunden, aber keine Studio-Firmware")
            self.sub_lbl.configure(text="Der serielle Monitor funktioniert schon. Für alle anderen Funktionen braucht "
                                        "der ESP32 einmalig die Studio-Firmware – das geht mit einem Klick.")
            self._set_cta([] if a.handshaking else [("Erneut prüfen", a.start_handshake, "TButton"),
                                                    ("Firmware installieren", a.quick_install, "Accent.TButton")])
        else:
            self._set_cta([])
        if a.fw:
            self.actions.grid()
        else:
            self.actions.grid_remove()
        if not a.fw:
            for t in self.tiles.values():
                t.set("–")
            self.grid_info.clear()
            self.grid_info.set("port", a.link.port if a.link.is_open else None)
            for ch in (self.ch_heap, self.ch_rssi, self.ch_temp):
                ch.clear()

    def on_info(self, d):
        chip, mem, fl, sy = d.get("chip", {}), d.get("mem", {}), d.get("flash", {}), d.get("sys", {})
        self.name_lbl.configure(text=d.get("name", "ESP32"))
        demo = "  ·  Demo-Gerät" if self.app.link.is_demo else ""
        self.sub_lbl.configure(text=f"{chip.get('model', '?')}  ·  {chip.get('cores', '?')} Kerne  ·  "
                                    f"{chip.get('mhz', '?')} MHz  ·  Studio-Firmware {d.get('version', '?')}{demo}")
        g = self.grid_info
        g.set("model", chip.get("model"))
        g.set("rev", fmt_rev(chip.get("rev")))
        g.set("cores", chip.get("cores"))
        g.set("mac", chip.get("mac"))
        g.set("flash", fmt_bytes(fl.get("size")))
        g.set("flash_speed", f"{fl.get('speed', 0) // 1_000_000} MHz" if fl.get("speed") else None)
        g.set("psram", fmt_bytes(mem.get("psram_size")) if mem.get("psram_size") else "keins")
        g.set("heap_size", fmt_bytes(mem.get("heap_size")))
        g.set("heap_min", fmt_bytes(mem.get("heap_min")))
        g.set("max_alloc", fmt_bytes(mem.get("heap_max_alloc")))
        g.set("sketch", fmt_bytes(fl.get("sketch")))
        g.set("reset", sy.get("reset"))
        g.set("sdk", chip.get("sdk"))
        g.set("core", chip.get("core"))
        g.set("fw", d.get("version"))
        g.set("led_pin", sy.get("led_pin"))
        g.set("hostname", d.get("wifi", {}).get("hostname"))
        g.set("port", self.app.link.port)
        sk, free = fl.get("sketch") or 0, fl.get("sketch_free") or 0
        if sk:
            self.tiles["flash"].set(fmt_bytes(sk), f"von {fmt_bytes(sk + free)} belegt",
                                    sk / max(1, sk + free) * 100)
        self.on_stats({**sy, "heap_free": mem.get("heap_free"), "heap_size": mem.get("heap_size"),
                       "cpu_mhz": chip.get("mhz"), **self._wifi_stats(d)}, chart=False)

    @staticmethod
    def _wifi_stats(d):
        w, ap = d.get("wifi", {}), d.get("ap", {})
        return {"sta": w.get("status"), "rssi": w.get("rssi", 0), "ip": w.get("ip", ""), "ap_on": ap.get("on"),
                "ap_clients": ap.get("clients", 0), "ssid": w.get("ssid")}

    def on_stats(self, s, chart=True):
        t = self.tiles
        hf, hs = s.get("heap_free"), s.get("heap_size")
        if hf is not None:
            t["heap"].set(fmt_bytes(hf), f"von {fmt_bytes(hs)}" if hs else " ", hf / hs * 100 if hs else None)
        if s.get("uptime") is not None:
            t["uptime"].set(fmt_uptime(s.get("uptime")))
        temp = s.get("temp")
        if temp is not None:
            st = "Value.TLabel" if temp < 65 else "ValueWarn.TLabel" if temp < 80 else "ValueErr.TLabel"
            t["temp"].set(f"{temp:.1f} °C".replace(".", ","), "grober Schätzwert", style=st)
        if s.get("cpu_mhz"):
            t["cpu"].set(f"{s['cpu_mhz']} MHz")
        sta = s.get("sta")
        if sta == "connected":
            ssid = s.get("ssid") or self.app.info.get("wifi", {}).get("ssid", "")
            t["wifi"].set("Verbunden", f"{ssid}  ·  {s.get('ip')}", style="ValueOk.TLabel")
            rssi = s.get("rssi", 0)
            t["rssi"].set(f"{rssi} dBm", f"{rssi_bars(rssi)}  {rssi_quality(rssi)} %", rssi_quality(rssi))
        elif sta is not None:
            t["wifi"].set("Getrennt" if sta != "off" else "Aus", "→ Bereich WLAN")
            t["rssi"].set("–", " ", 0)
        if s.get("ap_on") is not None:
            if s.get("ap_on"):
                n = s.get("ap_clients", 0)
                t["ap"].set("An", f"{n} Gerät{'e' if n != 1 else ''} verbunden", style="ValueOk.TLabel")
            else:
                t["ap"].set("Aus", "→ Bereich Hotspot")
        if chart:
            if hf is not None:
                self.ch_heap.add(hf / 1024)
            if sta == "connected":
                self.ch_rssi.add(s.get("rssi"))
            if temp is not None:
                self.ch_temp.add(temp)


class WifiPage(Page):
    title = "WLAN"
    subtitle = "Netzwerke suchen, verbinden und die Web-Oberfläche des ESP32 einschalten"

    def build(self, f):
        a = self.app
        f.columnconfigure(0, weight=3, uniform="cols")
        f.columnconfigure(1, weight=2, uniform="cols")
        left = make_card(f, "Netzwerke in der Nähe", "Doppelklick auf ein Netz übernimmt es zum Verbinden.")
        left.grid(row=0, column=0, rowspan=3, sticky="nsew", padx=(0, 14))
        bar = ttk.Frame(left.body, style="Card.TFrame")
        bar.pack(fill="x")
        self.scan_btn = ttk.Button(bar, text="Netzwerke suchen", style="Accent.TButton", command=self.scan)
        self.scan_btn.pack(side="left")
        self.scan_lbl = ttk.Label(bar, text="", style="CardMuted.TLabel")
        self.scan_lbl.pack(side="left", padx=12)
        cols = ("ssid", "signal", "rssi", "ch", "auth")
        self.tree = ttk.Treeview(left.body, columns=cols, show="headings", height=11, selectmode="browse")
        for c, text, w, anchor in (("ssid", "Netzwerk", 210, "w"), ("signal", "Signal", 70, "w"),
                                   ("rssi", "dBm", 55, "e"), ("ch", "Kanal", 55, "center"),
                                   ("auth", "Sicherheit", 110, "w")):
            self.tree.heading(c, text=text, command=lambda c=c: self._sort(c))
            self.tree.column(c, width=w, anchor=anchor, stretch=(c == "ssid"))
        self.tree.pack(fill="both", expand=True, pady=(10, 0))
        self.tree.bind("<Double-1>", self._pick)
        self.tree.bind("<<TreeviewSelect>>", lambda e: self._pick(None, fill_only=True))
        ttk.Label(left.body, text="Kanalbelegung (2,4 GHz)", style="CardMuted.TLabel").pack(anchor="w", pady=(12, 0))
        self.chan = tk.Canvas(left.body, height=110, highlightthickness=0, bd=0)
        a.register_raw(self.chan, "cardbg")
        self.chan.pack(fill="x", pady=(4, 0))
        self.chan.bind("<Configure>", lambda e: self._draw_channels())
        self.networks = []
        self._sort_key, self._sort_rev = "rssi", True

        con = make_card(f, "Verbinden")
        con.grid(row=0, column=1, sticky="nsew")
        b = con.body
        b.columnconfigure(0, weight=1)
        ttk.Label(b, text="Netzwerk (SSID)", style="Card.TLabel").grid(row=0, column=0, sticky="w")
        self.ssid = tk.StringVar()
        ttk.Entry(b, textvariable=self.ssid).grid(row=1, column=0, columnspan=2, sticky="we", pady=(4, 8))
        ttk.Label(b, text="Passwort", style="Card.TLabel").grid(row=2, column=0, sticky="w")
        self.pw = tk.StringVar()
        self.pw_entry = ttk.Entry(b, textvariable=self.pw, show="•")
        self.pw_entry.grid(row=3, column=0, sticky="we", pady=(4, 0))
        self.show_pw = tk.BooleanVar()
        ttk.Checkbutton(b, text="zeigen", variable=self.show_pw, style="Card.TCheckbutton",
                        command=lambda: self.pw_entry.configure(show="" if self.show_pw.get() else "•")).grid(
            row=3, column=1, padx=(8, 0))
        self.save = tk.BooleanVar(value=True)
        ttk.Checkbutton(b, text="Merken – beim Start automatisch verbinden", variable=self.save,
                        style="Card.TCheckbutton").grid(row=4, column=0, columnspan=2, sticky="w", pady=(10, 0))
        btns = ttk.Frame(b, style="Card.TFrame")
        btns.grid(row=5, column=0, columnspan=2, sticky="w", pady=(12, 0))
        self.con_btn = ttk.Button(btns, text="Verbinden", style="Accent.TButton", command=self.connect)
        self.con_btn.pack(side="left")
        ttk.Button(btns, text="Trennen", command=lambda: a.cmd("wifi.disconnect", ok=lambda d: (
            a.notify("WLAN getrennt"), a.refresh_info()))).pack(side="left", padx=8)
        ttk.Button(btns, text="Vergessen", command=self.forget).pack(side="left")
        self.con_bar = ttk.Progressbar(b, mode="indeterminate", style="Card.Horizontal.TProgressbar")
        self.con_msg = ttk.Label(b, text="", style="CardMuted.TLabel", wraplength=380, justify="left")
        autowrap(self.con_msg)
        self.con_msg.grid(row=7, column=0, columnspan=2, sticky="w", pady=(8, 0))
        self.pw_entry.bind("<Return>", lambda e: self.connect())

        st = make_card(f, "Verbindung")
        st.grid(row=1, column=1, sticky="nsew", pady=14)
        self.info = InfoGrid(st.body, a, [("status", "Status"), ("ssid", "Netzwerk"), ("ip", "IP-Adresse"),
                                          ("gateway", "Router"), ("subnet", "Subnetz"), ("dns", "DNS"),
                                          ("rssi", "Signal"), ("channel", "Kanal"), ("bssid", "BSSID"),
                                          ("mac", "MAC (WLAN)"), ("hostname", "Hostname"), ("saved", "Gespeichert")])
        self.info.pack(fill="x")
        row = ttk.Frame(st.body, style="Card.TFrame")
        row.pack(fill="x", pady=(12, 0))
        ttk.Button(row, text="Internet testen", command=self.net_test).pack(side="left")
        ttk.Button(row, text="Hostname ändern …", command=self.hostname).pack(side="left", padx=8)
        self.test_lbl = ttk.Label(st.body, text="", style="CardMuted.TLabel", wraplength=380, justify="left")
        autowrap(self.test_lbl)
        self.test_lbl.pack(anchor="w", pady=(8, 0))

        web = make_card(f, "Web-Oberfläche auf dem ESP32",
                        "Eine kleine Webseite direkt vom ESP32 – im Heimnetz oder über den Hotspot erreichbar. "
                        "Ohne Passwort, also nur im eigenen Netz einschalten.")
        web.grid(row=2, column=1, sticky="nsew")
        self.web_lbl = ttk.Label(web.body, text="Aus", style="Card.TLabel")
        self.web_lbl.pack(anchor="w")
        self.web_url = ttk.Label(web.body, text="", style="Link.TLabel", cursor="hand2")
        self.web_url.pack(anchor="w", pady=(2, 0))
        self.web_url.bind("<Button-1>", lambda e: self.open_web())
        self.web_mdns = ttk.Label(web.body, text="", style="CardMuted.TLabel")
        self.web_mdns.pack(anchor="w")
        row = ttk.Frame(web.body, style="Card.TFrame")
        row.pack(fill="x", pady=(10, 0))
        ttk.Button(row, text="Einschalten", style="Accent.TButton", command=lambda: a.cmd(
            "web.start", 1, ok=lambda d: (a.notify("Web-Oberfläche ist an"), a.refresh_info()))).pack(side="left")
        ttk.Button(row, text="Ausschalten", command=lambda: a.cmd(
            "web.stop", ok=lambda d: (a.notify("Web-Oberfläche ist aus"), a.refresh_info()))).pack(side="left", padx=8)
        ttk.Button(row, text="Im Browser öffnen", command=self.open_web).pack(side="left")
        self._web_url = ""

    # -- Aktionen --
    def scan(self):
        self.scan_btn.state(["disabled"])
        self.scan_lbl.configure(text="Suche läuft …")
        self.app.cmd("wifi.scan", ok=self._scanned, err=self._scan_err, timeout=20)

    def _scan_err(self, msg):
        self.scan_btn.state(["!disabled"])
        self.scan_lbl.configure(text=msg)

    def _scanned(self, d):
        self.scan_btn.state(["!disabled"])
        self.networks = d.get("networks", [])
        self.app.last_scan = self.networks
        self.scan_lbl.configure(text=f"{len(self.networks)} Netzwerke gefunden  ·  {time.strftime('%H:%M:%S')}")
        self._fill()
        self._draw_channels()

    def _fill(self):
        self.tree.delete(*self.tree.get_children())
        key = {"ssid": lambda n: n.get("ssid", "").lower(), "signal": lambda n: n.get("rssi", -100),
               "rssi": lambda n: n.get("rssi", -100), "ch": lambda n: n.get("channel", 0),
               "auth": lambda n: n.get("auth", "")}[self._sort_key]
        t = self.app.theme
        self.tree.tag_configure("strong", foreground=t["ok"])
        self.tree.tag_configure("weak", foreground=t["muted"])
        for i, n in enumerate(sorted(self.networks, key=key, reverse=self._sort_rev)):
            rssi = n.get("rssi", -100)
            tag = "strong" if rssi >= -60 else "weak" if rssi < -78 else ""
            ssid = n.get("ssid") or "(verstecktes Netz)"
            self.tree.insert("", "end", iid=str(i), values=(ssid, rssi_bars(rssi), rssi, n.get("channel"),
                                                            n.get("auth")), tags=(tag,))

    def _sort(self, col):
        if self._sort_key == col:
            self._sort_rev = not self._sort_rev
        else:
            self._sort_key, self._sort_rev = col, col in ("signal", "rssi")
        self._fill()

    def _pick(self, _e, fill_only=False):
        sel = self.tree.selection()
        if not sel:
            return
        vals = self.tree.item(sel[0], "values")
        ssid = vals[0]
        if ssid == "(verstecktes Netz)":
            ssid = ""
        self.ssid.set(ssid)
        if not fill_only:
            self.pw_entry.focus_set()
            if vals[4] == "offen":
                self.pw.set("")

    def _draw_channels(self):
        c, t = self.chan, self.app.theme
        c.delete("all")
        w, h = max(c.winfo_width(), 100), max(c.winfo_height(), 60)
        load = [0.0] * 14
        for n in self.networks:
            ch = n.get("channel", 0)
            if 1 <= ch <= 13:
                strength = rssi_quality(n.get("rssi", -100)) / 100
                for k in range(max(1, ch - 2), min(13, ch + 2) + 1):  # Kanäle überlappen
                    load[k] += strength * (1 if k == ch else 0.5)
        top = max(load[1:]) or 1
        free = min(range(1, 14), key=lambda k: (load[k], abs(k - 6))) if self.networks else None
        bw = (w - 10) / 13
        for k in range(1, 14):
            x0 = 5 + (k - 1) * bw + 3
            x1 = x0 + bw - 6
            bh = (h - 24) * load[k] / top
            color = t["ok"] if k == free else t["accent"] if k in (1, 6, 11) else t["card2"]
            c.create_rectangle(x0, h - 18 - bh, x1, h - 18, fill=color, outline="")
            c.create_text((x0 + x1) / 2, h - 8, text=str(k), fill=t["muted"], font=(self.app.ui_font, 9))
        if free:
            c.create_text(w - 5, 4, anchor="ne", text=f"Am freiesten: Kanal {free}", fill=t["ok"],
                          font=(self.app.ui_font, 9, "bold"))
        elif not self.networks:
            c.create_text(w / 2, h / 2 - 8, text="Erst nach Netzwerken suchen", fill=t["muted"],
                          font=(self.app.ui_font, 9))

    def connect(self):
        ssid = self.ssid.get().strip()
        if not ssid:
            self.app.notify("Bitte zuerst ein Netzwerk eintragen oder auswählen", "warn")
            return
        self.con_btn.state(["disabled"])
        self.con_bar.grid(row=6, column=0, columnspan=2, sticky="we", pady=(10, 0))
        self.con_bar.start(12)
        self.con_msg.configure(text=f"Verbinde mit „{ssid}“ … (bis zu 20 Sekunden)", style="CardMuted.TLabel")
        self.app.cmd("wifi.connect", ssid, self.pw.get(), 1 if self.save.get() else 0,
                     ok=self._connected, err=self._con_err, timeout=30)

    def _con_done(self):
        self.con_btn.state(["!disabled"])
        self.con_bar.stop()
        self.con_bar.grid_remove()

    def _connected(self, d):
        self._con_done()
        w = d.get("wifi", {})
        self.con_msg.configure(text=f"✓ Verbunden mit „{w.get('ssid')}“ – IP {w.get('ip')}"
                                    + ("  (gespeichert)" if d.get("saved") else ""), style="Ok.TLabel")
        self.app.refresh_info()

    def _con_err(self, msg):
        self._con_done()
        self.con_msg.configure(text="✗ " + msg, style="Err.TLabel")

    def forget(self):
        if messagebox.askyesno(APP_NAME, "Gespeichertes WLAN auf dem ESP32 vergessen?\n"
                                         "Die aktuelle Verbindung bleibt bis zum Neustart bestehen."):
            self.app.cmd("wifi.forget", ok=lambda d: (self.app.notify("Gespeichertes WLAN gelöscht"),
                                                     self.app.refresh_info()))

    def net_test(self):
        self.test_lbl.configure(text="Teste Internet …", style="CardMuted.TLabel")

        def ok(d):
            self.test_lbl.configure(text=f"✓ Internet geht. DNS {d.get('dns_ms')} ms  ·  Verbindung "
                                         f"{d.get('tcp_ms')} ms  ·  {d.get('http', '')}", style="Ok.TLabel")

        self.app.cmd("net.test", ok=ok, err=lambda m: self.test_lbl.configure(text="✗ " + m, style="Err.TLabel"),
                     timeout=15)

    def hostname(self):
        cur = self.app.info.get("wifi", {}).get("hostname", "")
        v = ask_string(self.app, "Hostname", "Neuer Hostname (nur a–z, 0–9 und -)", cur,
                       "Unter diesem Namen erscheint der ESP32 im Router und als name.local im Browser.")
        if v:
            self.app.cmd("wifi.hostname", v.strip(), ok=lambda d: (self.app.notify(
                f"Hostname: {d.get('hostname')} (wirkt beim nächsten Verbinden)"), self.app.refresh_info()))

    def open_web(self):
        if self._web_url:
            webbrowser.open(self._web_url)
        else:
            self.app.notify("Web-Oberfläche ist aus oder der ESP32 hat noch keine IP", "warn")

    def on_connection(self):
        if not self.app.fw:
            self.info.clear()
            self.web_lbl.configure(text="–")
            self.web_url.configure(text="")
            self.web_mdns.configure(text="")
            self._web_url = ""

    def on_info(self, d):
        w, web = d.get("wifi", {}), d.get("web", {})
        g = self.info
        status = {"connected": ("Verbunden", "Ok.TLabel"), "disconnected": ("Nicht verbunden", "Card.TLabel"),
                  "idle": ("Bereit", "Card.TLabel"), "off": ("Aus", "Card.TLabel"),
                  "no_ssid": ("Netz nicht gefunden", "Warn.TLabel"), "failed": ("Fehlgeschlagen", "Err.TLabel"),
                  "lost": ("Verbindung verloren", "Warn.TLabel")}.get(w.get("status"), (w.get("status"), "Card.TLabel"))
        g.set("status", status[0], status[1])
        for k in ("ssid", "ip", "gateway", "subnet", "dns", "channel", "bssid", "mac", "hostname"):
            g.set(k, w.get(k))
        g.set("rssi", f"{w['rssi']} dBm  {rssi_bars(w['rssi'])}" if w.get("rssi") else None)
        g.set("saved", w.get("saved_ssid") or "nichts gespeichert")
        if not self.ssid.get() and w.get("saved_ssid"):
            self.ssid.set(w.get("saved_ssid"))
        on = web.get("on")
        self.web_lbl.configure(text=("An" + ("  ·  startet automatisch" if web.get("auto") else "")) if on else "Aus",
                               style="Ok.TLabel" if on else "Card.TLabel")
        self._web_url = web.get("url", "") if on else ""
        self.web_url.configure(text=self._web_url or ("(wartet auf WLAN oder Hotspot)" if on else ""))
        self.web_mdns.configure(text=f"oder {web.get('mdns')}" if on and web.get("mdns") else "")

    def on_stats(self, s):
        if s.get("sta") == "connected" and s.get("rssi"):
            self.info.set("rssi", f"{s['rssi']} dBm  {rssi_bars(s['rssi'])}")


class HotspotPage(Page):
    title = "Hotspot"
    subtitle = "Der ESP32 spannt sein eigenes WLAN auf – Handy, Laptop & Co. können sich direkt verbinden"

    def build(self, f):
        a = self.app
        f.columnconfigure(0, weight=3, uniform="cols")
        f.columnconfigure(1, weight=2, uniform="cols")
        cfg = make_card(f, "Hotspot einrichten")
        cfg.grid(row=0, column=0, sticky="nsew", padx=(0, 14))
        b = cfg.body
        b.columnconfigure(1, weight=1)
        self.v_ssid = tk.StringVar(value="ESP32-Studio")
        self.v_pw = tk.StringVar()
        self.v_ch = tk.StringVar(value="6")
        self.v_max = tk.StringVar(value="4")
        self.v_hidden = tk.BooleanVar()
        self.v_auto = tk.BooleanVar(value=False)
        ttk.Label(b, text="Name (SSID)", style="Card.TLabel").grid(row=0, column=0, sticky="w", pady=6)
        ttk.Entry(b, textvariable=self.v_ssid).grid(row=0, column=1, columnspan=2, sticky="we", padx=(12, 0))
        ttk.Label(b, text="Passwort", style="Card.TLabel").grid(row=1, column=0, sticky="w", pady=6)
        self.pw_entry = ttk.Entry(b, textvariable=self.v_pw, show="•")
        self.pw_entry.grid(row=1, column=1, sticky="we", padx=(12, 0))
        pwb = ttk.Frame(b, style="Card.TFrame")
        pwb.grid(row=1, column=2, sticky="w", padx=(8, 0))
        self.show_pw = tk.BooleanVar()
        ttk.Checkbutton(pwb, text="zeigen", variable=self.show_pw, style="Card.TCheckbutton",
                        command=lambda: self.pw_entry.configure(show="" if self.show_pw.get() else "•")).pack(side="left")
        ttk.Button(pwb, text="Zufällig", command=self._random_pw).pack(side="left", padx=(8, 0))
        ttk.Label(b, text="leer = offenes WLAN, sonst mindestens 8 Zeichen", style="CardMuted.TLabel").grid(
            row=2, column=1, columnspan=2, sticky="w", padx=(12, 0))
        ttk.Label(b, text="Kanal", style="Card.TLabel").grid(row=3, column=0, sticky="w", pady=6)
        chf = ttk.Frame(b, style="Card.TFrame")
        chf.grid(row=3, column=1, columnspan=2, sticky="w", padx=(12, 0))
        ttk.Combobox(chf, textvariable=self.v_ch, values=[str(i) for i in range(1, 14)], width=5,
                     state="readonly").pack(side="left")
        ttk.Button(chf, text="Freiesten Kanal wählen", command=self._best_channel).pack(side="left", padx=8)
        ttk.Label(b, text="Max. Geräte", style="Card.TLabel").grid(row=4, column=0, sticky="w", pady=6)
        ttk.Spinbox(b, from_=1, to=10, textvariable=self.v_max, width=5).grid(row=4, column=1, sticky="w", padx=(12, 0))
        ttk.Checkbutton(b, text="Versteckt (Name wird nicht angezeigt)", variable=self.v_hidden,
                        style="Card.TCheckbutton").grid(row=5, column=1, columnspan=2, sticky="w", padx=(12, 0), pady=(6, 0))
        ttk.Checkbutton(b, text="Beim Start automatisch einschalten", variable=self.v_auto,
                        style="Card.TCheckbutton").grid(row=6, column=1, columnspan=2, sticky="w", padx=(12, 0), pady=(4, 0))
        btns = ttk.Frame(b, style="Card.TFrame")
        btns.grid(row=7, column=0, columnspan=3, sticky="w", pady=(16, 0))
        ttk.Button(btns, text="Hotspot starten", style="Accent.TButton", command=self.start).pack(side="left")
        ttk.Button(btns, text="Ausschalten", style="Danger.TButton", command=self.stop).pack(side="left", padx=8)
        self.msg = ttk.Label(b, text="", style="CardMuted.TLabel", wraplength=480, justify="left")
        autowrap(self.msg)
        self.msg.grid(row=8, column=0, columnspan=3, sticky="w", pady=(10, 0))
        for v in (self.v_ssid, self.v_pw, self.v_hidden):
            v.trace_add("write", lambda *_: self._draw_qr())

        st = make_card(f, "Status")
        st.grid(row=1, column=0, sticky="nsew", padx=(0, 14), pady=(14, 0))
        self.info = InfoGrid(st.body, a, [("status", "Status"), ("ssid", "Name"), ("ip", "IP-Adresse"),
                                          ("mac", "MAC"), ("channel", "Kanal"), ("clients", "Geräte"),
                                          ("auto", "Autostart")], cols=2)
        self.info.pack(fill="x")

        qr = make_card(f, "QR-Code zum Verbinden", "Mit der Handy-Kamera scannen – fertig.")
        qr.grid(row=0, column=1, sticky="nsew")
        self.qr = tk.Canvas(qr.body, width=230, height=230, highlightthickness=0, bd=0)
        a.register_raw(self.qr, "qr")
        self.qr.pack(pady=(4, 0))
        self.qr_lbl = ttk.Label(qr.body, text="", style="CardMuted.TLabel")
        self.qr_lbl.pack(pady=(6, 0))

        cl = make_card(f, "Verbundene Geräte")
        cl.grid(row=1, column=1, sticky="nsew", pady=(14, 0))
        self.clients = ttk.Treeview(cl.body, columns=("mac", "sig"), show="headings", height=6)
        self.clients.heading("mac", text="MAC-Adresse")
        self.clients.heading("sig", text="Signal")
        self.clients.column("mac", width=170)
        self.clients.column("sig", width=110)
        self.clients.pack(fill="both", expand=True)
        self.cl_lbl = ttk.Label(cl.body, text="Aktualisiert sich automatisch.", style="CardMuted.TLabel")
        self.cl_lbl.pack(anchor="w", pady=(6, 0))
        self._loaded_form = False
        self._ap_on = False
        self._ap_live = {}
        self._next_clients = 0
        self._clients_pending = False
        self._draw_qr()

    def _random_pw(self):
        alphabet = string.ascii_letters + string.digits
        alphabet = "".join(c for c in alphabet if c not in "lI0O")
        self.v_pw.set("".join(random.SystemRandom().choice(alphabet) for _ in range(12)))
        self.show_pw.set(True)
        self.pw_entry.configure(show="")

    def _best_channel(self):
        nets = self.app.last_scan
        if not nets:
            self.app.notify("Suche zuerst unter »WLAN« nach Netzwerken", "warn")
            return
        load = [0.0] * 14
        for n in nets:
            ch = n.get("channel", 0)
            for k in range(max(1, ch - 2), min(13, ch + 2) + 1):
                load[k] += rssi_quality(n.get("rssi", -100)) * (1 if k == ch else 0.5)
        best = min(range(1, 14), key=lambda k: (load[k], abs(k - 6)))
        self.v_ch.set(str(best))
        self.app.notify(f"Kanal {best} ist am wenigsten belegt")

    def start(self):
        ssid, pw = self.v_ssid.get().strip(), self.v_pw.get()
        if not ssid:
            self.msg.configure(text="Bitte einen Namen eingeben.", style="Err.TLabel")
            return
        if len(ssid) > 32:
            self.msg.configure(text="Der Name darf höchstens 32 Zeichen haben.", style="Err.TLabel")
            return
        if pw and not 8 <= len(pw) <= 63:
            self.msg.configure(text="Das Passwort braucht 8 bis 63 Zeichen (oder leer lassen für ein offenes WLAN).",
                               style="Err.TLabel")
            return
        try:
            mx = max(1, min(10, int(self.v_max.get())))
        except ValueError:
            mx = 4
        self.msg.configure(text="Starte Hotspot …", style="CardMuted.TLabel")

        def ok(d):
            ap = d.get("ap", {})
            note = f"  ({d['note']})" if d.get("note") else ""
            self.msg.configure(text=f"✓ Hotspot „{ap.get('ssid')}“ läuft – IP {ap.get('ip')}{note}", style="Ok.TLabel")
            self.app.notify("Hotspot ist an", "ok")
            self.app.refresh_info()

        self.app.cmd("ap.start", ssid, pw, self.v_ch.get(), 1 if self.v_hidden.get() else 0, mx,
                     1 if self.v_auto.get() else 0, ok=ok,
                     err=lambda m: self.msg.configure(text="✗ " + m, style="Err.TLabel"), timeout=10)

    def stop(self):
        self.app.cmd("ap.stop", ok=lambda d: (self.msg.configure(text="Hotspot ist aus.", style="CardMuted.TLabel"),
                                              self.app.notify("Hotspot ist aus"), self.app.refresh_info()))

    def _draw_qr(self):
        c, t = self.qr, self.app.theme
        c.configure(bg=t["card"])
        c.delete("all")
        live = self._ap_on and self._ap_live
        ssid = self._ap_live.get("ssid", "") if live else self.v_ssid.get().strip()
        pw = self._ap_live.get("password", "") if live else self.v_pw.get()
        hidden = self._ap_live.get("hidden", False) if live else self.v_hidden.get()
        size = 230
        if segno is None:
            c.create_text(size / 2, size / 2, text="Für den QR-Code bitte\n»pip install segno« ausführen",
                          fill=t["muted"], justify="center", font=(self.app.ui_font, 10))
            self.qr_lbl.configure(text="")
            return
        if not ssid:
            c.create_text(size / 2, size / 2, text="Erst einen Namen eingeben", fill=t["muted"])
            return
        qr = segno.make(wifi_qr_text(ssid, pw, hidden), error="m", micro=False)
        matrix = qr.matrix
        n, border = len(matrix), 2
        cell = max(2, size // (n + 2 * border))
        total = cell * (n + 2 * border)
        off = (size - total) // 2
        c.create_rectangle(off, off, off + total, off + total, fill="#ffffff", outline="")
        for y, row in enumerate(matrix):
            for x, v in enumerate(row):
                if v:
                    x0, y0 = off + (x + border) * cell, off + (y + border) * cell
                    c.create_rectangle(x0, y0, x0 + cell, y0 + cell, fill="#000000", outline="")
        self.qr_lbl.configure(text=f"„{ssid}“" + ("" if live else "  (Vorschau – Hotspot ist aus)"))

    def on_info(self, d):
        ap = d.get("ap", {})
        self._ap_on = bool(ap.get("on"))
        self._ap_live = ap
        if not self._loaded_form:
            self._loaded_form = True
            self.v_ssid.set(ap.get("ssid", self.v_ssid.get()))
            self.v_pw.set(ap.get("password", ""))
            self.v_ch.set(str(ap.get("channel", 6)))
            self.v_max.set(str(ap.get("max", 4)))
            self.v_hidden.set(bool(ap.get("hidden")))
            self.v_auto.set(bool(ap.get("auto")))
        g = self.info
        g.set("status", "An" if self._ap_on else "Aus", "Ok.TLabel" if self._ap_on else "Card.TLabel")
        g.set("ssid", ap.get("ssid"))
        g.set("ip", ap.get("ip") if self._ap_on else None)
        g.set("mac", ap.get("mac") if self._ap_on else None)
        g.set("channel", ap.get("channel"))
        g.set("clients", f"{ap.get('clients', 0)} von {ap.get('max', '?')}" if self._ap_on else None)
        g.set("auto", "ja" if ap.get("auto") else "nein")
        self._draw_qr()
        if not self._ap_on:
            self.clients.delete(*self.clients.get_children())

    def on_stats(self, s):
        if s.get("ap_on") != self._ap_on:
            self.app.refresh_info()

    def on_connection(self):
        if not self.app.fw:
            self._loaded_form = False
            self._ap_on = False
            self._ap_live = {}
            self.info.clear()
            self.clients.delete(*self.clients.get_children())
            self._draw_qr()

    def on_event(self, e):
        if e.get("type") == "ap":
            self._next_clients = 0

    def on_show(self):
        self._next_clients = 0

    def tick(self, now):
        if not (self.app.fw and self._ap_on) or self._clients_pending or now < self._next_clients:
            return
        self._next_clients = now + 3
        self._clients_pending = True

        def ok(d):
            self._clients_pending = False
            self.clients.delete(*self.clients.get_children())
            for c in d.get("clients", []):
                r = c.get("rssi", 0)
                self.clients.insert("", "end", values=(c.get("mac"), f"{rssi_bars(r)}  {r} dBm"))
            n = len(d.get("clients", []))
            self.cl_lbl.configure(text=f"{n} Gerät{'e' if n != 1 else ''} verbunden  ·  {time.strftime('%H:%M:%S')}")
            self.info.set("clients", f"{n} von {self._ap_live.get('max', '?')}")

        def err(_m):
            self._clients_pending = False

        self.app.cmd("ap.clients", ok=ok, err=err, quiet=True)


class GpioPage(Page):
    title = "GPIO & Pins"
    subtitle = "Pins schalten, Eingänge beobachten, PWM (z. B. LED dimmen) und Spannungen messen"

    def build(self, f):
        a = self.app
        f.columnconfigure(0, weight=1, uniform="cols")
        f.columnconfigure(1, weight=1, uniform="cols")
        self.hint = ttk.Label(f, text=PIN_HINTS["ESP32"], style="Muted.TLabel", wraplength=1000, justify="left")
        autowrap(self.hint)
        self.hint.grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 12))

        pc = make_card(f, "Pin steuern")
        pc.grid(row=1, column=0, sticky="nsew", padx=(0, 14))
        b = pc.body
        self.v_pin = tk.StringVar(value="2")
        self.v_mode = tk.StringVar(value="Ausgang")
        self.v_force = tk.BooleanVar()
        r0 = ttk.Frame(b, style="Card.TFrame")
        r0.pack(fill="x")
        ttk.Label(r0, text="GPIO", style="Card.TLabel").pack(side="left")
        ttk.Spinbox(r0, from_=0, to=48, textvariable=self.v_pin, width=5).pack(side="left", padx=(6, 14))
        ttk.Label(r0, text="Modus", style="Card.TLabel").pack(side="left")
        ttk.Combobox(r0, textvariable=self.v_mode, state="readonly", width=18,
                     values=list(self.MODES)).pack(side="left", padx=6)
        ttk.Button(r0, text="Setzen", command=self.set_mode).pack(side="left", padx=(4, 0))
        r1 = ttk.Frame(b, style="Card.TFrame")
        r1.pack(fill="x", pady=(12, 0))
        ttk.Button(r1, text="HIGH (an)", style="Accent.TButton", command=lambda: self.write(1)).pack(side="left")
        ttk.Button(r1, text="LOW (aus)", command=lambda: self.write(0)).pack(side="left", padx=8)
        ttk.Button(r1, text="Umschalten", command=self.toggle).pack(side="left")
        ttk.Button(r1, text="Lesen", command=self.read).pack(side="left", padx=8)
        r2 = ttk.Frame(b, style="Card.TFrame")
        r2.pack(fill="x", pady=(14, 0))
        self.dot = Dot(r2, a, 18)
        self.dot.pack(side="left")
        self.state_lbl = ttk.Label(r2, text="noch nichts gelesen", style="Value.TLabel")
        self.state_lbl.pack(side="left", padx=10)
        ttk.Checkbutton(b, text="Geschützte Pins erlauben (Flash/USB/Seriell – kann die Verbindung kappen!)",
                        variable=self.v_force, style="Card.TCheckbutton").pack(anchor="w", pady=(12, 0))

        wc = make_card(f, "Pins beobachten", "Eingänge live ansehen, z. B. Taster oder Bewegungsmelder.")
        wc.grid(row=1, column=1, sticky="nsew")
        r = ttk.Frame(wc.body, style="Card.TFrame")
        r.pack(fill="x")
        self.v_watch = tk.StringVar()
        e = ttk.Entry(r, textvariable=self.v_watch, width=16)
        e.pack(side="left")
        e.bind("<Return>", lambda ev: self.add_watch())
        ttk.Button(r, text="Hinzufügen", command=self.add_watch).pack(side="left", padx=8)
        ttk.Button(r, text="Alle entfernen", command=self.clear_watch).pack(side="left")
        ttk.Label(wc.body, text="Mehrere Pins mit Komma trennen, z. B. 0, 4, 5", style="CardMuted.TLabel").pack(
            anchor="w", pady=(4, 0))
        self.watch_box = ttk.Frame(wc.body, style="Card.TFrame")
        self.watch_box.pack(fill="x", pady=(10, 0))
        self.watch = {}
        self._watch_pending = False
        self._next_watch = 0

        pw = make_card(f, "PWM", "Helligkeit einer LED oder Drehzahl eines Motors regeln.")
        pw.grid(row=2, column=0, sticky="nsew", padx=(0, 14), pady=(14, 0))
        b = pw.body
        r = ttk.Frame(b, style="Card.TFrame")
        r.pack(fill="x")
        self.v_pwm_pin = tk.StringVar(value="2")
        self.v_freq = tk.StringVar(value="5000")
        ttk.Label(r, text="GPIO", style="Card.TLabel").pack(side="left")
        ttk.Spinbox(r, from_=0, to=48, textvariable=self.v_pwm_pin, width=5).pack(side="left", padx=(6, 14))
        ttk.Label(r, text="Frequenz (Hz)", style="Card.TLabel").pack(side="left")
        ttk.Entry(r, textvariable=self.v_freq, width=8).pack(side="left", padx=6)
        r = ttk.Frame(b, style="Card.TFrame")
        r.pack(fill="x", pady=(12, 0))
        self.v_duty = tk.DoubleVar(value=128)
        ttk.Scale(r, from_=0, to=255, variable=self.v_duty, command=lambda v: self._duty_changed()).pack(
            side="left", fill="x", expand=True)
        self.duty_lbl = ttk.Label(r, text="50 %", style="Value.TLabel", width=6, anchor="e")
        self.duty_lbl.pack(side="left", padx=(10, 0))
        r = ttk.Frame(b, style="Card.TFrame")
        r.pack(fill="x", pady=(10, 0))
        ttk.Button(r, text="PWM starten", style="Accent.TButton", command=self.pwm_send).pack(side="left")
        ttk.Button(r, text="Stopp", command=self.pwm_stop).pack(side="left", padx=8)
        self.v_fade = tk.BooleanVar()
        ttk.Checkbutton(r, text="Atmen-Effekt", variable=self.v_fade, style="Card.TCheckbutton").pack(side="left", padx=8)
        self.pwm_lbl = ttk.Label(b, text="", style="CardMuted.TLabel")
        self.pwm_lbl.pack(anchor="w", pady=(6, 0))
        self._pwm_active = False
        self._pwm_job = None
        self._pwm_busy = False
        self._fade_next = 0

        ad = make_card(f, "Spannung messen (ADC)", "Misst 0 – 3,3 V, z. B. Poti, Lichtsensor oder Akku über Spannungsteiler.")
        ad.grid(row=2, column=1, sticky="nsew", pady=(14, 0))
        b = ad.body
        r = ttk.Frame(b, style="Card.TFrame")
        r.pack(fill="x")
        self.v_adc = tk.StringVar(value="34")
        ttk.Label(r, text="GPIO", style="Card.TLabel").pack(side="left")
        ttk.Spinbox(r, from_=0, to=48, textvariable=self.v_adc, width=5).pack(side="left", padx=(6, 14))
        ttk.Button(r, text="Messen", command=self.adc_read).pack(side="left")
        self.v_adc_live = tk.BooleanVar()
        ttk.Checkbutton(r, text="Live", variable=self.v_adc_live, style="Card.TCheckbutton").pack(side="left", padx=10)
        self.adc_lbl = ttk.Label(b, text="–", style="Big.TLabel")
        self.adc_lbl.pack(anchor="w", pady=(8, 0))
        self.adc_raw = ttk.Label(b, text=" ", style="CardMuted.TLabel")
        self.adc_raw.pack(anchor="w")
        self.adc_chart = LineChart(b, a, "Verlauf (mV)", "mV", "info", fixed=(0, 3300), height=120)
        self.adc_chart.pack(fill="x", pady=(8, 0))
        self._adc_pending = False
        self._adc_next = 0

        dc = make_card(f, "Analoger Ausgang (DAC)", "Echte Spannung 0 – 3,3 V ausgeben. Nur ESP32 (GPIO 25/26) und ESP32-S2 (17/18).")
        dc.grid(row=3, column=0, sticky="nsew", padx=(0, 14), pady=(14, 0))
        b = dc.body
        r = ttk.Frame(b, style="Card.TFrame")
        r.pack(fill="x")
        self.v_dac_pin = tk.StringVar(value="25")
        ttk.Label(r, text="GPIO", style="Card.TLabel").pack(side="left")
        self.dac_combo = ttk.Combobox(r, textvariable=self.v_dac_pin, values=["25", "26"], width=5, state="readonly")
        self.dac_combo.pack(side="left", padx=(6, 14))
        self.v_dac = tk.DoubleVar(value=0)
        ttk.Scale(r, from_=0, to=255, variable=self.v_dac, command=lambda v: self._dac_changed()).pack(
            side="left", fill="x", expand=True)
        self.dac_lbl = ttk.Label(r, text="0,00 V", style="Card.TLabel", width=7, anchor="e")
        self.dac_lbl.pack(side="left", padx=(8, 0))
        self._dac_job = None

    MODES = {"Ausgang": "out", "Eingang": "in", "Eingang + Pull-up": "pullup", "Eingang + Pull-down": "pulldown",
             "Open-Drain": "od"}

    def _pin(self, var):
        try:
            return int(var.get())
        except ValueError:
            self.app.notify("Bitte eine Pin-Nummer eingeben", "warn")
            return None

    def _force(self):
        return ["force"] if self.v_force.get() else []

    def _show_state(self, pin, value):
        self.dot.set("ok" if value else "muted")
        self.state_lbl.configure(text=f"GPIO {pin} = {'HIGH' if value else 'LOW'}")

    def set_mode(self):
        pin = self._pin(self.v_pin)
        if pin is None:
            return
        mode = self.MODES[self.v_mode.get()]
        self.app.cmd("gpio.mode", pin, mode, *self._force(),
                     ok=lambda d: (self._show_state(pin, d.get("value")),
                                   self.app.notify(f"GPIO {pin}: {self.v_mode.get()}")))

    def write(self, v):
        pin = self._pin(self.v_pin)
        if pin is not None:
            self.app.cmd("gpio.write", pin, v, *self._force(), ok=lambda d: self._show_state(pin, d.get("value")))

    def toggle(self):
        pin = self._pin(self.v_pin)
        if pin is not None:
            self.app.cmd("gpio.toggle", pin, *self._force(), ok=lambda d: self._show_state(pin, d.get("value")))

    def read(self):
        pin = self._pin(self.v_pin)
        if pin is None:
            return

        def ok(d):
            vals = d.get("pins", {})
            if str(pin) in vals:
                self._show_state(pin, vals[str(pin)])
            else:
                self.app.notify(f"GPIO {pin} kann nicht gelesen werden (gibt es nicht oder ist geschützt)", "warn")

        self.app.cmd("gpio.read", pin, ok=ok)

    # -- Beobachten --
    def add_watch(self, pins=None):
        raw = pins if pins is not None else re.split(r"[,\s;]+", self.v_watch.get())
        for p in raw:
            try:
                n = int(p)
            except (ValueError, TypeError):
                continue
            if n in self.watch or not 0 <= n <= 48:
                continue
            fr = ttk.Frame(self.watch_box, style="Card.TFrame", padding=(0, 2))
            fr.pack(side="left", padx=(0, 16), pady=2)
            dot = Dot(fr, self.app, 14)
            dot.pack(side="left")
            lbl = ttk.Label(fr, text=f"GPIO {n}: ?", style="Card.TLabel")
            lbl.pack(side="left", padx=(6, 0))
            for w in (fr, dot, lbl):
                w.bind("<Button-3>", lambda e, n=n: self.remove_watch(n))
                w.bind("<Button-2>", lambda e, n=n: self.remove_watch(n))
            self.watch[n] = (fr, dot, lbl)
        self.v_watch.set("")
        self.app.cfg["watch_pins"] = sorted(self.watch)

    def remove_watch(self, n):
        if n in self.watch:
            self.watch.pop(n)[0].destroy()
            self.app.cfg["watch_pins"] = sorted(self.watch)

    def clear_watch(self):
        for n in list(self.watch):
            self.remove_watch(n)

    # -- PWM --
    def _duty_changed(self):
        duty = int(self.v_duty.get())
        self.duty_lbl.configure(text=f"{round(duty / 255 * 100)} %")
        if self._pwm_active and not self.v_fade.get():
            if self._pwm_job:
                self.after_cancel(self._pwm_job)
            self._pwm_job = self.after(70, self.pwm_send)

    def pwm_send(self, quiet=False):
        self._pwm_job = None
        pin = self._pin(self.v_pwm_pin)
        if pin is None or self._pwm_busy:
            return
        try:
            freq = int(self.v_freq.get())
        except ValueError:
            freq = 5000
        duty = int(self.v_duty.get())
        self._pwm_busy = True

        def ok(d):
            self._pwm_busy = False
            self._pwm_active = True
            self.pwm_lbl.configure(text=f"GPIO {d.get('pin')}: {d.get('duty')}/255 bei {d.get('freq')} Hz")

        def err(m):
            self._pwm_busy = False
            self._pwm_active = False
            self.v_fade.set(False)
            self.app.notify(m, "err")

        self.app.cmd("pwm", pin, duty, freq, *self._force(), ok=ok, err=err, quiet=quiet)

    def pwm_stop(self):
        pin = self._pin(self.v_pwm_pin)
        self._pwm_active = False
        self.v_fade.set(False)
        if pin is not None:
            self.app.cmd("pwm.stop", pin, ok=lambda d: self.pwm_lbl.configure(text="PWM gestoppt"))

    # -- ADC / DAC --
    def adc_read(self, quiet=False):
        pin = self._pin(self.v_adc)
        if pin is None or self._adc_pending:
            return
        self._adc_pending = True

        def ok(d):
            self._adc_pending = False
            mv = d.get("mv", 0)
            self.adc_lbl.configure(text=f"{mv / 1000:.2f} V".replace(".", ","))
            self.adc_raw.configure(text=f"GPIO {pin}  ·  {mv} mV  ·  Rohwert {d.get('raw')} von 4095")
            self.adc_chart.add(mv)

        def err(m):
            self._adc_pending = False
            self.v_adc_live.set(False)
            self.app.notify(m, "err")

        self.app.cmd("adc", pin, 8, ok=ok, err=err, quiet=quiet)

    def _dac_changed(self):
        v = int(self.v_dac.get())
        self.dac_lbl.configure(text=f"{v / 255 * 3.3:.2f} V".replace(".", ","))
        if self._dac_job:
            self.after_cancel(self._dac_job)
        self._dac_job = self.after(80, lambda: self.app.cmd("dac", self.v_dac_pin.get(), v, quiet=False))

    # -- Lebenszyklus --
    def on_info(self, d):
        fam = chip_family(d.get("chip", {}).get("model", ""))
        self.hint.configure(text=PIN_HINTS.get(fam, PIN_HINTS["ESP32"]))
        adc, _touch, dac, _sda, _scl = CHIP_DEFAULTS.get(fam, CHIP_DEFAULTS["ESP32"])
        if self.app.chip_changed:
            self.v_adc.set(str(adc))
            self.dac_combo.configure(values=[str(p) for p in dac] or ["–"])
            self.v_dac_pin.set(str(dac[0]) if dac else "–")
            led = d.get("sys", {}).get("led_pin")
            if isinstance(led, int) and 0 <= led <= 48:
                self.v_pin.set(str(led))
                self.v_pwm_pin.set(str(led))

    def tick(self, now):
        if not self.app.fw:
            return
        if self.watch and not self._watch_pending and now >= self._next_watch:
            self._next_watch = now + 0.4
            self._watch_pending = True
            pins = sorted(self.watch)

            def ok(d):
                self._watch_pending = False
                vals = d.get("pins", {})
                for n, (_fr, dot, lbl) in self.watch.items():
                    v = vals.get(str(n))
                    dot.set("muted" if v is None else "ok" if v else "card2")
                    lbl.configure(text=f"GPIO {n}: " + ("gesperrt" if v is None else "HIGH" if v else "LOW"))

            def err(_m):
                self._watch_pending = False

            self.app.cmd("gpio.read", *pins, ok=ok, err=err, quiet=True)
        if self.v_adc_live.get() and now >= self._adc_next:
            self._adc_next = now + 0.3
            self.adc_read(quiet=True)
        if self.v_fade.get() and now >= self._fade_next:
            self._fade_next = now + 0.12
            self.v_duty.set(round((math.sin(now * 2.2) + 1) / 2 * 255))
            self.duty_lbl.configure(text=f"{round(self.v_duty.get() / 255 * 100)} %")
            self.pwm_send(quiet=True)


class ToolsPage(Page):
    title = "Werkzeuge"
    subtitle = "I2C-Scanner, dauerhafter Speicher, Touch-Sensor, Verbindungstest und alle Befehle"

    def build(self, f):
        a = self.app
        f.columnconfigure(0, weight=1, uniform="cols")
        f.columnconfigure(1, weight=1, uniform="cols")
        ic = make_card(f, "I2C-Scanner", "Findet angeschlossene Sensoren und Displays. Leer lassen = Standard-Pins.")
        ic.grid(row=0, column=0, sticky="nsew", padx=(0, 14))
        r = ttk.Frame(ic.body, style="Card.TFrame")
        r.pack(fill="x")
        self.v_sda, self.v_scl = tk.StringVar(), tk.StringVar()
        ttk.Label(r, text="SDA", style="Card.TLabel").pack(side="left")
        ttk.Entry(r, textvariable=self.v_sda, width=5).pack(side="left", padx=(6, 12))
        ttk.Label(r, text="SCL", style="Card.TLabel").pack(side="left")
        ttk.Entry(r, textvariable=self.v_scl, width=5).pack(side="left", padx=(6, 12))
        ttk.Button(r, text="Scannen", style="Accent.TButton", command=self.i2c).pack(side="left")
        self.i2c_tree = ttk.Treeview(ic.body, columns=("addr", "dev"), show="headings", height=6)
        self.i2c_tree.heading("addr", text="Adresse")
        self.i2c_tree.heading("dev", text="Wahrscheinlich")
        self.i2c_tree.column("addr", width=80, stretch=False)
        self.i2c_tree.column("dev", width=260)
        self.i2c_tree.pack(fill="both", expand=True, pady=(10, 0))
        self.i2c_lbl = ttk.Label(ic.body, text="", style="CardMuted.TLabel")
        self.i2c_lbl.pack(anchor="w", pady=(6, 0))

        nc = make_card(f, "Dauerhafter Speicher (NVS)", "Werte bleiben auch nach Neustart und Stromausfall erhalten.")
        nc.grid(row=0, column=1, sticky="nsew")
        b = nc.body
        b.columnconfigure(1, weight=1)
        self.v_key, self.v_val = tk.StringVar(), tk.StringVar()
        ttk.Label(b, text="Schlüssel", style="Card.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Entry(b, textvariable=self.v_key).grid(row=0, column=1, sticky="we", padx=(10, 0), pady=3)
        ttk.Label(b, text="Wert", style="Card.TLabel").grid(row=1, column=0, sticky="w")
        ttk.Entry(b, textvariable=self.v_val).grid(row=1, column=1, sticky="we", padx=(10, 0), pady=3)
        r = ttk.Frame(b, style="Card.TFrame")
        r.grid(row=2, column=0, columnspan=2, sticky="w", pady=(8, 0))
        ttk.Button(r, text="Speichern", style="Accent.TButton", command=self.nvs_set).pack(side="left")
        ttk.Button(r, text="Lesen", command=self.nvs_get).pack(side="left", padx=6)
        ttk.Button(r, text="Löschen", command=self.nvs_del).pack(side="left")
        ttk.Button(r, text="Alle löschen", style="Danger.TButton", command=self.nvs_clear).pack(side="left", padx=6)
        self.nvs_tree = ttk.Treeview(b, columns=("k", "v"), show="headings", height=5)
        self.nvs_tree.heading("k", text="Schlüssel")
        self.nvs_tree.heading("v", text="Wert")
        self.nvs_tree.column("k", width=120, stretch=False)
        self.nvs_tree.grid(row=3, column=0, columnspan=2, sticky="nsew", pady=(10, 0))
        self.nvs_tree.bind("<<TreeviewSelect>>", self._nvs_pick)

        tc = make_card(f, "Touch-Sensor", "Berühre den Draht am Pin – der Wert ändert sich deutlich.")
        tc.grid(row=1, column=0, sticky="nsew", padx=(0, 14), pady=(14, 0))
        r = ttk.Frame(tc.body, style="Card.TFrame")
        r.pack(fill="x")
        self.v_touch = tk.StringVar(value="4")
        ttk.Label(r, text="GPIO", style="Card.TLabel").pack(side="left")
        ttk.Spinbox(r, from_=0, to=48, textvariable=self.v_touch, width=5).pack(side="left", padx=(6, 12))
        ttk.Button(r, text="Lesen", command=self.touch).pack(side="left")
        self.v_touch_live = tk.BooleanVar()
        ttk.Checkbutton(r, text="Live", variable=self.v_touch_live, style="Card.TCheckbutton").pack(side="left", padx=10)
        self.touch_lbl = ttk.Label(tc.body, text="–", style="Big.TLabel")
        self.touch_lbl.pack(anchor="w", pady=(8, 0))
        self.touch_chart = LineChart(tc.body, a, "Touch-Wert", "", "warn", height=100)
        self.touch_chart.pack(fill="x", pady=(6, 0))
        self._touch_pending = False
        self._touch_next = 0

        lc = make_card(f, "Verbindungstest", "Schickt 20 Pings über USB und misst die Antwortzeit.")
        lc.grid(row=1, column=1, sticky="nsew", pady=(14, 0))
        self.ping_btn = ttk.Button(lc.body, text="Test starten", style="Accent.TButton", command=self.ping_test)
        self.ping_btn.pack(anchor="w")
        self.ping_bar = ttk.Progressbar(lc.body, maximum=20, style="Card.Horizontal.TProgressbar")
        self.ping_bar.pack(fill="x", pady=(10, 0))
        self.ping_lbl = ttk.Label(lc.body, text="", style="Card.TLabel")
        self.ping_lbl.pack(anchor="w", pady=(8, 0))

        hc = make_card(f, "Alle Befehle der Firmware",
                       "Doppelklick übernimmt einen Befehl in den Seriellen Monitor. Dort kannst du ihn anpassen.")
        hc.grid(row=2, column=0, columnspan=2, sticky="nsew", pady=(14, 0))
        r = ttk.Frame(hc.body, style="Card.TFrame")
        r.pack(fill="x")
        ttk.Button(r, text="Liste laden", command=self.load_help).pack(side="left")
        self.help_tree = ttk.Treeview(hc.body, columns=("cmd", "help"), show="headings", height=8)
        self.help_tree.heading("cmd", text="Befehl")
        self.help_tree.heading("help", text="Beschreibung")
        self.help_tree.column("cmd", width=150, stretch=False)
        self.help_tree.pack(fill="both", expand=True, pady=(10, 0))
        self.help_tree.bind("<Double-1>", self._use_cmd)

    def i2c(self):
        args = [self.v_sda.get().strip(), self.v_scl.get().strip()]
        if not all(args):
            args = []
        self.i2c_lbl.configure(text="Scanne …")

        def ok(d):
            self.i2c_tree.delete(*self.i2c_tree.get_children())
            devs = d.get("devices", [])
            for addr in devs:
                self.i2c_tree.insert("", "end", values=(f"0x{addr:02X}", I2C_NAMES.get(addr, "unbekannt")))
            self.i2c_lbl.configure(text=f"{len(devs)} Gerät{'e' if len(devs) != 1 else ''} gefunden "
                                        f"(SDA {d.get('sda')}, SCL {d.get('scl')})" if devs else
                                   f"Nichts gefunden (SDA {d.get('sda')}, SCL {d.get('scl')}). Verkabelung und "
                                   "Pull-up-Widerstände prüfen.")

        self.app.cmd("i2c.scan", *args, ok=ok, err=lambda m: self.i2c_lbl.configure(text=m), timeout=8)

    def nvs_set(self):
        k = self.v_key.get().strip()
        if not k:
            self.app.notify("Schlüssel fehlt", "warn")
            return
        self.app.cmd("nvs.set", k, self.v_val.get(), ok=lambda d: (self.app.notify(f"Gespeichert: {k}"),
                                                                   self.nvs_list()))

    def nvs_get(self):
        k = self.v_key.get().strip()
        self.app.cmd("nvs.get", k, ok=lambda d: self.v_val.set(d.get("value", "")))

    def nvs_del(self):
        k = self.v_key.get().strip()
        self.app.cmd("nvs.del", k, ok=lambda d: (self.app.notify(f"Gelöscht: {k}"), self.nvs_list()))

    def nvs_clear(self):
        if messagebox.askyesno(APP_NAME, "Alle eigenen gespeicherten Werte auf dem ESP32 löschen?"):
            self.app.cmd("nvs.clear", ok=lambda d: (self.app.notify("Alle Werte gelöscht"), self.nvs_list()))

    def nvs_list(self):
        def ok(d):
            self.nvs_tree.delete(*self.nvs_tree.get_children())
            for it in d.get("items", []):
                self.nvs_tree.insert("", "end", values=(it.get("key"), it.get("value")))

        self.app.cmd("nvs.list", ok=ok, quiet=True)

    def _nvs_pick(self, _e):
        sel = self.nvs_tree.selection()
        if sel:
            k, v = self.nvs_tree.item(sel[0], "values")
            self.v_key.set(k)
            self.v_val.set(v)

    def touch(self, quiet=False):
        try:
            pin = int(self.v_touch.get())
        except ValueError:
            return
        if self._touch_pending:
            return
        self._touch_pending = True

        def ok(d):
            self._touch_pending = False
            self.touch_lbl.configure(text=str(d.get("value")))
            self.touch_chart.add(d.get("value"))

        def err(m):
            self._touch_pending = False
            self.v_touch_live.set(False)
            self.app.notify(m, "err")

        self.app.cmd("touch", pin, ok=ok, err=err, quiet=quiet)

    def ping_test(self):
        self.ping_btn.state(["disabled"])
        self.ping_bar["value"] = 0
        times = []

        def step(i):
            if i >= 20:
                self.ping_btn.state(["!disabled"])
                if times:
                    ms = [t * 1000 for t in times]
                    self.ping_lbl.configure(text=f"Ø {sum(ms) / len(ms):.1f} ms   ·   min {min(ms):.1f} ms   ·   "
                                                 f"max {max(ms):.1f} ms   ·   {len(ms)}/20 Antworten", style="Ok.TLabel")
                return

            def ok(d):
                times.append(d.get("_rtt", 0))
                self.ping_bar["value"] = i + 1
                step(i + 1)

            def err(m):
                self.ping_bar["value"] = i + 1
                step(i + 1)

            self.app.cmd("ping", ok=ok, err=err, timeout=2, quiet=True)

        step(0)

    def load_help(self):
        def ok(d):
            self.help_tree.delete(*self.help_tree.get_children())
            for c in d.get("commands", []):
                self.help_tree.insert("", "end", values=(c.get("cmd"), c.get("help")))

        self.app.cmd("help", ok=ok)

    def _use_cmd(self, _e):
        sel = self.help_tree.selection()
        if sel:
            cmd = self.help_tree.item(sel[0], "values")[0]
            self.app.show_page("monitor")
            self.app.pages["monitor"].set_input(cmd + " ")

    def on_info(self, d):
        if self.app.chip_changed:
            fam = chip_family(d.get("chip", {}).get("model", ""))
            _adc, touch, _dac, sda, scl = CHIP_DEFAULTS.get(fam, CHIP_DEFAULTS["ESP32"])
            self.v_touch.set(str(touch) if touch is not None else "")
            if not self.v_sda.get():
                self.v_sda.set(str(sda))
                self.v_scl.set(str(scl))

    def on_show(self):
        if self.app.fw:
            self.nvs_list()
            if not self.help_tree.get_children():
                self.load_help()

    def tick(self, now):
        if self.app.fw and self.v_touch_live.get() and now >= self._touch_next:
            self._touch_next = now + 0.25
            self.touch(quiet=True)


class MonitorPage(Page):
    title = "Serieller Monitor"
    subtitle = "Alles, was der ESP32 ausgibt – und Befehle von Hand senden (tippe »help«)"
    scroll = False

    def build(self, f):
        a = self.app
        cfg = a.cfg
        tb = ttk.Frame(f)
        tb.pack(fill="x")
        self.v_auto = tk.BooleanVar(value=True)
        self.v_ts = tk.BooleanVar(value=cfg.get("timestamps", True))
        self.v_proto = tk.BooleanVar(value=cfg.get("show_protocol", False))
        self.v_pause = tk.BooleanVar()
        for text, var in (("Autoscroll", self.v_auto), ("Zeitstempel", self.v_ts),
                          ("Protokoll anzeigen", self.v_proto), ("Pause", self.v_pause)):
            ttk.Checkbutton(tb, text=text, variable=var, command=self._opts).pack(side="left", padx=(0, 14))
        ttk.Button(tb, text="Speichern …", command=self.save).pack(side="right")
        ttk.Button(tb, text="Leeren", command=self.clear).pack(side="right", padx=8)
        self.v_find = tk.StringVar()
        fe = ttk.Entry(tb, textvariable=self.v_find, width=18)
        fe.pack(side="right")
        fe.bind("<Return>", lambda e: self.find())
        ttk.Label(tb, text="Suchen", style="Muted.TLabel").pack(side="right", padx=(0, 6))

        box = ttk.Frame(f, style="Card.TFrame", padding=1)
        box.pack(fill="both", expand=True, pady=(10, 0))
        self.text = tk.Text(box, wrap="word", bd=0, highlightthickness=0, padx=10, pady=8, undo=False,
                            font=(a.mono_font, 10), state="disabled")
        a.register_raw(self.text, "text")
        sb = ttk.Scrollbar(box, orient="vertical", command=self.text.yview)
        self.text.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self.text.pack(side="left", fill="both", expand=True)
        self._tags()

        self.macros = ttk.Frame(f)
        self.macros.pack(fill="x", pady=(10, 0))
        self._build_macros()

        inp = ttk.Frame(f)
        inp.pack(fill="x", pady=(10, 0))
        self.v_in = tk.StringVar()
        self.entry = ttk.Entry(inp, textvariable=self.v_in, font=(a.mono_font, 11))
        self.entry.pack(side="left", fill="x", expand=True)
        self.entry.bind("<Return>", lambda e: self.send())
        self.entry.bind("<Up>", lambda e: self._hist(-1))
        self.entry.bind("<Down>", lambda e: self._hist(1))
        self.v_end = tk.StringVar(value=cfg.get("line_ending", "LF"))
        ttk.Combobox(inp, textvariable=self.v_end, values=["LF", "CRLF", "CR", "Keins"], width=7,
                     state="readonly").pack(side="left", padx=8)
        ttk.Button(inp, text="Senden", style="Accent.TButton", command=self.send).pack(side="left")
        self.history = list(cfg.get("history", []))[-100:]
        self.hpos = len(self.history)
        self._paused = []
        self.log_sys(f"{APP_NAME} {APP_VERSION} bereit. Wähle oben einen Port und klicke auf »Verbinden«.")

    def _tags(self):
        t = self.app.theme
        self.text.tag_configure("ts", foreground=t["muted"])
        self.text.tag_configure("rx", foreground=t["fg"])
        self.text.tag_configure("tx", foreground=t["info"])
        self.text.tag_configure("sys", foreground=t["muted"])
        self.text.tag_configure("ok", foreground=t["ok"])
        self.text.tag_configure("err", foreground=t["err"])
        self.text.tag_configure("ev", foreground=t["warn"])
        self.text.tag_configure("proto", foreground=t["muted"])
        self.text.tag_configure("hl", background=t["warn"], foreground="#000000")

    def restyle(self):
        self._tags()

    def _opts(self):
        self.app.cfg["timestamps"] = self.v_ts.get()
        self.app.cfg["show_protocol"] = self.v_proto.get()
        if not self.v_pause.get() and self._paused:
            items, self._paused = self._paused, []
            for text, tag in items:
                self._write(text, tag)

    def _write(self, text, tag):
        if self.v_pause.get():
            self._paused.append((text, tag))
            if len(self._paused) > 3000:
                self._paused = self._paused[-3000:]
            return
        tx = self.text
        tx.configure(state="normal")
        if self.v_ts.get():
            tx.insert("end", time.strftime("%H:%M:%S") + f".{int(time.time() * 1000) % 1000:03d}  ", "ts")
        tx.insert("end", text + "\n", tag)
        lines = int(tx.index("end-1c").split(".")[0])
        if lines > 6000:
            tx.delete("1.0", f"{lines - 5000}.0")
        tx.configure(state="disabled")
        if self.v_auto.get():
            tx.see("end")

    def log_rx(self, line):
        self._write(line, "rx")

    def log_tx(self, text, proto=False):
        if not proto or self.v_proto.get():
            self._write("→ " + text, "proto" if proto else "tx")

    def log_sys(self, text):
        self._write("• " + text, "sys")

    def log_reply(self, line, data, manual):
        if manual:
            if "commands" in data:  # die Firmware hat die Liste schon lesbar ausgegeben
                self._write(f"← {len(data['commands'])} Befehle", "ok")
            else:
                self._write("← " + line[3:].split(" ", 1)[-1], "ok" if data.get("ok") else "err")
        elif self.v_proto.get():
            self._write("← " + line, "proto")

    def log_event(self, line, data):
        self._write(line if self.v_proto.get() else "★ " + describe_event(data), "ev")

    def clear(self):
        self.text.configure(state="normal")
        self.text.delete("1.0", "end")
        self.text.configure(state="disabled")

    def save(self):
        p = filedialog.asksaveasfilename(defaultextension=".txt", initialfile=f"esp32-log-{time.strftime('%Y%m%d-%H%M%S')}.txt",
                                         filetypes=[("Textdatei", "*.txt"), ("Alle Dateien", "*.*")])
        if p:
            Path(p).write_text(self.text.get("1.0", "end-1c"), encoding="utf-8")
            self.app.notify("Log gespeichert", "ok")

    def find(self):
        tx, needle = self.text, self.v_find.get()
        tx.tag_remove("hl", "1.0", "end")
        if not needle:
            return
        idx, first, count = "1.0", None, 0
        while True:
            idx = tx.search(needle, idx, nocase=True, stopindex="end")
            if not idx:
                break
            end = f"{idx}+{len(needle)}c"
            tx.tag_add("hl", idx, end)
            first = first or idx
            idx = end
            count += 1
        if first:
            self.v_auto.set(False)
            tx.see(first)
        self.app.notify(f"{count} Treffer für „{needle}“")

    def set_input(self, text):
        self.v_in.set(text)
        self.entry.focus_set()
        self.entry.icursor("end")

    def _hist(self, d):
        if not self.history:
            return "break"
        self.hpos = max(0, min(len(self.history), self.hpos + d))
        self.v_in.set(self.history[self.hpos] if self.hpos < len(self.history) else "")
        self.entry.icursor("end")
        return "break"

    def send(self, text=None):
        text = self.v_in.get() if text is None else text
        if not self.app.link.is_open:
            self.app.notify("Nicht verbunden", "warn")
            return
        end = {"LF": "\n", "CRLF": "\r\n", "CR": "\r", "Keins": ""}[self.v_end.get()]
        self.app.cfg["line_ending"] = self.v_end.get()
        try:
            self.app.link.write_line(text, end)
        except Exception as e:
            self.app.on_lost(str(e))
            return
        self.log_tx(text)
        if text.strip() and (not self.history or self.history[-1] != text):
            self.history.append(text)
            self.history = self.history[-100:]
            self.app.cfg["history"] = self.history
        self.hpos = len(self.history)
        if self.v_in.get() == text:
            self.v_in.set("")

    # -- Makros --
    def _build_macros(self):
        for w in self.macros.winfo_children():
            w.destroy()
        ttk.Label(self.macros, text="Schnellbefehle:", style="Muted.TLabel").pack(side="left", padx=(0, 8))
        for i, m in enumerate(self.app.cfg.get("macros", [])):
            b = ttk.Button(self.macros, text=m.get("name", "?"), command=lambda c=m.get("cmd", ""): self.send(c))
            b.pack(side="left", padx=(0, 6))
            b.bind("<Button-3>", lambda e, i=i: self._macro_menu(e, i))
            b.bind("<Button-2>", lambda e, i=i: self._macro_menu(e, i))
        ttk.Button(self.macros, text="+ Neu", command=self._add_macro).pack(side="left")
        ttk.Label(self.macros, text="Rechtsklick: ändern", style="Muted.TLabel").pack(side="left", padx=10)

    def _macro_dialog(self, name="", cmd=""):
        d = FormDialog(self.app, "Schnellbefehl", [("name", "Name auf dem Knopf", name, None),
                                                    ("cmd", "Befehl (wird so gesendet)", cmd, None)], "Speichern")
        if d.result and d.result["name"].strip() and d.result["cmd"].strip():
            return {"name": d.result["name"].strip(), "cmd": d.result["cmd"].strip()}
        return None

    def _add_macro(self):
        m = self._macro_dialog(cmd=self.v_in.get())
        if m:
            self.app.cfg.setdefault("macros", []).append(m)
            self._build_macros()

    def _macro_menu(self, e, i):
        t = self.app.theme
        menu = tk.Menu(self, tearoff=0, bg=t["card"], fg=t["fg"], activebackground=t["sel"], activeforeground=t["fg"],
                       bd=0)
        macros = self.app.cfg.get("macros", [])

        def edit():
            m = self._macro_dialog(macros[i]["name"], macros[i]["cmd"])
            if m:
                macros[i] = m
                self._build_macros()

        def delete():
            macros.pop(i)
            self._build_macros()

        def move(d):
            j = i + d
            if 0 <= j < len(macros):
                macros[i], macros[j] = macros[j], macros[i]
                self._build_macros()

        menu.add_command(label="Bearbeiten …", command=edit)
        menu.add_command(label="Nach links", command=lambda: move(-1))
        menu.add_command(label="Nach rechts", command=lambda: move(1))
        menu.add_separator()
        menu.add_command(label="Löschen", command=delete)
        menu.tk_popup(e.x_root, e.y_root)

    def on_show(self):
        self.entry.focus_set()


class FlashPage(Page):
    title = "Firmware & Flashen"
    subtitle = "Studio-Firmware installieren, eigene .bin-Dateien flashen, Flash löschen oder sichern"

    def build(self, f):
        a = self.app
        f.columnconfigure(0, weight=1, uniform="cols")
        f.columnconfigure(1, weight=1, uniform="cols")
        sc = make_card(f, "Studio-Firmware installieren",
                       "Damit die App WLAN, Hotspot, GPIO & Co. steuern kann, braucht der ESP32 einmalig die "
                       "Studio-Firmware.")
        sc.grid(row=0, column=0, sticky="nsew", padx=(0, 14))
        b = sc.body
        ttk.Label(b, text="Weg 1 – fertige Datei flashen (am einfachsten)", style="CardTitle.TLabel").pack(anchor="w")
        r = ttk.Frame(b, style="Card.TFrame")
        r.pack(fill="x", pady=(8, 0))
        self.v_fw = tk.StringVar()
        self.fw_combo = ttk.Combobox(r, textvariable=self.v_fw, state="readonly", width=18)
        self.fw_combo.pack(side="left", fill="x", expand=True)
        ttk.Button(r, text="Datei …", command=self._pick_fw).pack(side="left", padx=(8, 0))
        r = ttk.Frame(b, style="Card.TFrame")
        r.pack(fill="x", pady=(8, 0))
        self.detect_btn = ttk.Button(r, text="Chip erkennen", command=self.detect)
        self.detect_btn.pack(side="left")
        self.install_btn = ttk.Button(r, text="Firmware installieren", style="Accent.TButton", command=self.install)
        self.install_btn.pack(side="left", padx=8)
        self.fw_hint = ttk.Label(b, text="", style="CardMuted.TLabel", wraplength=520, justify="left")
        autowrap(self.fw_hint)
        self.fw_hint.pack(anchor="w", pady=(8, 0))
        ttk.Separator(b).pack(fill="x", pady=14)
        ttk.Label(b, text="Weg 2 – mit der Arduino IDE", style="CardTitle.TLabel").pack(anchor="w")
        autowrap(ttk.Label(b, style="CardMuted.TLabel", wraplength=520, justify="left", text=(
            "1. Arduino IDE öffnen, unter Boardverwalter »esp32 von Espressif« installieren.\n"
            "2. ESP32Studio.ino aus dem Sketch-Ordner öffnen.\n"
            "3. Board und Port wählen (bei ESP32-S3/C3 mit nativem USB: »USB CDC On Boot: Enabled«).\n"
            "4. Hochladen – fertig. Danach hier auf »Verbinden« klicken."))).pack(anchor="w", pady=(6, 0))
        ttk.Button(b, text="Sketch-Ordner öffnen", command=lambda: open_path(SKETCH_DIR)).pack(anchor="w", pady=(10, 0))

        cc = make_card(f, "Eigene Firmware flashen", "Zum Beispiel eine .bin aus der Arduino IDE (Sketch → Kompilierte "
                                                    "Binärdatei exportieren) oder von einem Projekt wie WLED/Tasmota.")
        cc.grid(row=0, column=1, sticky="nsew")
        b = cc.body
        b.columnconfigure(1, weight=1)
        self.v_file = tk.StringVar()
        self.v_addr = tk.StringVar(value="0x0")
        self.v_fbaud = tk.StringVar(value=str(a.cfg.get("flash_baud", 460800)))
        self.v_erase = tk.BooleanVar()
        ttk.Label(b, text="Datei", style="Card.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Entry(b, textvariable=self.v_file).grid(row=0, column=1, sticky="we", padx=8, pady=4)
        ttk.Button(b, text="Durchsuchen …", command=self._pick_file).grid(row=0, column=2)
        ttk.Label(b, text="Adresse", style="Card.TLabel").grid(row=1, column=0, sticky="w")
        ttk.Combobox(b, textvariable=self.v_addr, width=10, values=["0x0", "0x1000", "0x10000", "0x8000"]).grid(
            row=1, column=1, sticky="w", padx=8, pady=4)
        ttk.Label(b, text="0x0 = komplettes Image · 0x10000 = nur das Programm", style="CardMuted.TLabel",
                  wraplength=260, justify="left").grid(row=2, column=1, columnspan=2, sticky="w", padx=8)
        ttk.Label(b, text="Tempo", style="Card.TLabel").grid(row=3, column=0, sticky="w")
        ttk.Combobox(b, textvariable=self.v_fbaud, width=10, state="readonly",
                     values=["115200", "230400", "460800", "921600"]).grid(row=3, column=1, sticky="w", padx=8, pady=4)
        ttk.Checkbutton(b, text="Vorher den ganzen Flash löschen", variable=self.v_erase,
                        style="Card.TCheckbutton").grid(row=4, column=1, columnspan=2, sticky="w", padx=8, pady=(4, 0))
        self.flash_btn = ttk.Button(b, text="Flashen", style="Accent.TButton", command=self.flash_custom)
        self.flash_btn.grid(row=5, column=1, sticky="w", padx=8, pady=(12, 0))
        ttk.Separator(b).grid(row=6, column=0, columnspan=3, sticky="we", pady=14)
        ttk.Label(b, text="Werkzeuge", style="CardTitle.TLabel").grid(row=7, column=0, columnspan=3, sticky="w")
        r = Flow(b)
        r.grid(row=8, column=0, columnspan=3, sticky="we", pady=(8, 0))
        self.tool_btns = [
            r.add(ttk.Button(r, text="Chip-Infos auslesen", command=self.chip_info)),
            r.add(ttk.Button(r, text="Backup erstellen", command=self.backup)),
            r.add(ttk.Button(r, text="Flash löschen", style="Danger.TButton", command=self.erase)),
        ]

        oc = make_card(f, "Ausgabe")
        oc.grid(row=1, column=0, columnspan=2, sticky="nsew", pady=(14, 0))
        r = ttk.Frame(oc.body, style="Card.TFrame")
        r.pack(fill="x")
        self.prog = ttk.Progressbar(r, maximum=100, style="Card.Horizontal.TProgressbar")
        self.prog.pack(side="left", fill="x", expand=True)
        self.prog_lbl = ttk.Label(r, text="bereit", style="CardMuted.TLabel", width=34, anchor="e")
        self.prog_lbl.pack(side="left", padx=(10, 0))
        self.log = tk.Text(oc.body, height=13, wrap="word", bd=0, highlightthickness=0, padx=10, pady=8,
                           font=(a.mono_font, 9), state="disabled")
        a.register_raw(self.log, "text")
        self.log.pack(fill="both", expand=True, pady=(10, 0))
        self.busy = False
        self.q = queue.Queue()
        self._bins = []
        self._chip = None
        self.refresh_bins()
        if not HAS_ESPTOOL:
            self._log("esptool ist nicht installiert. Bitte im Terminal ausführen:  pip install esptool")

    # -- Firmware-Liste --
    def refresh_bins(self):
        self._bins = find_firmware_bins()
        labels = []
        for p in self._bins:
            key = p.stem.replace("esp32studio-", "")
            labels.append(f"{FIRMWARE_LABELS.get(key, key)}  –  {p.name}")
        self.fw_combo.configure(values=labels)
        if labels and not self.v_fw.get():
            self.fw_combo.current(0)
        if not labels:
            self.fw_hint.configure(text="Noch keine fertigen Firmware-Dateien gefunden. Sie liegen im Download "
                                        "»esp32studio-firmware« (GitHub → Actions) – einfach in den Ordner "
                                        "firmware/bin legen oder über »Datei …« auswählen. Oder Weg 2 nehmen.")
        else:
            self.fw_hint.configure(text="Tipp: »Chip erkennen« wählt automatisch die passende Datei.")

    def _pick_fw(self):
        p = filedialog.askopenfilename(filetypes=[("Firmware", "*.bin"), ("Alle Dateien", "*.*")])
        if p:
            path = Path(p)
            if path not in self._bins:
                self._bins.append(path)
            vals = list(self.fw_combo.cget("values")) + [f"{path.name}  –  {path.parent}"]
            self.fw_combo.configure(values=vals)
            self.fw_combo.current(len(vals) - 1)

    def _pick_file(self):
        p = filedialog.askopenfilename(filetypes=[("Firmware", "*.bin"), ("Alle Dateien", "*.*")])
        if p:
            self.v_file.set(p)
            self.v_addr.set("0x0" if "merged" in Path(p).name or "esp32studio" in Path(p).name else "0x10000")

    def _selected_bin(self):
        i = self.fw_combo.current()
        return self._bins[i] if 0 <= i < len(self._bins) else None

    def _choose_bin_for_chip(self, chip_text):
        fam = chip_family(chip_text)
        key = {"ESP32-S2": "esp32s2-usb", "ESP32-S3": "esp32s3", "ESP32-C3": "esp32c3", "ESP32-C6": "esp32c6-usb"}.get(
            fam, "esp32")
        port = self.app.selected_port()
        if port and port.native_usb and not key.endswith("-usb"):
            key += "-usb"
        for i, p in enumerate(self._bins):
            if p.stem == f"esp32studio-{key}":
                self.fw_combo.current(i)
                return key
        return None

    # -- esptool --
    def _log(self, text):
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def _set_busy(self, busy):
        self.busy = busy
        for btn in [self.install_btn, self.detect_btn, self.flash_btn] + self.tool_btns:
            btn.state(["disabled"] if busy else ["!disabled"])

    def run_esptool(self, make_args, title, on_done=None, reconnect=True):
        if self.busy:
            return
        port = self.app.conn_port if self.app.link.is_open and self.app.conn_port else self.app.selected_port()
        if port is None or not port.device:
            esp = [p for p in self.app.port_infos if p.likely_esp]
            if not esp:
                self.app.show_no_device()
                return
            port = esp[0]
            self.app._select_port(port.device)
        demo = port.device == DEMO_PORT
        if not demo and not HAS_ESPTOOL:
            messagebox.showerror(APP_NAME, "esptool fehlt.\n\nBitte im Terminal ausführen:\npip install esptool")
            return
        self.app.release_port()
        self._set_busy(True)
        self.prog["value"] = 0
        self.prog_lbl.configure(text=title + " …")
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")
        self._log(f"▶ {title} an {port.device}")
        self._output = []
        baud = self.v_fbaud.get()
        self.app.cfg["flash_baud"] = int(baud)
        t = threading.Thread(target=self._work, args=(port.device, baud, make_args, demo), daemon=True)
        t.start()
        self._poll(on_done, port, reconnect)

    def _work(self, device, baud, make_args, demo):
        if demo:
            for line in ("esptool v5 (Demo)", "Connecting....", "Chip type: ESP32-D0WD-V3 (revision v3.1)",
                         "Features: Wi-Fi, BT, Dual Core + LP Core, 240MHz", "MAC: 24:6f:28:aa:bb:cc",
                         "Uploading stub flasher...", "Changing baud rate to 460800..."):
                self.q.put(("out", line))
                time.sleep(0.15)
            for p in range(0, 101, 4):
                self.q.put(("out", f"Writing at 0x{p * 0x9c40:08x} [{'=' * (p // 5):<20}] {p:5.1f}%"))
                time.sleep(0.08)
            self.q.put(("out", "Hash of data verified."))
            self.q.put(("out", "Hard resetting via RTS pin..."))
            self.q.put(("done", 0))
            return
        import esptool  # erst hier laden, das dauert etwas

        try:
            v5 = int(str(esptool.__version__).split(".")[0]) >= 5
        except ValueError:
            v5 = True
        args = ["--port", device, "--baud", str(baud)] + make_args(v5)
        writer = _QueueWriter(self.q)
        code = 1
        with contextlib.redirect_stdout(writer), contextlib.redirect_stderr(writer):
            try:
                esptool.main(args)
                code = 0
            except SystemExit as e:
                code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
            except Exception as e:  # FatalError, SerialException …
                print(f"Fehler: {e}")
                code = 1
        writer.flush()
        self.q.put(("done", code))

    def _poll(self, on_done, port, reconnect):
        try:
            while True:
                kind, val = self.q.get_nowait()
                if kind == "out":
                    self._output.append(val)
                    m = re.search(r"(\d{1,3}(?:\.\d+)?)\s?%", val)
                    if m and ("Writing" in val or "Reading" in val or "Erasing" in val or "[" in val):
                        self.prog["value"] = float(m.group(1))
                        self.prog_lbl.configure(text=f"{float(m.group(1)):.0f} %")
                    else:
                        self._log(val)
                elif kind == "done":
                    self._finish(val, on_done, port, reconnect)
                    return
        except queue.Empty:
            pass
        self.after(60, lambda: self._poll(on_done, port, reconnect))

    def _finish(self, code, on_done, port, reconnect):
        self._set_busy(False)
        out = "\n".join(self._output)
        if code == 0:
            self.prog["value"] = 100
            self.prog_lbl.configure(text="✓ fertig")
            self._log("✓ Erfolgreich.")
        else:
            self.prog_lbl.configure(text="✗ fehlgeschlagen")
            self._log("✗ Fehlgeschlagen.")
            if re.search(r"(Failed to connect|No serial data|Wrong boot mode|timed out)", out, re.I):
                self._log("Tipp: BOOT-Taste gedrückt halten, kurz EN/RESET drücken, BOOT loslassen – dann nochmal.")
            if re.search(r"(Permission|Access is denied|busy|could not open)", out, re.I):
                self._log("Tipp: Der Port ist belegt. Andere Programme (Arduino IDE, Serial Monitor) schließen.")
        if on_done:
            on_done(code, out)
        if reconnect:
            self.app.reconnect_soon(port)

    # -- Aktionen --
    def auto_install(self):
        """Ein Klick: Chip erkennen, passende Datei wählen, nachfragen, flashen, neu verbinden."""
        if self.busy:
            return
        self.app.show_page("flash")
        self.refresh_bins()
        if not self._bins:
            self.fw_hint.configure(style="Warn.TLabel")
            self.app.notify("Keine fertige Firmware-Datei gefunden – siehe »Weg 1« oder »Weg 2«", "warn")
            return

        def detected(code, out):
            port = self.app.selected_port()
            m = re.search(r"(?:Chip is|Chip type:|Detecting chip type\.*)\s*(ESP32[-\w]*)", out)
            if code != 0 or not m:
                self._log("Chip nicht erkannt. Prüfe den Port oder versuche es mit gedrückter BOOT-Taste.")
                if port:
                    self.app.reconnect_soon(port)
                return
            self._chip = m.group(1)
            key = self._choose_bin_for_chip(self._chip)
            if not key:
                self.fw_hint.configure(text=f"Erkannt: {self._chip} – dafür gibt es keine fertige Datei. Bitte Weg 2.")
                if port:
                    self.app.reconnect_soon(port)
                return
            p = self._selected_bin()
            self.fw_hint.configure(text=f"Erkannt: {self._chip} → {FIRMWARE_LABELS.get(key, key)}")
            if not messagebox.askyesno(APP_NAME, f"Erkannt: {self._chip}\n\nStudio-Firmware „{p.name}“ jetzt "
                                                 "installieren?\nDas bisherige Programm auf dem ESP32 wird ersetzt."):
                if port:
                    self.app.reconnect_soon(port)
                return
            self.run_esptool(lambda v5: ["write-flash" if v5 else "write_flash", "0x0", str(p)],
                             "Firmware installieren",
                             lambda c, o: c == 0 and self.app.notify("Studio-Firmware installiert – verbinde …", "ok"))

        self.run_esptool(lambda v5: ["read-mac" if v5 else "read_mac"], "Chip erkennen", detected, reconnect=False)

    def detect(self):
        def done(code, out):
            m = re.search(r"(?:Chip is|Chip type:|Detecting chip type\.*)\s*(ESP32[-\w]*)", out)
            if code == 0 and m:
                self._chip = m.group(1)
                key = self._choose_bin_for_chip(self._chip)
                self.fw_hint.configure(text=f"Erkannt: {self._chip}" + (
                    f" → passende Datei gewählt ({FIRMWARE_LABELS.get(key, key)})" if key else
                    " – keine passende fertige Datei gefunden, bitte Weg 2 nehmen."))
            elif code == 0:
                self.fw_hint.configure(text="Chip gefunden, Typ aber nicht erkannt.")

        self.run_esptool(lambda v5: ["read-mac" if v5 else "read_mac"], "Chip erkennen", done)

    def install(self):
        p = self._selected_bin()
        if p is None:
            self.app.notify("Keine Firmware-Datei gewählt", "warn")
            return
        if not messagebox.askyesno(APP_NAME, f"„{p.name}“ auf den ESP32 flashen?\n\nDas bisherige Programm auf dem "
                                             "ESP32 wird dabei ersetzt."):
            return
        self.run_esptool(lambda v5: ["write-flash" if v5 else "write_flash", "0x0", str(p)], "Firmware installieren",
                         lambda c, o: c == 0 and self.app.notify("Studio-Firmware installiert", "ok"))

    def flash_custom(self):
        p = Path(self.v_file.get().strip())
        if not p.is_file():
            self.app.notify("Bitte eine .bin-Datei wählen", "warn")
            return
        addr = self.v_addr.get().strip() or "0x0"
        if not re.fullmatch(r"0x[0-9a-fA-F]+|\d+", addr):
            self.app.notify("Adresse ungültig, z. B. 0x10000", "err")
            return
        erase = self.v_erase.get()
        if not messagebox.askyesno(APP_NAME, f"„{p.name}“ an Adresse {addr} flashen?"
                                             + ("\n\nDer ganze Flash wird vorher gelöscht!" if erase else "")):
            return

        def args(v5):
            a = ["write-flash" if v5 else "write_flash"]
            if erase:
                a.append("--erase-all")
            return a + [addr, str(p)]

        self.run_esptool(args, "Flashen")

    def chip_info(self):
        def args(v5):
            return ["flash-id" if v5 else "flash_id"]

        self.run_esptool(args, "Chip-Infos auslesen")

    def erase(self):
        if messagebox.askyesno(APP_NAME, "Wirklich den GANZEN Flash löschen?\n\nDanach ist kein Programm mehr auf dem "
                                         "ESP32 – auch die Studio-Firmware nicht.", icon="warning"):
            self.run_esptool(lambda v5: ["erase-flash" if v5 else "erase_flash"], "Flash löschen")

    def backup(self):
        p = filedialog.asksaveasfilename(defaultextension=".bin",
                                         initialfile=f"esp32-backup-{time.strftime('%Y%m%d-%H%M%S')}.bin",
                                         filetypes=[("Binärdatei", "*.bin")])
        if p:
            self.run_esptool(lambda v5: ["read-flash" if v5 else "read_flash", "0", "ALL", p],
                             "Flash sichern (dauert etwas)")

    def on_show(self):
        self.refresh_bins()


class _QueueWriter(io.TextIOBase):
    """Fängt die Ausgabe von esptool ab und reicht sie zeilenweise weiter."""

    def __init__(self, q):
        super().__init__()
        self.q, self.buf = q, ""

    def write(self, s):
        self.buf += s
        parts = re.split(r"[\r\n]", self.buf)
        self.buf = parts.pop()
        for p in parts:
            p = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", p)
            if p.strip():
                self.q.put(("out", p))
        return len(s)

    def flush(self):
        if self.buf.strip():
            self.q.put(("out", self.buf))
        self.buf = ""

    def isatty(self):
        return False


class SettingsPage(Page):
    title = "Einstellungen"
    subtitle = "App anpassen und den ESP32 konfigurieren"

    def build(self, f):
        a = self.app
        f.columnconfigure(0, weight=1, uniform="cols")
        f.columnconfigure(1, weight=1, uniform="cols")
        ac = make_card(f, "App")
        ac.grid(row=0, column=0, sticky="nsew", padx=(0, 14))
        b = ac.body
        self.v_theme = tk.StringVar(value="Dunkel" if a.cfg["theme"] == "dark" else "Hell")
        r = ttk.Frame(b, style="Card.TFrame")
        r.pack(fill="x")
        ttk.Label(r, text="Design", style="Card.TLabel").pack(side="left")
        cb = ttk.Combobox(r, textvariable=self.v_theme, values=["Dunkel", "Hell"], state="readonly", width=10)
        cb.pack(side="left", padx=10)
        cb.bind("<<ComboboxSelected>>", lambda e: a.set_theme("dark" if self.v_theme.get() == "Dunkel" else "light"))
        r = ttk.Frame(b, style="Card.TFrame")
        r.pack(fill="x", pady=(10, 0))
        ttk.Label(r, text="Live-Werte alle", style="Card.TLabel").pack(side="left")
        self.v_poll = tk.StringVar(value=str(a.cfg.get("poll_s", 2)))
        cb = ttk.Combobox(r, textvariable=self.v_poll, values=["1", "2", "5", "10"], state="readonly", width=4)
        cb.pack(side="left", padx=8)
        cb.bind("<<ComboboxSelected>>", lambda e: a.cfg.__setitem__("poll_s", int(self.v_poll.get())))
        ttk.Label(r, text="Sekunden abfragen", style="Card.TLabel").pack(side="left")
        self.opts = {}
        for key, text in (("auto_connect", "Beim Start und beim Einstecken automatisch verbinden"),
                          ("auto_reconnect", "Nach Neustart oder Wackelkontakt automatisch wieder verbinden"),
                          ("toasts", "Benachrichtigungen unten rechts anzeigen")):
            v = tk.BooleanVar(value=bool(a.cfg.get(key)))
            ttk.Checkbutton(b, text=text, variable=v, style="Card.TCheckbutton",
                            command=lambda k=key, v=v: a.cfg.__setitem__(k, v.get())).pack(anchor="w", pady=(10, 0))
            self.opts[key] = v
        autowrap(ttk.Label(b, text=f"Einstellungen werden gespeichert in: {CONFIG_PATH}", style="CardMuted.TLabel",
                           wraplength=480)).pack(anchor="w", pady=(14, 0))

        dc = make_card(f, "Gerät", "Wird direkt auf dem ESP32 gespeichert.")
        dc.grid(row=0, column=1, sticky="nsew")
        b = dc.body
        b.columnconfigure(1, weight=1)
        self.v_name = tk.StringVar()
        self.v_led = tk.StringVar()
        self.v_cpu = tk.StringVar(value="240")
        ttk.Label(b, text="Gerätename", style="Card.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Entry(b, textvariable=self.v_name).grid(row=0, column=1, sticky="we", padx=8, pady=4)
        ttk.Button(b, text="Speichern", command=lambda: a.cmd("name", self.v_name.get().strip(), ok=lambda d: (
            a.notify(f"Name: {d.get('name')}", "ok"), a.refresh_info()))).grid(row=0, column=2)
        ttk.Label(b, text="LED-Pin", style="Card.TLabel").grid(row=1, column=0, sticky="w")
        ttk.Spinbox(b, from_=-1, to=48, textvariable=self.v_led, width=6).grid(row=1, column=1, sticky="w", padx=8, pady=4)
        ttk.Button(b, text="Speichern", command=lambda: a.cmd("led.pin", self.v_led.get(), ok=lambda d: (
            a.notify(f"LED-Pin: {d.get('pin')}", "ok"), a.refresh_info()))).grid(row=1, column=2)
        ttk.Label(b, text="CPU-Takt", style="Card.TLabel").grid(row=2, column=0, sticky="w")
        ttk.Combobox(b, textvariable=self.v_cpu, values=["80", "160", "240"], state="readonly", width=6).grid(
            row=2, column=1, sticky="w", padx=8, pady=4)
        ttk.Button(b, text="Setzen", command=lambda: a.cmd("cpu", self.v_cpu.get(), ok=lambda d: (
            a.notify(f"CPU läuft mit {d.get('mhz')} MHz", "ok"), a.refresh_info()))).grid(row=2, column=2)
        ttk.Label(b, text="Weniger Takt = weniger Strom und Wärme. Gilt bis zum Neustart.", style="CardMuted.TLabel").grid(
            row=3, column=1, columnspan=2, sticky="w", padx=8)
        ttk.Separator(b).grid(row=4, column=0, columnspan=3, sticky="we", pady=14)
        ttk.Button(b, text="Werkseinstellungen …", style="Danger.TButton", command=self.factory).grid(
            row=5, column=0, columnspan=3, sticky="w")
        ttk.Label(b, text="Löscht Name, WLAN, Hotspot und alle gespeicherten Werte auf dem ESP32.",
                  style="CardMuted.TLabel").grid(row=6, column=0, columnspan=3, sticky="w", pady=(4, 0))

        ab = make_card(f, "Über & Tastenkürzel")
        ab.grid(row=1, column=0, columnspan=2, sticky="nsew", pady=(14, 0))
        ttk.Label(ab.body, style="Card.TLabel", justify="left", text=(
            f"{APP_NAME} {APP_VERSION}  ·  Python {sys.version.split()[0]}  ·  Tk {tk.TkVersion}  ·  "
            f"pyserial {'✓' if serial else '✗'}  ·  esptool {'✓' if HAS_ESPTOOL else '✗'}  ·  "
            f"QR-Codes {'✓' if segno else '✗'}")).pack(anchor="w")
        ttk.Label(ab.body, style="CardMuted.TLabel", justify="left", text=(
            "Strg+1 … Strg+8  Bereiche wechseln     ·     F5  Infos aktualisieren     ·     "
            "Strg+R  ESP32 neu starten     ·     Strg+L  Monitor leeren     ·     Strg+K  Verbinden/Trennen")).pack(
            anchor="w", pady=(6, 0))

    def factory(self):
        if messagebox.askyesno(APP_NAME, "Den ESP32 auf Werkseinstellungen zurücksetzen?\n\nName, WLAN-Zugang, "
                                         "Hotspot und alle gespeicherten Werte werden gelöscht.", icon="warning"):
            self.app.cmd("factory", ok=lambda d: self.app.notify("Zurückgesetzt – ESP32 startet neu", "ok"))

    def on_info(self, d):
        self.v_name.set(d.get("name", ""))
        self.v_led.set(str(d.get("sys", {}).get("led_pin", "")))
        self.v_cpu.set(str(d.get("chip", {}).get("mhz", 240)))


# ---------------------------------------------------------------------------
# Hauptfenster
# ---------------------------------------------------------------------------
NAV = [
    ("dashboard", "▦  Übersicht", DashboardPage),
    ("wifi", "≋  WLAN", WifiPage),
    ("hotspot", "◎  Hotspot", HotspotPage),
    ("gpio", "⚡  GPIO & Pins", GpioPage),
    ("tools", "⚒  Werkzeuge", ToolsPage),
    ("monitor", "▤  Serieller Monitor", MonitorPage),
    ("flash", "⇪  Firmware & Flashen", FlashPage),
    ("settings", "⚙  Einstellungen", SettingsPage),
]


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.cfg = load_config()
        self.theme = THEMES[self.cfg["theme"]]
        self.link = Link()
        self.pending: dict[int, dict] = {}
        self.fw = None
        self.info: dict = {}
        self.stats: dict = {}
        self.state = "off"  # off | on | waiting
        self.handshaking = False
        self.handshake_attempts = 0
        self.want_connected = False
        self.reconnect_port = None
        self.stats_pending = False
        self.stats_fails = 0
        self.last_stats = 0.0
        self.last_scan: list = []
        self.chip_changed = True
        self._last_chip = None
        self.port_infos = []
        self._known_ports = None
        self.conn_port = None
        self.conn_lines = self.conn_garbage = 0
        self.conn_saw_bootloader = False
        self.hs_attempt = 0
        self.hs_reset_done = self.hs_baud_done = False
        self.hs_note = ""
        self.reconnect_since = 0.0
        self.reconnect_known = set()
        self.wait_reason = ""
        self.last_hello = 0.0
        self._next_driver_check = 0.0
        self._ui_q: queue.Queue = queue.Queue()
        self._nodev = None
        self._usb_shown = set()
        self._raw = []
        self._toasts = []
        self._traffic = ""
        self.current_page = None

        self.title(APP_NAME)
        self.geometry(self.cfg.get("geometry", "1280x820"))
        self.minsize(1080, 680)
        self._fonts()
        self._style()
        self._icon()
        self._build()
        self.refresh_ports()
        self.show_page("dashboard")
        self._bind_keys()
        self.protocol("WM_DELETE_WINDOW", self.on_close)
        self.after(30, self._pump)
        self.after(500, self._poll_stats)
        self.after(250, self._page_tick)
        self.after(2000, self._ports_loop)
        self.after(400, self._autostart)

    # -- Aussehen ------------------------------------------------------------
    def _fonts(self):
        self.ui_font = pick_font(["Segoe UI", "SF Pro Text", "Helvetica Neue", "Inter", "Ubuntu", "Cantarell",
                                  "Noto Sans", "DejaVu Sans"], "TkDefaultFont")
        self.mono_font = pick_font(["Cascadia Mono", "Consolas", "SF Mono", "Menlo", "JetBrains Mono",
                                    "DejaVu Sans Mono", "Liberation Mono"], "TkFixedFont")
        for name in ("TkDefaultFont", "TkTextFont", "TkMenuFont", "TkHeadingFont"):
            try:
                tkfont.nametofont(name).configure(family=self.ui_font, size=10)
            except tk.TclError:
                pass

    def _style(self):
        t, F = self.theme, self.ui_font
        s = ttk.Style(self)
        s.theme_use("clam")
        self.configure(bg=t["bg"])
        s.configure(".", background=t["bg"], foreground=t["fg"], fieldbackground=t["input"], bordercolor=t["border"],
                    darkcolor=t["bg"], lightcolor=t["bg"], troughcolor=t["card2"], focuscolor=t["accent"],
                    selectbackground=t["sel"], selectforeground=t["fg"], insertcolor=t["fg"], font=(F, 10))
        s.configure("TFrame", background=t["bg"])
        s.configure("Panel.TFrame", background=t["panel"])
        s.configure("Card.TFrame", background=t["card"])
        s.configure("Banner.TFrame", background=t["warn"])
        s.configure("TLabel", background=t["bg"], foreground=t["fg"])
        s.configure("Muted.TLabel", background=t["bg"], foreground=t["muted"])
        s.configure("PageTitle.TLabel", background=t["bg"], font=(F, 18, "bold"))
        s.configure("Panel.TLabel", background=t["panel"], foreground=t["fg"])
        s.configure("PanelMuted.TLabel", background=t["panel"], foreground=t["muted"], font=(F, 9))
        s.configure("Logo.TLabel", background=t["panel"], foreground=t["fg"], font=(F, 14, "bold"))
        s.configure("Banner.TLabel", background=t["warn"], foreground="#1a1200", font=(F, 10, "bold"))
        s.configure("Status.TLabel", background=t["panel"], foreground=t["muted"], font=(F, 9))
        s.configure("Card.TLabel", background=t["card"], foreground=t["fg"])
        s.configure("CardMuted.TLabel", background=t["card"], foreground=t["muted"], font=(F, 9))
        s.configure("CardTitle.TLabel", background=t["card"], foreground=t["fg"], font=(F, 11, "bold"))
        s.configure("H1.TLabel", background=t["card"], foreground=t["fg"], font=(F, 20, "bold"))
        s.configure("Value.TLabel", background=t["card"], foreground=t["fg"], font=(F, 16, "bold"))
        s.configure("ValueOk.TLabel", background=t["card"], foreground=t["ok"], font=(F, 16, "bold"))
        s.configure("ValueWarn.TLabel", background=t["card"], foreground=t["warn"], font=(F, 16, "bold"))
        s.configure("ValueErr.TLabel", background=t["card"], foreground=t["err"], font=(F, 16, "bold"))
        s.configure("Big.TLabel", background=t["card"], foreground=t["fg"], font=(F, 26, "bold"))
        s.configure("Ok.TLabel", background=t["card"], foreground=t["ok"])
        s.configure("Warn.TLabel", background=t["card"], foreground=t["warn"])
        s.configure("Err.TLabel", background=t["card"], foreground=t["err"])
        s.configure("Link.TLabel", background=t["card"], foreground=t["accent_hi"], font=(F, 10, "underline"))

        s.configure("TButton", background=t["card2"], foreground=t["fg"], bordercolor=t["border"],
                    lightcolor=t["card2"], darkcolor=t["card2"], padding=(12, 6), focusthickness=0, relief="flat")
        s.map("TButton", background=[("disabled", t["card"]), ("pressed", t["sel"]), ("active", t["sel"])],
              foreground=[("disabled", t["muted"])], bordercolor=[("active", t["accent"])],
              lightcolor=[("active", t["sel"])], darkcolor=[("active", t["sel"])])
        s.configure("Accent.TButton", background=t["accent"], foreground=t["on_accent"], bordercolor=t["accent"],
                    lightcolor=t["accent"], darkcolor=t["accent"], font=(F, 10, "bold"))
        s.map("Accent.TButton", background=[("disabled", t["card2"]), ("pressed", t["accent"]), ("active", t["accent_hi"])],
              foreground=[("disabled", t["muted"])], bordercolor=[("active", t["accent_hi"])],
              lightcolor=[("active", t["accent_hi"])], darkcolor=[("active", t["accent_hi"])])
        s.configure("Danger.TButton", background=t["danger_bg"], foreground=t["err"], bordercolor=t["danger_bg"],
                    lightcolor=t["danger_bg"], darkcolor=t["danger_bg"])
        s.map("Danger.TButton", background=[("active", t["err"])], foreground=[("active", "#ffffff")],
              bordercolor=[("active", t["err"])])
        s.configure("Nav.TButton", background=t["panel"], foreground=t["muted"], bordercolor=t["panel"],
                    lightcolor=t["panel"], darkcolor=t["panel"], anchor="w", padding=(16, 10), font=(F, 10))
        s.map("Nav.TButton", background=[("active", t["card2"])], foreground=[("active", t["fg"])],
              bordercolor=[("active", t["card2"])], lightcolor=[("active", t["card2"])],
              darkcolor=[("active", t["card2"])])
        s.configure("NavActive.TButton", background=t["sel"], foreground=t["fg"], bordercolor=t["sel"],
                    lightcolor=t["sel"], darkcolor=t["sel"], anchor="w", padding=(16, 10), font=(F, 10, "bold"))
        s.map("NavActive.TButton", background=[("active", t["sel"])])
        s.configure("Head.TButton", background=t["card2"], foreground=t["fg"], bordercolor=t["border"],
                    padding=(10, 5))
        s.configure("Banner.TButton", background="#1a1200", foreground=t["warn"], bordercolor="#1a1200",
                    lightcolor="#1a1200", darkcolor="#1a1200", padding=(10, 3))
        s.map("Banner.TButton", background=[("active", "#3a2a00")])

        for w in ("TEntry", "TCombobox", "TSpinbox"):
            s.configure(w, fieldbackground=t["input"], foreground=t["fg"], bordercolor=t["border"],
                        lightcolor=t["border"], darkcolor=t["border"], insertcolor=t["fg"], padding=5,
                        background=t["card2"], arrowcolor=t["fg"], selectbackground=t["sel"], selectforeground=t["fg"])
            s.map(w, bordercolor=[("focus", t["accent"])], lightcolor=[("focus", t["accent"])],
                  fieldbackground=[("readonly", t["input"]), ("disabled", t["card"])],
                  foreground=[("disabled", t["muted"])], selectbackground=[("readonly", t["input"])],
                  selectforeground=[("readonly", t["fg"])], arrowcolor=[("disabled", t["muted"])])
        self.option_add("*TCombobox*Listbox.background", t["card"])
        self.option_add("*TCombobox*Listbox.foreground", t["fg"])
        self.option_add("*TCombobox*Listbox.selectBackground", t["accent"])
        self.option_add("*TCombobox*Listbox.selectForeground", t["on_accent"])
        self.option_add("*TCombobox*Listbox.font", (F, 10))
        for name, bg in (("TCheckbutton", t["bg"]), ("Card.TCheckbutton", t["card"])):
            s.configure(name, background=bg, foreground=t["fg"], indicatorbackground=t["input"],
                        indicatorforeground=t["on_accent"], indicatorcolor=t["input"], focusthickness=0,
                        bordercolor=t["border"], upperbordercolor=t["border"], lowerbordercolor=t["border"])
            s.map(name, background=[("active", bg)], indicatorcolor=[("selected", t["accent"])],
                  indicatorbackground=[("selected", t["accent"])])
        s.configure("Treeview", background=t["card"], fieldbackground=t["card"], foreground=t["fg"],
                    bordercolor=t["card"], lightcolor=t["card"], darkcolor=t["card"], rowheight=26)
        s.map("Treeview", background=[("selected", t["sel"])], foreground=[("selected", t["fg"])])
        s.configure("Treeview.Heading", background=t["card2"], foreground=t["muted"], bordercolor=t["card2"],
                    lightcolor=t["card2"], darkcolor=t["card2"], relief="flat", font=(F, 9, "bold"), padding=(6, 4))
        s.map("Treeview.Heading", background=[("active", t["sel"])])
        for name in ("Horizontal.TProgressbar", "Card.Horizontal.TProgressbar"):
            s.configure(name, troughcolor=t["card2"], background=t["accent"], bordercolor=t["card2"],
                        lightcolor=t["accent"], darkcolor=t["accent"], thickness=6)
        s.configure("Horizontal.TScale", background=t["accent"], troughcolor=t["card2"], bordercolor=t["card2"],
                    lightcolor=t["accent"], darkcolor=t["accent"])
        s.configure("Vertical.TScrollbar", background=t["card2"], troughcolor=t["bg"], bordercolor=t["bg"],
                    lightcolor=t["card2"], darkcolor=t["card2"], arrowcolor=t["muted"], gripcount=0)
        s.map("Vertical.TScrollbar", background=[("active", t["sel"])])
        s.configure("TSeparator", background=t["border"])

    def register_raw(self, widget, kind):
        self._raw.append((widget, kind))
        self._style_raw(widget, kind)

    def _style_raw(self, w, kind):
        t = self.theme
        try:
            if kind == "text":
                w.configure(bg=t["input"], fg=t["fg"], insertbackground=t["fg"], selectbackground=t["sel"],
                            selectforeground=t["fg"])
            elif kind == "bg":
                w.configure(bg=t["bg"])
            elif kind == "panel":
                w.configure(bg=t["panel"])
            elif kind in ("cardbg", "qr"):
                w.configure(bg=t["card"])
            elif kind in ("chart", "dot"):
                w.redraw()
        except tk.TclError:
            pass

    def set_theme(self, name):
        self.cfg["theme"] = name
        self.theme = THEMES[name]
        self._style()
        self._raw = [(w, k) for w, k in self._raw if w.winfo_exists()]
        for w, k in self._raw:
            self._style_raw(w, k)
        self.pages["monitor"].restyle()
        self.pages["wifi"]._fill()
        self.pages["wifi"]._draw_channels()
        self.pages["hotspot"]._draw_qr()
        self._update_conn_ui()
        self._highlight_nav()

    def _icon(self):
        try:
            size = 64
            img = tk.PhotoImage(width=size, height=size)
            img.put(self.theme["accent"], to=(0, 0, size, size))
            img.put("#0b1730", to=(16, 16, 48, 48))
            for i in range(4):
                p = 19 + i * 8
                img.put("#ffffff", to=(p, 6, p + 4, 16))
                img.put("#ffffff", to=(p, 48, p + 4, 58))
                img.put("#ffffff", to=(6, p, 16, p + 4))
                img.put("#ffffff", to=(48, p, 58, p + 4))
            img.put("#60a5fa", to=(26, 26, 38, 38))
            self.iconphoto(True, img)
            self._icon_img = img
        except tk.TclError:
            pass

    # -- Aufbau --------------------------------------------------------------
    def _build(self):
        head = ttk.Frame(self, style="Panel.TFrame", padding=(16, 10))
        head.pack(fill="x")
        logo = ttk.Frame(head, style="Panel.TFrame")
        logo.pack(side="left")
        ttk.Label(logo, text="◆ " + APP_NAME, style="Logo.TLabel").pack(side="left")
        mid = ttk.Frame(head, style="Panel.TFrame")
        mid.pack(side="left", padx=(28, 0))
        ttk.Label(mid, text="Port", style="PanelMuted.TLabel").pack(side="left")
        self.port_var = tk.StringVar()
        self.port_combo = ttk.Combobox(mid, textvariable=self.port_var, state="readonly", width=32)
        self.port_combo.pack(side="left", padx=(6, 4))
        ttk.Button(mid, text="⟳", width=3, command=lambda: self.refresh_ports(notify=True)).pack(side="left")
        ttk.Label(mid, text="Baud", style="PanelMuted.TLabel").pack(side="left", padx=(14, 0))
        self.baud_var = tk.StringVar(value=str(self.cfg.get("baud", 115200)))
        bc = ttk.Combobox(mid, textvariable=self.baud_var, width=8,
                          values=["9600", "19200", "38400", "57600", "115200", "230400", "460800", "921600"])
        bc.pack(side="left", padx=(6, 12))
        bc.bind("<<ComboboxSelected>>", lambda e: self._baud_changed())
        bc.bind("<Return>", lambda e: self._baud_changed())
        self.conn_btn = ttk.Button(mid, text="Verbinden", style="Accent.TButton", width=12, command=self.toggle_connect)
        self.conn_btn.pack(side="left")
        right = ttk.Frame(head, style="Panel.TFrame")
        right.pack(side="left", padx=(18, 0))
        self.conn_dot = Dot(right, self, 12, "panel")
        self.conn_dot.pack(side="left")
        self.conn_lbl = ttk.Label(right, text="Getrennt", style="Panel.TLabel")
        self.conn_lbl.pack(side="left", padx=(8, 0))

        self.banner = ttk.Frame(self, style="Banner.TFrame", padding=(16, 6))
        self.banner_lbl = ttk.Label(self.banner, text="", style="Banner.TLabel")
        self.banner_lbl.pack(side="left")
        self.banner_btns = ttk.Frame(self.banner, style="Banner.TFrame")
        self.banner_btns.pack(side="right")

        self.status = ttk.Frame(self, style="Panel.TFrame", padding=(16, 5))
        self.status.pack(side="bottom", fill="x")
        self.status_lbl = ttk.Label(self.status, text="Bereit", style="Status.TLabel")
        self.status_lbl.pack(side="left")
        self.traffic_lbl = ttk.Label(self.status, text="", style="Status.TLabel")
        self.traffic_lbl.pack(side="right")

        self.body = ttk.Frame(self)
        self.body.pack(fill="both", expand=True)
        side = ttk.Frame(self.body, style="Panel.TFrame", padding=(10, 14), width=230)
        side.pack(side="left", fill="y")
        side.pack_propagate(False)
        self.nav_btns = {}
        for i, (key, label, _cls) in enumerate(NAV):
            b = ttk.Button(side, text=label, style="Nav.TButton", command=lambda k=key: self.show_page(k))
            b.pack(fill="x", pady=1)
            self.nav_btns[key] = b
        ttk.Label(side, text=f"v{APP_VERSION}", style="PanelMuted.TLabel").pack(side="bottom", anchor="w", padx=16)
        self.side_hint = ttk.Label(side, text="", style="PanelMuted.TLabel", wraplength=190, justify="left")
        self.side_hint.pack(side="bottom", anchor="w", padx=16, pady=(0, 8))

        self.stack = ttk.Frame(self.body)
        self.stack.pack(side="left", fill="both", expand=True)
        self.stack.rowconfigure(0, weight=1)
        self.stack.columnconfigure(0, weight=1)
        self.pages = {}
        for key, _label, cls in NAV:
            p = cls(self.stack, self)
            p.grid(row=0, column=0, sticky="nsew")
            self.pages[key] = p
        self.monitor: MonitorPage = self.pages["monitor"]
        for n in self.cfg.get("watch_pins", []):
            self.pages["gpio"].add_watch([n])

    def _bind_keys(self):
        for i, (key, _l, _c) in enumerate(NAV):
            self.bind_all(f"<Control-Key-{i + 1}>", lambda e, k=key: self.show_page(k))
        self.bind_all("<F5>", lambda e: self.refresh_info())
        self.bind_all("<Control-r>", lambda e: self.cmd("restart", ok=lambda d: self.notify("ESP32 startet neu …")))
        self.bind_all("<Control-l>", lambda e: self.monitor.clear())
        self.bind_all("<Control-k>", lambda e: self.toggle_connect())

    def show_page(self, key):
        p = self.pages[key]
        self.current_page = p
        p.tkraise()
        self._highlight_nav()
        p.on_show()

    def _highlight_nav(self):
        for k, b in self.nav_btns.items():
            b.configure(style="NavActive.TButton" if self.pages[k] is self.current_page else "Nav.TButton")

    # -- Meldungen ------------------------------------------------------------
    def notify(self, msg, level="info"):
        t = self.theme
        color = {"ok": t["ok"], "err": t["err"], "warn": t["warn"]}.get(level, t["muted"])
        self.status_lbl.configure(text=msg, foreground=color)
        if level == "err":
            self.monitor.log_sys("Fehler: " + msg)
        if not self.cfg.get("toasts", True):
            return
        self._toasts = [x for x in self._toasts if x.winfo_exists()]
        if len(self._toasts) >= 4:
            self._toasts.pop(0).destroy()
        fr = tk.Frame(self, bg=t["card2"], highlightthickness=1, highlightbackground=color, padx=14, pady=9)
        tk.Label(fr, text=msg, bg=t["card2"], fg=t["fg"], font=(self.ui_font, 10), wraplength=340,
                 justify="left").pack()
        self._toasts.append(fr)
        self._place_toasts()
        fr.bind("<Button-1>", lambda e: fr.destroy())
        self.after(3800 if level != "err" else 6000, lambda: (fr.destroy(), self._place_toasts()))

    def _place_toasts(self):
        self._toasts = [x for x in self._toasts if x.winfo_exists()]
        y = -40
        for fr in reversed(self._toasts):
            fr.place(relx=1.0, rely=1.0, x=-18, y=y, anchor="se")
            fr.update_idletasks()
            y -= fr.winfo_reqheight() + 8

    def _show_banner(self, text, buttons):
        self.banner_lbl.configure(text=text)
        for w in self.banner_btns.winfo_children():
            w.destroy()
        for label, cmd in buttons:
            ttk.Button(self.banner_btns, text=label, style="Banner.TButton", command=cmd).pack(side="left", padx=(8, 0))
        ttk.Button(self.banner_btns, text="✕", style="Banner.TButton", width=3, command=self._hide_banner).pack(
            side="left", padx=(8, 0))
        self.banner.pack(fill="x", before=self.body)

    def _hide_banner(self):
        self.banner.pack_forget()

    # -- Ports & Verbindung ---------------------------------------------------
    def refresh_ports(self, notify=False):
        cur = self.selected_port()
        cur_dev = cur.device if cur and cur.device else self.cfg.get("port")
        infos = list_serial_ports()
        real = [p for p in infos if p.device != DEMO_PORT]
        new = []
        if self._known_ports is not None:
            new = [p for p in real if p.device not in self._known_ports]
        self._known_ports = {p.device for p in real}
        if not any(p.likely_esp for p in real):
            label = "Kein ESP32 erkannt – bitte einstecken" if not real else "Kein ESP32 erkannt – Port wählen"
            infos = [PortInfo("", label)] + infos
        self.port_infos = infos
        self.port_combo.configure(values=[p.label for p in infos])
        idx = next((i for i, p in enumerate(infos) if p.device and p.device == cur_dev), None)
        likely_new = [p for p in new if p.likely_esp]
        if likely_new and (idx is None or not infos[idx].likely_esp):
            idx = infos.index(likely_new[0])
        if idx is None:
            idx = 0
        self.port_combo.current(idx)
        n_esp = sum(p.likely_esp for p in real)
        if notify:
            if n_esp:
                self.notify(f"{n_esp} ESP32-Port{'s' if n_esp != 1 else ''} gefunden", "ok")
            elif real:
                self.notify(f"{len(real)} Port{'s' if len(real) != 1 else ''} gefunden, aber keiner sieht nach ESP32 aus",
                            "warn")
            else:
                self.notify("Kein ESP32 gefunden – Kabel und Treiber prüfen", "warn")
        self.side_hint.configure(text="" if n_esp else "Kein ESP32 erkannt.\nKabel mit Datenleitung?\nTreiber: CP210x / CH340")
        return new

    def _ports_loop(self):
        if self.state == "off" and not self.pages["flash"].busy:
            new = self.refresh_ports()
            for p in new:
                self.notify(f"Neues Gerät erkannt: {p.label}", "ok")
                if self.cfg.get("auto_connect") and p.likely_esp:
                    self.monitor.log_sys(f"{p.device} wurde eingesteckt – verbinde automatisch")
                    self.connect(p, silent=True)
                    break
            if not any(p.likely_esp for p in self.port_infos) and time.time() >= self._next_driver_check:
                self._next_driver_check = time.time() + 15
                self.check_usb_problems()
        self.after(2000, self._ports_loop)

    def _autostart(self):
        port = self.selected_port()
        if self.cfg.get("auto_connect") and port and port.device and port.device != DEMO_PORT and (
                port.device == self.cfg.get("port") or port.likely_esp):
            self.connect(port, silent=True)
        elif not any(p.likely_esp for p in self.port_infos):
            self._next_driver_check = time.time() + 15
            self.check_usb_problems()

    def check_usb_problems(self, callback=None):
        """Im Hintergrund nach USB-Geräten ohne Treiber suchen (Windows/Linux)."""
        def work():
            found = find_usb_problems()
            self._ui_q.put(lambda: self._usb_problems(found, callback))
        threading.Thread(target=work, daemon=True).start()

    def _usb_problems(self, found, callback=None):
        if callback:
            callback(found)
        if found and self.state == "off" and not self.banner.winfo_ismapped() and found[0][2] not in self._usb_shown:
            name, url, text = found[0]
            self._usb_shown.add(text)
            self._show_banner(text, [("Treiber herunterladen", lambda: webbrowser.open(url))] if url else [])

    def selected_port(self):
        i = self.port_combo.current() if hasattr(self, "port_combo") else -1
        return self.port_infos[i] if 0 <= i < len(self.port_infos) else None

    def _select_port(self, device):
        for i, p in enumerate(self.port_infos):
            if p.device == device:
                self.port_combo.current(i)
                return

    def toggle_connect(self):
        if self.state == "off":
            self.connect()
        else:
            self.disconnect()

    def start_demo(self):
        self._select_port(DEMO_PORT)
        self.connect()

    def _baud(self):
        try:
            return int(self.baud_var.get())
        except ValueError:
            return 115200

    def _baud_changed(self):
        self.cfg["baud"] = self._baud()
        if self.link.is_open:
            try:
                self.link.transport.set_baud(self._baud())
                self.monitor.log_sys(f"Baudrate: {self._baud()}")
            except Exception as e:
                self.notify(f"Baudrate nicht änderbar: {e}", "err")

    def connect(self, port=None, silent=False):
        port = port or self.selected_port()
        if port is None or not port.device:
            esp = [p for p in self.port_infos if p.likely_esp]
            if esp:
                port = esp[0]
                self._select_port(port.device)
            else:
                if not silent:
                    self.show_no_device()
                return
        if serial is None and port.device != DEMO_PORT:
            messagebox.showerror(APP_NAME, "pyserial fehlt.\n\nBitte im Terminal ausführen:\npip install pyserial")
            return
        self._hide_banner()
        try:
            self.link.open(port.device, self._baud(), port.native_usb)
        except Exception as e:
            reason = open_error_text(e)
            self.monitor.log_sys(f"{port.device} lässt sich nicht öffnen: {e}")
            if silent:
                self._wait_for(port.device, open_error_text(e, short=True))
                return
            if messagebox.askretrycancel(APP_NAME, f"Verbindung zu {port.device} fehlgeschlagen.\n\n{reason}\n\n"
                                                   "»Wiederholen« = die App versucht es im Hintergrund weiter."):
                self._wait_for(port.device, open_error_text(e, short=True))
            return
        self._opened(port, "Verbunden mit")

    def _opened(self, port, verb):
        if self._nodev is not None and self._nodev.winfo_exists():
            self._nodev.destroy()
        self.conn_port = port
        if port.device != DEMO_PORT:
            self.cfg["port"] = port.device
        self.want_connected = True
        self.state = "on"
        self.conn_lines = self.conn_garbage = 0
        self.conn_saw_bootloader = False
        self.monitor.log_sys(f"{verb} {port.label} ({self._baud()} Baud)")
        self._update_conn_ui()
        self.start_handshake(delay=350)

    def disconnect(self):
        self.want_connected = False
        self.reconnect_port = None
        self._close_link()
        self.monitor.log_sys("Getrennt")
        self.state = "off"
        self.handshaking = False
        self._set_fw(None)
        self._update_conn_ui()

    def release_port(self):
        """Port für esptool freigeben."""
        self.want_connected = False
        self.reconnect_port = None
        if self.link.is_open:
            self._close_link()
            self.monitor.log_sys("Port für esptool freigegeben")
        self.state = "off"
        self.handshaking = False
        self._set_fw(None)
        self._update_conn_ui()

    def reconnect_soon(self, port):
        self._wait_for(port.device, "")

    def _wait_for(self, device, reason):
        """Im Hintergrund warten, bis sich der Port wieder öffnen lässt."""
        self.want_connected = True
        self.reconnect_port = device
        self.reconnect_since = time.time()
        try:
            self.reconnect_known = {p.device for p in list_serial_ports()}
        except Exception:
            self.reconnect_known = set(self._known_ports or ())
        self.wait_reason = reason
        self.state = "waiting"
        self.handshaking = False
        self._update_conn_ui()
        self.after(1000, self._try_reconnect)

    def _close_link(self):
        self.link.close()
        pend, self.pending = self.pending, {}
        self.stats_pending = False
        for p in pend.values():
            if p["err"]:
                try:
                    p["err"]("Verbindung getrennt")
                except Exception:
                    pass

    def on_lost(self, reason):
        port = self.link.port
        self._close_link()
        self.monitor.log_sys(f"Verbindung verloren: {reason}")
        self.handshaking = False
        self._set_fw(None)
        if self.cfg.get("auto_reconnect") and self.want_connected and port:
            self._wait_for(port, "")
        else:
            self.state = "off"
            self.notify("Verbindung zum ESP32 verloren", "warn")
            self._update_conn_ui()

    def _try_reconnect(self):
        if self.state != "waiting" or not self.reconnect_port:
            return
        infos = list_serial_ports()
        match = next((p for p in infos if p.device == self.reconnect_port), None)
        if match is None and time.time() - self.reconnect_since > 4:
            # Nativer USB bekommt nach einem Neustart manchmal einen neuen COM-Port
            moved = [p for p in infos if p.likely_esp and p.device not in self.reconnect_known]
            if moved:
                match = moved[0]
                self.monitor.log_sys(f"Der ESP32 ist jetzt an {match.device}")
        if match is None:
            self.wait_reason = ""
            self._update_conn_ui()
            self.after(1200, self._try_reconnect)
            return
        try:
            self.link.open(match.device, self._baud(), match.native_usb)
        except Exception as e:
            self.wait_reason = open_error_text(e, short=True)
            self._update_conn_ui()
            self.after(1500, self._try_reconnect)
            return
        self.port_infos = [p for p in infos]
        self.port_combo.configure(values=[p.label for p in infos])
        self._select_port(match.device)
        self.notify("Verbunden", "ok")
        self._opened(match, "Verbunden mit")

    # -- Firmware suchen ---------------------------------------------------------
    def start_handshake(self, delay=0, fresh=True):
        if fresh:
            self.hs_attempt = 0
            self.hs_reset_done = False
            self.hs_baud_done = False
        self.handshaking = True
        self.hs_note = ""
        self._hide_banner()
        self._update_conn_ui()
        self.after(delay, self._handshake)

    def _handshake(self):
        if not self.link.is_open or self.fw:
            self.handshaking = False
            self._update_conn_ui()
            return
        self.hs_attempt += 1
        self.hs_note = ""
        self._update_conn_ui()
        self.cmd("ping", ok=self._on_ping, err=self._ping_failed, timeout=1.3 if self.hs_attempt == 1 else 1.8,
                 quiet=True, need_fw=False)

    def _on_ping(self, d):
        self.handshaking = False
        self._set_fw(d)
        self.refresh_info()

    def _looks_garbled(self):
        return self.conn_lines >= 2 and self.conn_garbage / self.conn_lines > 0.5

    def _ping_failed(self, _msg):
        if not self.link.is_open or self.fw:
            return
        if self.hs_attempt < 2:
            self.after(400, self._handshake)
            return
        if self._looks_garbled() and self._baud() != 115200 and not self.hs_baud_done:
            self.hs_baud_done = True
            self.monitor.log_sys("Nur Zeichensalat – versuche 115200 Baud (Standard der Studio-Firmware)")
            self.baud_var.set("115200")
            self._baud_changed()
            self.conn_lines = self.conn_garbage = 0
            self.hs_attempt = 0
            self.after(300, self._handshake)
            return
        if not self.hs_reset_done and not self.link.is_demo:
            self.hs_reset_done = True
            self.hs_note = "starte den ESP32 neu …"
            self.monitor.log_sys("Keine Antwort – starte den ESP32 einmal neu und suche erneut")
            try:
                self.link.transport.hard_reset()
            except Exception:
                pass
            self.hs_attempt = 0
            self._update_conn_ui()
            self.after(2500, self._handshake)
            return
        self.handshaking = False
        self._set_fw(None)
        self._diagnose()

    def _diagnose(self):
        port = self.link.port or "?"
        others = [p for p in self.port_infos if p.device and p.device not in (DEMO_PORT, port)]
        retry = ("Erneut prüfen", self.start_handshake)
        install = ("Studio-Firmware installieren", self.quick_install)
        if self.conn_saw_bootloader:
            text = "Der ESP32 steckt im Bootloader-Modus und wartet auf eine Firmware."
            buttons = [install, ("Hard-Reset", self.hard_reset)]
        elif self.link.rx_since_open == 0:
            text = (f"Von {port} kommt gar nichts. Ist das der richtige Port? Sonst einmal die EN/RST-Taste "
                    "am ESP32 drücken.")
            buttons = ([("Anderen Port probieren", self.try_next_port)] if others else []) + [install, retry]
        elif self._looks_garbled():
            text = "Nur Zeichensalat empfangen – das Programm auf dem ESP32 nutzt eine andere Baudrate."
            buttons = [("Baudrate suchen", self.scan_baud), install]
        else:
            text = "Auf dem ESP32 läuft ein anderes Programm (keine Studio-Firmware). Der Monitor funktioniert."
            buttons = [install, retry]
        self.monitor.log_sys(text)
        self._show_banner(text, buttons)

    def try_next_port(self):
        cur = self.link.port
        cands = [p for p in self.port_infos if p.device and p.device != DEMO_PORT]
        if not cands:
            return
        idx = next((i for i, p in enumerate(cands) if p.device == cur), -1)
        nxt = cands[(idx + 1) % len(cands)]
        self.disconnect()
        self._select_port(nxt.device)
        self.connect(nxt)

    def quick_install(self):
        self._hide_banner()
        self.pages["flash"].auto_install()

    def scan_baud(self):
        """Probiert gängige Baudraten und nimmt die mit dem lesbarsten Text."""
        if not self.link.is_open:
            return
        self._hide_banner()
        rates = [115200, 9600, 57600, 74880, 230400, 460800, 921600, 38400, 19200]
        results = {}
        self.monitor.log_sys("Suche die passende Baudrate …")

        def step(i):
            if not self.link.is_open:
                return
            if i > 0:
                lines, garbage = self.conn_lines - self._scan_start[0], self.conn_garbage - self._scan_start[1]
                results[rates[i - 1]] = (lines - garbage, -garbage)
            if i >= len(rates):
                best = max(results, key=lambda r: results[r])
                good = results[best][0] > 0
                self.baud_var.set(str(best if good else 115200))
                self._baud_changed()
                self.notify(f"Baudrate {best} passt am besten" if good else "Keine lesbare Ausgabe gefunden",
                            "ok" if good else "warn")
                return
            self.link.transport.set_baud(rates[i])
            self.baud_var.set(str(rates[i]))
            self._scan_start = (self.conn_lines, self.conn_garbage)
            self.after(1500, lambda: step(i + 1))

        step(0)

    def show_no_device(self):
        if self._nodev and self._nodev.winfo_exists():
            self._nodev.lift()
            return
        self._nodev = NoDeviceDialog(self)

    def _set_fw(self, d):
        had = self.fw is not None
        self.fw = d
        if d is None:
            self.info = {}
            self.stats = {}
        if d is not None and not had:
            self._hide_banner()
            self.monitor.log_sys(f"Studio-Firmware {d.get('version', '?')} erkannt: {d.get('name', '')}")
            if self.link.port and self.link.port != DEMO_PORT:
                self.cfg["port"] = self.link.port
        self._update_conn_ui()
        for p in self.pages.values():
            p.on_connection()

    def _update_conn_ui(self):
        port = self.link.port if self.link.port != DEMO_PORT else "Demo"
        if self.state == "off":
            self.conn_dot.set("muted")
            self.conn_lbl.configure(text="Getrennt")
            self.conn_btn.configure(text="Verbinden", style="Accent.TButton")
            self.title(APP_NAME)
        elif self.state == "waiting":
            self.conn_dot.set("warn")
            why = f" ({self.wait_reason})" if self.wait_reason else ""
            self.conn_lbl.configure(text=f"Warte auf {self.reconnect_port or 'ESP32'} …{why}")
            self.conn_btn.configure(text="Abbrechen", style="TButton")
        else:
            name = (self.info.get("name") or (self.fw or {}).get("name")) if self.fw else None
            if self.fw:
                self.conn_dot.set("ok")
                self.conn_lbl.configure(text=f"{name}  ·  {port}")
                self.title(f"{APP_NAME} – {name} ({port})")
            elif self.handshaking:
                self.conn_dot.set("info")
                step = self.hs_note or f"suche Firmware{' (Versuch %d)' % self.hs_attempt if self.hs_attempt > 1 else ''} …"
                self.conn_lbl.configure(text=f"{port} – {step}")
            else:
                self.conn_dot.set("warn")
                self.conn_lbl.configure(text=f"{port} – ohne Studio-Firmware")
            self.conn_btn.configure(text="Trennen", style="TButton")
        for p in self.pages.values():
            if isinstance(p, DashboardPage):
                p.on_connection()

    # -- Befehle --------------------------------------------------------------
    def cmd(self, name, *args, ok=None, err=None, timeout=4.0, quiet=False, need_fw=True):
        if not self.link.is_open:
            msg = "Nicht verbunden – oben einen Port wählen und »Verbinden« klicken"
            if err:
                err(msg)
            elif not quiet:
                self.notify(msg, "warn")
            return None
        if need_fw and not self.fw:
            msg = "Keine Studio-Firmware erkannt – unter »Firmware & Flashen« installieren"
            if err:
                err(msg)
            elif not quiet:
                self.notify(msg, "warn")
            return None
        try:
            rid = self.link.send_command(name, *args)
        except Exception as e:
            self.on_lost(str(e))
            return None
        self.pending[rid] = dict(cmd=name, ok=ok, err=err, deadline=time.time() + timeout, quiet=quiet,
                                 t=time.perf_counter())
        self.monitor.log_tx(f"#{rid} {name} " + " ".join(str(a) for a in args), proto=True)
        return rid

    def _fail(self, p, msg):
        if p["err"]:
            p["err"](msg)
        elif not p["quiet"]:
            self.notify(msg, "err")

    def _pump(self):
        try:
            for _ in range(400):
                item = self.link.events.get_nowait()
                if item[-1] != self.link.gen or not self.link.is_open:
                    continue  # Rest einer alten Verbindung
                if item[0] == "line":
                    self._on_line(item[1], item[2])
                elif item[0] == "lost":
                    self.on_lost(item[1])
                elif item[0] == "write_timeout":
                    self.monitor.log_sys("Der ESP32 nimmt keine Daten an (hängt er oder ist er im Bootloader?)")
        except queue.Empty:
            pass
        while True:
            try:
                self._ui_q.get_nowait()()
            except queue.Empty:
                break
        now = time.time()
        for rid in [r for r, p in self.pending.items() if p["deadline"] < now]:
            p = self.pending.pop(rid)
            if p["cmd"] == "stats":
                self.stats_pending = False
            self._fail(p, f"Keine Antwort vom ESP32 auf »{p['cmd']}«")
        traffic = f"Empfangen {fmt_bytes(self.link.rx_bytes)}   ·   Gesendet {fmt_bytes(self.link.tx_bytes)}"
        if traffic != self._traffic:
            self._traffic = traffic
            self.traffic_lbl.configure(text=traffic)
        self.after(30, self._pump)

    def _on_line(self, line, t_recv):
        parsed = parse_protocol_line(line)
        if parsed is None:
            self.conn_lines += 1
            if is_garbled(line):
                self.conn_garbage += 1
            self.monitor.log_rx(line)
            if "waiting for download" in line:
                self.conn_saw_bootloader = True
                if self.fw:
                    self._set_fw(None)
                if not self.handshaking:
                    self._show_banner("Der ESP32 ist im Bootloader-Modus (wartet auf eine Firmware).",
                                      [("Studio-Firmware installieren", self.quick_install),
                                       ("Hard-Reset", self.hard_reset)])
            return
        kind, rid, data = parsed
        if kind == "R":
            p = self.pending.pop(rid, None) if rid else None
            self.monitor.log_reply(line, data, manual=p is None)
            if p is None:
                return
            if data.get("ok"):
                data["_rtt"] = t_recv - p["t"]
                if p["ok"]:
                    p["ok"](data)
            else:
                self._fail(p, data.get("error", "Unbekannter Fehler"))
        else:
            self.monitor.log_event(line, data)
            self._on_event(data)

    def _on_event(self, e):
        t, ev = e.get("type"), e.get("event")
        if t == "hello":
            self.last_hello = time.time()
            self.conn_saw_bootloader = False
            if self.fw is None:
                self.handshaking = False
                self._set_fw(e)
            if (e.get("uptime") or 0) > 5:
                self.notify(f"ESP32 erkannt: {e.get('name', '')}", "ok")
            else:
                self.notify(f"ESP32 gestartet ({e.get('reset', '?')})")
            self.after(300, self.refresh_info)
        elif t == "wifi":
            self.notify(describe_event(e), "ok" if ev == "connected" else "warn")
            self.after(200, self.refresh_info)
        elif t == "ap" and ev in ("join", "leave"):
            self.notify(describe_event(e), "ok" if ev == "join" else "info")
            self.after(200, self.refresh_info)
        for p in self.pages.values():
            p.on_event(e)

    def refresh_info(self):
        if self.fw:
            self.cmd("info", ok=self._on_info, quiet=True, timeout=5)

    def _on_info(self, d):
        self.info = d
        chip = d.get("chip", {}).get("model")
        self.chip_changed = chip != self._last_chip
        self._last_chip = chip
        if self.fw is not None:
            self.fw = {**self.fw, "name": d.get("name"), "version": d.get("version")}
        self._update_conn_ui()
        for p in self.pages.values():
            p.on_info(d)
        self.chip_changed = False

    def _poll_stats(self):
        interval = max(1, int(self.cfg.get("poll_s", 2)))
        if self.fw and self.link.is_open and not self.stats_pending and time.time() - self.last_stats >= interval:
            self.stats_pending = True
            self.last_stats = time.time()

            def ok(d):
                self.stats_pending = False
                self.stats_fails = 0
                self.stats = d
                for p in self.pages.values():
                    p.on_stats(d)

            def err(_m):
                self.stats_pending = False
                self.stats_fails += 1
                if self.stats_fails >= 3 and self.link.is_open:
                    self.stats_fails = 0
                    self.monitor.log_sys("Der ESP32 antwortet nicht mehr (Deep-Sleep, Absturz oder andere Firmware?)")
                    self._set_fw(None)
                    self.start_handshake()

            self.cmd("stats", ok=ok, err=err, quiet=True, timeout=3)
        self.after(250, self._poll_stats)

    def _page_tick(self):
        p = self.current_page
        if p is not None and self.link.is_open:
            try:
                p.tick(time.time())
            except Exception as e:  # eine Seite soll nie die App lahmlegen
                self.monitor.log_sys(f"Interner Fehler: {e}")
        self.after(100, self._page_tick)

    # -- Gerätefunktionen ---------------------------------------------------------
    def hard_reset(self):
        if not self.link.is_open:
            self.notify("Nicht verbunden", "warn")
            return
        had_fw, t0 = bool(self.fw), time.time()
        try:
            self.link.transport.hard_reset()
            self.monitor.log_sys("Hard-Reset über EN/RTS ausgelöst")
            self._hide_banner()
            self.conn_saw_bootloader = False
            if not self.fw:
                self.start_handshake(delay=1500)
        except Exception as e:
            self.notify(f"Reset über USB nicht möglich ({e}). Drück die EN/RST-Taste am Board.", "err")
            return

        def fallback():
            # ESP32-S2 & Co. (TinyUSB) lassen sich über die Leitungen nicht resetten
            if had_fw and self.link.is_open and self.fw and self.last_hello < t0:
                self.monitor.log_sys("Reset über die Leitungen hat nicht gewirkt – starte per Befehl neu")
                self.cmd("restart", quiet=True)

        self.after(2500, fallback)

    def enter_bootloader(self):
        if not self.link.is_open:
            self.notify("Nicht verbunden", "warn")
            return
        try:
            self.link.transport.bootloader()
            self.monitor.log_sys("Bootloader-Modus ausgelöst – der ESP32 wartet jetzt auf eine Firmware")
            self._set_fw(None)
        except Exception as e:
            self.notify(f"Nicht möglich ({e}). Halte BOOT gedrückt und drück kurz EN/RST.", "err")

    def rename_device(self):
        v = ask_string(self, "Umbenennen", "Neuer Name für den ESP32", self.info.get("name", ""))
        if v and v.strip():
            self.cmd("name", v.strip(), ok=lambda d: (self.notify(f"Heißt jetzt „{d.get('name')}“", "ok"),
                                                      self.refresh_info()))

    def on_close(self):
        self.cfg["geometry"] = self.geometry()
        save_config(self.cfg)
        self.link.close()
        self.destroy()


def selftest() -> int:
    """Kurzer Funktionstest ohne Fenster (für den automatischen Build)."""
    ok = True
    link = Link()
    link.open(DEMO_PORT, 115200)
    rid = link.send_command("ping")
    deadline, answered = time.time() + 5, False
    while time.time() < deadline and not answered:
        try:
            item = link.events.get(timeout=0.2)
        except queue.Empty:
            continue
        parsed = parse_protocol_line(item[1]) if item[0] == "line" else None
        answered = bool(parsed and parsed[0] == "R" and parsed[1] == rid and parsed[2].get("pong"))
    link.close()
    print("Demo-Ping:", "ok" if answered else "FEHLER")
    ok &= answered
    print("pyserial:", "ok" if serial else "FEHLT")
    ok &= serial is not None
    try:
        import esptool
        print("esptool:", esptool.__version__)
    except Exception as e:
        print("esptool: FEHLER", e)
        ok = False
    print("segno:", "ok" if segno else "fehlt (optional)")
    return 0 if ok else 1


def main():
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    if sys.platform.startswith("win"):
        try:
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            pass
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
