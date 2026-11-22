(function () {
  'use strict';

  var D = window.EduConnectData;
  if (!D) return;

  var $ = function (id) { return document.getElementById(id); };
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;

  /* Demo Accounts for Role-Based Access Control (CTO Q6) */
  var ACCOUNTS = {
    'layla.a@educonnect.ac.ae': { code: 'student26', role: 'student', name: 'Layla A. (S2041877)' },
    's2041877':                 { code: 'student26', role: 'student', name: 'Layla A. (S2041877)' },
    'staff.lead@educonnect.ac.ae': { code: 'staff2026', role: 'staff', name: 'Sarah K. (Support Lead)' },
    'cto@educonnect.ac.ae':     { code: 'cto2026',   role: 'cto',   name: 'Tariq M. (CTO Auditor)' }
  };

  var state = {
    role: 'student',         // 'student' | 'staff' | 'cto'
    userName: 'Layla A. (S2041877)',
    activeTab: 'assistant',  // 'assistant' | 'requests' | 'tickets' | 'kms' | 'cto' | 'denied'
    hasAsked: false,
    guardMode: false,
    corpusMode: 'educonnect', // 'educonnect' | 'uowd'
    selectedCategory: null,
    busy: false,
    nextTicketNum: 4093,
    ticketFilter: 'all',
    kmsDataset: 'educonnect',
    kmsSearch: '',
    kmsStatus: 'all',
    kmsCategory: 'all',
    uowdPagesCache: null,
    uowdChips: [
      'How much are the tuition fees?',
      'What are the English language requirements?',
      'What scholarships are available?',
      'Does UOWD help with student visas?'
    ],
    articles: D.ARTICLES.map(function (a) { return Object.assign({}, a, { bullets: (a.bullets || []).slice() }); }),
    tickets: D.INITIAL_TICKETS.map(function (t) { return Object.assign({}, t); }),
    auditLog: D.INITIAL_AUDIT.map(function (e) { return Object.assign({}, e); }),
    messages: []
  };

  /* ---------- DOM References ---------- */
  var portalSubtitle = $('portalSubtitle'),
      studentNav = $('studentNav'),
      adminNav = $('adminNav'),
      myReqBadge = $('myReqBadge'),
      openTicketBadge = $('openTicketBadge'),
      conflictBadge = $('conflictBadge'),
      corpusSwitchBtn = $('corpusSwitchBtn'),
      corpusPillLabel = $('corpusPillLabel'),
      authActionBtn = $('authActionBtn'),
      heroSection = $('heroSection'),
      browseSection = $('browseSection'),
      chatStage = $('chatStage'),
      modeEduBtn = $('modeEduConnect'),
      modeUowdBtn = $('modeUowd'),
      heroForm = $('heroForm'),
      heroQuestion = $('heroQuestion'),
      chipsEl = $('chips'),
      browseSub = $('browseSub'),
      clearCatBtn = $('clearCatBtn'),
      guardQuickBtn = $('guardQuickBtn'),
      categoryGrid = $('categoryGrid'),
      backHomeBtn = $('backHomeBtn'),
      activeCorpusTag = $('activeCorpusTag'),
      statusEl = $('status'),
      thread = $('thread'),
      form = $('form'),
      input = $('question'),
      sendBtn = $('send'),
      myRequestsList = $('myRequestsList'),
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
      loginModal = $('loginModal'),
      loginForm = $('loginForm'),
      loginEmail = $('loginEmail'),
      loginCode = $('loginCode'),
      loginError = $('loginError'),
      qrModal = $('qrModal'),
      modalQrCanvas = $('modalQrCanvas'),
      modalQrUrl = $('modalQrUrl'),
      articleModal = $('articleModal'),
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
    if (node) node.scrollIntoView({ block: block || 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
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
            var p0 = el('p', null, l); p0.dir = 'auto'; into.appendChild(p0);
          }
        });
        var ul = el('ul'); ul.dir = 'auto';
        bullets.forEach(function (l) { ul.appendChild(el('li', null, l.replace(/^([-*•]|\d+[.)])\s+/, ''))); });
        into.appendChild(ul);
        return;
      }
      var p = el('p', null, lines.join(' ')); p.dir = 'auto'; into.appendChild(p);
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
    } else done(false);
  }

  /* ---------- Role-Based Access Control (RBAC) & Header Sync ---------- */
  function isAdminRole() {
    return state.role === 'staff' || state.role === 'cto';
  }

  function myStudentTickets() {
    return state.tickets.filter(function (t) {
      return t.student.indexOf('S2041877') !== -1;
    });
  }

  function updateCounters() {
    var openCount = state.tickets.filter(function (t) { return t.status !== 'Resolved'; }).length;
    var flaggedCount = state.articles.filter(function (a) { return a.status !== 'verified'; }).length;
    var myCount = myStudentTickets().filter(function (t) { return t.status !== 'Resolved'; }).length;

    myReqBadge.textContent = myCount;
    openTicketBadge.textContent = openCount;
    conflictBadge.textContent = flaggedCount;
    auditCountBadge.textContent = state.auditLog.length;
  }

  function syncRoleUI() {
    var admin = isAdminRole();
    studentNav.hidden = admin;
    adminNav.hidden = !admin;

    if (admin) {
      portalSubtitle.textContent = (state.role === 'cto' ? 'CTO Executive Console' : 'Staff Support Console') + ' · ' + state.userName;
      authActionBtn.textContent = 'Switch to Student / Sign Out';
    } else {
      portalSubtitle.textContent = 'Student Services Portal · ' + state.userName;
      authActionBtn.textContent = 'Staff Sign In';
    }
    updateCounters();
  }

  var PANELS = {
    assistant: { btn: $('tabBtnAssistant'), panel: $('panelAssistant'), adminOnly: false },
    requests:  { btn: $('tabBtnMyRequests'), panel: $('panelMyRequests'), adminOnly: false },
    tickets:   { btn: $('tabBtnTickets'),   panel: $('panelTickets'),   adminOnly: true },
    kms:       { btn: $('tabBtnKms'),       panel: $('panelKms'),       adminOnly: true },
    cto:       { btn: $('tabBtnCto'),       panel: $('panelCto'),       adminOnly: true },
    denied:    { btn: null,                 panel: $('panelRbacDenied'), adminOnly: false }
  };

  function switchTab(name) {
    var target = PANELS[name] ? name : 'assistant';
    if (PANELS[target].adminOnly && !isAdminRole()) {
      target = 'denied';
      pushAuditEntry({
        question: 'Unauthorized admin route access blocked (Student S2041877 -> #' + name + ')',
        mode: 'security-blocked',
        confidence: 0,
        sourceId: 'RBAC',
        rule: 'CTO_Q6_RBAC_DENIED'
      });
    }

    state.activeTab = target;
    Object.keys(PANELS).forEach(function (k) {
      var active = (k === target);
      if (PANELS[k].btn) {
        PANELS[k].btn.classList.toggle('active', active);
        PANELS[k].btn.setAttribute('aria-selected', String(active));
      }
      PANELS[k].panel.hidden = !active;
    });

    if (target === 'requests') renderMyRequests();
    if (target === 'tickets') renderTickets();
    if (target === 'kms') renderKms();
    if (target === 'cto') { renderPilotKpis(); renderAuditTable(); renderRoadmap(); }
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
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

  /* ---------- Authentication Modal Logic ---------- */
  function openLoginModal() {
    loginError.hidden = true;
    loginModal.hidden = false;
    loginEmail.focus();
  }

  function performSignIn(email, code) {
    var acct = ACCOUNTS[String(email || '').trim().toLowerCase()];
    if (!acct || acct.code !== String(code || '').trim()) {
      loginError.textContent = 'Invalid ID/email or access code. Use a demo preset below to switch roles.';
      loginError.hidden = false;
      return;
    }
    state.role = acct.role;
    state.userName = acct.name;
    loginModal.hidden = true;
    loginError.hidden = true;
    syncRoleUI();
    pushAuditEntry({
      question: 'Role session activated: ' + acct.name + ' [' + acct.role.toUpperCase() + ']',
      mode: 'rbac-auth',
      confidence: 1,
      sourceId: 'SSO',
      rule: 'RBAC_ROLE_' + acct.role.toUpperCase()
    });
    if (acct.role === 'staff') switchTab('tickets');
    else if (acct.role === 'cto') switchTab('cto');
    else switchTab('assistant');
  }

  /* ---------- Corpus Mode & Landing Stage ---------- */
  function setCorpusMode(mode) {
    state.corpusMode = (mode === 'uowd') ? 'uowd' : 'educonnect';
    var isEdu = state.corpusMode === 'educonnect';
    modeEduBtn.classList.toggle('active', isEdu);
    modeUowdBtn.classList.toggle('active', !isEdu);

    if (isEdu) {
      corpusPillLabel.textContent = 'Source: EduConnect KMS';
      activeCorpusTag.textContent = 'EduConnect Policies (24) · UOWD Fallback Ready';
      heroQuestion.placeholder = 'Ask about late penalties, enrollment, tuition refunds, or UOWD info...';
    } else {
      corpusPillLabel.textContent = 'Source: UOWD (240 Pages)';
      activeCorpusTag.textContent = 'UOWD Live Public Website (240 Pages)';
      heroQuestion.placeholder = 'Ask any public UOWD question (fees, IELTS, visas, scholarships)...';
    }
    renderSuggestions();
  }

  function syncConversationView() {
    heroSection.hidden = state.hasAsked;
    browseSection.hidden = state.hasAsked;
    chatStage.hidden = !state.hasAsked;
  }

  function renderCategories() {
    categoryGrid.textContent = '';
    clearCatBtn.hidden = !state.selectedCategory && !state.guardMode;

    D.CATEGORIES.forEach(function (cat) {
      var catArts = state.articles.filter(function (a) { return a.category === cat.id; });
      var card = el('button', 'cat-card' + (state.selectedCategory === cat.id ? ' active' : ''));
      card.type = 'button';

      var top = el('div', 'cat-top');
      top.appendChild(el('span', 'cat-name', cat.name));
      top.appendChild(el('span', 'cat-count', catArts.length + ' guides'));
      card.appendChild(top);
      card.appendChild(el('p', 'cat-desc', cat.desc));

      card.addEventListener('click', function () {
        state.guardMode = false;
        state.selectedCategory = (state.selectedCategory === cat.id) ? null : cat.id;
        setCorpusMode('educonnect');
        renderCategories();
        renderSuggestions();
        scrollTo(heroSection, 'start');
      });
      categoryGrid.appendChild(card);
    });
  }

  function renderSuggestions() {
    chipsEl.textContent = '';
    var list = [];

    if (state.guardMode) {
      browseSub.textContent = 'Guardrail stress-tests selected — click a chip above to test refusal, PII redaction & escalation.';
      list = D.PERSONAS.filter(function (p) { return p.id === 'guard'; })[0].chips.slice(0, 4);
    } else if (state.selectedCategory) {
      var cat = D.CATEGORIES.filter(function (c) { return c.id === state.selectedCategory; })[0];
      browseSub.textContent = 'Filtered to ' + (cat ? cat.name : 'category') + ' policies.';
      list = state.articles.filter(function (a) { return a.category === state.selectedCategory; }).slice(0, 4).map(function (a) { return a.sampleQuestion; });
    } else if (state.corpusMode === 'uowd') {
      browseSub.textContent = 'Querying 240 live crawled public pages from uowdubai.ac.ae.';
      list = state.uowdChips.slice(0, 4);
    } else {
      browseSub.textContent = 'Choose a university department or test a guardrail scenario.';
      list = D.PERSONAS[0].chips.slice(0, 4);
    }

    clearCatBtn.hidden = !state.selectedCategory && !state.guardMode;
    list.forEach(function (q) {
      var b = el('button', 'chip' + (state.guardMode ? ' guard-chip' : ''), q);
      b.type = 'button';
      b.disabled = state.busy;
      b.addEventListener('click', function () { ask(q); });
      chipsEl.appendChild(b);
    });
  }

  /* ---------- Answer Thread & Student Escalation ---------- */
  function createTicketFromAnswer(question, res, btn, followWrap) {
    var topSrc = (res.sources && res.sources[0]) || null;
    var ticketId = 'TCK-' + (state.nextTicketNum++);
    var redQ = D.redactPii(question);
    var reason = (res.handoff && res.handoff.reason) || (res.mode === 'refused' ? 'Low Confidence / Out of Scope' : 'Student Requested Human Verification');
    var team = (res.handoff && res.handoff.team) || 'Student Support Desk';
    var draft = topSrc
      ? 'Recommended Staff Reply citing ' + (topSrc.id || 'Official Source') + ': ' + trimText(topSrc.snippet || res.answer, 220)
      : 'No matching policy exceeded threshold. Review student inquiry and update KMS if a documentation gap exists.';

    state.tickets.unshift({
      id: ticketId,
      createdAt: 'Just now',
      student: 'Student #S2041877 (Verified)',
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
    btn.textContent = 'Request ' + ticketId + ' Submitted ✓';

    if (followWrap && !followWrap.querySelector('.jump-ticket-btn')) {
      var jump = el('button', 'btn-outline jump-ticket-btn', isAdminRole() ? 'Open in Staff Queue →' : 'View in My Requests →');
      jump.type = 'button';
      jump.addEventListener('click', function () {
        switchTab(isAdminRole() ? 'tickets' : 'requests');
      });
      followWrap.appendChild(jump);
    }
  }

  function renderSourceCard(s) {
    var li = el('li', 'source');
    li.appendChild(el('p', 'source-title', s.title || 'Source'));
    if (s.section || s.id) {
      li.appendChild(el('p', 'source-path', (s.id ? s.id + ' · ' : '') + (s.section || '')));
    } else if (s.url) {
      var u0 = safeUrl(s.url);
      if (u0) li.appendChild(el('p', 'source-path', u0.hostname.replace(/^www\./, '') + u0.pathname));
    }
    if (s.snippet) li.appendChild(el('p', 'source-snippet', trimText(s.snippet, 165)));

    var u = safeUrl(s.url);
    if (u) {
      var a = el('a', 'source-link', 'Open official UOWD page ↗');
      a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      li.appendChild(a);
    } else if (s.id) {
      var inspect = el('button', 'source-link', 'View policy section →');
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
    var card = el('div', 'card' + (secBlocked ? ' security-blocked' : (refused ? ' refused' : '')));

    var head = el('div', 'card-head');
    head.appendChild(el('p', 'card-kicker', secBlocked ? 'Security Firewall Blocked' : (refused ? 'EduConnect Guard · Human Support Routing' : (sourceLabel || 'Official Policy Answer'))));

    var pills = el('span', 'provenance-pills');
    if (secBlocked) {
      pills.appendChild(el('span', 'pill-badge bad', 'Prompt Injection Blocked'));
    } else if (refused) {
      pills.appendChild(el('span', 'pill-badge warn', data.ruleLabel || 'Escalated to People'));
    } else {
      var pct = Math.round((Number(data.confidence) || 0) * 100);
      pills.appendChild(el('span', 'pill-badge ' + (pct >= 70 ? 'ok' : 'warn'), pct + '% Match Confidence'));
    }
    if (data.ms != null) pills.appendChild(el('span', 'pill-badge neutral', data.ms + ' ms'));
    head.appendChild(pills);
    card.appendChild(head);

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
    meta.appendChild(el('span', null, 'Privacy log: "' + trimText(D.redactPii(question), 58) + '"'));
    body.appendChild(meta);
    card.appendChild(body);

    if ((data.handoff && data.handoff.show) || refused) {
      var ho = data.handoff || { show: true, severity: 'warn', team: 'Student Support Desk', reason: 'Low Retrieval Confidence', text: 'I could not verify a confident policy match. Submit a support request below.' };
      var hBox = el('div', 'handoff' + (ho.severity === 'urgent' || secBlocked ? ' urgent' : ''));
      var hCopy = el('div');
      hCopy.appendChild(el('h4', null, ho.reason || 'Human Support Routing'));
      hCopy.appendChild(el('p', null, ho.text || 'Submit this question directly to university support staff.'));
      hBox.appendChild(hCopy);

      if (!secBlocked) {
        var hAct = el('div', 'handoff-actions');
        var escBtn = el('button', 'btn-warn', 'Submit Support Request');
        escBtn.type = 'button';
        escBtn.addEventListener('click', function () {
          createTicketFromAnswer(question, data, escBtn, hAct);
        });
        hAct.appendChild(escBtn);
        hBox.appendChild(hAct);
      }
      card.appendChild(hBox);
    }

    var srcs = Array.isArray(data.sources) ? data.sources.filter(Boolean) : [];
    if (srcs.length) {
      var sw = el('div', 'sources-wrap');
      sw.appendChild(el('h4', 'sources-title', 'Sources (' + srcs.length + ')'));
      var ul = el('ul', 'sources');
      srcs.forEach(function (s) { ul.appendChild(renderSourceCard(s)); });
      sw.appendChild(ul);
      card.appendChild(sw);
    }

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
      fbLbl.textContent = 'Thanks ✓';
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
    while (state.messages.length > 20) {
      var old = state.messages.shift();
      if (old && old.parentNode) old.remove();
    }
  }

  function userBubble(text) {
    var row = el('div', 'row user');
    var b = el('div', 'bubble', text); b.dir = 'auto';
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
    p.appendChild(document.createTextNode(state.corpusMode === 'uowd' ? 'Searching 240 live UOWD pages...' : 'Searching official policies...'));
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
    $('heroSendBtn').disabled = b;
    Array.prototype.forEach.call(chipsEl.querySelectorAll('button'), function (c) { c.disabled = b; });
  }

  function ask(rawQ) {
    var q = String(rawQ || '').trim();
    if (!q || state.busy) return;
    if (q.length > 400) {
      statusEl.textContent = 'Please keep questions under 400 characters.';
      return;
    }

    if (!state.hasAsked) {
      state.hasAsked = true;
      syncConversationView();
    }

    statusEl.textContent = '';
    userBubble(q);
    heroQuestion.value = '';
    input.value = '';
    autosize();
    setBusy(true);

    if (state.corpusMode === 'educonnect') {
      var t0 = performance.now();
      var localRes = D.answerEduConnect(q, state.articles);
      if (localRes) {
        localRes.ms = Math.max(1, Math.round(performance.now() - t0));
        var srcLabel = localRes.primaryArticle
          ? ('Official Policy · ' + localRes.primaryArticle.id)
          : 'EduConnect Response';
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

    var loadNode = loadingCard();
    fetch('/api/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q })
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        loadNode.remove();
        if (!res.ok) throw new Error((res.body && res.body.error) || 'Engine error');
        var data = res.body || {};
        var isFallback = (state.corpusMode === 'educonnect');
        var label = data.mode === 'refused'
          ? 'Not Answered · Escalate to Support'
          : (isFallback ? 'UOWD Campus Index (240 Pages)' : 'UOWD Live Public Website');
        if (data.mode === 'refused') {
          data.ruleLabel = 'Below Confidence Threshold';
          data.handoff = {
            show: true, severity: 'warn', team: 'Student Support Desk',
            reason: 'No Verified Policy Match',
            text: (data.handoff && data.handoff.text) || 'We could not verify an answer in the official policies. Submit a support request below.'
          };
        } else if (data.handoff && data.handoff.show) {
          data.handoff.reason = 'Confirm Official Dates & Fees';
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
        botAnswerCard({
          mode: 'refused', confidence: 0, ruleLabel: 'Manual Support Required',
          answer: 'I could not match this question to an official policy or live campus page.',
          handoff: { show: true, severity: 'warn', team: 'Student Support Desk', reason: 'Escalate to Support Staff', text: 'Submit a support request so an advisor can help.' },
          sources: []
        }, q, 'Refused · Support Escalation');
      })
      .then(function () {
        setBusy(false);
        if (finePointer) input.focus({ preventScroll: true });
      });
  }

  /* ---------- STUDENT TAB 2: My Requests (Student-Scoped Only) ---------- */
  function renderMyRequests() {
    var list = myStudentTickets();
    myRequestsList.textContent = '';
    if (!list.length) {
      var card = el('div', 'ticket-card');
      card.appendChild(el('p', 'ticket-q', 'You have no open support requests yet.'));
      myRequestsList.appendChild(card);
      return;
    }

    list.forEach(function (t) {
      var card = el('article', 'ticket-card');
      var head = el('div', 'ticket-head');
      var idGrp = el('div', 'ticket-id-group');
      idGrp.appendChild(el('span', 'ticket-id', t.id));
      idGrp.appendChild(el('span', 'pill-badge ' + (t.status === 'Resolved' ? 'ok' : 'warn'), t.status === 'Resolved' ? 'Resolved' : 'Assigned · ' + t.assignedTeam));
      head.appendChild(idGrp);
      head.appendChild(el('span', 'muted-small', t.createdAt));
      card.appendChild(head);

      card.appendChild(el('p', 'ticket-q', t.question));

      var meta = el('div', 'ticket-meta');
      meta.appendChild(el('span', null, 'Category: ' + t.category));
      meta.appendChild(el('span', null, 'Status: ' + (t.status === 'Resolved' ? 'Completed by support staff' : 'Awaiting human review')));
      card.appendChild(meta);
      myRequestsList.appendChild(card);
    });
  }

  /* ---------- ADMIN TAB 1: Staff Ticket Queue ---------- */
  function renderTickets() {
    if (!isAdminRole()) return;
    var openT = state.tickets.filter(function (t) { return t.status !== 'Resolved'; });
    var sensT = state.tickets.filter(function (t) { return /Sensitive/i.test(t.trigger); });
    var govT = state.tickets.filter(function (t) { return /Conflict|Stale|Confidence|Manual/i.test(t.trigger); });

    ticketKpis.textContent = '';
    [
      { lbl: 'Open Escalations', val: openT.length, sub: 'Awaiting support action' },
      { lbl: 'Guardrail Sensitive', val: sensT.length, sub: 'Appeals, hardship & wellbeing' },
      { lbl: 'Governance / Low Conf', val: govT.length, sub: 'Conflicts or low retrieval score' },
      { lbl: 'Copilot Citation Coverage', val: '100%', sub: 'Pre-attached KMS drafts' }
    ].forEach(function (k) {
      var c = el('div', 'kpi-card');
      c.appendChild(el('p', 'kpi-label', k.lbl));
      c.appendChild(el('p', 'kpi-val', k.val));
      c.appendChild(el('p', 'kpi-sub', k.sub));
      ticketKpis.appendChild(c);
    });

    var filtered = state.tickets.filter(function (t) {
      if (state.ticketFilter === 'open') return t.status !== 'Resolved';
      if (state.ticketFilter === 'sensitive') return /Sensitive/i.test(t.trigger);
      if (state.ticketFilter === 'governance') return /Conflict|Stale|Confidence|Manual/i.test(t.trigger);
      if (state.ticketFilter === 'resolved') return t.status === 'Resolved';
      return true;
    });

    ticketList.textContent = '';
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
      meta.appendChild(el('span', null, 'Area: ' + t.category));
      meta.appendChild(el('span', null, 'Cited Policy: ' + t.citedId));
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
          mode: 'staff-resolved', confidence: 1, sourceId: t.citedId, rule: 'HUMAN_AGENT_APPROVED'
        });
        renderTickets();
      });
      actions.appendChild(resolveBtn);

      if (t.citedId && t.citedId !== 'NONE') {
        var openKmsBtn = el('button', 'btn-outline', 'Inspect ' + t.citedId + ' in KMS');
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

  /* ---------- ADMIN TAB 2: Knowledge Repository ---------- */
  function populateKmsCategories() {
    kmsCatFilter.textContent = '';
    kmsCatFilter.appendChild(el('option', null, 'All Categories')).value = 'all';
    D.CATEGORIES.forEach(function (c) {
      var o = el('option', null, c.name); o.value = c.id; kmsCatFilter.appendChild(o);
    });
  }

  function renderKms() {
    if (!isAdminRole()) return;
    var isEdu = state.kmsDataset === 'educonnect';
    kmsBtnEdu.classList.toggle('active', isEdu);
    kmsBtnUowd.classList.toggle('active', !isEdu);
    kmsStatusFilter.disabled = !isEdu;
    kmsCatFilter.disabled = !isEdu;

    if (!isEdu) { renderUowdIndex(); return; }

    var verifiedCount = state.articles.filter(function (a) { return a.status === 'verified'; }).length;
    var flaggedCount = state.articles.length - verifiedCount;

    kmsKpis.textContent = '';
    [
      { lbl: 'Total KMS Scope', val: state.articles.length + ' Policies', sub: 'Structured internal repository' },
      { lbl: 'Verified & Owned', val: verifiedCount, sub: 'Single named owner + check date' },
      { lbl: 'Governance Alerts', val: flaggedCount, sub: flaggedCount ? 'CTO Q3 conflicts awaiting sign-off' : 'All conflicts reconciled!' },
      { lbl: 'Linked Public Corpus', val: '240 Pages', sub: 'Crawled uowdubai.ac.ae pages' }
    ].forEach(function (k) {
      var c = el('div', 'kpi-card');
      c.appendChild(el('p', 'kpi-label', k.lbl));
      c.appendChild(el('p', 'kpi-val', k.val));
      c.appendChild(el('p', 'kpi-sub', k.sub));
      kmsKpis.appendChild(c);
    });

    var q = state.kmsSearch.trim().toLowerCase();
    var filtered = state.articles.filter(function (a) {
      if (state.kmsStatus === 'flagged' && a.status === 'verified') return false;
      if (state.kmsStatus === 'verified' && a.status !== 'verified') return false;
      if (state.kmsCategory !== 'all' && a.category !== state.kmsCategory) return false;
      if (q && (a.id + ' ' + a.title + ' ' + a.owner + ' ' + a.section + ' ' + a.summary).toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) {
      if (a.status !== 'verified' && b.status === 'verified') return -1;
      if (a.status === 'verified' && b.status !== 'verified') return 1;
      return 0;
    });

    kmsList.textContent = '';
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

      if (flagged && a.conflictNote) card.appendChild(el('div', 'kms-alert', a.conflictNote));
      else card.appendChild(el('p', 'source-snippet', a.reconciledFlag ? a.reconciledSummary : a.summary));

      var acts = el('div', 'ticket-actions');
      var viewBtn = el('button', 'btn-outline', 'Inspect Policy');
      viewBtn.type = 'button';
      viewBtn.addEventListener('click', function () { openArticleModal(a.id); });
      acts.appendChild(viewBtn);

      if (flagged) {
        var recBtn = el('button', 'btn-warn', 'Reconcile & Assign Owner');
        recBtn.type = 'button';
        recBtn.addEventListener('click', function () {
          a.status = 'verified';
          a.owner = a.suggestedOwner || 'Office of Academic Governance';
          a.lastVerified = '23 Nov 2026 (Reconciled Live)';
          a.reconciledFlag = true;
          updateCounters();
          pushAuditEntry({
            question: 'KMS Governance reconciled ' + a.id + ' -> ' + a.owner,
            mode: 'kms-reconciled', confidence: 1, sourceId: a.id, rule: 'CONFLICT_RESOLVED'
          });
          renderKms();
        });
        acts.appendChild(recBtn);
      }
      card.appendChild(acts);
      kmsList.appendChild(card);
    });
  }

  function renderUowdIndex() {
    kmsKpis.textContent = '';
    [
      { lbl: 'Live Public Corpus', val: '240 Pages', sub: 'Crawled from uowdubai.ac.ae' },
      { lbl: 'Retrieval Engine', val: 'Custom BM25', sub: 'Synonyms, typos & title boost' },
      { lbl: 'Indexed Excerpts', val: state.uowdPagesCache ? state.uowdPagesCache.chunks.length : '1,365', sub: 'Runs purely in browser / Node' },
      { lbl: 'Guardrail Rule', val: 'Confirm Official', sub: 'External source link attached' }
    ].forEach(function (k) {
      var c = el('div', 'kpi-card');
      c.appendChild(el('p', 'kpi-label', k.lbl));
      c.appendChild(el('p', 'kpi-val', k.val));
      c.appendChild(el('p', 'kpi-sub', k.sub));
      kmsKpis.appendChild(c);
    });

    if (state.uowdPagesCache) { drawUowdPages(state.uowdPagesCache); return; }
    kmsList.textContent = '';
    kmsList.appendChild(el('p', 'muted-small', 'Loading 240 crawled UOWD public pages...'));
    fetch('corpus-lite.json')
      .then(function (r) { if (!r.ok) throw new Error('missing'); return r.json(); })
      .then(function (c) { state.uowdPagesCache = c; drawUowdPages(c); })
      .catch(function () {
        kmsList.textContent = '';
        var card = el('div', 'kms-card');
        card.appendChild(el('h3', 'ticket-q', 'UOWD Live Server Index (240 Pages Active on Node Backend)'));
        card.appendChild(el('p', 'source-snippet', 'Full URL table browsing is included in the GitHub Pages static bundle; locally the 240-page index runs inside server memory for /api/ask.'));
        kmsList.appendChild(card);
      });
  }

  function drawUowdPages(c) {
    var seen = {}, pages = [];
    (c.chunks || []).forEach(function (ch) {
      if (!seen[ch.url]) { seen[ch.url] = true; pages.push({ url: ch.url, title: ch.title || ch.url, snippet: ch.text }); }
    });
    var q = state.kmsSearch.trim().toLowerCase();
    var filtered = pages.filter(function (p) {
      return !q || (p.title + ' ' + p.url + ' ' + p.snippet).toLowerCase().indexOf(q) !== -1;
    });

    kmsList.textContent = '';
    kmsList.appendChild(el('p', 'muted-small', 'Showing ' + Math.min(filtered.length, 40) + ' of ' + filtered.length + ' crawled UOWD pages (' + pages.length + ' total URLs).'));
    filtered.slice(0, 40).forEach(function (p) {
      var card = el('article', 'kms-card');
      card.appendChild(el('h3', 'ticket-q', p.title));
      card.appendChild(el('p', 'source-path', p.url));
      card.appendChild(el('p', 'source-snippet', trimText(p.snippet, 180)));
      var ext = el('a', 'source-link', 'Open Live UOWD Page ↗');
      ext.href = p.url; ext.target = '_blank'; ext.rel = 'noopener noreferrer';
      card.appendChild(ext);
      kmsList.appendChild(card);
    });
  }

  /* ---------- ADMIN TAB 3: CTO KPIs, Audit Log & Roadmap ---------- */
  function renderPilotKpis() {
    if (!isAdminRole()) return;
    pilotKpiGrid.textContent = '';
    D.PILOT_METRICS.forEach(function (m) {
      var c = el('div', 'pilot-card');
      c.appendChild(el('p', 'kpi-label', m.name));
      c.appendChild(el('div', 'pilot-val', m.pilot));
      var track = el('div', 'bar-track');
      track.appendChild(el('div', 'bar-fill w-' + m.progress));
      c.appendChild(track);
      c.appendChild(el('p', 'pilot-meta', 'Baseline: ' + m.baseline));
      c.appendChild(el('p', 'pilot-meta', 'Target: ' + m.target));
      pilotKpiGrid.appendChild(c);
    });
  }

  function renderRedactedCell(text, td) {
    String(text || '').split(/(\[email\]|\[number\])/g).forEach(function (part) {
      if (part === '[email]' || part === '[number]') td.appendChild(el('span', 'pii-tag', part));
      else td.appendChild(document.createTextNode(part));
    });
  }

  function renderAuditTable() {
    if (!isAdminRole()) return;
    auditTableBody.textContent = '';
    state.auditLog.forEach(function (e) {
      var tr = el('tr');
      tr.appendChild(el('td', null, fmtTimeUtc(e.ts)));
      var qTd = el('td'); renderRedactedCell(e.question, qTd); tr.appendChild(qTd);
      var modeCls = e.mode === 'security-blocked' ? 'bad' : (e.mode.indexOf('refused') !== -1 || e.mode.indexOf('escalated') !== -1 ? 'warn' : 'ok');
      var mTd = el('td'); mTd.appendChild(el('span', 'pill-badge ' + modeCls, e.mode)); tr.appendChild(mTd);
      tr.appendChild(el('td', null, (e.sourceId ? e.sourceId + ' · ' : '') + e.rule));
      auditTableBody.appendChild(tr);
    });
  }

  function renderRoadmap() {
    if (!isAdminRole()) return;
    roadmapGrid.textContent = '';
    D.ROADMAP.forEach(function (r) {
      var step = el('div', 'road-step');
      step.appendChild(el('p', 'road-phase', r.phase));
      step.appendChild(el('h4', null, r.title));
      step.appendChild(el('p', null, r.owner + ' — ' + r.exit));
      roadmapGrid.appendChild(step);
    });
  }

  /* ---------- Modals ---------- */
  function openQrModal() {
    var shareUrl = (location.origin && location.origin !== 'null')
      ? (location.origin + location.pathname.replace(/[^/]*$/, ''))
      : 'https://parkar4308-cell.github.io/uowd-assistant/';
    modalQrUrl.textContent = shareUrl;
    if (window.QR && typeof window.QR.draw === 'function') window.QR.draw(modalQrCanvas, shareUrl, 260, 4);
    qrModal.hidden = false;
    $('qrCloseBtn').focus();
  }

  function openArticleModal(id) {
    var art = state.articles.filter(function (a) { return a.id === id; })[0];
    if (!art) {
      art = {
        id: id, title: 'Student Wellbeing & Confidential Counselling Charter (§1.1)',
        categoryLabel: 'Safeguarding', section: 'Student Care Policy 2026 · §1.1',
        owner: 'Director of Student Wellbeing', lastVerified: '20 Nov 2026', status: 'verified',
        summary: 'Mental health and safeguarding disclosures bypass automated answers and route confidentially to Room G-14 Counsellors or the 24/7 Helpline (800-WELL-EDU).',
        bullets: ['Never handled by AI.', 'Priority human escalation without storing personal distress logs.']
      };
    }
    artModalId.textContent = art.id + ' · ' + art.categoryLabel;
    artModalTitle.textContent = art.title;
    artModalBody.textContent = '';
    artModalBody.appendChild(el('p', 'muted-small', (art.reconciledFlag ? art.reconciledSection : art.section) + ' · Owner: ' + art.owner + ' · Checked: ' + art.lastVerified));
    if (isAdminRole() && art.status !== 'verified' && art.conflictNote) {
      artModalBody.appendChild(el('div', 'kms-alert', art.conflictNote));
    }
    artModalBody.appendChild(el('p', null, art.reconciledFlag ? art.reconciledSummary : art.summary));
    var ul = el('ul');
    (art.bullets || []).forEach(function (b) { ul.appendChild(el('li', null, b)); });
    artModalBody.appendChild(ul);
    articleModal.hidden = false;
    $('artCloseBtn').focus();
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight + 2, 120) + 'px';
  }

  /* ---------- Init ---------- */
  function init() {
    syncRoleUI();
    renderCategories();
    populateKmsCategories();
    setCorpusMode('educonnect');
    syncConversationView();

    /* Check URL hash for RBAC guard demonstration (#admin) */
    function checkHashRoute() {
      var h = String(location.hash || '').replace(/^#/, '').toLowerCase();
      if (h === 'admin' || h === 'tickets' || h === 'kms' || h === 'cto') {
        switchTab(h === 'admin' ? 'tickets' : h);
      } else if (h === 'requests') {
        switchTab('requests');
      }
    }
    window.addEventListener('hashchange', checkHashRoute);

    /* Wire Nav Tabs */
    Object.keys(PANELS).forEach(function (k) {
      if (PANELS[k].btn) PANELS[k].btn.addEventListener('click', function () { switchTab(k); });
    });

    /* Topbar Corpus Toggle & Auth Action */
    corpusSwitchBtn.addEventListener('click', function () {
      setCorpusMode(state.corpusMode === 'educonnect' ? 'uowd' : 'educonnect');
      if (state.activeTab !== 'assistant') switchTab('assistant');
    });
    authActionBtn.addEventListener('click', function () {
      if (isAdminRole()) {
        state.role = 'student';
        state.userName = 'Layla A. (S2041877)';
        syncRoleUI();
        switchTab('assistant');
      } else {
        openLoginModal();
      }
    });

    /* RBAC Denied Buttons */
    $('rbacSignInBtn').addEventListener('click', openLoginModal);
    $('rbacBackStudentBtn').addEventListener('click', function () { switchTab('assistant'); });
    $('newAskFromReqBtn').addEventListener('click', function () { switchTab('assistant'); });

    /* Login Modal & Quick Presets */
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      performSignIn(loginEmail.value, loginCode.value);
    });
    $('fillStudentBtn').addEventListener('click', function () {
      loginEmail.value = 'layla.a@educonnect.ac.ae';
      loginCode.value = 'student26';
      performSignIn(loginEmail.value, loginCode.value);
    });
    $('fillStaffBtn').addEventListener('click', function () {
      loginEmail.value = 'staff.lead@educonnect.ac.ae';
      loginCode.value = 'staff2026';
      performSignIn(loginEmail.value, loginCode.value);
    });
    $('fillCtoBtn').addEventListener('click', function () {
      loginEmail.value = 'cto@educonnect.ac.ae';
      loginCode.value = 'cto2026';
      performSignIn(loginEmail.value, loginCode.value);
    });
    $('loginCloseBtn').addEventListener('click', function () { loginModal.hidden = true; });
    loginModal.addEventListener('click', function (e) { if (e.target === loginModal) loginModal.hidden = true; });

    /* Hero & Student Browse Controls */
    modeEduBtn.addEventListener('click', function () { state.guardMode = false; setCorpusMode('educonnect'); });
    modeUowdBtn.addEventListener('click', function () { state.guardMode = false; setCorpusMode('uowd'); });
    clearCatBtn.addEventListener('click', function () {
      state.selectedCategory = null;
      state.guardMode = false;
      renderCategories();
      renderSuggestions();
    });
    guardQuickBtn.addEventListener('click', function () {
      state.selectedCategory = null;
      state.guardMode = !state.guardMode;
      setCorpusMode('educonnect');
      renderCategories();
      renderSuggestions();
      scrollTo(heroSection, 'start');
    });
    backHomeBtn.addEventListener('click', function () {
      state.hasAsked = false;
      state.selectedCategory = null;
      state.guardMode = false;
      thread.textContent = '';
      state.messages = [];
      renderCategories();
      renderSuggestions();
      syncConversationView();
    });

    /* Forms */
    heroForm.addEventListener('submit', function (e) { e.preventDefault(); ask(heroQuestion.value); });
    form.addEventListener('submit', function (e) { e.preventDefault(); ask(input.value); });
    input.addEventListener('input', autosize);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); }
    });

    /* Ticket Filters & KMS Controls */
    Array.prototype.forEach.call($('ticketFilters').children, function (b) {
      b.addEventListener('click', function () {
        state.ticketFilter = b.dataset.tfilter;
        Array.prototype.forEach.call($('ticketFilters').children, function (x) { x.classList.toggle('active', x === b); });
        renderTickets();
      });
    });
    kmsBtnEdu.addEventListener('click', function () { state.kmsDataset = 'educonnect'; renderKms(); });
    kmsBtnUowd.addEventListener('click', function () { state.kmsDataset = 'uowd'; renderKms(); });
    kmsSearch.addEventListener('input', function () { state.kmsSearch = kmsSearch.value; renderKms(); });
    kmsStatusFilter.addEventListener('change', function () { state.kmsStatus = kmsStatusFilter.value; renderKms(); });
    kmsCatFilter.addEventListener('change', function () { state.kmsCategory = kmsCatFilter.value; renderKms(); });

    /* QR & Policy Modals */
    $('qrOpenBtn').addEventListener('click', openQrModal);
    $('qrCloseBtn').addEventListener('click', function () { qrModal.hidden = true; });
    $('qrCloseBtnBottom').addEventListener('click', function () { qrModal.hidden = true; });
    $('artCloseBtn').addEventListener('click', function () { articleModal.hidden = true; });
    qrModal.addEventListener('click', function (e) { if (e.target === qrModal) qrModal.hidden = true; });
    articleModal.addEventListener('click', function (e) { if (e.target === articleModal) articleModal.hidden = true; });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { qrModal.hidden = true; articleModal.hidden = true; loginModal.hidden = true; }
    });

    /* Sync Live UOWD Metadata */
    fetch('/api/suggestions')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && Array.isArray(d.questions) && d.questions.length) {
          state.uowdChips = d.questions.slice(0, 4);
          if (state.corpusMode === 'uowd') renderSuggestions();
        }
      }).catch(function () {});

    fetch('/api/info')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.pages) modeUowdBtn.textContent = 'UOWD Live Website (' + d.pages + ' Pages)';
      }).catch(function () {});

    checkHashRoute();
  }

  init();
})();
