#!/usr/bin/env bash
# ESP32 Studio starten (macOS / Linux)
set -e
cd "$(dirname "$0")/app"
PY=python3
command -v "$PY" >/dev/null 2>&1 || { echo "Python 3 fehlt – bitte installieren."; exit 1; }
"$PY" -c "import tkinter" 2>/dev/null || {
  echo "Tkinter fehlt. Linux: sudo apt install python3-tk  ·  macOS: brew install python-tk"; exit 1; }
if ! "$PY" -c "import serial, esptool, segno" 2>/dev/null; then
  echo "Installiere benoetigte Pakete (einmalig) ..."
  "$PY" -m pip install --user -r requirements.txt || "$PY" -m pip install --user --break-system-packages -r requirements.txt
fi
exec "$PY" esp32_studio.py
