@echo off
chcp 65001 >nul
title ESP32 Studio
cd /d "%~dp0app"

set PY=
where py >nul 2>nul && set PY=py -3
if not defined PY where python >nul 2>nul && set PY=python
if not defined PY (
  echo Python wurde nicht gefunden.
  echo Bitte installieren: https://www.python.org/downloads/
  echo Beim Installieren den Haken bei "Add python.exe to PATH" setzen.
  pause
  exit /b 1
)

%PY% -c "import serial, esptool, segno" >nul 2>nul
if errorlevel 1 (
  echo Installiere benoetigte Pakete ^(einmalig^) ...
  %PY% -m pip install --upgrade -r requirements.txt
  if errorlevel 1 (
    echo Installation fehlgeschlagen.
    pause
    exit /b 1
  )
)

where pyw >nul 2>nul && (start "" pyw -3 esp32_studio.py & exit /b 0)
where pythonw >nul 2>nul && (start "" pythonw esp32_studio.py & exit /b 0)
%PY% esp32_studio.py
