(function () {
  'use strict';
  var SUGGEST = ['How do I apply for an undergraduate degree?', 'What are the English language requirements?', 'What scholarships are available?',
    'How much are the tuition fees?', 'When does the next semester start?', 'Does UOWD help with student visas?'];
  var ready = null;
  function load() {
    if (!ready) ready = fetchOrig('corpus-lite.json').then(function (r) { return r.json(); }).then(function (c) {
      return { corpus: c, ctx: { index: new UOWDEngine.BM25Index(c.chunks, {}), generatedAt: c.generatedAt, thresh: UOWDEngine.THRESH, llm: null } };
    });
    return ready;
  }
  var fetchOrig = window.fetch.bind(window);
  function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } }); }
  window.fetch = function (url, opts) {
    var u = String(url);
    var m = u.match(/\/api\/([a-z]+)\/?$/);
    if (!m) return fetchOrig(url, opts);
    var name = m[1];
    if (name === 'feedback') return Promise.resolve(json({ ok: true }));
    if (name === 'suggestions') return Promise.resolve(json({ questions: SUGGEST }));
    return load().then(function (s) {
      if (name === 'info') return json({ pages: s.corpus.pages.length, chunks: s.corpus.chunks.length, generatedAt: s.corpus.generatedAt, llm: false, version: 'static' });
      if (name === 'ask') {
        var q = '';
        try { q = JSON.parse((opts && opts.body) || '{}').question || ''; } catch (e) { q = ''; }
        q = String(q).slice(0, 400);
        if (!q.trim()) return json({ error: 'question required' }, 400);
        var t0 = performance.now();
        return UOWDEngine.answerQuestion(q, s.ctx).then(function (r) { r.ms = Math.round(performance.now() - t0); return json(r); });
      }
      return json({ error: 'not found' }, 404);
    }).catch(function () { return json({ error: 'could not load the page data' }, 500); });
  };
})();
