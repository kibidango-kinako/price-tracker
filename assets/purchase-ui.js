/* Shared UI for the two PSA10 dashboards. Uses each page's existing chart and data. */
const PurchaseUI = (() => {
  let settings = {...Purchase.defaults};
  const costs = new Map();
  let selected = null;
  let sparkDB = null, sparkMap = new Map(), chartProduct = null;
  const money = n => n == null || !Number.isFinite(n) ? '—' : '¥' + Math.floor(n).toLocaleString('ja-JP');
  const signed = n => n == null ? '—' : (n < 0 ? '−' : '+') + money(Math.abs(Math.floor(n)));
  const pct = n => n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  const safeURL = value => { try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'snkrdunk.com' ? u.href : '#'; } catch { return '#'; } };
  const title = r => [r.card_name, r.rarity, r.collection_no ? '[' + r.collection_no + ']' : ''].filter(Boolean).join(' ');
  const badge = a => `<span class="purchase-badge ${a.eligible ? 'good' : a.label === 'データ不足' ? 'warn' : ''}">${a.label}</span>`;
  const input = (key, label, min, max, step=1) => `<label>${label}<input name="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${settings[key]}" required></label>`;
  function init() {
    try {
      const saved = JSON.parse(localStorage.getItem('price-tracker.purchase.v1'));
      if (saved && valid(saved)) settings = {...settings, ...saved};
    } catch {}
    document.querySelector('.badge-live').textContent = '成約データ';
    const main = document.getElementById('mainView');
    main.insertAdjacentHTML('afterbegin', `
      <section class="purchase-intro"><div><span class="purchase-eyebrow">MARKET / PSA10</span><h2>仕入のチャンスを探す。</h2><p>商品を選び、仕入価格から利益をチェック。</p></div><div class="intro-actions"><button class="purchase-secondary" id="openMarketChart">価格グラフ</button><button class="purchase-secondary" id="openSettings">仕入条件を設定 <span aria-hidden="true">↗</span></button></div></section>
      <div class="purchase-summary" id="purchaseSummary"></div>
      <dialog class="purchase-settings" id="purchaseSettings" aria-labelledby="settingsTitle"><div class="drawer-heading"><div><span class="purchase-eyebrow">PREFERENCES</span><h2 id="settingsTitle">仕入条件</h2></div><button class="purchase-secondary" id="closeSettings" aria-label="仕入条件を閉じる">閉じる</button></div>
        <form id="purchaseSettingsForm">
        <fieldset><legend>01 / 利益目標</legend><div class="purchase-grid">
        ${input('targetProfit','最低利益額（円）',0,100000000)}${input('targetRoi','最低利益率（％・仕入総額基準）',0,1000,0.1)}${input('budget','1商品あたり予算（円・0は制限なし）',0,100000000)}</div></fieldset>
        <fieldset><legend>02 / 販売費用</legend><div class="purchase-grid"><label>販売先（費用の初期値）<select name="venue"><option value="snkr">SNKRDUNK</option><option value="mercari">メルカリ</option><option value="custom">その他・任意設定</option></select></label>
        ${input('fee','販売手数料（％）',0,99.9,0.1)}${input('shipping','販売時の送料（円）',0,1000000)}</div>
        <details class="advanced-settings"><summary>梱包費・仕入時費用も設定する</summary><div class="purchase-grid">${input('extra','梱包・その他販売費（円）',0,1000000)}${input('buyFees','仕入時の送料・手数料（円）',0,1000000)}</div></details></fieldset>
        <fieldset><legend>03 / 候補に含める条件</legend><div class="purchase-grid">${input('minTrades','直近7日の最低取得件数',1,100000)}${input('maxAge','最終取引からの上限日数',1,30)}</div></fieldset>
        <p id="settingsError" class="purchase-error" role="status"></p><div class="settings-actions"><button class="purchase-action" type="submit">保存して適用</button><button class="purchase-secondary" type="button" id="purchaseReset">初期値に戻す</button></div></form>
        <p class="purchase-note">費用は試算用の初期値です。ご自身の販売条件に合わせて変更してください。仕入上限は最低利益額・率の両方を満たす商品代金です。設定のみこのブラウザに保存します。</p>
      </dialog>
      <dialog class="purchase-detail" id="purchaseDetail" aria-label="仕入利益の計算"></dialog>
      <details class="purchase-data-disclosure"><summary id="purchaseDataSummary">データについて</summary><p class="purchase-data-info" id="purchaseDataInfo"></p></details>`);
    const chart = document.getElementById('chartPanel');
    const chartDialog = document.createElement('dialog');
    chartDialog.id = 'marketChartDialog'; chartDialog.className = 'market-chart-dialog';
    chartDialog.setAttribute('aria-label','カードの価格グラフ');
    chartDialog.innerHTML = '<div class="drawer-heading"><h2>価格グラフ</h2><button class="purchase-secondary" id="closeMarketChart">グラフを閉じる</button></div>';
    chartDialog.append(chart); main.append(chartDialog);
    document.getElementById('rangeChips').after(document.getElementById('signalRow'), chart.querySelector('.chart-wrap'), document.getElementById('chartLegend'));
    document.getElementById('openMarketChart').onclick = () => showChart(document.getElementById('cardSelect').value);
    document.getElementById('closeMarketChart').onclick = () => chartDialog.close();
    chartDialog.addEventListener('click', e => { if(e.target===chartDialog && outside(e,chartDialog)) chartDialog.close(); });
    chartDialog.addEventListener('close', () => {
      const trigger = [...document.querySelectorAll('[data-graph-id]')].find(el=>el.dataset.graphId===chartProduct);
      (trigger || document.getElementById('openMarketChart')).focus({preventScroll:true});
    });
    main.append(document.querySelector('.purchase-data-disclosure'));
    const settingsDialog = document.getElementById('purchaseSettings');
    document.getElementById('openSettings').onclick = () => settingsDialog.showModal();
    document.getElementById('closeSettings').onclick = () => settingsDialog.close();
    settingsDialog.addEventListener('click', e => { if(e.target === settingsDialog && outside(e, settingsDialog)) settingsDialog.close(); });
    const detailDialog = document.getElementById('purchaseDetail');
    detailDialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    detailDialog.addEventListener('click', e => { if(e.target === detailDialog && outside(e, detailDialog)) close(); });
    document.addEventListener('keydown', e => { if(e.key === 'Escape' && detailDialog.open && !settingsDialog.open) { e.preventDefault(); close(); } });
    const breakpoint = matchMedia('(max-width: 767px)');
    breakpoint.addEventListener('change', () => { if(detailDialog.open) { detailDialog.close(); breakpoint.matches ? detailDialog.showModal() : detailDialog.show(); } });
    const form = document.getElementById('purchaseSettingsForm');
    form.elements.venue.value = settings.venue;
    form.elements.venue.addEventListener('change', e => {
      if (e.target.value === 'custom') return;
      form.elements.fee.value = e.target.value === 'snkr' ? 9.3 : 10;
      form.elements.shipping.value = e.target.value === 'snkr' ? 240 : 160;
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const value = Object.fromEntries(new FormData(form));
      Object.keys(Purchase.defaults).forEach(k => { if (k !== 'venue') value[k] = Number(value[k]); });
      if (!valid(value)) { document.getElementById('settingsError').textContent = '設定の入力値を確認してください。'; return; }
      settings = value;
      let message = '条件を適用しました。';
      try { localStorage.setItem('price-tracker.purchase.v1', JSON.stringify(settings)); } catch { message += ' ブラウザへの保存はできませんでした。'; }
      document.getElementById('settingsError').textContent = message;
      settingsDialog.close();
      refresh(); if (selected) open(selected, false);
    });
    document.getElementById('purchaseReset').addEventListener('click', () => {
      settings = {...Purchase.defaults};
      Object.keys(settings).forEach(k => { form.elements[k].value = settings[k]; });
      form.requestSubmit();
    });
    const chip = document.getElementById('profitChip');
    chip.textContent = '参考候補'; chip.title = '入力済み仕入価格、未入力なら過去7日安値で、設定した利益・件数・鮮度・予算と中立以上のトレンドを満たす商品';
    document.getElementById('tableSearch').setAttribute('aria-label','カード名・型番・収録弾を検索');
    document.getElementById('tableSearch').placeholder = 'カード名・型番・収録弾で検索';
    document.getElementById('chartSearchInput').setAttribute('aria-label','チャートの商品検索');
    document.getElementById('setFilter').setAttribute('aria-label','キャラクターで絞り込み');
    document.getElementById('cardSelect').setAttribute('aria-label','チャートの商品');
    document.getElementById('mobileSortSelect').setAttribute('aria-label','一覧の並び順');
    document.getElementById('mobileSortSelect').innerHTML = '<option value="roi7">利益率</option><option value="profitAmount">利益額</option><option value="purchaseLimit">仕入上限</option><option value="med7">7日中央値</option><option value="mn7">7日安値</option><option value="mx7">7日高値</option><option value="cnt7">7日取引件数</option><option value="trendScore">相場トレンド</option><option value="dod">当日／前日平均比</option><option value="wow">週比</option><option value="lastTradeAt">最終取引日時</option><option value="rank">ランク</option><option value="card_name">カード名</option>';
    const table = document.getElementById('tableBody').closest('table');
    table.classList.add('purchase-table');
    const heading = (key,label) => `<th data-sort-key="${key}" aria-sort="none"><button data-sort="${key}">${label} <span aria-hidden="true" class="sort-arrow">↕</span></button></th>`;
    table.querySelector('thead').innerHTML = `<tr>${heading('card_name','商品 / 詳細')}${heading('purchaseLimit','仕入上限')}${heading('profitAmount','利益額 / 利益率')}${heading('med7','7日中央値')}<th>30日価格推移</th>${heading('cnt7','7日取得件数')}<th>仕入判断 / 信頼度</th>${heading('trendScore','相場トレンド')}</tr>`;
    table.addEventListener('click', e => {
      const sort = e.target.closest('[data-sort]'); if(sort) { setSort(sort.dataset.sort); return; }
      const graph = e.target.closest('[data-graph-id]'); if(graph) { showChart(graph.dataset.graphId); return; }
      const b = e.target.closest('[data-purchase-id]'); if(b) open(b.dataset.purchaseId);
    });
    const bar = document.getElementById('mobileSortBar');
    bar.querySelector('label').textContent='並び替え';
    bar.querySelector('label').htmlFor='mobileSortSelect';
    bar.insertAdjacentHTML('beforeend','<span class="sort-hint">PCは表の見出しからも変更できます</span>');
    document.getElementById('emptyState').textContent = '該当商品がありません。検索・レアリティ・参考候補の条件を変更してください。';
  }
  function valid(s) {
    return ['snkr','mercari','custom'].includes(s.venue) && Object.entries(Purchase.defaults).every(([k]) => k === 'venue' || (typeof s[k] === 'number' && Number.isFinite(s[k]) && s[k] >= 0)) && s.fee < 100 && s.targetRoi <= 1000 && s.minTrades >= 1 && Number.isInteger(s.minTrades) && s.maxAge >= 1 && s.maxAge <= 30;
  }
  function assessment(r) { return Purchase.assess(r, settings, costs.get(String(r.apparel_id))); }
  function enrich() {
    if (sparkDB !== db) {
      const tableName = typeof TABLE !== 'undefined' ? TABLE : 'ranking_transactions';
      sparkMap = new Map();
      q(`SELECT apparel_id, DATE(transaction_date) day, AVG(price) price FROM ${tableName}
        WHERE grade='PSA10' AND price>0 AND julianday(transaction_date) >= julianday(?, '-720 hours')
        AND julianday(transaction_date) <= julianday(?) GROUP BY apparel_id,DATE(transaction_date) ORDER BY day`, [aggregationNow, aggregationNow]).forEach(r=>{
          const id=String(r.apparel_id); if(!sparkMap.has(id)) sparkMap.set(id,[]); sparkMap.get(id).push(r);
        });
      sparkDB = db;
    }
    const identities = new Map();
    tableData.forEach(r => {
      const key = [r.card_name, r.rarity, r.collection_no, r.set_name].join('|');
      const ids = identities.get(key) || new Set(); ids.add(String(r.apparel_id)); identities.set(key, ids);
    });
    tableData.forEach(r => { r.identityUncertain = identities.get([r.card_name,r.rarity,r.collection_no,r.set_name].join('|')).size > 1; const a = assessment(r); r.roi7 = a.hasCost ? a.roi : a.reference.roi; r.purchaseLimit = a.limit; r.profitAmount = a.hasCost ? a.profit : a.reference.profit; r.lastTradeAt = Number.isFinite(Purchase.timestamp(r.last_tx)) ? Purchase.timestamp(r.last_tx) : null; });
  }
  function refresh() { enrich(); renderTableBody(); }
  function summary() {
    const candidates = tableData.filter(r => assessment(r).eligible).length;
    const insufficient = tableData.filter(r => assessment(r).label === 'データ不足').length;
    document.getElementById('purchaseSummary').innerHTML = `<span>掲載商品 <strong>${tableData.length}</strong></span><span>参考候補 <strong>${candidates}</strong></span><span>データ不足 <strong>${insufficient}</strong></span><span class="summary-target">目標 <strong>${money(settings.targetProfit)} / ${settings.targetRoi}％</strong></span>`;
    const tableName = typeof TABLE !== 'undefined' ? TABLE : 'ranking_transactions';
    const dates = q(`SELECT MAX(collected_date) collected, MAX(transaction_date) traded FROM ${tableName}`)[0];
    document.getElementById('purchaseDataInfo').textContent = `データ収集日：${dates?.collected || '不明'} ／ 最新成約：${dates?.traded || '不明'}（日本時間）。集計基準：${aggregationNow}。7日集計は閲覧時点を基準。取得できた成約のみを集計し、市場全体の件数・売れるまでの日数は示しません。`;
    document.getElementById('purchaseDataSummary').textContent = `データ収集 ${dates?.collected || '不明'} · 集計条件を見る`;
    document.getElementById('profitChip').setAttribute('aria-pressed', String(filterProfit));
  }
  function product(r) {
    const img = typeof cardImages !== 'undefined' ? cardImages[String(r.apparel_id)] : null;
    const src = img?.img && (/^https:\/\//.test(img.img) || /^data\/thumbs\/[\w.-]+$/.test(img.img)) ? img.img : null;
    return `<div class="purchase-product">${src ? `<img class="purchase-thumb" src="${esc(src)}" alt="" loading="lazy">` : '<span class="purchase-thumb-placeholder" aria-hidden="true">PSA<strong>10</strong></span>'}<div><button class="purchase-title-button" data-purchase-id="${esc(r.apparel_id)}">${esc(title(r))}</button><div class="purchase-small">${esc(r.set_name || '')}${r.identityUncertain ? '<br>同名・同型番あり：仕様確認が必要' : ''}</div><div class="card-actions"><button class="purchase-secondary" data-purchase-id="${esc(r.apparel_id)}">利益を計算</button><button class="purchase-secondary" data-graph-id="${esc(r.apparel_id)}">グラフ</button><a class="card-market-link" href="${esc(safeURL(r.url))}" target="_blank" rel="noopener noreferrer" aria-label="${esc(title(r))}をスニダンで見る（新しいタブ）">スニダン ↗</a></div></div></div>`;
  }
  function rows(sorted, mobile) {
    return sorted.map(r => {
      const a = assessment(r), ref = a.hasCost ? a : a.reference;
      const basis = a.hasCost ? '入力した価格で計算' : '過去安値で買った場合';
      const trend = a.label === 'データ不足' ? '判定保留' : TREND_LABEL_MAP[r.trend.cls] || 'データ不足';
      const confidence = `信頼度 ${a.confidence}（件数・鮮度）`;
      const last = r.last_tx || '不明';
      const value = `<div class="purchase-value">${a.limit === 0 ? '条件を満たす価格なし' : money(a.limit)}</div><div class="purchase-small">商品代金の上限</div>`;
      const profit = `<div style="color:${ref.profit === null ? 'var(--text3)' : ref.profit >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:700">${signed(ref.profit)} / ${pct(ref.roi)}</div><div class="purchase-small">${basis}</div>`;
      const status = `${badge(a)}<div class="purchase-small">${confidence}</div>`;
      if (mobile) return `<tr class="card-row ${String(r.apparel_id) === selected ? 'selected-product' : ''}"><td class="purchase-cards"><div class="purchase-card-top">${product(r)}${badge(a)}</div><div class="purchase-card-values"><div><span>仕入上限</span>${value}</div><div><span>${a.hasCost ? '入力価格での利益' : '過去安値での参考利益'}</span>${profit}</div></div><div class="purchase-card-foot"><span class="purchase-small">7日中央値 ${money(r.med7)} ／ ${r.cnt7}件<br>相場：${trend} ／ ${confidence}<br>最終成約 ${esc(last)}</span><div class="mobile-spark">${sparkline(r)}<span>30日・日別平均</span></div></div></td></tr>`;
      return `<tr class="${String(r.apparel_id) === selected ? 'selected-product' : ''}"><td>${product(r)}</td><td>${value}</td><td>${profit}</td><td>${money(r.med7)}<div class="purchase-small">安値 ${money(r.mn7)}</div></td><td>${sparkline(r)}</td><td>${r.cnt7}件<div class="purchase-small">最終 ${esc(last)}</div></td><td>${status}</td><td>${trend}</td></tr>`;
    }).join('');
  }
  function open(id, scroll=true) {
    const pageScroll = window.scrollY;
    selected = String(id);
    const r = tableData.find(x => String(x.apparel_id) === selected); if (!r) { close(); return; }
    const detail = document.getElementById('purchaseDetail');
    const wasOpen = detail.open;
    detail.innerHTML = `<div class="drawer-heading"><span class="purchase-eyebrow">PROFIT CALCULATOR</span><button class="purchase-secondary" id="closePurchase" aria-label="商品詳細を閉じる">閉じる</button></div><h2>${esc(title(r))}</h2><p class="purchase-small">${esc(r.set_name || '')} ／ PSA10 ／ 最終成約 ${esc(r.last_tx || '不明')}</p>
      <div class="purchase-grid"><label>実際の仕入商品代金（円）<input id="purchaseCost" type="number" min="1" max="100000000" step="1" placeholder="例：20000" value="${costs.get(selected) || ''}"></label><div class="purchase-small">販売価格の試算基準：直近7日成約中央値 ${money(r.med7)}<br>過去安値 ${money(r.mn7)} は現在買える価格ではありません。</div></div>
      <p class="purchase-error" id="costError" role="status"></p><div id="purchaseResult" aria-live="polite"></div>
      <button class="purchase-secondary" id="purchaseChart">この商品のチャートを見る</button> <a class="purchase-view-link" href="${esc(safeURL(r.url))}" target="_blank" rel="noopener noreferrer">SNKRDUNKの商品ページ ↗</a>
      <details class="purchase-note"><summary>計算方法・判定の根拠</summary>売却手取＝販売価格×（1−手数料率）−販売送料−その他販売費。利益＝売却手取−商品代金−仕入時費用。利益率＝利益÷（商品代金＋仕入時費用）。仕入上限は最低利益額・率を両方満たす額を切り捨て。条件達成には取引件数・鮮度・予算・中立以上のトレンドも必要です。信頼度は件数と鮮度の目安で、値動きやデータの正しさを保証しません。税金は含みません。</details>`;
    document.getElementById('purchaseCost').addEventListener('input', e => {
      const el = e.target; const n = Number(el.value);
      const invalid = el.validity.badInput || (el.value !== '' && (!el.checkValidity() || !Number.isInteger(n)));
      document.getElementById('costError').textContent = invalid ? '仕入商品代金は1〜100,000,000円の整数で入力してください。' : '';
      if (!invalid && n > 0) costs.set(selected, n); else costs.delete(selected);
      updateResult(r, invalid); refresh();
    });
    document.getElementById('closePurchase').onclick = close;
    document.getElementById('purchaseChart').onclick = () => showChart(r.apparel_id);
    updateResult(r);
    renderTableBody();
    if (!wasOpen) { isMobile() ? detail.showModal() : detail.show(); document.body.classList.add('detail-open'); }
    if (scroll) document.getElementById('closePurchase').focus({preventScroll:true});
    window.scrollTo({top:pageScroll,behavior:'instant'});
    requestAnimationFrame(() => window.scrollTo({top:pageScroll,behavior:'instant'}));
  }
  function showChart(id) {
    const y = window.scrollY;
    if (document.getElementById('purchaseDetail').open) close();
    chartProduct = String(id || allOptions[0]?.value || '');
    populateSelect(allOptions); document.getElementById('chartSearchInput').value='';
    document.getElementById('cardSelect').value=chartProduct;
    activeApId=chartProduct; chartPanelOpen=true;
    document.getElementById('chartPanelBody').classList.remove('chart-collapsed');
    const dialog = document.getElementById('marketChartDialog');
    if (!dialog.open) dialog.showModal();
    renderChart(); document.getElementById('closeMarketChart').focus({preventScroll:true});
    window.scrollTo({top:y,behavior:'instant'});
    requestAnimationFrame(()=>window.scrollTo({top:y,behavior:'instant'}));
  }
  function sparkline(r) {
    const series=sparkMap.get(String(r.apparel_id)) || [];
    if(series.length<2) return '<span class="purchase-small">推移データ不足</span>';
    const prices=series.map(p=>p.price), min=Math.min(...prices), max=Math.max(...prices);
    const start=Purchase.timestamp(series[0].day), end=Purchase.timestamp(series.at(-1).day);
    const points=series.map(p=>`${4+((Purchase.timestamp(p.day)-start)/(end-start || 1))*102},${max===min?20:36-(p.price-min)/(max-min)*30}`).join(' ');
    const color=prices.at(-1)>=prices[0]?'var(--green)':'var(--red)';
    return `<button class="sparkline-button" data-graph-id="${esc(r.apparel_id)}" aria-label="${esc(title(r))}の価格グラフ"><svg viewBox="0 0 110 42" role="img" aria-label="直近30日の日別平均成約価格。詳細グラフを開く"><path d="M4 38H106" stroke="var(--border2)"/><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  }
  function syncSort() {
    document.querySelectorAll('th[data-sort-key]').forEach(th=>{
      const active=th.dataset.sortKey===sortCol;
      th.setAttribute('aria-sort',active?(sortDir===1?'ascending':'descending'):'none');
      th.querySelector('.sort-arrow').textContent=active?(sortDir===1?'↑':'↓'):'↕';
    });
  }
  function outside(event, dialog) {
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  }
  function close() {
    const id = selected;
    document.getElementById('purchaseDetail').close();
    document.body.classList.remove('detail-open'); selected = null;
    renderTableBody();
    const trigger = [...document.querySelectorAll('[data-purchase-id]')].find(el => el.dataset.purchaseId === id);
    if (trigger) trigger.focus({preventScroll:true});
  }
  function updateResult(r, invalid=false) {
    const a = assessment(r), cost = costs.get(String(r.apparel_id));
    const label = invalid ? '<span class="purchase-badge warn">入力を確認</span>' : badge(a);
    const scenarios = [0, 5, 10].map(drop => {
      const sale = r.med7 > 0 ? Math.floor(r.med7 * (1 - drop / 100)) : null;
      const c = Purchase.calculate(sale, cost, settings);
      return `<tr><td>${drop ? drop + '％下落' : '7日中央値'}</td><td>${money(sale)}</td><td>${signed(c.profit)}</td><td>${pct(c.roi)}</td></tr>`;
    }).join('');
    document.getElementById('purchaseResult').innerHTML = `${label}<p class="purchase-note">${esc(a.reasons.join(' ／ ') || '設定した利益・件数・鮮度・予算・相場条件を満たしています。')}</p><div class="purchase-metrics"><div class="purchase-metric"><span class="purchase-small">仕入上限（商品代金）</span><strong class="purchase-value">${a.limit === 0 ? '条件を満たす価格なし' : money(a.limit)}</strong></div><div class="purchase-metric"><span class="purchase-small">入力価格での利益額</span><strong class="${a.profit === null ? '' : a.profit >= 0 ? 'profit-positive' : 'profit-negative'}">${signed(a.profit)}</strong></div><div class="purchase-metric"><span class="purchase-small">入力価格での利益率</span><strong class="${a.roi === null ? '' : a.roi >= 0 ? 'profit-positive' : 'profit-negative'}">${pct(a.roi)}</strong></div></div>
      <p class="purchase-small">売却手取 ${money(a.net)} ／ 仕入時費用 ${money(settings.buyFees)} ／ 最低利益 ${money(settings.targetProfit)}・${settings.targetRoi}％ ／ 取得 ${r.cnt7}件・信頼度 ${a.confidence}</p>
      <div style="overflow-x:auto"><table class="purchase-scenarios"><thead><tr><th>販売シナリオ</th><th>販売価格</th><th>利益額</th><th>利益率</th></tr></thead><tbody>${scenarios}</tbody></table></div><p class="purchase-note">中央値は販売価格の仮定です。未入力時は利益を表示しません。データ不足時の仕入上限は参考値です。入力した商品代金はページを再読み込みするまでのみ保持します。</p>`;
  }
  return {init, enrich, summary, assessment, rows, syncSort, sync: () => { if (selected) open(selected, false); }};
})();
