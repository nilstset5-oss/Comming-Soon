// HTML-Seite der Web-Oberflaeche (eigene Datei, damit die Arduino-IDE
// den Sketch sauber vorverarbeiten kann)
#pragma once
#include <Arduino.h>

const char WEB_PAGE[] PROGMEM = R"HTML(<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ESP32 Studio</title><style>
:root{--bg:#0f1420;--card:#182032;--fg:#e8edf7;--mut:#8a96ad;--acc:#3b82f6}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg);padding:16px}
h1{font-size:20px;margin:0 0 4px}p{color:var(--mut);margin:0 0 16px}
.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;max-width:760px}
.c{background:var(--card);border-radius:12px;padding:12px}.c b{display:block;font-size:12px;color:var(--mut);font-weight:500}
.c span{font-size:18px;font-weight:600}.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
button{background:var(--acc);color:#fff;border:0;border-radius:10px;padding:10px 14px;font-size:15px;cursor:pointer}
button.s{background:#2a3550}input{background:#0b1019;color:var(--fg);border:1px solid #2a3550;border-radius:10px;padding:9px;width:80px}
</style></head><body>
<h1 id="n">ESP32 Studio</h1><p>Web-Oberfläche deines ESP32</p>
<div class="g">
<div class="c"><b>Laufzeit</b><span id="up">–</span></div>
<div class="c"><b>Freier Speicher</b><span id="heap">–</span></div>
<div class="c"><b>Temperatur</b><span id="temp">–</span></div>
<div class="c"><b>WLAN</b><span id="rssi">–</span></div>
<div class="c"><b>Hotspot-Geräte</b><span id="cl">–</span></div>
<div class="c"><b>LED</b><span id="led">–</span></div>
</div>
<div class="row"><button onclick="api('led?s=toggle')">LED umschalten</button>
<button class="s" onclick="api('led?s=blink')">Blinken</button>
<button class="s" onclick="if(confirm('ESP32 neu starten?'))api('restart')">Neustart</button></div>
<div class="row"><input id="pin" type="number" placeholder="Pin" min="0" max="48">
<button class="s" onclick="gp(1)">Pin HIGH</button><button class="s" onclick="gp(0)">Pin LOW</button></div>
<script>
function fmt(s){var h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h+'h '+m+'m '+(s%60)+'s'}
function api(p){return fetch('/api/'+p).then(function(r){return r.json()}).then(load)}
function gp(v){var p=document.getElementById('pin').value;if(p!=='')api('gpio?pin='+p+'&v='+v)}
function load(){return fetch('/api/stats').then(function(r){return r.json()}).then(function(d){
document.getElementById('n').textContent=d.name;document.getElementById('up').textContent=fmt(d.uptime);
document.getElementById('heap').textContent=(d.heap_free/1024).toFixed(1)+' KB';
document.getElementById('temp').textContent=d.temp==null?'–':d.temp+' °C';
document.getElementById('rssi').textContent=d.sta=='connected'?d.rssi+' dBm':'nicht verbunden';
document.getElementById('cl').textContent=d.ap_on?d.ap_clients:'aus';
document.getElementById('led').textContent=d.led?'an':'aus';}).catch(function(){})}
load();setInterval(load,2000);
</script></body></html>)HTML";
