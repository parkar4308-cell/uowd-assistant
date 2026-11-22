(function () {
  'use strict';
  var url = (location.origin + location.pathname.replace(/[^\/]*$/, '').replace(/\/$/, ''));
  var canvas = document.getElementById('qr');
  // Leave room for the heading, URL and hint around the code.
  var px = Math.min(window.innerWidth - 56, window.innerHeight - 330, 900);
  QR.draw(canvas, url, Math.max(220, px), 4);
  document.getElementById('url').textContent = url;
  canvas.setAttribute('aria-label', 'QR code linking to ' + url);
})();
