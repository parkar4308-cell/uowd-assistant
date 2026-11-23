// Camera -> ESP32 LCD bridge. Reads the camera's bay counts from ntfy.sh and sends the
// free-bay count (a single digit 0-4) to the ESP32 over USB serial. The firmware already
// accepts '0'..'4' on serial (parking_node.ino, loop) and then drives the LCD + gate.
// Usage:  node serial_bridge.js [COM7]        (no npm packages)
//         node serial_bridge.js COM7 --digit 2   (send one digit and exit, to test the wiring)
'use strict';
const https = require('https');
const fs = require('fs');
const { execFileSync } = require('child_process');

const PORT = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'COM7';
const TOPIC = 'uowd-csit214-parking-parkar4308';
const di = process.argv.indexOf('--digit');

execFileSync('mode', [PORT, 'BAUD=115200', 'PARITY=N', 'DATA=8', 'STOP=1', 'dtr=off', 'rts=off'], { stdio: 'ignore', shell: true });
const out = fs.openSync('\\\\.\\' + PORT, 'w');
function send(d) { fs.writeSync(out, String(d)); }

if (di > 0) { send(process.argv[di + 1]); console.log('sent', process.argv[di + 1]); process.exit(0); }

let lastFree = null, lastSent = 0;
function apply(free, ts) {
  if (!(free >= 0 && free <= 4)) return;
  const age = ts ? Math.round((Date.now() - Date.parse(ts)) / 1000) : 0;
  const now = Date.now();
  if (free !== lastFree || now - lastSent > 5000) {
    send(free); lastFree = free; lastSent = now;
    console.log(new Date().toLocaleTimeString(), 'free =', free, '/4', age > 60 ? '(STALE ' + age + 's)' : '');
  }
}

function connect() {
  console.log('Connecting to ntfy topic...');
  const req = https.get(`https://ntfy.sh/${TOPIC}/json?since=2m`, { headers: { Accept: 'application/x-ndjson' } }, (res) => {
    if (res.statusCode !== 200) { console.log('HTTP', res.statusCode, '- retrying in 10 s'); res.resume(); return setTimeout(connect, 10000); }
    console.log('Connected. Waiting for camera data...');
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (c) => {
      buf += c; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          const o = JSON.parse(line);
          if (o.event !== 'message' || !o.message) continue;
          const s = JSON.parse(o.message);
          const lot = s.lots && s.lots[0];
          if (lot) apply(lot.free, s.updatedAt || s.serverTime);
        } catch (e) { /* ignore bad line */ }
      }
    });
    res.on('end', () => { console.log('Stream closed, reconnecting'); setTimeout(connect, 3000); });
  });
  req.on('error', (e) => { console.log('Error:', e.message, '- retrying in 10 s'); setTimeout(connect, 10000); });
}
connect();
