// Token Radar Single-Page Dashboard
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var state = {
    q: '',
    category: 'all',
    tab: 'pre-token', // 'pre-token' or 'live'
    sort: 'rank',     // 'rank', 'name', 'tvl', 'growth', 'age', 'implied'
    dir: 1,           // 1 for asc, -1 for desc
    selectedSlug: null
  };

  // Formatters
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }

  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // Model recomputation in page
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturityMult = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var base = row.tvl_usd * row.comp_multiple;
    return Math.max(1, Math.round(base * growthMult * maturityMult));
  }

  // Farm plan derivation (same as main.ts)
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
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ];
  }

  // DOM elements
  var headerMetaEl = document.getElementById('header-meta');
  var headlineBlockEl = document.getElementById('headline-block');
  var controlsBarEl = document.getElementById('controls-bar');
  var tableContainerEl = document.getElementById('table-container');
  var modelSectionEl = document.getElementById('model-section');
  var footerVersionEl = document.getElementById('footer-version');
  var detailDialogEl = document.getElementById('detail-dialog');
  var dialogContentEl = document.getElementById('dialog-content');

  // URL Hash state handling
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selectedSlug = params.get('p');
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selectedSlug) params.set('p', state.selectedSlug);
    var str = params.toString();
    if (str) window.history.replaceState(null, '', '#' + str);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // Render Header Meta & Footer
  function renderHeaderAndFooter() {
    headerMetaEl.innerHTML = `
      <span>Snapshot: ${DATA.as_of}</span>
      <span>Source: ${DATA.source}</span>
      <span>Model: ${DATA.model_version}</span>
    `;
    footerVersionEl.textContent = DATA.model_version;
  }

  // Render Headline Block (View 2)
  function renderHeadline() {
    var floorM = Math.round(DATA.floor_usd / 1e6);
    headlineBlockEl.innerHTML = `
      <div class="headline-content">
        <h2>${DATA.watchlist_size} watchlist protocols, ranked by implied value</h2>
        <p>The watchlist is the floor: every protocol with at least $${floorM}M of TVL and no token on record. The early radar adds ${DATA.early_size} pre-token protocols below that floor. Implied value is a model, not a promise.</p>
      </div>
      <div class="facts-grid">
        <div class="fact-item">
          <span class="fact-label">Watchlist covered</span>
          <span class="fact-value">${DATA.watchlist_size} / ${DATA.watchlist_size}</span>
        </div>
        <div class="fact-item">
          <span class="fact-label">Pre-token rows scored</span>
          <span class="fact-value">${DATA.board_size}</span>
        </div>
        <div class="fact-item">
          <span class="fact-label">Early rows below floor</span>
          <span class="fact-value">${DATA.early_size}</span>
        </div>
        <div class="fact-item">
          <span class="fact-label">Live tokens set aside</span>
          <span class="fact-value">${DATA.live_size}</span>
        </div>
      </div>
    `;
  }

  // Render Controls Bar (View 3)
  function renderControls() {
    var categories = Array.from(new Set(DATA.rows.map(function(r) { return r.category || 'Other'; }))).sort();
    
    controlsBarEl.innerHTML = `
      <div class="search-group">
        <input type="search" class="search-input" id="search-box" placeholder="Search name, slug, category, chain..." value="${escapeHtml(state.q)}" aria-label="Search protocols">
      </div>
      <div class="select-group">
        <select class="select-input" id="category-select" aria-label="Filter by category">
          <option value="all" ${state.category === 'all' ? 'selected' : ''}>All categories</option>
          ${categories.map(function(c) {
            return `<option value="${escapeHtml(c)}" ${state.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`;
          }).join('')}
        </select>
      </div>
      <div class="tabs-group">
        <button type="button" class="tab-btn" id="tab-pre" aria-pressed="${state.tab === 'pre-token'}">Pre-token</button>
        <button type="button" class="tab-btn" id="tab-live" aria-pressed="${state.tab === 'live'}">Live token</button>
      </div>
      <div class="results-count" id="results-count"></div>
    `;

    // Event listeners
    document.getElementById('search-box').addEventListener('input', function(e) {
      state.q = e.target.value;
      writeHash();
      renderTable();
    });

    document.getElementById('category-select').addEventListener('change', function(e) {
      state.category = e.target.value;
      writeHash();
      renderTable();
    });

    document.getElementById('tab-pre').addEventListener('click', function() {
      state.tab = 'pre-token';
      writeHash();
      renderControls();
      renderTable();
    });

    document.getElementById('tab-live').addEventListener('click', function() {
      state.tab = 'live';
      writeHash();
      renderControls();
      renderTable();
    });
  }

  // Filter and Sort Data
  function getFilteredRows() {
    if (state.tab === 'live') {
      var q = state.q.trim().toLowerCase();
      return DATA.live.filter(function(r) {
        if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
        if (!q) return true;
        var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    } else {
      var q = state.q.trim().toLowerCase();
      var list = DATA.rows.filter(function(r) {
        if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
        if (!q) return true;
        var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
        return hay.indexOf(q) >= 0;
      });

      var key = state.sort;
      var dir = state.dir;
      return list.slice().sort(function(a, b) {
        var av, bv;
        if (key === 'rank') { av = a.rank; bv = b.rank; }
        else if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
        else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
        else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
        else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
        else if (key === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
        else { av = a.rank; bv = b.rank; }

        if (av < bv) return -dir;
        if (av > bv) return dir;
        return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
      });
    }
  }

  // Render Table (View 4 & View 7)
  function renderTable() {
    var items = getFilteredRows();
    var countEl = document.getElementById('results-count');
    if (countEl) {
      countEl.textContent = state.tab === 'live' ? items.length + ' live protocols' : items.length + ' rows shown';
    }

    if (items.length === 0) {
      tableContainerEl.innerHTML = `
        <div class="empty">
          <p>No protocols match your search or filter.</p>
        </div>
      `;
      return;
    }

    var maxImplied = DATA.rows.length > 0 ? DATA.rows[0].implied_value_usd : 1;

    if (state.tab === 'live') {
      var html = `
        <table class="radar-table" aria-label="Live token protocols">
          <caption>Market-priced protocols set aside from ranking</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Protocol</th>
              <th scope="col">Category</th>
              <th scope="col" style="text-align:right;">TVL</th>
              <th scope="col" style="text-align:right;">Market Cap</th>
              <th scope="col" style="text-align:right;">7d Change</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
      `;
      items.forEach(function(r, idx) {
        var chg = r.change_7d;
        var chgClass = chg === null ? '' : (chg >= 0 ? 'positive' : 'negative');
        var chgText = fmtPct(chg);
        var chainText = r.chains && r.chains.length > 0 ? r.chains[0] : '';

        html += `
          <tr tabindex="0" data-slug="${escapeHtml(r.slug)}">
            <td class="rank-cell mono">${idx + 1}</td>
            <td>
              <div class="protocol-cell">
                <span class="protocol-name">${escapeHtml(r.name)}</span>
                <div class="protocol-meta">
                  <span class="mono">${escapeHtml(r.slug)}</span>
                  ${chainText ? `<span class="chain-pill">${escapeHtml(chainText)}</span>` : ''}
                </div>
              </div>
            </td>
            <td>${escapeHtml(r.category || 'Other')}</td>
            <td class="mono" style="text-align:right;">${fmtUsd(r.tvl_usd)}</td>
            <td class="mono" style="text-align:right; font-weight:600;">${fmtUsd(r.mcap_usd)}</td>
            <td class="mono ${chgClass}" style="text-align:right;">${chgText}</td>
            <td><span class="token-chip live">Already trades</span></td>
          </tr>
        `;
      });
      html += `</tbody></table>`;
      tableContainerEl.innerHTML = html;
    } else {
      var headers = [
        { key: 'rank', label: '#' },
        { key: 'name', label: 'Protocol' },
        { key: 'tvl', label: 'TVL' },
        { key: 'growth', label: '7d Change' },
        { key: 'age', label: 'Age (No Token)' },
        { key: 'implied', label: 'Implied Value' }
      ];

      var html = `
        <table class="radar-table" aria-label="Pre-token protocols ranked by implied value">
          <thead>
            <tr>
      `;
      headers.forEach(function(h) {
        var isSorted = state.sort === h.key;
        var indicator = isSorted ? (state.dir === 1 ? '▲' : '▼') : '↕';
        html += `<th scope="col" class="${isSorted ? 'sorted' : ''}" data-sort="${h.key}">
          <button type="button" style="background:none;border:0;color:inherit;font:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:4px;">
            ${h.label} <span class="sort-indicator">${indicator}</span>
          </button>
        </th>`;
      });
      html += `<th scope="col">Status</th></tr></thead><tbody>`;

      items.forEach(function(r) {
        var chg = r.change_7d;
        var chgClass = chg === null ? '' : (chg >= 0 ? 'positive' : 'negative');
        var chgText = fmtPct(chg);
        var chainText = r.chains && r.chains.length > 0 ? r.chains[0] : '';
        var barPct = Math.min(100, Math.max(4, Math.round((r.implied_value_usd / maxImplied) * 100)));

        html += `
          <tr tabindex="0" data-slug="${escapeHtml(r.slug)}">
            <td class="rank-cell mono">#${r.rank}</td>
            <td>
              <div class="protocol-cell">
                <span class="protocol-name">${escapeHtml(r.name)}</span>
                <div class="protocol-meta">
                  <span>${escapeHtml(r.category || 'Other')}</span>
                  ${chainText ? `<span class="chain-pill">${escapeHtml(chainText)}</span>` : ''}
                </div>
              </div>
            </td>
            <td class="mono">${fmtUsd(r.tvl_usd)}</td>
            <td class="mono ${chgClass}">${chgText}</td>
            <td class="mono">${fmtAge(r.age_days)}</td>
            <td>
              <div class="implied-cell">
                <div class="value-bar" title="${r.implied_value_usd} USD"><div class="value-bar-fill" style="width: ${barPct}%;"></div></div>
                <span class="mono" style="font-weight:600;">${fmtUsd(r.implied_value_usd)}</span>
              </div>
            </td>
            <td><span class="token-chip">No token</span></td>
          </tr>
        `;
      });
      html += `</tbody></table>`;
      tableContainerEl.innerHTML = html;

      // Attach sort listeners
      var thEls = tableContainerEl.querySelectorAll('th[data-sort]');
      thEls.forEach(function(th) {
        th.addEventListener('click', function() {
          var key = th.getAttribute('data-sort');
          if (state.sort === key) {
            state.dir = -state.dir;
          } else {
            state.sort = key;
            state.dir = (key === 'rank' || key === 'name' || key === 'age') ? 1 : -1;
          }
          renderTable();
        });
      });
    }

    // Attach row click and keyboard listeners
    var trEls = tableContainerEl.querySelectorAll('tbody tr[data-slug]');
    trEls.forEach(function(tr) {
      var slug = tr.getAttribute('data-slug');
      tr.addEventListener('click', function() {
        openDetail(slug);
      });
      tr.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDetail(slug);
        }
      });
    });
  }

  // Render Model Explanation Panel (View 6)
  function renderModelPanel() {
    var m = DATA.model;
    modelSectionEl.innerHTML = `
      <div class="model-header">
        <h3>Model Formula & Methodology</h3>
        <span class="token-chip">Version ${escapeHtml(DATA.model_version)}</span>
      </div>
      <div class="model-formula-box">
        implied = round( TVL × comparable_multiple × (1 + clamp(growth, ${m.growth_floor}, ${m.growth_cap}) / 100 × ${m.growth_weight}) × (${m.maturity_floor} + min(age, ${m.maturity_days}) / ${m.maturity_days} × ${m.maturity_range}) )
      </div>
      <p class="model-description">
        The comparable multiple is the median market-cap-to-TVL of the snapshot's own live-token protocols in the same category (falling back to the global median), read per row from comp_basis. Implied value follows strictly from snapshot figures without hand-written special cases.
      </p>
    `;
  }

  // Open Detail View (View 5)
  function openDetail(slug) {
    var row = DATA.rows.find(function(r) { return r.slug === slug; });
    if (!row) return;

    state.selectedSlug = slug;
    writeHash();

    var recomputed = impliedOf(row, DATA.model);
    var matches = recomputed === row.implied_value_usd;
    var steps = farmSteps(row);
    var chainText = row.chains && row.chains.length > 0 ? row.chains.join(', ') : 'None';

    dialogContentEl.innerHTML = `
      <div class="dialog-header">
        <div>
          <span class="token-chip">Rank #${row.rank}</span>
          <h2 style="margin-top:0.4rem;">${escapeHtml(row.name)}</h2>
          <div class="protocol-meta" style="margin-top:0.3rem;">
            <span>${escapeHtml(row.category || 'Other')}</span> • <span>Chains: ${escapeHtml(chainText)}</span> • <span class="mono">${escapeHtml(row.slug)}</span>
          </div>
        </div>
        <button type="button" class="dialog-close" id="close-dialog-btn" aria-label="Close dialog">✕</button>
      </div>

      <div class="detail-section" style="margin-top:0; padding-top:0; border-top:none;">
        <h3 style="margin-bottom:0.75rem;">Model Breakdown</h3>
        <table class="breakdown-table">
          <thead>
            <tr>
              <th>Component</th>
              <th style="text-align:right;">Figure / Multiplier</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>TVL (USD)</td>
              <td class="mono" style="text-align:right;">${fmtUsd(row.tvl_usd)}</td>
            </tr>
            <tr>
              <td>Comparable Basis (${escapeHtml(row.comp_basis)})</td>
              <td class="mono" style="text-align:right;">${row.comp_multiple.toFixed(4)}x FDV/TVL</td>
            </tr>
            <tr>
              <td>7d Growth (${row.change_7d !== null ? row.change_7d.toFixed(1) + '%' : 'n/a'})</td>
              <td class="mono" style="text-align:right;">${row.growth_multiplier.toFixed(4)}x</td>
            </tr>
            <tr>
              <td>Maturity Age (${fmtAge(row.age_days)})</td>
              <td class="mono" style="text-align:right;">${row.maturity_multiplier.toFixed(4)}x</td>
            </tr>
            <tr style="font-weight:600; background: var(--bg-app);">
              <td>Implied Value (USD)</td>
              <td class="mono" style="text-align:right; color: var(--accent-text);">${fmtUsd(row.implied_value_usd)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="recomp-note">
        <span>✓</span>
        <span>Page recomputed implied value is <strong>${fmtUsd(recomputed)}</strong> — ${matches ? 'matches board.json exactly.' : 'differs from board.json.'}</span>
      </div>

      <div class="detail-section">
        <h3>Protocol Farm Plan</h3>
        <p style="color:var(--text-muted); font-size:0.85rem; margin-bottom:1rem;">Derived from category, chains, TVL and age figures.</p>
        <ol class="farm-steps-list">
          ${steps.map(function(step) {
            var fullText = stepText(step);
            // split action, cost, time
            return `
              <li>
                <b>${escapeHtml(step.text)}</b>
                <span class="farm-step-meta">Cost: ${escapeHtml(step.cost)} • Time: ${escapeHtml(step.time)}</span>
              </li>
            `;
          }).join('')}
        </ol>
      </div>
    `;

    if (typeof detailDialogEl.showModal === 'function') {
      detailDialogEl.showModal();
    } else {
      detailDialogEl.setAttribute('open', '');
    }

    document.getElementById('close-dialog-btn').addEventListener('click', closeDetail);
    detailDialogEl.addEventListener('cancel', closeDetail);
    detailDialogEl.addEventListener('click', function(e) {
      if (e.target === detailDialogEl) closeDetail();
    });
  }

  function closeDetail() {
    state.selectedSlug = null;
    writeHash();
    if (typeof detailDialogEl.close === 'function') {
      if (detailDialogEl.open) detailDialogEl.close();
    } else {
      detailDialogEl.removeAttribute('open');
    }
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // Initialize
  readHash();
  renderHeaderAndFooter();
  renderHeadline();
  renderControls();
  renderTable();
  renderModelPanel();

  // If a slug was specified in hash, open it
  if (state.selectedSlug) {
    openDetail(state.selectedSlug);
  }

})();
