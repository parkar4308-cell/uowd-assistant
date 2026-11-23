(function () {
  'use strict';
  var BAY_IDS = ['C1', 'C2', 'C3', 'C4'];
  var SIM = /[?&]sim=1\b/.test(location.search);
  var IS_CLOUD = location.hostname.endsWith('github.io') || /[?&]cloud=1/.test(location.search);
  var NTFY_URL = 'https://ntfy.sh/uowd-csit214-parking-parkar4308';
  var $ = function (id) { return document.getElementById(id); };

  var view = $('view'), vctx = view.getContext('2d');
  var src = document.createElement('canvas'), sctx = src.getContext('2d', { willReadFrequently: true });
  var video = document.createElement('video');
  video.muted = true; video.playsInline = true;
  var noise = document.createElement('canvas'); noise.width = 160; noise.height = 90;
  var nctx = noise.getContext('2d');

  var mode = 'idle';            // idle | cam | sim
  var rects = [null, null, null, null];   // {x0,y0,x1,y1} in canvas pixels
  var baselines = [null, null, null, null]; // {patch, edges, chroma}
  var trackers = BAY_IDS.map(function () { return Detect.createBayTracker({ on: 0.12, off: 0.08, frames: 3 }); });
  var manual = [null, null, null, null]; // null=AUTO | true=TAKEN | false=FREE
  var scores = [null, null, null, null];
  var pending = null;           // first corner while defining a bay
  var drag = null;              // { idx, ox, oy, startX, startY, moved }
  var suppressNextClick = false;
  var cars = [false, false, false, false]; // sim only
  var sending = false;
  var thr = { on: 0.12, off: 0.08 };
  var lastCloudSig = '';
  var lastCloudMs = 0;

  function setSize(w, h) { view.width = src.width = w; view.height = src.height = h; }
  setSize(640, 360);

  function msg(t) { $('msg').textContent = t || ''; }

  function isTaken(i) {
    if (manual[i] !== null) return manual[i];
    return !!(baselines[i] && trackers[i].occupied);
  }

  // ---- sources ----
  function simBays() {
    var out = [], bw = 130, bh = 200, gap = 20, x = (640 - (4 * bw + 3 * gap)) / 2;
    for (var i = 0; i < 4; i++) out.push({ x0: x + i * (bw + gap), y0: 80, x1: x + i * (bw + gap) + bw, y1: 80 + bh });
    return out;
  }

  function drawSim() {
    var w = src.width, h = src.height;
    sctx.fillStyle = '#787878'; sctx.fillRect(0, 0, w, h);
    var id = nctx.createImageData(160, 90), d = id.data;
    for (var i = 0; i < d.length; i += 4) { var v = 120 + (Math.random() * 2 - 1) * 7; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    nctx.putImageData(id, 0, 0);
    sctx.imageSmoothingEnabled = true; sctx.drawImage(noise, 0, 0, w, h);
    sctx.strokeStyle = '#ececec'; sctx.lineWidth = 4;
    simBays().forEach(function (r) { sctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); });
    simBays().forEach(function (r, i) {
      if (!cars[i]) return;
      sctx.fillStyle = '#1c1c1c'; sctx.fillRect(r.x0 + 18, r.y0 + 20, r.x1 - r.x0 - 36, r.y1 - r.y0 - 40);
      sctx.fillStyle = '#4a4a4a'; sctx.fillRect(r.x0 + 32, r.y0 + 60, r.x1 - r.x0 - 64, 40);
    });
  }

  function drawFrame() {
    if (mode === 'sim') drawSim();
    else if (mode === 'cam' && video.videoWidth) {
      if (src.width !== video.videoWidth) { setSize(video.videoWidth, video.videoHeight); }
      sctx.drawImage(video, 0, 0, src.width, src.height);
    } else { sctx.fillStyle = '#e4e7eb'; sctx.fillRect(0, 0, src.width, src.height); }
    vctx.drawImage(src, 0, 0);
    drawOverlay();
  }

  function drawOverlay() {
    vctx.lineWidth = 2.5;
    vctx.font = 'bold 12px system-ui, sans-serif';
    for (var i = 0; i < 4; i++) {
      var r = rects[i]; if (!r) continue;
      var ready = !!baselines[i] || manual[i] !== null;
      var taken = isTaken(i);
      var stroke = !ready ? '#1d5fa8' : taken ? '#c62828' : '#1f8a4c';
      var fill = !ready ? 'rgba(29, 95, 168, 0.10)' : taken ? 'rgba(198, 40, 40, 0.22)' : 'rgba(31, 138, 76, 0.14)';
      vctx.fillStyle = fill;
      vctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      vctx.strokeStyle = stroke;
      vctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);

      var pct = scores[i] != null ? (' ' + Math.min(99, Math.round(scores[i] * 100)) + '%') : '';
      var tag = BAY_IDS[i] + (manual[i] !== null ? ' LOCK' : ready ? (taken ? ' CAR' : ' FREE') + pct : '');
      var tw = vctx.measureText(tag).width + 10;
      vctx.fillStyle = stroke;
      vctx.fillRect(r.x0, r.y0, tw, 20);
      vctx.fillStyle = '#fff';
      vctx.fillText(tag, r.x0 + 5, r.y0 + 14);
    }
    if (pending) { vctx.fillStyle = '#1d5fa8'; vctx.fillRect(pending.x - 4, pending.y - 4, 8, 8); }
  }

  // ---- detection ----
  function bayPatch(i) {
    var r = rects[i], w = src.width, h = src.height;
    var x0 = Math.max(0, Math.floor(r.x0)), y0 = Math.max(0, Math.floor(r.y0));
    var x1 = Math.min(w, Math.ceil(r.x1)), y1 = Math.min(h, Math.ceil(r.y1));
    var rw = x1 - x0, rh = y1 - y0;
    if (rw < 4 || rh < 4) return null;
    var img = sctx.getImageData(x0, y0, rw, rh);
    var gray = Detect.toGray(img.data, rw, rh);
    var chroma = Detect.toChroma(img.data, rw, rh);
    return {
      gray: Detect.downscale(gray, rw, rh, 0, 0, rw, rh),
      chroma: Detect.downscale(chroma, rw, rh, 0, 0, rw, rh)
    };
  }

  function captureOneBaseline(i) {
    if (!rects[i]) return false;
    var p = bayPatch(i);
    if (!p) return false;
    baselines[i] = { patch: p.gray, edges: Detect.sobelMagnitude(p.gray), chroma: p.chroma };
    trackers[i].reset();
    scores[i] = null;
    return true;
  }

  function autoGridRects(w, h) {
    var out = [], marginX = w * 0.12, gap = w * 0.02;
    var bw = (w - 2 * marginX - 3 * gap) / 4;
    var bh = h * 0.48, y0 = h * 0.24;
    for (var i = 0; i < 4; i++) {
      var x0 = marginX + i * (bw + gap);
      out.push({ x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x0 + bw), y1: Math.round(y0 + bh) });
    }
    return out;
  }

  function setSendingState(on) {
    sending = !!on;
    $('btnSend').textContent = sending ? 'Stop sending' : 'Start sending';
    if (!sending) setPost('Not sending.');
  }

  function stopVideoStream() {
    if (video.srcObject && video.srcObject.getTracks) {
      video.srcObject.getTracks().forEach(function (tr) { tr.stop(); });
    }
    video.srcObject = null;
  }

  function setAutoRectsOnly() {
    if (mode === 'sim') { rects = simBays(); }
    else {
      var w = (video.videoWidth || src.width || 640);
      var h = (video.videoHeight || src.height || 360);
      if (src.width !== w || src.height !== h) setSize(w, h);
      rects = autoGridRects(w, h);
    }
    baselines = [null, null, null, null]; scores = [null, null, null, null]; pending = null;
    trackers.forEach(function (t) { t.reset(); });
  }

  function captureBaseline() {
    if (mode === 'idle') { msg('Start the camera, V380 window, or simulated feed first.'); return; }
    drawFrame();
    var n = 0;
    for (var i = 0; i < 4; i++) {
      if (captureOneBaseline(i)) n++;
    }
    if (n) {
      msg('Baseline captured for ' + n + ' bay(s) — live sending active. Drag any box on video to fine-tune position.');
      setSendingState(true);
      sendTick();
    } else {
      msg('Define at least one bay first (click 4-Bay Auto-Grid or mark corners).');
    }
    renderBays();
  }

  function applyAutoGrid() {
    if (mode === 'idle') { msg('Start the V380 window, camera, or simulated feed first.'); return; }
    setAutoRectsOnly();
    captureBaseline();
  }

  function detectTick() {
    if (mode === 'idle') return;
    for (var i = 0; i < 4; i++) {
      if (!rects[i] || !baselines[i]) continue;
      var p = bayPatch(i); if (!p) continue;
      var s = Detect.bayScore(p.gray, baselines[i].patch, baselines[i].edges, {
        chroma: p.chroma, baseChroma: baselines[i].chroma
      });
      scores[i] = s; trackers[i].update(s);
    }
    renderBays();
  }

  // ---- UI ----
  var bayEls = [];
  function buildBays() {
    var ul = $('bays');
    BAY_IDS.forEach(function (id, i) {
      var li = document.createElement('li');
      var name = document.createElement('span'); name.textContent = id;
      var right = document.createElement('span');
      var pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'pill pill-btn';
      pill.title = 'Click to override bay (AUTO -> TAKEN -> FREE -> AUTO)';
      pill.addEventListener('click', function () {
        if (manual[i] === null) manual[i] = true;
        else if (manual[i] === true) manual[i] = false;
        else manual[i] = null;
        renderBays();
        drawOverlay();
        sendTick();
      });
      var sc = document.createElement('span'); sc.className = 'score';
      right.appendChild(pill); right.appendChild(sc);
      li.appendChild(name); li.appendChild(right); ul.appendChild(li);
      bayEls.push({ pill: pill, score: sc });
    });
  }

  function renderBays() {
    for (var i = 0; i < 4; i++) {
      var e = bayEls[i], p = e.pill;
      if (manual[i] !== null) {
        p.className = 'pill pill-btn ' + (manual[i] ? 'taken' : 'free');
        p.textContent = (manual[i] ? 'taken' : 'free') + ' (lock)';
        e.score.textContent = 'manual';
      } else if (!rects[i]) {
        p.className = 'pill pill-btn'; p.textContent = 'not set'; e.score.textContent = '';
      } else if (!baselines[i]) {
        p.className = 'pill pill-btn'; p.textContent = 'no baseline'; e.score.textContent = '';
      } else {
        var t = trackers[i].occupied;
        p.className = 'pill pill-btn ' + (t ? 'taken' : 'free'); p.textContent = t ? 'taken' : 'free';
        e.score.textContent = 'score ' + (scores[i] == null ? '-' : scores[i].toFixed(3));
      }
    }
    var next = rects.indexOf(null);
    if (mode === 'cam') {
      $('hint').textContent = next === -1
        ? 'All 4 bays set. Drag any box on the video to align it over a parking spot, or click a bay pill to lock manually.'
        : 'Click two opposite corners on the picture to define bay ' + BAY_IDS[next] + (pending ? ' (corner 1 set, click corner 2).' : '.');
    } else if (mode === 'sim') {
      $('hint').textContent = 'Simulated feed: click inside a bay to toggle a car (or click a bay pill to test manual lock).';
    } else { $('hint').textContent = ''; }
  }

  function canvasPoint(ev) {
    var b = view.getBoundingClientRect();
    return { x: (ev.clientX - b.left) * view.width / b.width, y: (ev.clientY - b.top) * view.height / b.height };
  }

  function hitBay(pt) {
    for (var i = 3; i >= 0; i--) {
      var r = rects[i];
      if (r && pt.x >= r.x0 && pt.x <= r.x1 && pt.y >= r.y0 && pt.y <= r.y1) return i;
    }
    return -1;
  }

  view.addEventListener('pointerdown', function (ev) {
    if (mode !== 'cam' || !rects.every(Boolean)) return;
    var pt = canvasPoint(ev);
    var idx = hitBay(pt);
    if (idx < 0) return;
    drag = { idx: idx, ox: pt.x - rects[idx].x0, oy: pt.y - rects[idx].y0, startX: pt.x, startY: pt.y, moved: false };
    view.setPointerCapture(ev.pointerId);
    view.style.cursor = 'grabbing';
  });

  view.addEventListener('pointermove', function (ev) {
    if (!drag) {
      if (mode === 'cam' && rects.every(Boolean)) {
        view.style.cursor = hitBay(canvasPoint(ev)) >= 0 ? 'grab' : 'default';
      } else {
        view.style.cursor = mode === 'sim' ? 'pointer' : 'crosshair';
      }
      return;
    }
    var pt = canvasPoint(ev);
    if (Math.abs(pt.x - drag.startX) > 3 || Math.abs(pt.y - drag.startY) > 3) drag.moved = true;
    var r = rects[drag.idx];
    var bw = r.x1 - r.x0, bh = r.y1 - r.y0;
    var nx = Math.max(0, Math.min(src.width - bw, Math.round(pt.x - drag.ox)));
    var ny = Math.max(0, Math.min(src.height - bh, Math.round(pt.y - drag.oy)));
    rects[drag.idx] = { x0: nx, y0: ny, x1: nx + bw, y1: ny + bh };
    drawFrame();
  });

  view.addEventListener('pointerup', function () {
    if (!drag) return;
    var d = drag;
    drag = null;
    view.style.cursor = 'grab';
    if (d.moved) {
      suppressNextClick = true;
      drawFrame();
      captureOneBaseline(d.idx);
      msg('Aligned ' + BAY_IDS[d.idx] + ' and updated its baseline.');
      renderBays();
    }
  });

  view.addEventListener('click', function (ev) {
    if (suppressNextClick) { suppressNextClick = false; return; }
    var pt = canvasPoint(ev);
    if (mode === 'sim') {
      simBays().forEach(function (r, i) { if (pt.x >= r.x0 && pt.x <= r.x1 && pt.y >= r.y0 && pt.y <= r.y1) cars[i] = !cars[i]; });
      return;
    }
    if (mode !== 'cam') return;
    var next = rects.indexOf(null);
    if (next === -1) return;
    if (!pending) { pending = pt; }
    else {
      var r = { x0: Math.min(pending.x, pt.x), y0: Math.min(pending.y, pt.y), x1: Math.max(pending.x, pt.x), y1: Math.max(pending.y, pt.y) };
      pending = null;
      if (r.x1 - r.x0 < 8 || r.y1 - r.y0 < 8) { msg('That rectangle is too small, try again.'); }
      else { rects[next] = r; baselines[next] = null; trackers[next].reset(); scores[next] = null; msg(''); }
    }
    renderBays();
  });

  function resetBays() {
    if (mode === 'sim') { rects = simBays(); } else { rects = [null, null, null, null]; }
    baselines = [null, null, null, null]; scores = [null, null, null, null];
    manual = [null, null, null, null]; pending = null; drag = null;
    trackers.forEach(function (t) { t.reset(); });
    renderBays();
  }

  function refreshCameras() {
    var sel = $('camSelect');
    if (!sel || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve();
    return navigator.mediaDevices.enumerateDevices().then(function (devs) {
      var vids = devs.filter(function (d) { return d.kind === 'videoinput'; });
      var prev = sel.value;
      sel.textContent = '';
      if (!vids.length) {
        var noneOpt = document.createElement('option');
        noneOpt.value = ''; noneOpt.textContent = 'Default webcam';
        sel.appendChild(noneOpt);
        return;
      }
      vids.forEach(function (d, idx) {
        var opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || ('Camera ' + (idx + 1));
        sel.appendChild(opt);
      });
      if (prev && vids.some(function (d) { return d.deviceId === prev; })) sel.value = prev;
    }).catch(function () {});
  }

  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      msg('Camera not available here. Browsers only allow it on https or http://localhost. Try the simulated feed.'); return;
    }
    stopVideoStream();
    msg('Starting laptop webcam...');
    var sel = $('camSelect');
    var devId = sel && sel.value ? sel.value : '';
    var videoOpts = { width: { ideal: 1280 }, height: { ideal: 720 } };
    if (devId) videoOpts.deviceId = { exact: devId };
    navigator.mediaDevices.getUserMedia({ video: videoOpts, audio: false }).then(function (stream) {
      video.srcObject = stream; return video.play();
    }).then(function () {
      mode = 'cam';
      refreshCameras();
      setAutoRectsOnly();
      renderBays();
      msg('Laptop webcam live! Setting 4-bay auto-grid & capturing empty baseline in 0.4 s...');
      setTimeout(function () {
        if (mode === 'cam') captureBaseline();
      }, 400);
    }).catch(function (err) {
      var n = err && err.name;
      if (n === 'NotAllowedError' || n === 'SecurityError') msg('Camera permission was denied. Allow it in the browser address bar, or use the simulated feed.');
      else if (n === 'NotFoundError' || n === 'OverconstrainedError') msg('No camera found on this device. Use the simulated feed.');
      else msg('Could not start the camera' + (n ? ' (' + n + ')' : '') + '. Use the simulated feed.');
    });
  }

  function startScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      msg('Window capture is not available in this browser. Use a desktop Chromium/Edge browser on http://localhost.'); return;
    }
    stopVideoStream();
    msg('Select the V380 Pro window or phone mirror screen...');
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(function (stream) {
      var track = stream.getVideoTracks()[0];
      if (track) track.addEventListener('ended', function () {
        if (video.srcObject === stream) { mode = 'idle'; setSendingState(false); msg('V380 window capture ended.'); renderBays(); }
      });
      video.srcObject = stream; return video.play();
    }).then(function () {
      mode = 'cam';
      setAutoRectsOnly();
      renderBays();
      msg('V380 / App window live. Drag any bay box C1–C4 over the paper lot, then press Capture empty baseline.');
    }).catch(function (err) {
      var n = err && err.name;
      if (n === 'NotAllowedError') msg('Window share cancelled.');
      else msg('Could not capture window' + (n ? ' (' + n + ')' : '') + '.');
    });
  }

  function buildCloudSnapshot(bays) {
    var nowIso = new Date().toISOString();
    var freeCount = bays.filter(function (b) { return !b.occupied; }).length;
    return {
      updatedAt: nowIso,
      serverTime: nowIso,
      lots: [{
        id: 'lotA',
        name: 'Lot A (camera prototype)',
        capacity: bays.length || 4,
        free: freeCount,
        bays: bays.map(function (b) {
          return { id: b.id, occupied: b.occupied, source: 'camera', lastChange: nowIso, flagged: false };
        })
      }],
      devices: [
        { id: $('device').value.trim() || 'webcam-lotA', lastSeen: nowIso, online: true },
        { id: 'esp32-lotB', lastSeen: nowIso, online: false }
      ],
      events: [{ ts: nowIso, type: 'online', message: 'Camera node live (' + freeCount + '/' + (bays.length || 4) + ' free)' }]
    };
  }

  function publishCloudFromCam(bays) {
    var sig = bays.map(function (b) { return b.id + ':' + (b.occupied ? 1 : 0); }).join(',');
    var now = Date.now();
    if (sig === lastCloudSig && now - lastCloudMs < 12000) return Promise.resolve(true);
    lastCloudSig = sig;
    lastCloudMs = now;
    return fetch(NTFY_URL, { method: 'POST', body: JSON.stringify(buildCloudSnapshot(bays)) })
      .then(function (r) { return r.ok; })
      .catch(function () { return false; });
  }

  // ---- sending ----
  function sendTick() {
    if (!sending) return;
    var bays = [];
    for (var i = 0; i < 4; i++) {
      if (manual[i] === null && (!rects[i] || !baselines[i])) continue;
      bays.push({
        id: BAY_IDS[i],
        occupied: isTaken(i),
        raw: Math.round((scores[i] || 0) * 1000) / 1000,
        source: 'camera'
      });
    }
    if (!bays.length) { setPost('Nothing to send yet: define bays and capture a baseline.'); return; }
    var dev = $('device').value.trim(), base = $('server').value.trim().replace(/\/+$/, '');
    var body = { device: dev, uptime_ms: Math.round(performance.now()), bays: bays };
    var target = (IS_CLOUD && !base) ? 'http://localhost:8080/api/readings' : (base + '/api/readings');
    var freeCount = bays.filter(function (b) { return !b.occupied; }).length;
    var freeSummary = 'Free ' + freeCount + '/' + bays.length + (freeCount > 0 ? ' (Gate OPEN)' : ' (FULL - GATE CLOSED)');

    if (IS_CLOUD) {
      publishCloudFromCam(bays).then(function (ok) {
        setPost((ok ? 'Cloud Live synced at ' : 'Cloud sync retrying at ') + new Date().toLocaleTimeString() + ' | ' + freeSummary);
      });
      if (!base) return;
    }

    fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': dev, 'X-Device-Token': $('token').value.trim() },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        var gateTxt = typeof d.free === 'number'
          ? ' | Free ' + d.free + '/' + d.capacity + (d.gateOpen ? ' (Gate OPEN)' : ' (FULL - GATE CLOSED)')
          : '';
        setPost('HTTP ' + r.status + ' at ' + new Date().toLocaleTimeString() + gateTxt);
      });
    }).catch(function () {
      publishCloudFromCam(bays).then(function (ok) {
        setPost((ok ? 'Local server offline; Cloud Live synced at ' : 'Last POST failed: server not reachable.') + (ok ? new Date().toLocaleTimeString() + ' | ' + freeSummary : ''));
      });
    });
  }
  function setPost(t) { $('post').textContent = t; }

  // ---- wiring ----
  $('btnScreen').addEventListener('click', startScreen);
  $('btnStart').addEventListener('click', startCamera);
  $('btnAutoGrid').addEventListener('click', applyAutoGrid);
  $('btnBaseline').addEventListener('click', captureBaseline);
  $('btnReset').addEventListener('click', resetBays);
  $('btnSend').addEventListener('click', function () {
    setSendingState(!sending);
    if (sending) { setPost('Sending every 1 s...'); sendTick(); }
  });
  function onThr() {
    var on = parseFloat($('onRange').value), off = parseFloat($('offRange').value);
    if (off >= on) { off = Math.max(0.01, on - 0.01); $('offRange').value = off; }
    thr.on = on; thr.off = off;
    $('onVal').textContent = on.toFixed(2); $('offVal').textContent = off.toFixed(2);
    trackers.forEach(function (t) { t.setThresholds(on, off); });
  }
  $('onRange').addEventListener('input', onThr);
  $('offRange').addEventListener('input', onThr);

  buildBays();
  refreshCameras();
  if (SIM) {
    mode = 'sim';
    $('btnStart').disabled = true;
    $('btnScreen').disabled = true;
    $('linkSim').textContent = 'Simulated feed active';
    resetBays();
    drawSim();
    captureBaseline();
  }
  renderBays();
  setInterval(drawFrame, 100);
  setInterval(detectTick, 500);
  setInterval(sendTick, 1000);
})();
