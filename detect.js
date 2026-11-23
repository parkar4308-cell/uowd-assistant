/* Deterministic bay-occupancy detection tuned for toy cars, lighting shifts, and shadows.
 * No ML. UMD: window.Detect or require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Detect = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SIZE = 32;
  var N = SIZE * SIZE;
  var DIFF_FULL = 80;
  var EDGE_FULL = 120;
  var CHROMA_FULL = 60;

  // Spatial weight mask: emphasize the inner car zone (cols/rows 4..27) and
  // heavily down-weight the 4px outer rim so neighbor shadows don't bleed across bays.
  var WEIGHTS = new Float32Array(N);
  var CORE_IDX = [];
  (function initMask() {
    var sum = 0;
    for (var y = 0; y < SIZE; y++) {
      for (var x = 0; x < SIZE; x++) {
        var i = y * SIZE + x;
        var inCore = x >= 4 && x < SIZE - 4 && y >= 4 && y < SIZE - 4;
        WEIGHTS[i] = inCore ? 1.50 : 0.25;
        sum += WEIGHTS[i];
        if (inCore) CORE_IDX.push(i);
      }
    }
    var scale = N / sum;
    for (var k = 0; k < N; k++) WEIGHTS[k] *= scale;
  })();

  // RGBA array (Uint8ClampedArray or plain array) -> Float32Array of luma (0..255), length w*h.
  function toGray(rgba, w, h) {
    var out = new Float32Array(w * h);
    for (var i = 0, j = 0; i < w * h; i++, j += 4) {
      out[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    }
    return out;
  }

  // RGBA array -> Float32Array of color saturation/chroma max(R,G,B)-min(R,G,B) (0..255).
  // Catches painted toy cars even if their grayscale brightness matches the grey floor.
  function toChroma(rgba, w, h) {
    var out = new Float32Array(w * h);
    for (var i = 0, j = 0; i < w * h; i++, j += 4) {
      var r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
      var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      out[i] = mx - mn;
    }
    return out;
  }

  // Box-average region [x0,x1) x [y0,y1) of a scalar image (w x h) into a SIZE x SIZE patch.
  function downscale(vals, w, h, x0, y0, x1, y1) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(w, Math.ceil(x1)); y1 = Math.min(h, Math.ceil(y1));
    var rw = Math.max(1, x1 - x0), rh = Math.max(1, y1 - y0);
    var out = new Float32Array(N);
    for (var py = 0; py < SIZE; py++) {
      var ya = y0 + Math.floor(py * rh / SIZE);
      var yb = Math.max(ya + 1, y0 + Math.floor((py + 1) * rh / SIZE));
      for (var px = 0; px < SIZE; px++) {
        var xa = x0 + Math.floor(px * rw / SIZE);
        var xb = Math.max(xa + 1, x0 + Math.floor((px + 1) * rw / SIZE));
        var sum = 0, n = 0;
        for (var y = ya; y < yb && y < h; y++) {
          for (var x = xa; x < xb && x < w; x++) { sum += vals[y * w + x]; n++; }
        }
        out[py * SIZE + px] = n ? sum / n : 0;
      }
    }
    return out;
  }

  function mean(a) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i];
    return a.length ? s / a.length : 0;
  }

  // Sobel gradient magnitude; border pixels are 0.
  function sobelMagnitude(patch) {
    var n = SIZE, out = new Float32Array(N);
    for (var y = 1; y < n - 1; y++) {
      for (var x = 1; x < n - 1; x++) {
        var i = y * n + x;
        var gx = -patch[i - n - 1] + patch[i - n + 1] - 2 * patch[i - 1] + 2 * patch[i + 1] - patch[i + n - 1] + patch[i + n + 1];
        var gy = -patch[i - n - 1] - 2 * patch[i - n] - patch[i - n + 1] + patch[i + n - 1] + 2 * patch[i + n] + patch[i + n + 1];
        out[i] = Math.sqrt(gx * gx + gy * gy) / 4;
      }
    }
    return out;
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  // Top-15% mean inside CORE_IDX so a small toy car covering 10-30% of the bay
  // still produces a strong detection without uniform noise triggering.
  function topCoreMean(diffs) {
    var core = new Float32Array(CORE_IDX.length);
    for (var i = 0; i < CORE_IDX.length; i++) core[i] = diffs[CORE_IDX[i]];
    core.sort(); // ascending
    var k = Math.max(1, Math.floor(core.length * 0.15));
    var sum = 0;
    for (var j = core.length - k; j < core.length; j++) sum += core[j];
    return sum / k;
  }

  // Computes bay occupancy score (0..1).
  // `extra` is optional: { chroma: Float32Array(1024), baseChroma: Float32Array(1024) }.
  function bayScore(patch, baselinePatch, baselineEdges, extra) {
    var m = mean(patch), mb = mean(baselinePatch);
    var lumaDiff = new Float32Array(N);
    var d = 0;
    for (var i = 0; i < N; i++) {
      var diff = Math.abs((patch[i] - m) - (baselinePatch[i] - mb));
      lumaDiff[i] = diff;
      d += WEIGHTS[i] * diff;
    }
    d /= N;

    var edges = sobelMagnitude(patch), e = 0;
    for (var k = 0; k < N; k++) e += WEIGHTS[k] * Math.abs(edges[k] - baselineEdges[k]);
    e /= N;

    var lumaFull = clamp01(d / DIFF_FULL);
    var edgeFull = clamp01(e / EDGE_FULL);
    var peakLuma = clamp01((topCoreMean(lumaDiff) - 14) / 60);

    var chromaFull = 0, peakChroma = 0;
    if (extra && extra.chroma && extra.baseChroma) {
      var cDiff = new Float32Array(N);
      var cd = 0;
      for (var c = 0; c < N; c++) {
        var dc = Math.abs(extra.chroma[c] - extra.baseChroma[c]);
        cDiff[c] = dc;
        cd += WEIGHTS[c] * dc;
      }
      cd /= N;
      chromaFull = clamp01(cd / CHROMA_FULL);
      peakChroma = clamp01((topCoreMean(cDiff) - 16) / 65);
    }

    var strongFull = Math.max(lumaFull, chromaFull * 0.9);
    var strongPeak = Math.max(peakLuma, peakChroma);
    return clamp01(0.35 * strongFull + 0.25 * edgeFull + 0.40 * strongPeak);
  }

  // Hysteresis (ON/OFF) plus a consecutive-frame debounce.
  function createBayTracker(opts) {
    opts = opts || {};
    var on = opts.on != null ? opts.on : 0.12;
    var off = opts.off != null ? opts.off : 0.08;
    var frames = opts.frames != null ? opts.frames : 3;
    var occupied = false, count = 0;
    return {
      update: function (score) {
        var target = occupied;
        if (!occupied && score > on) target = true;
        else if (occupied && score < off) target = false;
        var changed = false;
        if (target !== occupied) {
          count++;
          if (count >= frames) { occupied = target; count = 0; changed = true; }
        } else {
          count = 0;
        }
        return { occupied: occupied, changed: changed };
      },
      setThresholds: function (newOn, newOff) { on = newOn; off = newOff; },
      reset: function () { occupied = false; count = 0; },
      get occupied() { return occupied; }
    };
  }

  return {
    SIZE: SIZE, toGray: toGray, toChroma: toChroma, downscale: downscale,
    sobelMagnitude: sobelMagnitude, bayScore: bayScore, createBayTracker: createBayTracker
  };
});
