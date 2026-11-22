(function () {
  'use strict';
  var MAX_MESSAGES = 20;          // DOM only, nothing persisted
  var SLOW_MS = 5000;             // show "Stop waiting" after this
  var TIMEOUT_MS = 30000;         // give up after this (server may take ~20 s with AI on)
  var SOURCES_SHOWN = 3;
  var messages = [];
  var busy = false, asked = false, current = null;
  var $ = function (id) { return document.getElementById(id); };
  var thread = $('thread'), chipsEl = $('chips'), form = $('form'), input = $('question'),
      sendBtn = $('send'), statusEl = $('status'), emptyEl = $('empty'), moreBtn = $('moreBtn'),
      suggestEl = chipsEl.parentNode;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;

  /* ---------- helpers (all server text goes in via textContent) ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  var SVGNS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    copy: 'M9 9h10v11H9zM5 15V4h10',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    up: 'M7 11v9H4v-9zM7 11l4-8c1.7 0 2.6 1 2.3 2.7L12.8 9H19c1.2 0 2 1 1.8 2.2l-1.3 7A2 2 0 0 1 17.5 20H7',
    down: 'M17 13V4h3v9zM17 13l-4 8c-1.7 0-2.6-1-2.3-2.7l.5-3.3H5c-1.2 0-2-1-1.8-2.2l1.3-7A2 2 0 0 1 6.5 4H17',
    ext: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5',
    retry: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5'
  };
  function icon(name, size) {
    var s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size || 18); s.setAttribute('height', size || 18);
    s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
    var p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', ICONS[name]);
    p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
    s.appendChild(p);
    return s;
  }
  function button(cls, label, iconName) {
    var b = el('button', 'btn' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    if (iconName) b.appendChild(icon(iconName));
    b.appendChild(el('span', null, label));
    return b;
  }
  function setLabel(btn, text) { btn.lastChild.textContent = text; }
  function safeUrl(u) {
    try { var p = new URL(u); return (p.protocol === 'https:' || p.protocol === 'http:') ? p : null; }
    catch (e) { return null; }
  }
  function sitePath(p) {
    var path = p.pathname;
    try { path = decodeURI(path); } catch (e) {}
    path = path.replace(/\/+$/, '');
    var s = p.hostname.replace(/^www\./, '') + path;
    return s.length > 80 ? s.slice(0, 40) + '...' + s.slice(-36) : s;
  }
  function trimText(t, n) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    if (t.length <= n) return t;
    var cut = t.slice(0, n), sp = cut.lastIndexOf(' ');
    return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, '') + '...';
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function setStatus(t) { statusEl.textContent = t || ''; }
  function scrollTo(node, block) {
    node.scrollIntoView({ block: block || 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  /* Split an answer into short paragraphs (and bullet lists if the text has them). */
  function renderAnswer(text, into) {
    var blocks = String(text).replace(/\r/g, '').split(/\n\s*\n/);
    blocks.forEach(function (block) {
      var lines = block.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      if (!lines.length) return;
      var bullets = lines.filter(function (l) { return /^([-*•]|\d+[.)])\s+/.test(l); });
      if (bullets.length >= 2 && bullets.length >= lines.length - 1) {
        lines.forEach(function (l) {
          if (!/^([-*•]|\d+[.)])\s+/.test(l)) { var p0 = el('p', null, l); p0.dir = 'auto'; into.appendChild(p0); }
        });
        var ul = el('ul'); ul.dir = 'auto';
        bullets.forEach(function (l) { ul.appendChild(el('li', null, l.replace(/^([-*•]|\d+[.)])\s+/, ''))); });
        into.appendChild(ul);
        return;
      }
      var para = lines.join(' ');
      var parts = [];
      if (para.length <= 300) parts.push(para);
      else {
        /* a full stop followed by a digit (6.0, 1.5, 3.2) is part of a number, not the end of a sentence */
        var sents = para.match(/(?:[^.!?؟]|\.(?=\d))+[.!?؟]+["')\]]*\s*|(?:[^.!?؟]|\.(?=\d))+$/g) || [para];
        var cur = '';
        sents.forEach(function (s) {
          if (cur && (cur + s).length > 240) { parts.push(cur.trim()); cur = ''; }
          cur += s;
        });
        if (cur.trim()) parts.push(cur.trim());
      }
      parts.forEach(function (t) { var p = el('p', null, t); p.dir = 'auto'; into.appendChild(p); });
    });
    if (!into.firstChild) into.appendChild(el('p', null, 'No answer was returned.'));
  }

  function copyText(text, btn) {
    function done(ok) {
      setLabel(btn, ok ? 'Copied' : 'Copy failed');
      btn.firstChild.replaceWith(icon(ok ? 'check' : 'copy'));
      setStatus(ok ? 'Answer copied.' : 'Could not copy. Select the text and copy it instead.');
      setTimeout(function () { setLabel(btn, 'Copy answer'); btn.firstChild.replaceWith(icon('copy')); setStatus(''); }, 2000);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallback()); });
    } else done(fallback());
    function fallback() {
      var ta = el('textarea'); ta.value = text; ta.setAttribute('readonly', '');
      ta.className = 'sr'; document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove(); return ok;
    }
  }

  /* ---------- thread ---------- */
  function addMessage(role, node) {
    thread.appendChild(node);
    messages.push({ role: role, el: node });
    while (messages.length > MAX_MESSAGES) { var old = messages.shift(); if (old.el.parentNode) old.el.remove(); }
  }

  function userBubble(text) {
    var row = el('div', 'row user');
    var b = el('div', 'bubble', text); b.dir = 'auto';
    var label = el('span', 'sr', 'You asked: ');
    row.appendChild(label); row.appendChild(b);
    addMessage('user', row);
    scrollTo(row, 'end');
  }

  function confLabel(c) {
    var n = Number(c) || 0;
    if (n >= 0.7) return ['high', 'High confidence'];
    if (n >= 0.45) return ['medium', 'Medium confidence'];
    return ['low', 'Low confidence'];
  }

  function feedbackRow(question, actions) {
    var label = el('span', 'fb-label', 'Helpful?');
    var yes = button('', 'Yes', 'up'), no = button('', 'No', 'down');
    yes.setAttribute('aria-label', 'Yes, this answer was helpful');
    no.setAttribute('aria-label', 'No, this answer was not helpful');
    function send(helpful, btn) {
      yes.disabled = no.disabled = true;
      btn.classList.add('picked'); btn.setAttribute('aria-pressed', 'true');
      fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question, helpful: helpful }) })
        .then(function (r) { label.textContent = r.ok ? 'Thanks.' : 'Not saved.'; })
        .catch(function () { label.textContent = 'Not saved.'; });
    }
    yes.addEventListener('click', function () { send(true, yes); });
    no.addEventListener('click', function () { send(false, no); });
    var group = el('span', 'fb');
    group.appendChild(label); group.appendChild(yes); group.appendChild(no);
    actions.appendChild(group);
  }

  function sourceCard(s) {
    var li = el('li', 'source');
    var u = safeUrl(s.url);
    var title = el('p', 'source-title', String(s.title || (u ? u.hostname : 'Source'))); title.dir = 'auto';
    li.appendChild(title);
    if (u) li.appendChild(el('p', 'source-path', sitePath(u)));
    if (s.snippet) { var sn = el('p', 'source-snippet', trimText(s.snippet, 180)); sn.dir = 'auto'; li.appendChild(sn); }
    if (u) {
      var a = el('a', 'source-link');
      a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.appendChild(el('span', null, 'Open official page'));
      a.appendChild(icon('ext', 15));
      a.appendChild(el('span', 'sr', ' (opens in a new tab): ' + String(s.title || '')));
      li.appendChild(a);
    }
    return li;
  }

  function sourcesBlock(srcs) {
    var wrap = el('div', 'sources-wrap');
    wrap.appendChild(el('h3', 'sources-title', srcs.length === 1 ? 'Source' : 'Sources (' + srcs.length + ')'));
    var ul = el('ul', 'sources');
    srcs.forEach(function (s, i) {
      var li = sourceCard(s);
      if (i >= SOURCES_SHOWN) li.hidden = true;
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    var extra = srcs.length - SOURCES_SHOWN;
    if (extra > 0) {
      var more = button('show-more', 'Show ' + extra + ' more source' + (extra > 1 ? 's' : ''));
      more.setAttribute('aria-expanded', 'false');
      more.addEventListener('click', function () {
        var open = more.getAttribute('aria-expanded') === 'true';
        Array.prototype.forEach.call(ul.children, function (li, i) { if (i >= SOURCES_SHOWN) li.hidden = open; });
        more.setAttribute('aria-expanded', String(!open));
        setLabel(more, open ? 'Show ' + extra + ' more source' + (extra > 1 ? 's' : '') : 'Show fewer sources');
        if (!open) { var a = ul.children[SOURCES_SHOWN].querySelector('a'); if (a) a.focus(); }
      });
      wrap.appendChild(more);
    }
    return wrap;
  }

  function handoffBox(text) {
    var h = el('div', 'handoff');
    h.setAttribute('role', 'note');
    h.setAttribute('aria-label', 'Talk to a person');
    var ic = el('span', 'handoff-icon'); ic.appendChild(icon('person', 18));
    var body = el('div');
    body.appendChild(el('h3', null, 'Talk to a person'));
    var p = el('p', null, String(text || 'Please contact UOWD Student Services.')); p.dir = 'auto';
    body.appendChild(p);
    h.appendChild(ic); h.appendChild(body);
    return h;
  }

  function botAnswer(data, question) {
    var refused = data.mode === 'refused';
    var row = el('article', 'row bot');
    row.setAttribute('aria-label', refused ? 'Assistant could not answer' : 'Assistant answer');
    var card = el('div', 'card' + (refused ? ' refused' : ''));
    var body = el('div', 'card-body');
    body.appendChild(el('p', 'card-kicker', refused ? 'Not answered' : 'Answer'));
    var ans = el('div', 'answer');
    renderAnswer(String(data.answer || (refused ? 'I could not find this in the public UOWD pages.' : 'No answer was returned.')), ans);
    body.appendChild(ans);

    var meta = el('p', 'meta');
    var parts = [];
    if (!refused) {
      var cl = confLabel(data.confidence);
      var c = el('span', 'conf-' + cl[0]); c.appendChild(el('span', 'conf-dot')); c.appendChild(document.createTextNode(cl[1]));
      parts.push(c);
      parts.push(el('span', null, data.mode === 'llm' ? 'Worded by AI from the sources' : 'Quoted from the sources'));
    }
    var d = data.lastChecked ? fmtDate(data.lastChecked) : '';
    if (d) parts.push(el('span', null, 'Checked on ' + d));
    parts.forEach(function (p, i) { if (i) meta.appendChild(el('span', 'sep', '·')); meta.appendChild(p); });
    if (parts.length) body.appendChild(meta);
    card.appendChild(body);

    if (data.handoff && data.handoff.show) card.appendChild(handoffBox(data.handoff.text));

    var srcs = Array.isArray(data.sources) ? data.sources.filter(function (s) { return s && (s.url || s.title); }) : [];
    if (srcs.length) card.appendChild(sourcesBlock(srcs));

    var actions = el('div', 'actions');
    if (!refused) {
      var copy = button('', 'Copy answer', 'copy');
      copy.addEventListener('click', function () {
        var text = String(data.answer || '');
        var urls = srcs.map(function (s) { var u = safeUrl(s.url); return u ? u.href : ''; }).filter(Boolean);
        if (urls.length) text += '\n\nSources:\n' + urls.join('\n');
        copyText(text, copy);
      });
      actions.appendChild(copy);
    }
    actions.appendChild(el('span', 'spacer'));
    feedbackRow(question, actions);
    card.appendChild(actions);

    row.appendChild(card);
    addMessage('bot', row);
    scrollTo(row, 'start');
  }

  function errorCard(title, text, retryQ) {
    var row = el('div', 'row bot');
    var card = el('div', 'card error');
    card.setAttribute('role', 'alert');
    var body = el('div', 'card-body');
    body.appendChild(el('p', 'card-kicker', title));
    body.appendChild(el('div', 'answer', text));
    card.appendChild(body);
    if (retryQ) {
      var actions = el('div', 'actions');
      var r = button('primary', 'Try again', 'retry');
      r.addEventListener('click', function () { if (busy) return; row.remove(); ask(retryQ, true); });
      actions.appendChild(r);
      card.appendChild(actions);
    }
    row.appendChild(card);
    addMessage('bot', row);
    scrollTo(row, 'start');
  }

  function loadingCard(onStop) {
    var row = el('div', 'row bot loading');
    var card = el('div', 'card');
    var body = el('div', 'card-body');
    var kick = el('p', 'card-kicker');
    var t = el('span', 'typing'); t.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 3; i++) t.appendChild(el('span', 'dot'));
    kick.appendChild(t);
    kick.appendChild(el('span', null, 'Searching UOWD pages'));
    body.appendChild(kick);
    ['w1', 'w2', 'w3'].forEach(function (w) { var s = el('div', 'skel ' + w); s.setAttribute('aria-hidden', 'true'); body.appendChild(s); });
    var slow = el('div', 'slow-note'); slow.hidden = true;
    slow.appendChild(el('span', null, 'Still working. This can take up to 20 seconds.'));
    var stop = button('', 'Stop waiting');
    stop.addEventListener('click', onStop);
    slow.appendChild(stop);
    body.appendChild(slow);
    card.appendChild(body);
    row.appendChild(card);
    thread.appendChild(row);
    scrollTo(row, 'end');
    return { row: row, showSlow: function () { slow.hidden = false; setStatus('Still working. You can stop waiting at any time.'); } };
  }

  /* ---------- asking ---------- */
  function setBusy(b) {
    busy = b; sendBtn.disabled = b;
    thread.setAttribute('aria-busy', b ? 'true' : 'false');
    Array.prototype.forEach.call(chipsEl.querySelectorAll('button'), function (c) { c.disabled = b; });
  }

  function collapseSuggestions() {
    if (!asked) {
      asked = true;
      emptyEl.hidden = true;
      if (chipsEl.children.length) moreBtn.hidden = false;
    }
    chipsEl.hidden = true;
    suggestEl.classList.add('collapsed');
    moreBtn.setAttribute('aria-expanded', 'false');
  }

  function ask(q, isRetry) {
    q = (q || '').trim();
    if (!q || busy) return;
    if (q.length > 400) { setStatus('Please keep your question under 400 characters.'); return; }
    setStatus('Searching the UOWD pages...');
    collapseSuggestions();
    if (!isRetry) userBubble(q);
    input.value = ''; autosize();
    setBusy(true);

    var ctrl = window.AbortController ? new AbortController() : null;
    var why = null;
    var loading = loadingCard(function () { why = 'stopped'; if (ctrl) ctrl.abort(); });
    var slowT = setTimeout(loading.showSlow, SLOW_MS);
    var hardT = setTimeout(function () { why = 'timeout'; if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    var started = Date.now();
    current = ctrl;

    fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q }), signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) { return { status: r.status, ok: r.ok, body: body }; });
      })
      .then(function (res) {
        loading.row.remove();
        if (res.status === 429) errorCard('Too many questions', 'You are asking too quickly. Please wait a minute and try again.', q);
        else if (res.status === 400) errorCard('Could not read that', 'That question could not be read. Please rephrase it (up to 400 characters).', null);
        else if (!res.ok) errorCard('Something went wrong', 'The assistant had a problem on its side. Try again, or contact UOWD Student Services.', q);
        else { botAnswer(res.body || {}, q); setStatus(''); return; }
        setStatus('');
      })
      .catch(function () {
        loading.row.remove();
        if (why === 'stopped') errorCard('Stopped waiting', 'You stopped waiting for this answer. You can try again.', q);
        else if (why === 'timeout') errorCard('No answer yet', 'No answer after ' + Math.round((Date.now() - started) / 1000) + ' seconds. The service may be busy. Please try again.', q);
        else errorCard('Could not connect', 'Could not reach the assistant. Check your connection (same Wi-Fi or hotspot) and try again.', q);
        setStatus('');
      })
      .then(function () {
        clearTimeout(slowT); clearTimeout(hardT); current = null;
        setBusy(false);
        if (finePointer) input.focus({ preventScroll: true });
      });
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight + 2, 140) + 'px';
  }

  function loadChips(questions) {
    chipsEl.textContent = '';
    (questions || []).slice(0, 6).forEach(function (q) {
      var b = el('button', 'chip', String(q));
      b.type = 'button'; b.dir = 'auto';
      b.addEventListener('click', function () { ask(String(q)); });
      chipsEl.appendChild(b);
    });
    if (!chipsEl.children.length) suggestEl.hidden = true;
    else if (asked) moreBtn.hidden = false;
  }

  function init() {
    form.addEventListener('submit', function (e) { e.preventDefault(); ask(input.value); });
    input.addEventListener('input', autosize);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); }
    });
    moreBtn.addEventListener('click', function () {
      var open = moreBtn.getAttribute('aria-expanded') === 'true';
      chipsEl.hidden = open;
      suggestEl.classList.toggle('collapsed', open);
      moreBtn.setAttribute('aria-expanded', String(!open));
      if (!open) { scrollTo(suggestEl, 'nearest'); var first = chipsEl.querySelector('button'); if (first) first.focus(); }
    });
    fetch('/api/suggestions').then(function (r) { return r.json(); })
      .then(function (d) { loadChips(d.questions); })
      .catch(function () { suggestEl.hidden = true; setStatus('Suggested questions are unavailable, but you can still type your own.'); });
    fetch('/api/info').then(function (r) { return r.json(); })
      .then(function (d) {
        var date = d.generatedAt ? fmtDate(d.generatedAt) : '';
        $('footnote').textContent = 'Answers come from the public UOWD website' + (date ? ', checked ' + date : '') +
          '. Not official. Do not enter personal data.' + (d.pages ? ' (' + d.pages + ' pages indexed)' : '');
      }).catch(function () {});
  }

  if (/[?&]mock=1(&|$)/.test(location.search)) {
    var s = document.createElement('script');
    s.src = 'mock-api.js';
    s.onload = init; s.onerror = init;
    document.head.appendChild(s);
  } else init();
})();
