/* Minimal QR Code generator: byte mode, ECC level M, versions 1-10.
   API: QR.encode(text) -> { size, version, mask, modules: boolean[][] }  (modules[y][x], true = dark)
        QR.draw(canvas, text, px, quiet) */
(function (root) {
  'use strict';
  // [ecc codewords per block, g1 blocks, g1 data cw, g2 blocks, g2 data cw] for level M, index = version
  var EC = [null,
    [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]];
  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  function rsGenerator(deg) {
    var poly = [1];
    for (var i = 0; i < deg; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly; // highest degree first, leading 1
  }
  function rsRemainder(data, deg) {
    var gen = rsGenerator(deg), rem = new Array(deg).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ rem[0];
      rem.shift(); rem.push(0);
      for (var j = 0; j < deg; j++) rem[j] ^= gmul(gen[j + 1], factor);
    }
    return rem;
  }

  function utf8(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.codePointAt(i);
      if (c > 0xFFFF) i++;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | c >> 6, 0x80 | c & 63);
      else if (c < 0x10000) out.push(0xE0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
      else out.push(0xF0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    }
    return out;
  }

  function capacity(v) { var e = EC[v]; return e[1] * e[2] + e[3] * e[4]; }

  function buildCodewords(bytes, v) {
    var cap = capacity(v), bits = [];
    function put(val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    put(0, Math.min(4, cap * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) {
      var b = 0; for (var k = 0; k < 8; k++) b = b << 1 | bits[i + k]; data.push(b);
    }
    for (var pad = 0xEC; data.length < cap; pad ^= 0xEC ^ 0x11) data.push(pad);
    var e = EC[v], blocks = [], pos = 0, n;
    for (n = 0; n < e[1]; n++) { blocks.push(data.slice(pos, pos + e[2])); pos += e[2]; }
    for (n = 0; n < e[3]; n++) { blocks.push(data.slice(pos, pos + e[4])); pos += e[4]; }
    var eccs = blocks.map(function (b) { return rsRemainder(b, e[0]); });
    var out = [], maxLen = Math.max(e[2], e[4]);
    function pushCol(i2) { blocks.forEach(function (b) { if (i2 < b.length) out.push(b[i2]); }); }
    for (var i2 = 0; i2 < maxLen; i2++) pushCol(i2);
    for (var j = 0; j < e[0]; j++) eccs.forEach(function (r) { out.push(r[j]); });
    return out;
  }

  function newMatrix(size) {
    var m = [], f = [];
    for (var y = 0; y < size; y++) { m.push(new Array(size).fill(false)); f.push(new Array(size).fill(false)); }
    return { m: m, f: f, size: size };
  }
  function setFn(q, x, y, dark) { q.m[y][x] = dark; q.f[y][x] = true; }

  function drawFunctionPatterns(q, v) {
    var size = q.size, i, j;
    for (i = 0; i < size; i++) { setFn(q, 6, i, i % 2 === 0); setFn(q, i, 6, i % 2 === 0); }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        var d = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(q, x, y, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    var ap = ALIGN[v], n = ap.length;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++)
        setFn(q, ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    drawFormat(q, 0); // reserve the areas
    drawVersion(q, v);
  }
  function drawFormat(q, mask) {
    var size = q.size, data = (0 << 3) | mask, rem = data, i; // level M = 00
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    function bit(k) { return ((bits >>> k) & 1) !== 0; }
    for (i = 0; i <= 5; i++) setFn(q, 8, i, bit(i));
    setFn(q, 8, 7, bit(6)); setFn(q, 8, 8, bit(7)); setFn(q, 7, 8, bit(8));
    for (i = 9; i < 15; i++) setFn(q, 14 - i, 8, bit(i));
    for (i = 0; i < 8; i++) setFn(q, size - 1 - i, 8, bit(i));
    for (i = 8; i < 15; i++) setFn(q, 8, size - 15 + i, bit(i));
    setFn(q, 8, size - 8, true);
  }
  function drawVersion(q, v) {
    if (v < 7) return;
    var rem = v, i;
    for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var bits = (v << 12) | rem;
    for (i = 0; i < 18; i++) {
      var b = ((bits >>> i) & 1) !== 0, a = q.size - 11 + i % 3, c = Math.floor(i / 3);
      setFn(q, a, c, b); setFn(q, c, a, b);
    }
  }
  function placeData(q, cw) {
    var size = q.size, i = 0, total = cw.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var j = 0; j < 2; j++) {
        var x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!q.f[y][x] && i < total) { q.m[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
      }
    }
  }
  function maskFn(k, x, y) {
    switch (k) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return x * y % 2 + x * y % 3 === 0;
      case 6: return (x * y % 2 + x * y % 3) % 2 === 0;
      default: return ((x + y) % 2 + x * y % 3) % 2 === 0;
    }
  }
  function applyMask(q, k) {
    for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++)
      if (!q.f[y][x] && maskFn(k, x, y)) q.m[y][x] = !q.m[y][x];
  }
  function penalty(m, size) {
    var score = 0, x, y, dark = 0;
    function line(get) {
      var s = 0, r = 1, str = '', k;
      for (k = 0; k < size; k++) str += get(k) ? '1' : '0';
      for (k = 1; k < size; k++) {
        if (str[k] === str[k - 1]) { r++; if (r === 5) s += 3; else if (r > 5) s++; } else r = 1;
      }
      var re = /1011101/g, mt;
      while ((mt = re.exec(str))) {
        var before = str.slice(Math.max(0, mt.index - 4), mt.index);
        var after = str.slice(mt.index + 7, mt.index + 11);
        if (before === '0000' || after === '0000') s += 40;
        re.lastIndex = mt.index + 1;
      }
      return s;
    }
    for (y = 0; y < size; y++) score += line(function (k) { return m[y][k]; });
    for (x = 0; x < size; x++) score += line(function (k) { return m[k][x]; });
    for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) {
      var c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (m[y][x]) dark++;
    var total = size * size;
    score += Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }

  function encode(text) {
    var bytes = utf8(String(text)), v;
    for (v = 1; v <= 10; v++) if (bytes.length + (v < 10 ? 2 : 3) <= capacity(v)) break;
    if (v > 10) throw new Error('Text too long for QR versions 1-10 (max 213 bytes at level M)');
    var cw = buildCodewords(bytes, v), size = 17 + 4 * v;
    var base = newMatrix(size);
    drawFunctionPatterns(base, v);
    placeData(base, cw);
    var best = null, bestScore = Infinity, bestMask = 0;
    for (var k = 0; k < 8; k++) {
      var q = { size: size, f: base.f, m: base.m.map(function (r) { return r.slice(); }) };
      applyMask(q, k);
      drawFormat(q, k);
      var p = penalty(q.m, size);
      if (p < bestScore) { bestScore = p; best = q; bestMask = k; }
    }
    return { size: size, version: v, mask: bestMask, modules: best.m };
  }

  function draw(canvas, text, px, quiet) {
    var qr = encode(text), q = quiet == null ? 4 : quiet, n = qr.size + 2 * q;
    var scale = Math.max(1, Math.floor((px || 480) / n));
    canvas.width = canvas.height = n * scale;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    for (var y = 0; y < qr.size; y++) for (var x = 0; x < qr.size; x++)
      if (qr.modules[y][x]) ctx.fillRect((x + q) * scale, (y + q) * scale, scale, scale);
    return qr;
  }

  var API = { encode: encode, draw: draw };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.QR = API;
})(typeof window !== 'undefined' ? window : globalThis);
