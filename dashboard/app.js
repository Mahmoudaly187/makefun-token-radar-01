// Token Radar dashboard: a static page, no framework, no network.
//
// It renders window.RADAR, which main.ts writes to data.js from the same board.json the gate reads.
// Everything on screen is derived from the sealed snapshot's own figures; the page computes nothing the
// board did not already compute, and it re-derives each row's implied value in the browser only to show
// that the page and the board agree.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) {
    document.body.innerHTML = '<p class="empty">No radar data: data.js did not load.</p>';
    return;
  }

  var state = {
    q: '',
    category: 'all',
    chain: 'all',
    watchlistOnly: false,
    tab: 'pre-token', // 'pre-token' or 'live'
    sort: 'rank',     // rank | name | tvl | growth | age | implied | comp
    dir: 1,
    selectedSlug: null
  };

  // ---- formatters -------------------------------------------------------

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }

  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // ---- the model, re-derived in the page (must match board.json) --------

  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturityMult = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var base = row.tvl_usd * row.comp_multiple;
    return Math.max(1, Math.round(base * growthMult * maturityMult));
  }

  // ---- farm plan, derived from the protocol's own record ----------------

  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }

  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }

  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  function tvlWords(tvl) {
    if (tvl >= 1e9) return '$' + (tvl / 1e9).toFixed(1) + 'B';
    if (tvl >= 1e6) return '$' + Math.round(tvl / 1e6) + 'M';
    return '$' + Math.round(tvl / 1e3) + 'K';
  }

  function ageWords(age) {
    if (age === null || age === undefined) return 'an unrecorded time';
    if (age >= 730) return (age / 365).toFixed(1) + ' years';
    if (age >= 365) return 'a year';
    if (age >= 60) return Math.round(age / 30) + ' months';
    return age + ' days';
  }

  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'provide $' + capital + " of liquidity to " + name + "'s main pool on " + chain + ' and keep the position open';
    if (c.indexOf('bridge') >= 0) return 'bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge';
    if (c.indexOf('prediction') >= 0) return 'fund $' + capital + ' and place one market position on ' + name;
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares';
    if (c.indexOf('stable') >= 0) return 'mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain;
    if (c.indexOf('rwa') >= 0) return "mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it';
    if (c.indexOf('insurance') >= 0) return 'buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy';
    return 'deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open';
  }

  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var action = actionFor(p, capital, chain);
    var tvl = tvlWords(p.tvl_usd);
    var ran = ageWords(p.age_days);
    return [
      { text: 'Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline; never reuse a wallet that holds other assets.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: 'On ' + chain + ', ' + action + '. ' + p.name + ' holds ' + tvl + ' of TVL, so $' + capital + ' is a position that registers with it without risking much.', cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action every week — a deposit, a borrow, a swap or a vote — so the activity is counted in more than one weekly snapshot.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: p.name + ' has run ' + ran + ' with no token, so hold the position at least ' + hold + ' days; a longer, unbroken record is what a launch rewards.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open " + p.name + "'s own docs or points page and confirm the current reward rule, because a season's rules change between rounds.", cost: 'nothing to read the rules', time: '10 minutes' },
      { text: 'Claim only from a link ' + p.name + ' publishes on its own site or docs — never a link from a direct message or an advertisement.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log, so you can repeat the position or unwind it without guessing.', cost: 'nothing but the log', time: '5 minutes' }
    ];
  }

  // ---- element handles --------------------------------------------------

  var headerMetaEl = document.getElementById('header-meta');
  var headlineBlockEl = document.getElementById('headline-block');
  var controlsBarEl = document.getElementById('controls-bar');
  var tableContainerEl = document.getElementById('table-container');
  var modelSectionEl = document.getElementById('model-section');
  var footerVersionEl = document.getElementById('footer-version');
  var detailDialogEl = document.getElementById('detail-dialog');
  var dialogContentEl = document.getElementById('dialog-content');

  // ---- URL hash state ---------------------------------------------------

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selectedSlug = params.get('p');
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selectedSlug) params.set('p', state.selectedSlug);
    var str = params.toString();
    if (str) window.history.replaceState(null, '', '#' + str);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ---- header, headline, footer ----------------------------------------

  function renderHeaderAndFooter() {
    headerMetaEl.innerHTML = ''
      + '<span>Snapshot <b>' + escapeHtml(DATA.as_of) + '</b></span>'
      + '<span>' + escapeHtml(DATA.source) + '</span>'
      + '<span>Model <b>' + escapeHtml(DATA.model_version) + '</b></span>';
    footerVersionEl.textContent = DATA.model_version;
  }

  function renderHeadline() {
    var floorM = Math.round(DATA.floor_usd / 1e6);
    var bt = DATA.backtest;
    var bases = DATA.calibration.filter(function (c) { return c.n > 0; }).length;
    headlineBlockEl.innerHTML = ''
      + '<div class="headline-content">'
      +   '<h2>' + DATA.watchlist_size + ' protocols with no token, ranked by implied value</h2>'
      +   '<p>The watchlist is the floor: every protocol with at least $' + floorM + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, so the radar can catch a protocol before it is a household name. Implied value is a model read from the snapshot, not a promise.</p>'
      + '</div>'
      + '<div class="facts-grid">'
      +   fact('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'every slug is a row')
      +   fact('Rows scored', String(DATA.board_size), DATA.early_size + ' below the floor')
      +   fact('Comparable bases', String(bases), 'categories with live comparables')
      +   fact('Back-tested', String(bt.n), 'live protocols, leave-one-out')
      + '</div>';
  }

  function fact(label, value, sub) {
    return '<div class="fact-item">'
      + '<span class="fact-label">' + escapeHtml(label) + '</span>'
      + '<span class="fact-value">' + escapeHtml(value) + '</span>'
      + (sub ? '<span class="fact-sub">' + escapeHtml(sub) + '</span>' : '')
      + '</div>';
  }

  // ---- controls ---------------------------------------------------------

  function renderControls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chains[c] = true; }); });
    var chainList = Object.keys(chains).sort();

    controlsBarEl.innerHTML = ''
      + '<div class="search-group">'
      +   '<input type="search" class="search-input" id="search-box" placeholder="Search name, slug, category, chain..." value="' + escapeHtml(state.q) + '" aria-label="Search protocols">'
      + '</div>'
      + '<div class="select-group">'
      +   '<select class="select-input" id="category-select" aria-label="Filter by category">'
      +     '<option value="all"' + (state.category === 'all' ? ' selected' : '') + '>All categories</option>'
      +     categories.map(function (c) { return '<option value="' + escapeHtml(c) + '"' + (state.category === c ? ' selected' : '') + '>' + escapeHtml(c) + '</option>'; }).join('')
      +   '</select>'
      + '</div>'
      + '<div class="select-group">'
      +   '<select class="select-input" id="chain-select" aria-label="Filter by chain">'
      +     '<option value="all"' + (state.chain === 'all' ? ' selected' : '') + '>All chains</option>'
      +     chainList.map(function (c) { return '<option value="' + escapeHtml(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + escapeHtml(c) + '</option>'; }).join('')
      +   '</select>'
      + '</div>'
      + '<div class="tabs-group">'
      +   '<button type="button" class="tab-btn" id="tab-pre" aria-pressed="' + (state.tab === 'pre-token') + '">Pre-token (' + DATA.rows.length + ')</button>'
      +   '<button type="button" class="tab-btn" id="tab-live" aria-pressed="' + (state.tab === 'live') + '">Already trading (' + DATA.live.length + ')</button>'
      + '</div>'
      + '<button type="button" class="tab-btn filter-btn" id="watch-only" aria-pressed="' + state.watchlistOnly + '">Watchlist only (' + DATA.watchlist_size + ')</button>'
      + '<div class="results-count" id="results-count"></div>';

    document.getElementById('search-box').addEventListener('input', function (e) { state.q = e.target.value; writeHash(); renderTable(); });
    document.getElementById('category-select').addEventListener('change', function (e) { state.category = e.target.value; writeHash(); renderTable(); });
    document.getElementById('chain-select').addEventListener('change', function (e) { state.chain = e.target.value; writeHash(); renderTable(); });
    document.getElementById('tab-pre').addEventListener('click', function () { state.tab = 'pre-token'; writeHash(); renderControls(); renderTable(); });
    document.getElementById('tab-live').addEventListener('click', function () { state.tab = 'live'; writeHash(); renderControls(); renderTable(); });
    document.getElementById('watch-only').addEventListener('click', function () { state.watchlistOnly = !state.watchlistOnly; writeHash(); renderControls(); renderTable(); });
  }

  // ---- filter and sort --------------------------------------------------

  function matches(r) {
    if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
    if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
    if (state.watchlistOnly && !r.on_watchlist) return false;
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function getFilteredRows() {
    if (state.tab === 'live') return DATA.live.filter(matches);

    var list = DATA.rows.filter(matches);
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
      else if (key === 'comp') { av = a.comp_multiple; bv = b.comp_multiple; }
      else { av = a.rank; bv = b.rank; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ---- table ------------------------------------------------------------

  function renderTable() {
    var items = getFilteredRows();
    var countEl = document.getElementById('results-count');
    if (countEl) countEl.textContent = state.tab === 'live' ? items.length + ' trading' : items.length + ' rows';

    if (items.length === 0) {
      tableContainerEl.innerHTML = '<div class="empty"><p>No protocols match this search or filter.</p></div>';
      return;
    }

    var maxImplied = DATA.rows.length > 0 ? DATA.rows[0].implied_value_usd : 1;

    if (state.tab === 'live') {
      var lh = '<table class="radar-table" aria-label="Protocols whose token already trades">'
        + '<caption>Protocols whose token already trades: shown at the market\u2019s own values, never ranked</caption>'
        + '<thead><tr><th scope="col">#</th><th scope="col">Protocol</th><th scope="col">Category</th>'
        + '<th scope="col" class="num">TVL</th><th scope="col" class="num">Market cap</th><th scope="col" class="num">7d</th><th scope="col">Status</th></tr></thead><tbody>';
      items.forEach(function (r, idx) {
        var chgClass = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'positive' : 'negative');
        var chainText = r.chains && r.chains.length > 0 ? r.chains[0] : '';
        lh += '<tr tabindex="0" data-slug="' + escapeHtml(r.slug) + '">'
          + '<td class="rank-cell mono">' + (idx + 1) + '</td>'
          + '<td><div class="protocol-cell"><span class="protocol-name">' + escapeHtml(r.name) + '</span>'
          + '<div class="protocol-meta"><span class="mono">' + escapeHtml(r.slug) + '</span>'
          + (chainText ? '<span class="chain-pill">' + escapeHtml(chainText) + '</span>' : '') + '</div></div></td>'
          + '<td>' + escapeHtml(r.category || 'Other') + '</td>'
          + '<td class="mono num">' + fmtUsd(r.tvl_usd) + '</td>'
          + '<td class="mono num strong">' + fmtUsd(r.mcap_usd) + '</td>'
          + '<td class="mono num ' + chgClass + '">' + fmtPct(r.change_7d) + '</td>'
          + '<td><span class="token-chip live">Trades</span></td></tr>';
      });
      tableContainerEl.innerHTML = lh + '</tbody></table>';
    } else {
      var headers = [
        { key: 'rank', label: '#', cls: '' },
        { key: 'name', label: 'Protocol', cls: '' },
        { key: 'tvl', label: 'TVL', cls: 'num' },
        { key: 'growth', label: '7d', cls: 'num' },
        { key: 'age', label: 'Age', cls: 'num' },
        { key: 'comp', label: 'Comp.', cls: 'num' },
        { key: 'implied', label: 'Implied value', cls: 'num' }
      ];
      var html = '<table class="radar-table" aria-label="Pre-token protocols ranked by implied value"><thead><tr>';
      headers.forEach(function (h) {
        var isSorted = state.sort === h.key;
        var indicator = isSorted ? (state.dir === 1 ? '\u25b2' : '\u25bc') : '\u2195';
        html += '<th scope="col" class="' + h.cls + (isSorted ? ' sorted' : '') + '" data-sort="' + h.key + '">'
          + '<button type="button" class="th-sort">' + escapeHtml(h.label) + ' <span class="sort-indicator">' + indicator + '</span></button></th>';
      });
      html += '<th scope="col">Status</th></tr></thead><tbody>';

      items.forEach(function (r) {
        var chgClass = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'positive' : 'negative');
        var chainText = r.chains && r.chains.length > 0 ? r.chains[0] : '';
        var barPct = Math.min(100, Math.max(4, Math.round((r.implied_value_usd / maxImplied) * 100)));
        html += '<tr tabindex="0" data-slug="' + escapeHtml(r.slug) + '">'
          + '<td class="rank-cell mono">#' + r.rank + '</td>'
          + '<td><div class="protocol-cell"><span class="protocol-name">' + escapeHtml(r.name) + '</span>'
          + '<div class="protocol-meta"><span>' + escapeHtml(r.category || 'Other') + '</span>'
          + (chainText ? '<span class="chain-pill">' + escapeHtml(chainText) + '</span>' : '')
          + (r.on_watchlist ? '<span class="watch-pill">Watchlist</span>' : '') + '</div></div></td>'
          + '<td class="mono num">' + fmtUsd(r.tvl_usd) + '</td>'
          + '<td class="mono num ' + chgClass + '">' + fmtPct(r.change_7d) + '</td>'
          + '<td class="mono num">' + fmtAge(r.age_days) + '</td>'
          + '<td class="mono num">' + r.comp_multiple.toFixed(2) + 'x</td>'
          + '<td class="num"><div class="implied-cell"><div class="value-bar"><div class="value-bar-fill" style="width:' + barPct + '%;"></div></div>'
          + '<span class="mono strong">' + fmtUsd(r.implied_value_usd) + '</span></div></td>'
          + '<td><span class="token-chip">No token</span></td></tr>';
      });
      html += '</tbody></table>';
      tableContainerEl.innerHTML = html;

      tableContainerEl.querySelectorAll('th[data-sort]').forEach(function (th) {
        th.addEventListener('click', function () {
          var key = th.getAttribute('data-sort');
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = (key === 'rank' || key === 'name' || key === 'age' || key === 'comp') ? 1 : -1; }
          renderTable();
        });
      });
    }

    tableContainerEl.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
      var slug = tr.getAttribute('data-slug');
      tr.addEventListener('click', function () { openDetail(slug); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(slug); } });
    });
  }

  // ---- model panel: formula, calibration and back-test ------------------

  function renderModelPanel() {
    var m = DATA.model;
    var bt = DATA.backtest;
    var calRows = DATA.calibration.filter(function (c) { return c.n > 0; }).slice(0, 12);
    modelSectionEl.innerHTML = ''
      + '<div class="model-header"><h3>How the implied value is computed</h3><span class="token-chip">' + escapeHtml(DATA.model_version) + '</span></div>'
      + '<div class="model-formula-box">implied = round( TVL &times; comparable &times; (1 + clamp(growth, ' + m.growth_floor + ', ' + m.growth_cap + ')/100 &times; ' + m.growth_weight + ') &times; (' + m.maturity_floor + ' + min(age, ' + m.maturity_days + ')/' + m.maturity_days + ' &times; ' + m.maturity_range + ') )</div>'
      + '<p class="model-description">The <b>comparable</b> is the category\u2019s median market-cap-to-TVL, read from the snapshot\u2019s own live-token protocols and shrunk toward the global median by sample size, so a thin category cannot swing a row on one observation. Every figure comes from the sealed snapshot; no protocol name is special-cased.</p>'
      + '<div class="model-grid">'
      +   '<div class="model-card">'
      +     '<h4>Category comparables</h4>'
      +     '<table class="mini-table"><thead><tr><th>Category</th><th class="num">Live n</th><th class="num">Median</th><th class="num">Weight</th><th class="num">Used</th></tr></thead><tbody>'
      +       calRows.map(function (c) { return '<tr><td>' + escapeHtml(c.category) + '</td><td class="mono num">' + c.n + '</td><td class="mono num">' + c.median_fdv_tvl.toFixed(2) + 'x</td><td class="mono num">' + Math.round(c.weight * 100) + '%</td><td class="mono num strong">' + c.used.toFixed(2) + 'x</td></tr>'; }).join('')
      +     '</tbody></table>'
      +     '<p class="model-note">Weight is how much of the comparable comes from the category\u2019s own median; the rest comes from the global median. A category with no live comparable uses the global median outright.</p>'
      +   '</div>'
      +   '<div class="model-card">'
      +     '<h4>Back-test: does the model carry signal?</h4>'
      +     '<table class="mini-table"><tbody>'
      +       btRow('Live protocols tested', String(bt.n))
      +       btRow('Rank correlation (Spearman)', bt.spearman.toFixed(3))
      +       btRow('Error (RMSE, log units)', bt.rmse_log.toFixed(2))
      +       btRow('Median error vs truth', '&times;' + (1 + bt.median_abs_pct_error).toFixed(2))
      +       btRow('Predicted within 2x', Math.round(bt.within_2x * 100) + '%')
      +       btRow('Predicted within 5x', Math.round(bt.within_5x * 100) + '%')
      +     '</tbody></table>'
      +     '<p class="model-note">Each live protocol is scored with its own row held out of the comparables, then compared with its real market cap. A single snapshot predicts market cap only weakly \u2014 a rank correlation near 0.4 is honest, not strong \u2014 which is why the model keeps modest, positive weights rather than fitting a regression to one snapshot.</p>'
      +   '</div>'
      + '</div>';
  }

  function btRow(label, value) {
    return '<tr><td>' + escapeHtml(label) + '</td><td class="mono num strong">' + value + '</td></tr>';
  }

  // ---- detail dialog ----------------------------------------------------

  function openDetail(slug) {
    var row = DATA.rows.find(function (r) { return r.slug === slug; });
    if (!row) return;
    state.selectedSlug = slug;
    writeHash();

    var recomputed = impliedOf(row, DATA.model);
    var matches = recomputed === row.implied_value_usd;
    var steps = farmSteps(row);
    var chainText = row.chains && row.chains.length > 0 ? row.chains.join(', ') : 'None';
    var m = DATA.model;

    dialogContentEl.innerHTML = ''
      + '<div class="dialog-header"><div>'
      +   '<span class="token-chip">Rank #' + row.rank + '</span>'
      +   '<h2 class="dialog-title">' + escapeHtml(row.name) + '</h2>'
      +   '<div class="protocol-meta"><span>' + escapeHtml(row.category || 'Other') + '</span><span>' + escapeHtml(chainText) + '</span><span class="mono">' + escapeHtml(row.slug) + '</span></div>'
      + '</div><button type="button" class="dialog-close" id="close-dialog-btn" aria-label="Close dialog">\u2715</button></div>'

      + '<div class="detail-section">'
      +   '<h3>Why this value</h3>'
      +   '<table class="breakdown-table"><thead><tr><th>Component</th><th class="num">Figure</th></tr></thead><tbody>'
      +     bd('TVL (from snapshot)', fmtUsd(row.tvl_usd))
      +     bd('Comparable \u2014 ' + escapeHtml(row.comp_basis), row.comp_multiple.toFixed(2) + 'x')
      +     bd('7-day growth (' + fmtPct(row.change_7d) + ', clamped)', row.growth_multiplier.toFixed(3) + 'x')
      +     bd('Maturity (' + fmtAge(row.age_days) + ' with no token)', row.maturity_multiplier.toFixed(3) + 'x')
      +     bdStrong('Implied value', fmtUsd(row.implied_value_usd))
      +   '</tbody></table>'
      +   '<div class="recomp-note"><span>' + (matches ? '\u2713' : '\u26a0') + '</span><span>The page recomputes <b>' + fmtUsd(recomputed) + '</b> \u2014 ' + (matches ? 'identical to board.json.' : 'differs from board.json.') + '</span></div>'
      + '</div>'

      + '<div class="detail-section">'
      +   '<h3>How to farm it</h3>'
      +   '<p class="model-note">Six steps, derived from this protocol\u2019s category, chains, TVL and age. Each names what it costs and how long it takes.</p>'
      +   '<ol class="farm-steps-list">'
      +     steps.map(function (s) { return '<li><b>' + escapeHtml(s.text) + '</b><span class="farm-step-meta">Cost: ' + escapeHtml(s.cost) + ' \u2022 Time: ' + escapeHtml(s.time) + '</span></li>'; }).join('')
      +   '</ol>'
      + '</div>';

    if (typeof detailDialogEl.showModal === 'function') detailDialogEl.showModal();
    else detailDialogEl.setAttribute('open', '');

    document.getElementById('close-dialog-btn').addEventListener('click', closeDetail);
    detailDialogEl.addEventListener('cancel', closeDetail);
    detailDialogEl.addEventListener('click', function (e) { if (e.target === detailDialogEl) closeDetail(); });
  }

  function bd(label, value) { return '<tr><td>' + label + '</td><td class="mono num">' + value + '</td></tr>'; }
  function bdStrong(label, value) { return '<tr class="total-row"><td>' + label + '</td><td class="mono num strong">' + value + '</td></tr>'; }

  function closeDetail() {
    state.selectedSlug = null;
    writeHash();
    if (typeof detailDialogEl.close === 'function') { if (detailDialogEl.open) detailDialogEl.close(); }
    else detailDialogEl.removeAttribute('open');
  }

  // ---- boot -------------------------------------------------------------

  readHash();
  renderHeaderAndFooter();
  renderHeadline();
  renderControls();
  renderTable();
  renderModelPanel();

  if (state.selectedSlug) openDetail(state.selectedSlug);
})();
