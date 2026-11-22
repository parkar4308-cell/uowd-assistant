(function () {
  'use strict';

  var D = window.EduConnectData;
  if (!D) return;

  var $ = function (id) { return document.getElementById(id); };
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;

  /* ---------- Mutable Demo State (Live Interactive Simulation) ---------- */
  var state = {
    activeTab: 'assistant',
    activePersona: 'student',
    corpusMode: 'educonnect', // 'educonnect' | 'uowd'
    selectedCategory: null,
    busy: false,
    asked: false,
    nextTicketNum: 4093,
    ticketFilter: 'all',
    kmsDataset: 'educonnect', // 'educonnect' | 'uowd'
    kmsSearch: '',
    kmsStatus: 'all',
    kmsCategory: 'all',
    uowdPagesCache: null,
    uowdChips: [
      'How much are the tuition fees?',
      'What are the English language requirements?',
      'What scholarships are available?',
      'How do I apply for an undergraduate degree?',
      'When does the next semester start?',
      'Does UOWD help with student visas?'
    ],
    articles: D.ARTICLES.map(function (a) { return Object.assign({}, a, { bullets: (a.bullets || []).slice() }); }),
    tickets: D.INITIAL_TICKETS.map(function (t) { return Object.assign({}, t); }),
    auditLog: D.INITIAL_AUDIT.map(function (e) { return Object.assign({}, e); }),
    messages: []
  };

  /* ---------- DOM References ---------- */
  var personaBar = $('personaBar'),
      personaTag = $('personaTag'),
      openTicketBadge = $('openTicketBadge'),
      conflictBadge = $('conflictBadge'),
      corpusBadge = $('corpusBadge'),
      modeEduBtn = $('modeEduConnect'),
      modeUowdBtn = $('modeUowd'),
      engineHint = $('engineHint'),
      categoryGrid = $('categoryGrid'),
      clearCatBtn = $('clearCatBtn'),
      suggestTitle = $('suggestTitle'),
      suggestSub = $('suggestSub'),
      chipsEl = $('chips'),
      moreBtn = $('moreBtn'),
      clearThreadBtn = $('clearThreadBtn'),
      statusEl = $('status'),
      thread = $('thread'),
      form = $('form'),
      input = $('question'),
      sendBtn = $('send'),
      ticketKpis = $('ticketKpis'),
      ticketList = $('ticketList'),
      kmsKpis = $('kmsKpis'),
      kmsBtnEdu = $('kmsBtnEdu'),
      kmsBtnUowd = $('kmsBtnUowd'),
      kmsSearch = $('kmsSearch'),
      kmsStatusFilter = $('kmsStatusFilter'),
      kmsCatFilter = $('kmsCatFilter'),
      kmsList = $('kmsList'),
      pilotKpiGrid = $('pilotKpiGrid'),
      auditCountBadge = $('auditCountBadge'),
      auditTableBody = $('auditTableBody'),
      roadmapGrid = $('roadmapGrid'),
      qrModal = $('qrModal'),
      qrOpenBtn = $('qrOpenBtn'),
      qrCloseBtn = $('qrCloseBtn'),
      qrCloseBtnBottom = $('qrCloseBtnBottom'),
      modalQrCanvas = $('modalQrCanvas'),
      modalQrUrl = $('modalQrUrl'),
      articleModal = $('articleModal'),
      artCloseBtn = $('artCloseBtn'),
      artModalId = $('artModalId'),
      artModalTitle = $('artModalTitle'),
      artModalBody = $('artModalBody');

  /* ---------- Safe DOM Helpers ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  function safeUrl(u) {
    try {
      var p = new URL(u);
      return (p.protocol === 'https:' || p.protocol === 'http:') ? p : null;
    } catch (e) {
      return null;
    }
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return String(iso || '');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function fmtTimeUtc(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return String(iso || '');
    return d.toISOString().slice(11, 19) + 'Z';
  }

  function trimText(t, n) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    if (t.length <= n) return t;
    var cut = t.slice(0, n), sp = cut.lastIndexOf(' ');
    return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, '') + '...';
  }

  function scrollTo(node, block) {
    if (!node) return;
    node.scrollIntoView({ block: block || 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  function renderTextBlocks(text, into) {
    var blocks = String(text || '').replace(/\r/g, '').split(/\n\s*\n/);
    blocks.forEach(function (block) {
      var lines = block.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      if (!lines.length) return;
      var bullets = lines.filter(function (l) { return /^([-*•]|\d+[.)])\s+/.test(l); });
      if (bullets.length >= 2 || (bullets.length === 1 && lines.length === 1)) {
        lines.forEach(function (l) {
          if (!/^([-*•]|\d+[.)])\s+/.test(l)) {
            var p0 = el('p', null, l);
            p0.dir = 'auto';
            into.appendChild(p0);
          }
        });
        var ul = el('ul');
        ul.dir = 'auto';
        bullets.forEach(function (l) {
          ul.appendChild(el('li', null, l.replace(/^([-*•]|\d+[.)])\s+/, '')));
        });
        into.appendChild(ul);
        return;
      }
      var p = el('p', null, lines.join(' '));
      p.dir = 'auto';
      into.appendChild(p);
    });
    if (!into.firstChild) into.appendChild(el('p', null, 'No answer returned.'));
  }

  function copyText(text, btn) {
    function done(ok) {
      btn.textContent = ok ? 'Copied ✓' : 'Copy failed';
      setTimeout(function () { btn.textContent = 'Copy answer'; }, 1800);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else {
      done(false);
    }
  }

  /* ---------- Header Counters & Live Telemetry ---------- */
  function updateCounters() {
    var openCount = state.tickets.filter(function (t) { return t.status !== 'Resolved'; }).length;
    var flaggedCount = state.articles.filter(function (a) { return a.status !== 'verified'; }).length;
    openTicketBadge.textContent = openCount + ' Open';
    openTicketBadge.className = 'count-pill ' + (openCount > 0 ? 'warn' : 'ok');

    conflictBadge.textContent = flaggedCount + ' Flagged';
    conflictBadge.className = 'count-pill ' + (flaggedCount > 0 ? 'bad' : 'ok');

    auditCountBadge.textContent = state.auditLog.length + ' Events';
  }

  function pushAuditEntry(entry) {
    state.auditLog.unshift({
      ts: new Date().toISOString(),
      question: D.redactPii(entry.question),
      mode: entry.mode || 'kms-rag',
      confidence: entry.confidence != null ? entry.confidence : 0,
      sourceId: entry.sourceId || 'KMS',
      rule: entry.rule || 'LOGGED'
    });
    if (state.auditLog.length > 40) state.auditLog.length = 40;
    updateCounters();
    if (state.activeTab === 'cto') renderAuditTable();
  }

  /* ---------- Tab & Persona Switching ---------- */
  var TAB_MAP = {
    assistant: { btn: $('tabBtnAssistant'), panel: $('panelAssistant') },
    tickets:   { btn: $('tabBtnTickets'),   panel: $('panelTickets') },
    kms:       { btn: $('tabBtnKms'),       panel: $('panelKms') },
    cto:       { btn: $('tabBtnCto'),       panel: $('panelCto') }
  };

  function switchTab(name) {
    if (!TAB_MAP[name]) name = 'assistant';
    state.activeTab = name;
    Object.keys(TAB_MAP).forEach(function (k) {
      var active = (k === name);
      TAB_MAP[k].btn.classList.toggle('active', active);
      TAB_MAP[k].btn.setAttribute('aria-selected', String(active));
      TAB_MAP[k].panel.hidden = !active;
    });
    if (name === 'tickets') renderTickets();
    if (name === 'kms') renderKms();
    if (name === 'cto') { renderPilotKpis(); renderAuditTable(); renderRoadmap(); }
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  function setCorpusMode(mode) {
    state.corpusMode = (mode === 'uowd') ? 'uowd' : 'educonnect';
    var isEdu = state.corpusMode === 'educonnect';
    modeEduBtn.classList.toggle('active', isEdu);
    modeUowdBtn.classList.toggle('active', !isEdu);
    if (isEdu) {
      engineHint.textContent = 'Active: EduConnect KMS (24 Policies) + automatic fallback to UOWD 240-page live BM25 index.';
      input.placeholder = 'Ask about late penalties, enrollment, tuition refunds, appeals, or UOWD info...';
    } else {
      engineHint.textContent = 'Active: Live UOWD Campus Corpus (240 crawled pages from uowdubai.ac.ae via custom BM25).';
      input.placeholder = 'Ask any public question about UOWD (tuition fees, IELTS, visas, scholarships, dates)...';
    }
    renderSuggestions();
  }

  function selectPersona(personaId) {
    var p = D.PERSONAS.filter(function (x) { return x.id === personaId; })[0] || D.PERSONAS[0];
    state.activePersona = p.id;
    state.selectedCategory = null;
    personaTag.textContent = p.roleTag;
    Array.prototype.forEach.call(personaBar.children, function (btn) {
      btn.classList.toggle('active', btn.dataset.persona === p.id);
    });
    setCorpusMode(p.corpus);
    renderCategories();
    switchTab(p.tab);
  }

  function renderPersonas() {
    personaBar.textContent = '';
    D.PERSONAS.forEach(function (p) {
      var b = el('button', 'persona-pill' + (p.id === state.activePersona ? ' active' : ''), p.label);
      b.type = 'button';
      b.dataset.persona = p.id;
      b.addEventListener('click', function () { selectPersona(p.id); });
      personaBar.appendChild(b);
    });
  }

  /* ---------- Category Grid & Suggestions (Tab 1) ---------- */
  function renderCategories() {
    categoryGrid.textContent = '';
    clearCatBtn.hidden = !state.selectedCategory;
    D.CATEGORIES.forEach(function (cat) {
      var catArts = state.articles.filter(function (a) { return a.category === cat.id; });
      var flagged = catArts.filter(function (a) { return a.status !== 'verified'; }).length;
      var card = el('button', 'cat-card' + (state.selectedCategory === cat.id ? ' active' : ''));
      card.type = 'button';

      var top = el('div', 'cat-top');
      top.appendChild(el('span', 'cat-name', cat.name));
      var badges = el('span', 'cat-badges');
      badges.appendChild(el('span', 'cat-count', catArts.length + ' policies'));
      if (flagged > 0) badges.appendChild(el('span', 'count-pill bad', flagged + ' alert'));
      top.appendChild(badges);

      card.appendChild(top);
      card.appendChild(el('p', 'cat-desc', cat.desc));
      card.addEventListener('click', function () {
        state.selectedCategory = (state.selectedCategory === cat.id) ? null : cat.id;
        setCorpusMode('educonnect');
        renderCategories();
        renderSuggestions();
        scrollTo($('suggestSection'), 'nearest');
      });
      categoryGrid.appendChild(card);
    });
  }

  function renderSuggestions() {
    chipsEl.textContent = '';
    chipsEl.hidden = false;
    moreBtn.hidden = true;

    var list = [];
    var isGuard = (state.activePersona === 'guard' && !state.selectedCategory);

    if (state.selectedCategory) {
      var catObj = D.CATEGORIES.filter(function (c) { return c.id === state.selectedCategory; })[0];
      suggestTitle.textContent = (catObj ? catObj.name : 'Category') + ' — Policy Questions';
      suggestSub.textContent = 'Questions mapped directly to verified KMS policies (plus governance conflict triggers).';
      list = state.articles
        .filter(function (a) { return a.category === state.selectedCategory; })
        .map(function (a) { return a.sampleQuestion; });
    } else if (state.corpusMode === 'uowd') {
      suggestTitle.textContent = 'UOWD Public Website — Live Corpus Prompts (240 Pages)';
      suggestSub.textContent = 'Queries run live BM25 search across real crawled pages from uowdubai.ac.ae.';
      list = state.uowdChips.slice(0, 6);
    } else if (isGuard) {
      suggestTitle.textContent = 'Guardrail Stress-Test Scenarios (CTO Q4, Q7 & Q8)';
      suggestSub.textContent = 'Click any stress-test prompt to test sensitive escalation, PII redaction, and prompt-injection blocking.';
      list = D.PERSONAS.filter(function (p) { return p.id === 'guard'; })[0].chips;
    } else {
      suggestTitle.textContent = 'Recommended Student Questions';
      suggestSub.textContent = 'Click a question to see grounded section citations, or switch to Guardrail Stress-Test above.';
      list = D.PERSONAS[0].chips;
    }

    list.forEach(function (q) {
      var b = el('button', 'chip' + (isGuard ? ' guard-chip' : ''), q);
      b.type = 'button';
      b.disabled = state.busy;
      b.addEventListener('click', function () { ask(q); });
      chipsEl.appendChild(b);
    });
  }

  /* ---------- Tab 1 Answer Cards & Escalation ---------- */
  function createTicketFromAnswer(question, res, btn, followWrap) {
    var topSrc = (res.sources && res.sources[0]) || null;
    var ticketId = 'TCK-' + (state.nextTicketNum++);
    var redQ = D.redactPii(question);
    var reason = (res.handoff && res.handoff.reason) || (res.mode === 'refused' ? 'Low Confidence / Out of Scope' : 'Student Requested Human Verification');
    var team = (res.handoff && res.handoff.team) || 'Student Support Desk';
    var draft = topSrc
      ? 'Recommended Staff Reply citing ' + (topSrc.id || 'Official Source') + ': ' + trimText(topSrc.snippet || res.answer, 220)
      : 'No matching institutional policy found above confidence threshold. Please review student request directly and update KMS if a documentation gap exists.';

    state.tickets.unshift({
      id: ticketId,
      createdAt: 'Just now (Live Escalation)',
      student: 'Student #S2041877 (Redacted)',
      category: res.primaryArticle ? res.primaryArticle.categoryLabel : 'General Support',
      trigger: reason,
      triggerLevel: res.mode === 'refused' ? 'urgent' : 'warn',
      question: redQ,
      status: 'Open',
      assignedTeam: team,
      citedId: topSrc && topSrc.id ? topSrc.id : 'NONE',
      citedTitle: topSrc ? topSrc.title : 'Human Policy Lookup Required',
      copilotDraft: draft
    });

    updateCounters();
    pushAuditEntry({
      question: question,
      mode: 'ticket-escalated',
      confidence: res.confidence || 0,
      sourceId: ticketId,
      rule: 'ESCALATED -> ' + team
    });

    btn.disabled = true;
    btn.textContent = 'Ticket ' + ticketId + ' Created ✓';

    if (followWrap && !followWrap.querySelector('.jump-ticket-btn')) {
      var jump = el('button', 'btn-outline jump-ticket-btn', 'Open in Staff Queue →');
      jump.type = 'button';
      jump.addEventListener('click', function () { switchTab('tickets'); });
      followWrap.appendChild(jump);
    }
  }

  function renderSourceCard(s) {
    var li = el('li', 'source');
    var head = el('div', 'source-head');
    head.appendChild(el('p', 'source-title', s.title || 'Source'));
    if (s.status) {
      var stCls = s.status === 'verified' ? 'ok' : 'bad';
      var stTxt = s.status === 'verified' ? 'Verified' : (s.status === 'conflict' ? 'Conflict' : 'Stale');
      head.appendChild(el('span', 'pill-badge ' + stCls, stTxt));
    }
    li.appendChild(head);

    if (s.section || s.id) {
      li.appendChild(el('p', 'source-path', (s.id ? s.id + ' · ' : '') + (s.section || '')));
    } else if (s.url) {
      var u0 = safeUrl(s.url);
      if (u0) li.appendChild(el('p', 'source-path', u0.hostname.replace(/^www\./, '') + u0.pathname));
    }

    if (s.snippet) li.appendChild(el('p', 'source-snippet', trimText(s.snippet, 175)));

    var u = safeUrl(s.url);
    if (u) {
      var a = el('a', 'source-link', 'Open official UOWD page ↗');
      a.href = u.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      li.appendChild(a);
    } else if (s.id) {
      var inspect = el('button', 'source-link', 'Inspect full policy & owner →');
      inspect.type = 'button';
      inspect.addEventListener('click', function () { openArticleModal(s.id); });
      li.appendChild(inspect);
    }
    return li;
  }

  function botAnswerCard(data, question, sourceLabel) {
    var refused = data.mode === 'refused';
    var secBlocked = data.type === 'SECURITY_GUARDRAIL_BLOCK';
    var row = el('article', 'row bot');
    var cardCls = 'card' + (secBlocked ? ' security-blocked' : (refused ? ' refused' : ''));
    var card = el('div', cardCls);

    /* Header strip */
    var head = el('div', 'card-head');
    head.appendChild(el('p', 'card-kicker', secBlocked ? 'Security Firewall Blocked' : (refused ? 'EduConnect Guard · Human Handoff Required' : (sourceLabel || 'Verified Policy Answer'))));

    var pills = el('span', 'provenance-pills');
    if (secBlocked) {
      pills.appendChild(el('span', 'pill-badge bad', 'Prompt Injection Blocked'));
    } else if (refused) {
      pills.appendChild(el('span', 'pill-badge warn', data.ruleLabel || 'Guardrail Declined'));
    } else {
      var pct = Math.round((Number(data.confidence) || 0) * 100);
      pills.appendChild(el('span', 'pill-badge ' + (pct >= 70 ? 'ok' : 'warn'), pct + '% Match Confidence'));
    }
    if (data.ms != null) pills.appendChild(el('span', 'pill-badge neutral', data.ms + ' ms'));
    head.appendChild(pills);
    card.appendChild(head);

    /* Body */
    var body = el('div', 'card-body');
    var ans = el('div', 'answer');
    renderTextBlocks(data.answer, ans);
    body.appendChild(ans);

    var meta = el('div', 'meta-bar');
    if (data.primaryArticle) {
      meta.appendChild(el('span', null, 'Owner: ' + data.primaryArticle.owner));
      meta.appendChild(el('span', null, 'Verified: ' + data.primaryArticle.lastVerified));
    } else if (data.lastChecked) {
      meta.appendChild(el('span', null, 'Corpus checked: ' + fmtDate(data.lastChecked)));
    }
    meta.appendChild(el('span', null, 'Logged query: "' + trimText(D.redactPii(question), 64) + '"'));
    body.appendChild(meta);
    card.appendChild(body);

    /* Guardrail / Handoff Banner */
    if ((data.handoff && data.handoff.show) || refused) {
      var ho = data.handoff || { show: true, severity: 'warn', team: 'Student Support Desk', reason: 'Low Retrieval Confidence', text: 'I could not verify a confident policy match. Escalate to staff below.' };
      var hBox = el('div', 'handoff' + (ho.severity === 'urgent' || secBlocked ? ' urgent' : ''));
      var hCopy = el('div');
      hCopy.appendChild(el('h4', null, ho.reason || 'Human Support Routing'));
      hCopy.appendChild(el('p', null, ho.text || 'Please confirm or escalate with university support staff.'));
      hBox.appendChild(hCopy);

      if (!secBlocked) {
        var hAct = el('div', 'handoff-actions');
        var escBtn = el('button', 'btn-warn', 'Escalate to Support Ticket Queue');
        escBtn.type = 'button';
        escBtn.addEventListener('click', function () {
          createTicketFromAnswer(question, data, escBtn, hAct);
        });
        hAct.appendChild(escBtn);
        hBox.appendChild(hAct);
      }
      card.appendChild(hBox);
    }

    /* Sources */
    var srcs = Array.isArray(data.sources) ? data.sources.filter(Boolean) : [];
    if (srcs.length) {
      var sw = el('div', 'sources-wrap');
      sw.appendChild(el('h4', 'sources-title', 'Verified Sources (' + srcs.length + ')'));
      var ul = el('ul', 'sources');
      srcs.forEach(function (s) { ul.appendChild(renderSourceCard(s)); });
      sw.appendChild(ul);
      card.appendChild(sw);
    }

    /* Footer Actions */
    var act = el('div', 'actions');
    if (!refused && !secBlocked) {
      var cpy = el('button', 'btn', 'Copy answer');
      cpy.type = 'button';
      cpy.addEventListener('click', function () { copyText(data.answer, cpy); });
      act.appendChild(cpy);
    }
    act.appendChild(el('span', 'spacer'));
    var fb = el('span', 'fb');
    var fbLbl = el('span', 'fb-label', 'Helpful?');
    var yBtn = el('button', 'btn', 'Yes'); yBtn.type = 'button';
    var nBtn = el('button', 'btn', 'No');  nBtn.type = 'button';
    function sendFb(helpful, picked) {
      yBtn.disabled = nBtn.disabled = true;
      picked.classList.add('picked');
      fbLbl.textContent = 'Saved ✓';
      fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question, helpful: helpful })
      }).catch(function () {});
    }
    yBtn.addEventListener('click', function () { sendFb(true, yBtn); });
    nBtn.addEventListener('click', function () { sendFb(false, nBtn); });
    fb.appendChild(fbLbl); fb.appendChild(yBtn); fb.appendChild(nBtn);
    act.appendChild(fb);
    card.appendChild(act);

    row.appendChild(card);
    addMessage(row);
    scrollTo(row, 'start');
  }

  function addMessage(node) {
    thread.appendChild(node);
    state.messages.push(node);
    clearThreadBtn.hidden = false;
    while (state.messages.length > 20) {
      var old = state.messages.shift();
      if (old && old.parentNode) old.remove();
    }
  }

  function userBubble(text) {
    var row = el('div', 'row user');
    var b = el('div', 'bubble', text);
    b.dir = 'auto';
    row.appendChild(b);
    addMessage(row);
    scrollTo(row, 'end');
  }

  function loadingCard() {
    var row = el('div', 'row bot');
    var card = el('div', 'card');
    var body = el('div', 'card-body');
    var p = el('p', 'card-kicker');
    var t = el('span', 'typing');
    for (var i = 0; i < 3; i++) t.appendChild(el('span', 'dot'));
    p.appendChild(t);
    p.appendChild(document.createTextNode(state.corpusMode === 'uowd' ? 'Searching 240 live UOWD pages...' : 'Checking EduConnect guardrails & KMS...'));
    body.appendChild(p);
    body.appendChild(el('div', 'skel w1'));
    body.appendChild(el('div', 'skel w2'));
    card.appendChild(body);
    row.appendChild(card);
    thread.appendChild(row);
    scrollTo(row, 'end');
    return row;
  }

  function setBusy(b) {
    state.busy = b;
    sendBtn.disabled = b;
    Array.prototype.forEach.call(chipsEl.querySelectorAll('button'), function (c) { c.disabled = b; });
  }

  function ask(rawQ) {
    var q = String(rawQ || '').trim();
    if (!q || state.busy) return;
    if (q.length > 400) {
      statusEl.textContent = 'Please keep questions under 400 characters.';
      return;
    }

    statusEl.textContent = '';
    userBubble(q);
    input.value = '';
    autosize();
    setBusy(true);

    if (state.corpusMode === 'educonnect') {
      var t0 = performance.now();
      var localRes = D.answerEduConnect(q, state.articles);
      if (localRes) {
        localRes.ms = Math.max(1, Math.round(performance.now() - t0));
        var srcLabel = localRes.primaryArticle
          ? ('EduConnect KMS · ' + localRes.primaryArticle.id)
          : 'EduConnect KMS Response';
        botAnswerCard(localRes, q, srcLabel);
        pushAuditEntry({
          question: q,
          mode: localRes.type === 'SECURITY_GUARDRAIL_BLOCK' ? 'security-blocked' : (localRes.mode === 'refused' ? 'guardrail-refused' : 'rag-verified'),
          confidence: localRes.confidence,
          sourceId: localRes.sources[0] ? (localRes.sources[0].id || 'KMS') : (localRes.type === 'SECURITY_GUARDRAIL_BLOCK' ? 'FIREWALL' : 'GUARD'),
          rule: localRes.auditRule
        });
        setBusy(false);
        if (finePointer) input.focus({ preventScroll: true });
        return;
      }
    }

    /* Fall back to (or explicitly query) UOWD 240-Page Live BM25 Engine via /api/ask */
    var loadNode = loadingCard();
    fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q })
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        loadNode.remove();
        if (!res.ok) {
          throw new Error(res.body && res.body.error || 'Engine error');
        }
        var data = res.body || {};
        var isFallback = (state.corpusMode === 'educonnect');
        var label = data.mode === 'refused'
          ? 'No Policy Match Found · Human Escalation Available'
          : (isFallback ? 'Fallback · UOWD Live 240-Page Corpus' : 'UOWD Live 240-Page Corpus (BM25)');
        if (data.mode === 'refused') {
          data.ruleLabel = 'Below Confidence Threshold';
          data.handoff = {
            show: true,
            severity: 'warn',
            team: 'Student Support Desk',
            reason: 'Low Confidence / Topic Not in Approved KMS',
            text: data.handoff && data.handoff.text ? data.handoff.text : 'No approved EduConnect or UOWD page matched above threshold. Escalate to support staff.'
          };
        } else if (data.handoff && data.handoff.show) {
          data.handoff.reason = 'Critical Date / Fee Policy — Verify with Official Source';
          data.handoff.team = 'Admissions & Student Finance';
        }
        botAnswerCard(data, q, label);
        pushAuditEntry({
          question: q,
          mode: data.mode === 'refused' ? 'low-conf-refused' : 'uowd-bm25',
          confidence: data.confidence || 0,
          sourceId: data.sources && data.sources[0] ? 'uowdubai.ac.ae' : 'NONE',
          rule: data.mode === 'refused' ? 'BELOW_THRESH -> Handoff' : 'PUBLIC_UOWD_GROUNDED'
        });
      })
      .catch(function () {
        loadNode.remove();
        var fallbackRefusal = {
          mode: 'refused',
          confidence: 0,
          ruleLabel: 'Corpus Offline / Unmatched',
          answer: 'I could not reach the UOWD search index for this query and found no matching EduConnect policy.',
          handoff: { show: true, severity: 'warn', team: 'Student Support Desk', reason: 'Manual Escalation Required', text: 'Create a ticket below for human support assistance.' },
          sources: []
        };
        botAnswerCard(fallbackRefusal, q, 'Refused · Escalate to Support');
      })
      .then(function () {
        setBusy(false);
        if (finePointer) input.focus({ preventScroll: true });
      });
  }

  /* ---------- TAB 2: Staff Ticket Queue ---------- */
  function renderTickets() {
    var openT = state.tickets.filter(function (t) { return t.status !== 'Resolved'; });
    var sensT = state.tickets.filter(function (t) { return /Sensitive/i.test(t.trigger); });
    var govT = state.tickets.filter(function (t) { return /Conflict|Stale|Confidence|Manual/i.test(t.trigger); });

    ticketKpis.textContent = '';
    [
      { lbl: 'Open Escalations', val: openT.length, sub: 'Awaiting support agent action' },
      { lbl: 'Guardrail Sensitive', val: sensT.length, sub: 'Appeals, hardship & wellbeing' },
      { lbl: 'Governance / Low Conf', val: govT.length, sub: 'Policy conflicts or low BM25 score' },
      { lbl: 'Copilot Citation Coverage', val: '100%', sub: 'Pre-attached KMS drafts (CTO Q1)' }
    ].forEach(function (k) {
      var card = el('div', 'kpi-card');
      card.appendChild(el('p', 'kpi-label', k.lbl));
      card.appendChild(el('p', 'kpi-val', k.val));
      card.appendChild(el('p', 'kpi-sub', k.sub));
      ticketKpis.appendChild(card);
    });

    var filtered = state.tickets.filter(function (t) {
      if (state.ticketFilter === 'open') return t.status !== 'Resolved';
      if (state.ticketFilter === 'sensitive') return /Sensitive/i.test(t.trigger);
      if (state.ticketFilter === 'governance') return /Conflict|Stale|Confidence|Manual/i.test(t.trigger);
      if (state.ticketFilter === 'resolved') return t.status === 'Resolved';
      return true;
    });

    ticketList.textContent = '';
    if (!filtered.length) {
      var empty = el('div', 'ticket-card');
      empty.appendChild(el('p', 'ticket-q', 'No tickets match this filter.'));
      ticketList.appendChild(empty);
      return;
    }

    filtered.forEach(function (t) {
      var card = el('article', 'ticket-card');
      var head = el('div', 'ticket-head');
      var idGrp = el('div', 'ticket-id-group');
      idGrp.appendChild(el('span', 'ticket-id', t.id));
      idGrp.appendChild(el('span', 'pill-badge ' + (t.triggerLevel === 'urgent' ? 'bad' : (t.triggerLevel === 'warn' ? 'warn' : 'neutral')), t.trigger));
      idGrp.appendChild(el('span', 'pill-badge ' + (t.status === 'Resolved' ? 'ok' : 'warn'), t.status));
      head.appendChild(idGrp);
      head.appendChild(el('span', 'muted-small', t.createdAt + ' · ' + t.assignedTeam));
      card.appendChild(head);

      card.appendChild(el('p', 'ticket-q', t.question));

      var meta = el('div', 'ticket-meta');
      meta.appendChild(el('span', null, 'Requester: ' + t.student));
      meta.appendChild(el('span', null, 'Service Area: ' + t.category));
      meta.appendChild(el('span', null, 'Cited Doc: ' + t.citedId));
      card.appendChild(meta);

      var copilot = el('div', 'copilot-box');
      copilot.appendChild(el('p', 'copilot-label', 'AI Staff Copilot Draft (' + t.citedTitle + ')'));
      copilot.appendChild(el('p', null, t.copilotDraft));
      card.appendChild(copilot);

      var actions = el('div', 'ticket-actions');
      var resolveBtn = el('button', 'btn-primary', t.status === 'Resolved' ? 'Resolved ✓' : 'Approve & Send Cited Reply');
      resolveBtn.type = 'button';
      resolveBtn.disabled = (t.status === 'Resolved');
      resolveBtn.addEventListener('click', function () {
        t.status = 'Resolved';
        updateCounters();
        pushAuditEntry({
          question: 'Staff resolved ' + t.id + ': ' + t.question,
          mode: 'staff-resolved',
          confidence: 1,
          sourceId: t.citedId,
          rule: 'HUMAN_AGENT_APPROVED'
        });
        renderTickets();
      });
      actions.appendChild(resolveBtn);

      if (t.citedId && t.citedId !== 'NONE') {
        var openKmsBtn = el('button', 'btn-outline', 'Inspect Policy ' + t.citedId + ' in KMS');
        openKmsBtn.type = 'button';
        openKmsBtn.addEventListener('click', function () {
          state.kmsDataset = 'educonnect';
          state.kmsSearch = t.citedId;
          kmsSearch.value = t.citedId;
          state.kmsStatus = 'all';
          kmsStatusFilter.value = 'all';
          switchTab('kms');
        });
        actions.appendChild(openKmsBtn);
      }

      card.appendChild(actions);
      ticketList.appendChild(card);
    });
  }

  /* ---------- TAB 3: Knowledge Repository ---------- */
  function populateKmsCategories() {
    kmsCatFilter.textContent = '';
    kmsCatFilter.appendChild(el('option', null, 'All Categories')).value = 'all';
    D.CATEGORIES.forEach(function (c) {
      var o = el('option', null, c.name);
      o.value = c.id;
      kmsCatFilter.appendChild(o);
    });
  }

  function renderKms() {
    var isEdu = state.kmsDataset === 'educonnect';
    kmsBtnEdu.classList.toggle('active', isEdu);
    kmsBtnUowd.classList.toggle('active', !isEdu);
    kmsStatusFilter.disabled = !isEdu;
    kmsCatFilter.disabled = !isEdu;

    if (!isEdu) {
      renderUowdIndex();
      return;
    }

    var verifiedCount = state.articles.filter(function (a) { return a.status === 'verified'; }).length;
    var flaggedCount = state.articles.length - verifiedCount;

    kmsKpis.textContent = '';
    [
      { lbl: 'Total Approved Scope', val: state.articles.length + ' Policies', sub: 'Structured internal KMS articles' },
      { lbl: 'Verified & Owned', val: verifiedCount, sub: 'Single named owner + recent audit date' },
      { lbl: 'Governance Alerts', val: flaggedCount, sub: flaggedCount ? 'CTO Q3 conflicts awaiting sign-off' : 'All conflicts reconciled!' },
      { lbl: 'Linked Public Corpus', val: '240 Pages', sub: 'Live crawled uowdubai.ac.ae pages' }
    ].forEach(function (k) {
      var card = el('div', 'kpi-card');
      card.appendChild(el('p', 'kpi-label', k.lbl));
      card.appendChild(el('p', 'kpi-val', k.val));
      card.appendChild(el('p', 'kpi-sub', k.sub));
      kmsKpis.appendChild(card);
    });

    var q = state.kmsSearch.trim().toLowerCase();
    var filtered = state.articles.filter(function (a) {
      if (state.kmsStatus === 'flagged' && a.status === 'verified') return false;
      if (state.kmsStatus === 'verified' && a.status !== 'verified') return false;
      if (state.kmsCategory !== 'all' && a.category !== state.kmsCategory) return false;
      if (q) {
        var hay = (a.id + ' ' + a.title + ' ' + a.owner + ' ' + a.section + ' ' + a.summary).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    /* Float flagged articles to top when showing All */
    filtered.sort(function (a, b) {
      if (a.status !== 'verified' && b.status === 'verified') return -1;
      if (a.status === 'verified' && b.status !== 'verified') return 1;
      return 0;
    });

    kmsList.textContent = '';
    if (!filtered.length) {
      var eCard = el('div', 'kms-card');
      eCard.appendChild(el('p', 'ticket-q', 'No KMS policies match that search filter.'));
      kmsList.appendChild(eCard);
      return;
    }

    filtered.forEach(function (a) {
      var flagged = a.status !== 'verified';
      var card = el('article', 'kms-card' + (flagged ? ' flagged' : ''));

      var head = el('div', 'ticket-head');
      var idGrp = el('div', 'ticket-id-group');
      idGrp.appendChild(el('span', 'ticket-id', a.id));
      idGrp.appendChild(el('span', 'pill-badge neutral', a.categoryLabel));
      idGrp.appendChild(el('span', 'pill-badge ' + (flagged ? 'bad' : 'ok'),
        a.status === 'verified' ? 'Verified Owner' : (a.status === 'conflict' ? 'CTO Q3: Contradiction Flagged' : 'CTO Q3: Stale / Unowned')));
      head.appendChild(idGrp);
      head.appendChild(el('span', 'muted-small', 'Checked: ' + a.lastVerified));
      card.appendChild(head);

      card.appendChild(el('h3', 'ticket-q', a.title));
      card.appendChild(el('p', 'muted-small', (a.reconciledFlag ? a.reconciledSection : a.section) + ' · Owner: ' + a.owner));

      if (flagged && a.conflictNote) {
        card.appendChild(el('div', 'kms-alert', a.conflictNote));
      } else {
        card.appendChild(el('p', 'source-snippet', a.reconciledFlag ? a.reconciledSummary : a.summary));
      }

      var foot = el('div', 'kms-footer');
      var btnGrp = el('div', 'ticket-actions');
      var viewBtn = el('button', 'btn-outline', 'Inspect Full Policy');
      viewBtn.type = 'button';
      viewBtn.addEventListener('click', function () { openArticleModal(a.id); });
      btnGrp.appendChild(viewBtn);

      var testAskBtn = el('button', 'btn-outline', 'Test in Assistant');
      testAskBtn.type = 'button';
      testAskBtn.addEventListener('click', function () {
        setCorpusMode('educonnect');
        switchTab('assistant');
        ask(a.sampleQuestion);
      });
      btnGrp.appendChild(testAskBtn);

      if (flagged) {
        var recBtn = el('button', 'btn-warn', 'Reconcile & Assign Owner');
        recBtn.type = 'button';
        recBtn.addEventListener('click', function () {
          a.status = 'verified';
          a.owner = a.suggestedOwner || 'Office of Academic Governance';
          a.lastVerified = '23 Nov 2026 (Reconciled Live)';
          a.reconciledFlag = true;
          updateCounters();
          renderCategories();
          pushAuditEntry({
            question: 'KMS Governance reconciled ' + a.id + ' -> assigned to ' + a.owner,
            mode: 'kms-reconciled',
            confidence: 1,
            sourceId: a.id,
            rule: 'CONFLICT_RESOLVED'
          });
          renderKms();
        });
        btnGrp.appendChild(recBtn);
      }

      foot.appendChild(btnGrp);
      card.appendChild(foot);
      kmsList.appendChild(card);
    });
  }

  function renderUowdIndex() {
    kmsKpis.textContent = '';
    [
      { lbl: 'Live Public Corpus', val: '240 Pages', sub: 'Crawled politely from uowdubai.ac.ae' },
      { lbl: 'Search Engine', val: 'Custom BM25', sub: 'Title boost, synonyms & spelling correction' },
      { lbl: 'Indexed Excerpts', val: state.uowdPagesCache ? state.uowdPagesCache.chunks.length : '2,500+', sub: 'In-browser retrieval with zero LLM key' },
      { lbl: 'Verification Policy', val: 'Confirm Official', sub: 'Direct deep links to official university pages' }
    ].forEach(function (k) {
      var card = el('div', 'kpi-card');
      card.appendChild(el('p', 'kpi-label', k.lbl));
      card.appendChild(el('p', 'kpi-val', k.val));
      card.appendChild(el('p', 'kpi-sub', k.sub));
      kmsKpis.appendChild(card);
    });

    if (state.uowdPagesCache) {
      drawUowdPages(state.uowdPagesCache);
      return;
    }

    kmsList.textContent = '';
    var loading = el('div', 'kms-card');
    loading.appendChild(el('p', 'ticket-q', 'Loading 240 crawled UOWD public pages...'));
    kmsList.appendChild(loading);

    fetch('corpus-lite.json')
      .then(function (r) { if (!r.ok) throw new Error('not static'); return r.json(); })
      .then(function (c) {
        state.uowdPagesCache = c;
        drawUowdPages(c);
      })
      .catch(function () {
        kmsList.textContent = '';
        var note = el('div', 'kms-card');
        note.appendChild(el('h3', 'ticket-q', 'UOWD Live Server Index (240 Pages Active on Backend)'));
        note.appendChild(el('p', 'source-snippet', 'You are currently running against the local Node server where the full 240-page corpus stays in server memory. Switch Student Assistant to "UOWD Live Campus Index (240 Pages)" or run the static GitHub Pages build to browse every crawled URL directly.'));
        var go = el('button', 'btn-primary', 'Query UOWD Live Corpus in Assistant →');
        go.type = 'button';
        go.addEventListener('click', function () {
          setCorpusMode('uowd');
          switchTab('assistant');
        });
        note.appendChild(go);
        kmsList.appendChild(note);
      });
  }

  function drawUowdPages(c) {
    var seen = {};
    var pages = [];
    (c.chunks || []).forEach(function (ch) {
      if (!seen[ch.url]) {
        seen[ch.url] = true;
        pages.push({ url: ch.url, title: ch.title || ch.url, snippet: ch.text });
      }
    });

    var q = state.kmsSearch.trim().toLowerCase();
    var filtered = pages.filter(function (p) {
      if (!q) return true;
      return (p.title + ' ' + p.url + ' ' + p.snippet).toLowerCase().indexOf(q) !== -1;
    });

    kmsList.textContent = '';
    var summary = el('p', 'muted-small', 'Showing ' + Math.min(filtered.length, 40) + ' of ' + filtered.length + ' matching crawled UOWD pages (' + pages.length + ' total URLs indexed).');
    kmsList.appendChild(summary);

    filtered.slice(0, 40).forEach(function (p) {
      var card = el('article', 'kms-card');
      var head = el('div', 'ticket-head');
      head.appendChild(el('span', 'pill-badge ok', 'Crawled Public Page'));
      head.appendChild(el('span', 'muted-small', 'Source: uowdubai.ac.ae'));
      card.appendChild(head);
      card.appendChild(el('h3', 'ticket-q', p.title));
      card.appendChild(el('p', 'source-path', p.url));
      card.appendChild(el('p', 'source-snippet', trimText(p.snippet, 190)));
      var acts = el('div', 'ticket-actions');
      var ext = el('a', 'btn-outline', 'Open Live Page ↗');
      ext.href = p.url; ext.target = '_blank'; ext.rel = 'noopener noreferrer';
      acts.appendChild(ext);
      var askBtn = el('button', 'btn-primary', 'Ask About This Topic');
      askBtn.type = 'button';
      askBtn.addEventListener('click', function () {
        setCorpusMode('uowd');
        switchTab('assistant');
        ask('Tell me about ' + trimText(p.title.replace(/\|.*$/, ''), 60));
      });
      acts.appendChild(askBtn);
      card.appendChild(acts);
      kmsList.appendChild(card);
    });
  }

  /* ---------- TAB 4: CTO Pilot KPIs, Audit Log & Roadmap ---------- */
  function renderPilotKpis() {
    pilotKpiGrid.textContent = '';
    D.PILOT_METRICS.forEach(function (m) {
      var c = el('div', 'pilot-card');
      c.appendChild(el('p', 'kpi-label', m.name));
      c.appendChild(el('div', 'pilot-val', m.pilot));
      var track = el('div', 'bar-track');
      var fill = el('div', 'bar-fill w-' + m.progress);
      track.appendChild(fill);
      c.appendChild(track);
      c.appendChild(el('p', 'pilot-meta', 'Baseline: ' + m.baseline));
      c.appendChild(el('p', 'pilot-meta', 'Target: ' + m.target));
      pilotKpiGrid.appendChild(c);
    });
  }

  function renderRedactedCell(text, td) {
    var parts = String(text || '').split(/(\[email\]|\[number\])/g);
    parts.forEach(function (part) {
      if (part === '[email]' || part === '[number]') td.appendChild(el('span', 'pii-tag', part));
      else td.appendChild(document.createTextNode(part));
    });
  }

  function renderAuditTable() {
    auditTableBody.textContent = '';
    state.auditLog.forEach(function (e) {
      var tr = el('tr');
      tr.appendChild(el('td', null, fmtTimeUtc(e.ts)));
      var qTd = el('td');
      renderRedactedCell(e.question, qTd);
      tr.appendChild(qTd);

      var modeCls = e.mode === 'security-blocked' ? 'bad' : (e.mode.indexOf('refused') !== -1 || e.mode.indexOf('escalated') !== -1 ? 'warn' : 'ok');
      var mTd = el('td');
      mTd.appendChild(el('span', 'pill-badge ' + modeCls, e.mode));
      tr.appendChild(mTd);

      tr.appendChild(el('td', null, (e.sourceId ? e.sourceId + ' · ' : '') + e.rule));
      auditTableBody.appendChild(tr);
    });
  }

  function renderRoadmap() {
    roadmapGrid.textContent = '';
    D.ROADMAP.forEach(function (r) {
      var step = el('div', 'road-step');
      step.appendChild(el('p', 'road-phase', r.phase));
      step.appendChild(el('h4', null, r.title));
      step.appendChild(el('p', null, r.owner + ' — ' + r.exit));
      roadmapGrid.appendChild(step);
    });
  }

  /* ---------- Modals (QR & Article Inspector) ---------- */
  function openQrModal() {
    var shareUrl = (location.origin && location.origin !== 'null')
      ? (location.origin + location.pathname.replace(/[^/]*$/, ''))
      : 'https://parkar4308-cell.github.io/uowd-assistant/';
    modalQrUrl.textContent = shareUrl;
    if (window.QR && typeof window.QR.draw === 'function') {
      window.QR.draw(modalQrCanvas, shareUrl, 280, 4);
    }
    qrModal.hidden = false;
    qrCloseBtn.focus();
  }

  function openArticleModal(id) {
    var art = state.articles.filter(function (a) { return a.id === id; })[0];
    if (!art) {
      art = {
        id: id,
        title: 'Student Wellbeing & Confidential Counselling Charter (§1.1)',
        categoryLabel: 'Safeguarding & Student Care',
        section: 'Student Care Policy 2026 · Section 1.1',
        owner: 'Director of Student Wellbeing',
        lastVerified: '20 Nov 2026',
        status: 'verified',
        summary: 'Mental health, distress, and safeguarding disclosures immediately bypass automated answers and route confidentially to Room G-14 Counsellors or the 24/7 Crisis Support Line (800-WELL-EDU).',
        bullets: ['Never answered by generative AI.', 'Priority human escalation logged anonymously without transcript details.']
      };
    }
    artModalId.textContent = art.id + ' · ' + art.categoryLabel;
    artModalTitle.textContent = art.title;
    artModalBody.textContent = '';

    var meta = el('p', 'muted-small', (art.reconciledFlag ? art.reconciledSection : art.section) + ' · Owner: ' + art.owner + ' · Verified: ' + art.lastVerified);
    artModalBody.appendChild(meta);
    if (art.status !== 'verified' && art.conflictNote) {
      artModalBody.appendChild(el('div', 'kms-alert', art.conflictNote));
    }
    artModalBody.appendChild(el('p', null, art.reconciledFlag ? art.reconciledSummary : art.summary));
    var ul = el('ul');
    (art.bullets || []).forEach(function (b) { ul.appendChild(el('li', null, b)); });
    artModalBody.appendChild(ul);
    articleModal.hidden = false;
    artCloseBtn.focus();
  }

  /* ---------- Composer & Init ---------- */
  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight + 2, 130) + 'px';
  }

  function init() {
    renderPersonas();
    renderCategories();
    populateKmsCategories();
    updateCounters();
    setCorpusMode('educonnect');
    renderTickets();
    renderKms();
    renderPilotKpis();
    renderAuditTable();
    renderRoadmap();

    /* Wire Tabs */
    Object.keys(TAB_MAP).forEach(function (k) {
      TAB_MAP[k].btn.addEventListener('click', function () { switchTab(k); });
    });

    /* Wire Engine Switch */
    modeEduBtn.addEventListener('click', function () { setCorpusMode('educonnect'); });
    modeUowdBtn.addEventListener('click', function () { setCorpusMode('uowd'); });
    clearCatBtn.addEventListener('click', function () {
      state.selectedCategory = null;
      renderCategories();
      renderSuggestions();
    });

    clearThreadBtn.addEventListener('click', function () {
      thread.textContent = '';
      state.messages = [];
      clearThreadBtn.hidden = true;
    });

    /* Wire Composer */
    form.addEventListener('submit', function (e) { e.preventDefault(); ask(input.value); });
    input.addEventListener('input', autosize);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); }
    });

    /* Wire Ticket Filters */
    Array.prototype.forEach.call($('ticketFilters').children, function (b) {
      b.addEventListener('click', function () {
        state.ticketFilter = b.dataset.tfilter;
        Array.prototype.forEach.call($('ticketFilters').children, function (x) { x.classList.toggle('active', x === b); });
        renderTickets();
      });
    });

    /* Wire KMS Controls */
    kmsBtnEdu.addEventListener('click', function () { state.kmsDataset = 'educonnect'; renderKms(); });
    kmsBtnUowd.addEventListener('click', function () { state.kmsDataset = 'uowd'; renderKms(); });
    kmsSearch.addEventListener('input', function () { state.kmsSearch = kmsSearch.value; renderKms(); });
    kmsStatusFilter.addEventListener('change', function () { state.kmsStatus = kmsStatusFilter.value; renderKms(); });
    kmsCatFilter.addEventListener('change', function () { state.kmsCategory = kmsCatFilter.value; renderKms(); });

    /* Wire Modals */
    qrOpenBtn.addEventListener('click', openQrModal);
    qrCloseBtn.addEventListener('click', function () { qrModal.hidden = true; });
    qrCloseBtnBottom.addEventListener('click', function () { qrModal.hidden = true; });
    artCloseBtn.addEventListener('click', function () { articleModal.hidden = true; });
    qrModal.addEventListener('click', function (e) { if (e.target === qrModal) qrModal.hidden = true; });
    articleModal.addEventListener('click', function (e) { if (e.target === articleModal) articleModal.hidden = true; });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { qrModal.hidden = true; articleModal.hidden = true; }
    });

    /* Sync live UOWD metadata & suggestions */
    fetch('/api/suggestions')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && Array.isArray(d.questions) && d.questions.length) {
          state.uowdChips = d.questions;
          if (state.corpusMode === 'uowd') renderSuggestions();
        }
      })
      .catch(function () {});

    fetch('/api/info')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.pages) {
          corpusBadge.textContent = '24 KMS Policies · UOWD ' + d.pages + ' Pages Live';
          modeUowdBtn.textContent = 'UOWD Live Campus Index (' + d.pages + ' Pages)';
        }
      })
      .catch(function () {});
  }

  init();
})();
