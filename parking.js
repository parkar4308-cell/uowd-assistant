(function () {
  'use strict';
  var MOCK = /[?&]mock=1/.test(location.search);
  var IS_CLOUD = location.hostname.endsWith('github.io') || /[?&]cloud=1/.test(location.search);
  var IS_TUNNEL = /(trycloudflare\.com|pinggy\.link|pinggy\.io)$/i.test(location.hostname);
  var IS_PUBLIC = IS_CLOUD || IS_TUNNEL || /[?&]public=1/.test(location.search);
  var NTFY_BASE = 'https://ntfy.sh/uowd-csit214-parking-parkar4308';
  var simulated = false, state = null, lastRecv = 0, adminKey = null, polling = null;
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function ago(iso) {
    if (!iso) return 'no change yet';
    var s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's ago';
    return Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm ago';
  }
  function clock(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString([], { hour12: false });
  }
  var SRC = { ultrasonic: 'ultrasonic', photoresistor: 'light sensor', button: 'button (simulated)', camera: 'camera (browser)' };

  var DEV_LABELS = {
    'webcam-lotA': 'webcam-lotA (V380 / Camera Node)',
    'esp32-lotB': 'esp32-lotB (ESP32 1602 LCD + Servo Gate)'
  };

  function setConn(on) {
    var p = $('pill');
    p.textContent = simulated ? 'Simulated' : (on ? 'Live' : 'Reconnecting');
    p.className = 'pill ' + (on && !simulated ? 'pill-on' : 'pill-off');
  }

  function render() {
    if (!state) return;
    var lots = (state.lots || []).filter(function (l) { return l.id === 'lotA'; }), tf = 0, tc = 0;
    var box = $('lots'); box.textContent = '';
    lots.forEach(function (lot, i) {
      tf += lot.free; tc += lot.capacity;
      var taken = lot.capacity - lot.free;
      var card = el('section', 'card lot');
      card.setAttribute('aria-labelledby', 'lotName' + i);
      var h = el('h2', null, lot.name); h.id = 'lotName' + i;
      card.appendChild(h);
      var big = el('p', 'big');
      big.setAttribute('aria-live', 'polite');
      big.appendChild(document.createTextNode(lot.free + ' free '));
      big.appendChild(el('span', 'of', 'of ' + lot.capacity));
      card.appendChild(big);
      var bar = el('div', 'bar');
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', taken + ' of ' + lot.capacity + ' bays taken');
      var fill = el('div');
      fill.style.width = (lot.capacity ? taken / lot.capacity * 100 : 0) + '%';
      bar.appendChild(fill); card.appendChild(bar);
      card.appendChild(el('p', 'small', taken + ' taken'));
      var bays = el('div', 'bays');
      (lot.bays || []).forEach(function (b) {
        var t = el('div', 'bay' + (b.occupied ? ' taken' : '') + (b.flagged ? ' flag' : ''));
        t.appendChild(el('div', 'id', b.id));
        t.appendChild(el('div', 'st', b.occupied ? 'TAKEN' : 'FREE'));
        t.appendChild(el('div', 'meta', SRC[b.source] || b.source));
        t.appendChild(el('div', 'meta', (b.lastChange ? 'changed ' + ago(b.lastChange) : 'no change yet')));
        if (b.flagged) t.appendChild(el('div', 'fl', 'Flagged: suspicious reading'));
        bays.appendChild(t);
      });
      card.appendChild(bays);
      box.appendChild(card);
    });

    // Entrance Gate & 1602 LCD Controller card
    var primary = lots[0] || { free: 0, capacity: 4 };
    var gateOpen = primary.free > 0;
    var gateCard = el('section', 'card gate-card');
    gateCard.setAttribute('aria-labelledby', 'gateH');
    var gh = el('h2', 'sec', 'Entrance Gate & 1602 LCD Controller (ESP32)'); gh.id = 'gateH';
    gateCard.appendChild(gh);
    var grow = el('div', 'gate-row');
    grow.appendChild(el('span', 'pill ' + (gateOpen ? 'pill-on' : 'pill-locked'),
      gateOpen ? 'GATE OPEN (90\u00b0)' : 'GATE CLOSED / LOCKED (0\u00b0 \u2014 LOT FULL)'));
    var lcd = el('div', 'lcd-preview');
    lcd.setAttribute('aria-label', '1602 LCD display preview');
    var line1 = gateOpen ? 'CAM  LOT: OPEN  ' : '** LOT FULL! ** ';
    var line2 = gateOpen
      ? ('FREE: ' + primary.free + '/' + primary.capacity + '  GATE^')
      : ('FREE: 0/' + primary.capacity + '  LOCK ');
    lcd.appendChild(el('div', null, line1));
    lcd.appendChild(el('div', null, line2));
    grow.appendChild(lcd);
    gateCard.appendChild(grow);
    box.appendChild(gateCard);

    $('total').textContent = 'Campus: ' + tf + ' free of ' + tc;
    var parts = lots.map(function (l) {
      var m = /\(([^)]*)\)/.exec(l.name);
      return (m ? m[1].replace(/\s*prototype$/, ' lot') : l.name) + ' (' + l.capacity + ' bays)';
    });
    $('sub').textContent = 'Prototype: ' + (parts.join(' + ') || 'no lots') + (simulated ? ' (simulated demo data)' : '');

    var dv = $('devices'); dv.textContent = '';
    (state.devices || []).forEach(function (d) {
      var li = el('li');
      li.appendChild(el('span', 'dot' + (d.online ? ' on' : '')));
      li.appendChild(el('strong', null, DEV_LABELS[d.id] || d.id));
      li.appendChild(el('span', null, d.online ? 'online' : 'offline'));
      li.appendChild(el('span', 'ago', 'last seen ' + (d.lastSeen ? ago(d.lastSeen) : 'never')));
      dv.appendChild(li);
    });

    var ev = $('events'); ev.textContent = '';
    var evs = state.events || [];
    if (!evs.length) ev.appendChild(el('li', 'empty', 'No events yet.'));
    evs.forEach(function (e) {
      var li = el('li');
      li.appendChild(el('span', 'time', clock(e.ts)));
      li.appendChild(el('span', 'badge ' + String(e.type).replace(/[^a-z]/g, ''), e.type));
      li.appendChild(el('span', 'msgtxt', e.message));
      ev.appendChild(li);
    });
  }

  function tickAgo() {
    var age = lastRecv ? Math.round((Date.now() - lastRecv) / 1000) : 0;
    $('ago').textContent = lastRecv ? (simulated ? 'demo data, not from a camera' : 'updated ' + ago(new Date(lastRecv).toISOString())) : 'waiting for data';
    if (!simulated && lastRecv && age > 60) { $('pill').textContent = 'Stale'; $('pill').className = 'pill pill-off'; }
    if (state) render();
  }

  function onState(s) { state = s; var t = Date.parse(s && (s.updatedAt || s.serverTime)); lastRecv = (!simulated && !isNaN(t)) ? t : Date.now(); render(); tickAgo(); }

  function parseNtfyLines(txt) {
    var lines = String(txt || '').trim().split('\n');
    var latest = null;
    lines.forEach(function (line) {
      if (!line.trim()) return;
      try {
        var obj = JSON.parse(line);
        if (obj && obj.event === 'message' && obj.message) {
          latest = JSON.parse(obj.message);
        }
      } catch (e) {}
    });
    return latest;
  }

  var WAVE_STAGES = [
    [],
    [],
    ['C1'],
    ['C1', 'C2'],
    ['C1', 'C2', 'C3'],
    ['C1', 'C2', 'C3', 'C4'],
    ['C1', 'C2', 'C3', 'C4'],
    ['C1', 'C2', 'C3'],
    ['C1', 'C2'],
    ['C1']
  ];
  var syncFallbackTimer = null;
  var gotCloudMsg = false;

  function buildSyncWaveState() {
    var idx = Math.floor(Date.now() / 3000) % WAVE_STAGES.length;
    var occ = WAVE_STAGES[idx];
    var nowIso = new Date().toISOString();
    var freeCount = 4 - occ.length;
    return {
      updatedAt: nowIso,
      serverTime: nowIso,
      lots: [{
        id: 'lotA',
        name: 'Lot A (camera prototype)',
        capacity: 4,
        free: freeCount,
        bays: ['C1', 'C2', 'C3', 'C4'].map(function (id) {
          return { id: id, occupied: occ.indexOf(id) !== -1, source: 'camera', lastChange: nowIso, flagged: false };
        })
      }],
      devices: [
        { id: 'webcam-lotA', lastSeen: nowIso, online: true },
        { id: 'esp32-lotB', lastSeen: nowIso, online: true }
      ],
      events: [{
        ts: nowIso,
        type: freeCount === 0 ? 'offline' : 'online',
        message: 'SIMULATED demo data (no camera feed connected): ' + freeCount + '/4 free'
      }]
    };
  }

  function startSyncWaveFallback() {
    if (syncFallbackTimer) return;
    function applySync() {
      if (gotCloudMsg) { clearInterval(syncFallbackTimer); syncFallbackTimer = null; return; }
      simulated = true;
      setConn(true);
      onState(buildSyncWaveState());
    }
    applySync();
    syncFallbackTimer = setInterval(applySync, 1500);
  }

  function pollCloud() {
    if (polling) return;
    function go() {
      fetch(NTFY_BASE + '/json?poll=1&since=12h')
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then(function (txt) {
          var s = parseNtfyLines(txt);
          if (s) {
            gotCloudMsg = true; simulated = false;
            if (syncFallbackTimer) { clearInterval(syncFallbackTimer); syncFallbackTimer = null; }
            setConn(true);
            onState(s);
          }
        })
        .catch(function () {
          startSyncWaveFallback();
        });
    }
    go();
    polling = setInterval(go, 15000);
  }

  function startCloud() {
    pollCloud();
    setTimeout(function () { if (!gotCloudMsg) startSyncWaveFallback(); }, 4000);
    if (!window.EventSource) return;
    try {
      var es = new EventSource(NTFY_BASE + '/sse');
      es.onopen = function () { setConn(true); };
      es.onmessage = function (m) {
        try {
          var env = JSON.parse(m.data);
          var snap = (env && env.message) ? JSON.parse(env.message) : env;
          if (snap && snap.lots) {
            gotCloudMsg = true; simulated = false;
            if (syncFallbackTimer) { clearInterval(syncFallbackTimer); syncFallbackTimer = null; }
            setConn(true);
            onState(snap);
          }
        } catch (e) {}
      };
    } catch (e) {}
  }

  function poll() {
    if (polling) return;
    function go() {
      fetch('/api/state', { headers: { 'X-Pinggy-No-Screen': '1' } }).then(function (r) { return r.json(); })
        .then(function (s) { setConn(true); onState(s); })
        .catch(function () { setConn(false); });
    }
    go(); polling = setInterval(go, 1500);
  }

  function start() {
    if (IS_PUBLIC) {
      var ft = document.querySelector('footer.foot');
      if (ft) ft.hidden = true;
    }
    if (MOCK) {
      fetch('mock-state.json').then(function (r) { return r.json(); }).then(function (s) {
        // shift mock timestamps so "ago" values look current
        var off = Date.now() - Date.parse(s.serverTime);
        var sh = function (iso) { return iso ? new Date(Date.parse(iso) + off).toISOString() : iso; };
        s.lots.forEach(function (l) { l.bays.forEach(function (b) { b.lastChange = sh(b.lastChange); }); });
        s.devices.forEach(function (d) { d.lastSeen = sh(d.lastSeen); });
        s.events.forEach(function (e) { e.ts = sh(e.ts); });
        setConn(true); onState(s);
      });
      return;
    }
    if (IS_CLOUD) {
      startCloud();
      return;
    }
    if (IS_TUNNEL || /[?&]poll=1/.test(location.search) || !window.EventSource) {
      poll();
      return;
    }
    var gotSseFrame = false;
    var es = new EventSource('/api/events');
    var fallbackTimer = setTimeout(function () { if (!gotSseFrame) poll(); }, 2500);
    es.onopen = function () { setConn(true); };
    es.onmessage = function (m) {
      gotSseFrame = true;
      clearTimeout(fallbackTimer);
      try { setConn(true); onState(JSON.parse(m.data)); } catch (e) { /* ignore bad frame */ }
    };
    es.onerror = function () {
      setConn(false);
      if (es.readyState === 2) { es.close(); poll(); }
      else setTimeout(function () { if (es.readyState !== 1) { es.close(); poll(); } }, 4000);
    };
  }

  // ---- Admin ----
  function adminFetch(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'X-Admin-Key': adminKey || '', 'Content-Type': 'application/json' }, opts.headers || {});
    return fetch(path, opts).then(function (r) {
      if (r.status === 401) { adminKey = null; throw new Error('401 Unauthorized: wrong or missing admin key.'); }
      if (!r.ok) throw new Error('Request failed: HTTP ' + r.status);
      return r.json().catch(function () { return {}; });
    });
  }
  function msg(t, ok) { var m = $('adminMsg'); m.textContent = t; m.className = 'msg' + (ok ? ' ok' : ''); }

  function loadAdmin() {
    if (MOCK) { listDevices([{ id: 'esp32-lotB', token: '****', lot: 'lotB', enabled: true }]); return; }
    adminFetch('/api/admin/devices').then(function (r) {
      msg('');
      listDevices(Array.isArray(r) ? r : r.devices || []);
    }).catch(function (e) { msg(e.message); $('adminDevices').textContent = ''; });
  }
  function listDevices(list) {
    var ul = $('adminDevices'); ul.textContent = '';
    list.forEach(function (d) {
      var li = el('li');
      li.appendChild(el('strong', null, d.id));
      li.appendChild(el('span', 'ago', 'lot ' + d.lot + ', token ' + d.token));
      li.appendChild(el('span', null, d.enabled ? 'enabled' : 'disabled'));
      var b = el('button', 'btn', d.enabled ? 'Disable' : 'Enable');
      b.type = 'button';
      b.addEventListener('click', function () {
        adminFetch('/api/admin/devices/' + encodeURIComponent(d.id) + '/' + (d.enabled ? 'disable' : 'enable'), { method: 'POST' })
          .then(loadAdmin).catch(function (e) { msg(e.message); });
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  $('adminBtn').addEventListener('click', function () {
    var box = $('admin');
    if (!box.hidden) { box.hidden = true; this.setAttribute('aria-expanded', 'false'); return; }
    if (!adminKey) {
      var k = window.prompt('Admin key');
      if (!k) return;
      adminKey = k;
    }
    box.hidden = false; this.setAttribute('aria-expanded', 'true');
    loadAdmin();
  });
  $('regForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target;
    if (!adminKey) { msg('Enter the admin key first (close and reopen Admin).'); return; }
    adminFetch('/api/admin/devices', { method: 'POST', body: JSON.stringify({ id: f.id.value.trim(), token: f.token.value, lot: f.lot.value.trim() }) })
      .then(function () { msg('Device registered.', true); f.reset(); f.lot.value = 'lotB'; loadAdmin(); })
      .catch(function (e) { msg(e.message); });
  });

  // ---- Live QR Modal ----
  function openQr() {
    var req = IS_CLOUD ? Promise.resolve({}) : fetch('/api/public-url').then(function (r) { return r.json(); }).catch(function () { return {}; });
    req.then(function (d) {
        var target = (d && d.url) ? d.url : (location.origin + location.pathname);
        var link = $('qrUrlLink');
        link.href = target;
        link.textContent = target;
        if (window.QR && typeof window.QR.draw === 'function') {
          window.QR.draw($('qrCanvas'), target, 240, 4);
        }
        $('qrModal').hidden = false;
      });
  }
  $('qrBtn').addEventListener('click', openQr);
  $('qrClose').addEventListener('click', function () { $('qrModal').hidden = true; });
  $('qrModal').addEventListener('click', function (ev) { if (ev.target === $('qrModal')) $('qrModal').hidden = true; });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') $('qrModal').hidden = true; });

  setInterval(tickAgo, 1000);
  start();
})();
