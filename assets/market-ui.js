/* Market overview for the PSA10 dashboards: period switch, market gate, summary tiles,
   search candidates, heatmap and the market block of the detail drawer.
   Reads the page's db / tableData; calculations live in market.js. */
const MarketUI = (() => {
  const STORE = 'price-tracker.market.v1';
  let period = '7', pickTab = 'priority', heatCount = 60;
  let loadedDB = null, trades = new Map(), stats = new Map(), ranks = new Map(), gate = Market.gate([]), asOf = 0, dataStart = 0, dirty = true, heatWidth = -1;
  const yen = n => n == null || !Number.isFinite(n) ? '—' : '¥' + Math.round(n).toLocaleString('ja-JP');
  const yenShort = n => {
    if (n == null || !Number.isFinite(n)) return '—';
    const a = Math.abs(n), sign = n < 0 ? '−' : '';
    if (a >= 1e8) return sign + '¥' + (a / 1e8).toFixed(2) + '億';
    if (a >= 1e4) return sign + '¥' + Math.round(a / 1e4).toLocaleString('ja-JP') + '万';
    return sign + '¥' + Math.round(a).toLocaleString('ja-JP');
  };
  const pct = (n, digits=1) => {
    if (n == null || !Number.isFinite(n)) return '集計中';
    const text = Math.abs(n).toFixed(digits);   // 丸めて0になる値に符号を付けない
    return (Number(text) === 0 ? '' : n > 0 ? '+' : '−') + text + '%';
  };
  const tone = n => n == null || !Number.isFinite(n) || Math.abs(n) < .05 ? 'flat' : n > 0 ? 'up' : 'down';
  const change = n => `<span class="mk-chg ${tone(n)}">${pct(n)}</span>`;
  const label = () => Market.PERIODS.find(p => p.key === period).label;
  const title = r => [r.card_name, r.rarity, r.collection_no ? '[' + r.collection_no + ']' : ''].filter(Boolean).join(' ');
  const thumb = r => {
    const img = typeof cardImages !== 'undefined' ? cardImages[String(r.apparel_id)] : null;
    return img?.img && (/^https:\/\//.test(img.img) || /^data\/thumbs\/[\w.-]+$/.test(img.img)) ? img.img : null;
  };
  const stamp = ms => { const d = new Date(ms + 9 * 3600000); return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const segmented = (id, name, options, current) => `<div class="mk-seg" id="${id}" role="group" aria-label="${name}">${options.map(([key, text]) => `<button type="button" data-key="${key}" aria-pressed="${key === current}">${text}</button>`).join('')}</div>`;

  function init() {
    try { const saved = JSON.parse(localStorage.getItem(STORE)); if (Market.PERIODS.some(p => p.key === saved?.period)) period = saved.period; } catch {}
    if (isMobile()) heatCount = 30;
    document.getElementById('purchaseSummary').insertAdjacentHTML('afterend', `
      <section class="mk-section" aria-labelledby="mkOverviewTitle">
        <div class="mk-bar"><h3 id="mkOverviewTitle">市場の概況</h3><span class="mk-asof" id="mkAsOf"></span>${segmented('mkPeriods', '集計期間', Market.PERIODS.map(p => [p.key, p.label]), period)}</div>
        <p class="mk-stale" id="mkStale" role="status" hidden></p>
        <div class="mk-gate" id="mkGate" role="status"></div>
        <div class="mk-tiles" id="mkTiles"></div>
      </section>
      <section class="mk-section" aria-labelledby="mkPicksTitle">
        <div class="mk-bar"><h3 id="mkPicksTitle">いま探す候補</h3>${segmented('mkPickTabs', '候補の並べ方', [['priority', '探す優先度'], ['gainers', '値上がり'], ['losers', '値下がり'], ['volume', '成約額']], pickTab)}</div>
        <p class="purchase-small mk-note" id="mkPickNote"></p>
        <ol class="mk-picks" id="mkPicks"></ol>
      </section>
      <section class="mk-section" aria-labelledby="mkHeatTitle">
        <div class="mk-bar"><h3 id="mkHeatTitle">ヒートマップ</h3><span class="purchase-small" id="mkHeatNote"></span><label class="mk-count">表示数<select id="mkHeatCount">${[30, 60, 100].map(n => `<option value="${n}"${n === heatCount ? ' selected' : ''}>上位${n}</option>`).join('')}</select></label></div>
        <div class="mk-heat" id="mkHeat"></div>
        <div class="mk-legend" aria-hidden="true"><span><i style="background:${Market.heatColor(-10)}"></i>下落</span><span><i style="background:${Market.heatColor(0)}"></i>横ばい</span><span><i style="background:${Market.heatColor(10)}"></i>上昇</span><span><i class="mk-pending"></i>集計中</span></div>
      </section>`);
    document.querySelector('.purchase-data-disclosure').insertAdjacentHTML('beforeend', `<p class="purchase-data-info">期間の変動は、直近の成約の中央値と、その期間だけ前の成約の中央値を比べます（1日は24時間どうし、7日・30日・90日は7日間どうし）。どちらかの成約が2件未満、または収集開始より前にかかる場合は「集計中」とし、0％とは扱いません。基準はデータ内の最新成約時刻です。成約額は取得できた成約価格の合計で、取引の多い商品は1日あたりの取得数に上限があるため実際より小さくなります。</p><p class="purchase-data-info">市場判定は、7日変動を出せた商品（7日5件以上）の変動の中央値と、3％を超えて上げた・下げた商品の割合で決めます。中央値が−3％以下、または下げた商品が50％以上で「仕入停止」、中央値が−1％以下、または下げた割合が上げた割合より10ポイント以上多いと「注意」、それ以外は「通常」です。2026年7〜11月のポケモンPSA10成約では、仕入停止に当たる日は条件に関係なく約3割の商品が2週間以内に10％以上下げました。判定は遅れて出ます（下落の初動と底打ちは拾えません）。</p><p class="purchase-data-info">探す優先度は、同じ成約データで下落が多かった状態を外したものです。①7日${Market.RULE.hotCount}件以上またはランキング${Market.RULE.hotRank}位以内（過熱）、②7日変動が${Market.RULE.fall}％以下または+${Market.RULE.surge}％以上、③直近3日の中央値が7日中央値より${-Market.RULE.gap}％以上安い、④成約件数が前週の半分以下、のどれにも当たらない商品が候補で、成約件数が前週の${Market.RULE.volUp}倍以上なら「優先して探す」です。1つ当たると「様子見」、2つ以上で「見送り」。仕入停止の日は候補を出しません。相場の向きの強さ・価格の安定・レアリティ・価格帯は、市場全体の動きを引くと差が出なかったため使っていません。根拠は4か月・下落と反発が1回ずつのデータで、しきい値はポケモンの成約から決めています。スニダン内の成約だけを見ており、他の販路で上限以下で買える確率は測っていません。</p><p class="purchase-data-info">売値の前提は7日中央値と直近3日中央値（3件以上）の低い方です。仕入上限はその損益分岐点で、上限ちょうどで仕入れると過去データでは通常時でも3〜5割が赤字でした。狙い値は上限の${Market.SAFETY.blue * 100}％下（注意の日は${Market.SAFETY.yellow * 100}％下）です。</p>`);
    document.getElementById('mkPeriods').addEventListener('click', e => { const b = e.target.closest('button[data-key]'); if (b) setPeriod(b.dataset.key); });
    document.getElementById('mkPickTabs').addEventListener('click', e => { const b = e.target.closest('button[data-key]'); if (!b) return; pickTab = b.dataset.key; press('mkPickTabs', pickTab); renderPicks(); });
    document.getElementById('mkHeatCount').addEventListener('change', e => { heatCount = Number(e.target.value); renderHeat(); });
    document.getElementById('mainView').addEventListener('click', e => {
      const b = e.target.closest('.mk-section [data-purchase-id]'); if (b) PurchaseUI.open(b.dataset.purchaseId);
    });
    // ヒートマップは箱の幅に合わせて描くので、箱の幅そのものを見張る。PCで利益計算パネルを開くと
    // ウィンドウ幅は変わらずに本文だけ狭くなり、描き直さないと右側が切れる。
    // 描画時に幅が0だった場合も、幅が付いた時点で描き直す
    let timer = null, windowWidth = window.innerWidth;
    const redraw = () => { clearTimeout(timer); timer = setTimeout(renderHeat, 150); };
    new ResizeObserver(entries => { if (Math.round(entries[0].contentRect.width) !== heatWidth) redraw(); }).observe(document.getElementById('mkHeat'));
    // 高さはスマートフォン幅かどうかで決まるため、ウィンドウ幅の変化でも描き直す
    window.addEventListener('resize', () => { if (window.innerWidth !== windowWidth) { windowWidth = window.innerWidth; redraw(); } });
    document.addEventListener('keydown', e => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.querySelector('dialog[open]')) return;
      e.preventDefault(); document.getElementById('tableSearch').focus();
    });
  }
  const press = (id, key) => document.querySelectorAll(`#${id} button`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.key === key)));

  function load() {
    if (loadedDB === db) return;
    const table = typeof TABLE !== 'undefined' ? TABLE : 'ranking_transactions';
    const result = db.exec(`SELECT apparel_id, transaction_date, price FROM ${table} WHERE grade='PSA10' AND price>0`);
    // 基準は一覧の7日集計と同じ時刻（データ内の最新成約。閲覧時刻より先の行は使わない）
    trades = new Map(); asOf = Purchase.timestamp(aggregationNow); dataStart = Infinity;
    (result[0]?.values || []).forEach(([id, date, price]) => {
      const t = Purchase.timestamp(date); if (!Number.isFinite(t) || t > asOf) return;
      const key = String(id); if (!trades.has(key)) trades.set(key, []);
      trades.get(key).push({t, p:price});
      if (t < dataStart) dataStart = t;
    });
    stats = new Map([...trades].map(([id, list]) => [id, Market.metrics(list, asOf, dataStart)]));
    gate = Market.gate([...stats.values()]);
    // いまのランキング順位。card_master が無いデータは、最新収集日の順位を使う（過去の最高順位は使わない）
    ranks = new Map();
    const put = sql => { try { (db.exec(sql)[0]?.values || []).forEach(([id, rank]) => { if (rank > 0) ranks.set(String(id), rank); }); } catch {} };
    put('SELECT apparel_id, rank FROM card_master');
    if (!ranks.size) put(`SELECT apparel_id, MIN(rank) FROM ${table} WHERE collected_date = (SELECT MAX(collected_date) FROM ${table}) GROUP BY apparel_id`);
    loadedDB = db;
  }

  // 利益計算より先に、売値の前提（7日中央値と直近3日中央値の低い方）を各商品に付ける
  function prepare() {
    load();
    tableData.forEach(r => { r.market = stats.get(String(r.apparel_id)) || null; r.saleBase = r.market?.saleBase ?? r.med7; });
  }

  // PurchaseUI.enrich() から、商品の同定・設定が決まったあとに呼ばれる
  function enrich(settings, assess) {
    prepare();
    tableData.forEach(r => {
      const m = r.market, a = assess(r), p = m?.periods[period];
      r.priority = a.label === 'データ不足'
        ? {score:null, tier:null, label:'集計中', flags:[], checks:null, reason:a.reasons[0]}
        : Market.priority(m, {minTrades:settings.minTrades, gate, rank:ranks.get(String(r.apparel_id))});
      r.priorityScore = r.priority.score;
      r.aim = Market.aim(a.limit, gate.level);
      r.chg = p?.change ?? null; r.chgYen = p?.changeYen ?? null;
      r.volume = p?.volume || null; r.volumePrev = p?.volumePrev ?? null; r.periodCount = p?.count ?? 0;
      const withinBudget = !settings.budget || (a.limit > 0 && a.limit + settings.buyFees <= settings.budget);
      r.isCandidate = a.limit > 0 && withinBudget && (r.priority.tier === 'A' || r.priority.tier === 'B');
    });
    dirty = true;
  }

  function setPeriod(key) {
    period = key; press('mkPeriods', key);
    try { localStorage.setItem(STORE, JSON.stringify({period})); } catch {}
    PurchaseUI.refresh();
  }

  function render() {
    if (!dirty) return; dirty = false;
    document.getElementById('mkAsOf').textContent = asOf ? `最新成約 ${stamp(asOf)} 時点・スニダン PSA10・1枚` : '';
    const stale = document.getElementById('mkStale'), age = (Date.now() - asOf) / Market.DAY;
    stale.hidden = !(asOf && age > 2);
    if (!stale.hidden) stale.textContent = `最新の成約データは ${stamp(asOf)} です（${Math.floor(age)}日前）。収集が止まっている可能性があります。`;
    renderGate(); renderTiles(); renderPicks(); renderHeat();
  }

  // 市場判定。色だけに頼らないよう、記号と言葉を必ず添える
  const GATE_VIEW = {
    red:{mark:'■', text:'全面安です。条件に関係なく下げやすい局面のため、候補を出していません。'},
    yellow:{mark:'▲', text:'弱含みです。候補は出しますが、狙い値を上限の10％下にしています。'},
    blue:{mark:'●', text:'全体は落ち着いています。狙い値は上限の5％下です。'}
  };
  function renderGate() {
    const box = document.getElementById('mkGate'), view = GATE_VIEW[gate.level];
    box.className = 'mk-gate gate-' + (gate.level || 'none');
    box.innerHTML = view
      ? `<strong><span aria-hidden="true">${view.mark}</span> 市場判定：${gate.label}</strong><span>${view.text}</span><em>7日変動の中央値 ${pct(gate.median)}／3％超の上げ ${(gate.up * 100).toFixed(0)}％・下げ ${(gate.down * 100).toFixed(0)}％（${gate.count}商品）</em>`
      : `<strong>市場判定：集計中</strong><span>7日変動を比べられる商品が${gate.count}件のため判定できません。狙い値は注意の日と同じ幅にしています。</span>`;
  }

  function renderTiles() {
    const rows = tableData.filter(r => r.market);
    const volume = rows.reduce((s, r) => s + (r.volume || 0), 0), count = rows.reduce((s, r) => s + r.periodCount, 0);
    const comparable = rows.every(r => r.volumePrev !== null);
    const prev = comparable ? rows.reduce((s, r) => s + r.volumePrev, 0) : null;
    const volumeChange = prev > 0 ? (volume - prev) / prev * 100 : null;
    const changes = rows.map(r => r.chg).filter(v => v !== null);
    const up = changes.filter(v => v >= .5).length, down = changes.filter(v => v <= -.5).length, flat = changes.length - up - down;
    const mid = Market.median(changes), share = n => changes.length ? n / changes.length * 100 : 0;
    document.getElementById('mkTiles').innerHTML = `
      <div class="mk-tile"><span>${label()}成約額</span><strong>${yenShort(volume)}</strong><em>前の${label()}比 ${change(volumeChange)}</em></div>
      <div class="mk-tile"><span>${label()}成約件数</span><strong>${count.toLocaleString('ja-JP')}件</strong><em>取得できた成約のみ</em></div>
      <div class="mk-tile"><span>値上がり／値下がり</span><strong><b class="mk-chg up">${up}</b> ／ <b class="mk-chg down">${down}</b></strong>
        <div class="mk-breadth" role="img" aria-label="値上がり${up}、横ばい${flat}、値下がり${down}"><i class="up" style="width:${share(up)}%"></i><i class="flat" style="width:${share(flat)}%"></i><i class="down" style="width:${share(down)}%"></i></div>
        <em>横ばい ${flat}・集計中 ${rows.length - changes.length}</em></div>
      <div class="mk-tile"><span>${label()}変動の中央値</span><strong>${change(mid)}</strong><em>変動を出せた ${changes.length} 商品</em></div>`;
  }

  const pickers = {
    priority: {rows: () => tableData.filter(r => r.isCandidate).sort((a, b) => b.priorityScore - a.priorityScore || (b.market.cnt7 - a.market.cnt7)),
      note: n => gate.level === 'red' ? '市場が全面安のため、候補を出していません。過去のデータでは、この状態の日は条件を満たす商品も満たさない商品も同じように下げています。'
        : n ? '下落の多かった状態（過熱・下落中・急騰直後・直近3日の値崩れ・成約半減）を外し、成約件数の伸びが大きい順に並べています。仕入上限は損益分岐点です。狙い値以下の出品を他の販路で探し、見つけた価格を「利益を計算」に入れて確かめます。'
        : '条件を満たす候補がありません。仕入条件（予算・最低件数）を確認してください。'},
    gainers: {rows: () => tableData.filter(r => r.priorityScore !== null && r.chg !== null && r.chg > 0).sort((a, b) => b.chg - a.chg),
      note: () => `${label()}の値上がり率が大きい順です（成約件数と鮮度の条件を満たす商品のみ）。急な値上がりの直後は売値の前提が崩れやすい点に注意してください。`},
    losers: {rows: () => tableData.filter(r => r.priorityScore !== null && r.chg !== null && r.chg < 0).sort((a, b) => a.chg - b.chg),
      note: () => `${label()}の値下がり率が大きい順です。手持ちがある場合の売却判断や、仕入れを見送る確認に使います。`},
    volume: {rows: () => tableData.filter(r => r.volume > 0).sort((a, b) => b.volume - a.volume),
      note: () => `${label()}の成約額が大きい順です。お金が集まっている商品を確認できます。`}
  };
  function renderPicks() {
    const rows = pickers[pickTab].rows().slice(0, 8);
    document.getElementById('mkPickNote').textContent = pickers[pickTab].note(rows.length);
    document.getElementById('mkPicks').innerHTML = rows.map((r, i) => {
      const a = PurchaseUI.assessment(r), src = thumb(r), search = Purchase.marketSearches([r.card_name, String(r.collection_no || '').split(' ').pop(), 'PSA10'].filter(Boolean).join(' '))[0];
      const head = pickTab === 'priority' ? `<span class="mk-pick-main">${ratio(r.market)}</span>` : pickTab === 'volume' ? `<span class="mk-pick-main">${yenShort(r.volume)}</span>` : `<span class="mk-pick-main">${change(r.chg)}</span>`;
      return `<li class="mk-pick"><div class="mk-pick-head"><span class="mk-rank">${i + 1}</span>${head}${tierChip(r.priority)}</div>
        <button type="button" class="mk-pick-body" data-purchase-id="${esc(r.apparel_id)}" aria-label="${esc(title(r))}の利益を計算">
          ${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : '<span class="mk-noimg" aria-hidden="true">PSA10</span>'}
          <span class="mk-pick-text"><span class="mk-pick-name">${esc(title(r))}</span>
            <span class="mk-kv"><span>売値の前提</span><b>${yen(r.saleBase)}</b></span>
            <span class="mk-kv"><span>仕入上限（損益分岐）</span><b class="mk-limit">${a.limit > 0 ? yen(a.limit) : '—'}</b></span>
            <span class="mk-kv"><span>狙い値</span><b>${r.aim ? yen(r.aim) : '—'}</b></span>
            <span class="mk-kv"><span>${label()}変動</span><b>${change(r.chg)}</b></span></span></button>
        <p class="purchase-small">${esc(r.priority.reason)}</p>
        ${search ? `<a class="card-market-link" href="${esc(search.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(title(r))}を${search.label}で探す（新しいタブ）">${search.label}で探す ↗</a>` : ''}</li>`;
    }).join('');
  }
  const ratio = m => m?.volRatio == null ? '前週比 —' : `前週比 ×${m.volRatio.toFixed(2)}`;
  function tierChip(p) {
    const flags = p.flags.map(f => `<span class="mk-flag">${f}</span>`).join('');
    return `<span class="mk-tier tier-${p.tier || 'none'}">${p.label}</span>${flags}`;
  }

  function renderHeat() {
    const box = document.getElementById('mkHeat'); if (!box) return;
    const width = heatWidth = box.clientWidth, height = isMobile() ? 380 : 460;
    document.getElementById('mkHeatNote').textContent = `面積＝${label()}成約額、色＝${label()}変動。押すと利益計算を開きます`;
    if (!width) return;
    const items = tableData.filter(r => r.volume > 0).sort((a, b) => b.volume - a.volume).slice(0, heatCount).map(r => ({value:r.volume, r}));
    box.style.height = height + 'px';
    box.innerHTML = Market.treemap(items, width, height).map(n => {
      const r = n.item.r, color = Market.heatColor(r.chg), src = thumb(r);
      const showImg = src && n.w >= 46 && n.h >= 62, showName = n.w >= 120 && n.h >= 64, showPct = n.w >= 34 && n.h >= 18, narrow = n.w < 62;
      const imgH = Math.min(n.h - 8, (n.w - 8) * 1.4, 130);
      return `<button type="button" class="mk-cell${color ? '' : ' mk-pending'}" data-purchase-id="${esc(r.apparel_id)}" style="left:${n.x.toFixed(1)}px;top:${n.y.toFixed(1)}px;width:${n.w.toFixed(1)}px;height:${n.h.toFixed(1)}px;${color ? 'background:' + color : ''}" title="${esc(title(r))}&#10;7日中央値 ${yen(r.med7)}／${label()}変動 ${pct(r.chg)}／${label()}成約額 ${yenShort(r.volume)}" aria-label="${esc(title(r))}、${label()}変動 ${pct(r.chg)}">
        ${showImg ? `<img src="${esc(src)}" alt="" loading="lazy" style="height:${imgH.toFixed(0)}px">` : ''}
        ${showPct ? `<span class="mk-cell-pct${narrow ? ' mk-narrow' : ''}">${r.chg === null && narrow ? '…' : pct(r.chg, narrow ? 0 : 1)}</span>` : ''}${showName ? `<span class="mk-cell-name">${esc(r.card_name || '')}</span>` : ''}</button>`;
    }).join('') || '<p class="purchase-small mk-empty">この期間の成約がありません。</p>';
  }

  // 一覧の「探す優先度」セル
  function priorityCell(r) {
    const p = r.priority;
    if (!p || p.score === null) return `<div class="mk-priority"><span class="mk-tier tier-none">集計中</span><div class="purchase-small">${esc(p?.reason || '成約データなし')}</div></div>`;
    return `<div class="mk-priority"><div class="mk-priority-top"><span class="mk-score tier-${p.tier}">${p.tier}</span>${tierChip(p)}</div>${checks(p)}<div class="purchase-small">成約件数 ${ratio(r.market)}</div></div>`;
  }
  // 4つの条件を、記号（✓／×）と言葉で示す
  const checks = p => `<ul class="mk-checks" aria-label="候補の条件">${p.checks.map(c => `<li class="${c.ok ? 'ok' : 'ng'}" title="${esc(c.name)}：${esc(c.text)}" aria-label="${esc(c.name)}：${c.ok ? '満たす' : '満たさない'}（${esc(c.text)}）"><span aria-hidden="true">${c.ok ? '✓' : '×'}</span>${esc(c.name)}</li>`).join('')}</ul>`;
  const changeCell = r => `${change(r.chg)}<div class="purchase-small">${r.chgYen === null ? '比較できる成約なし' : (r.chgYen >= 0 ? '+' : '−') + yen(Math.abs(r.chgYen))}</div>`;
  const volumeCell = r => {
    const v = r.volume && r.volumePrev > 0 ? (r.volume - r.volumePrev) / r.volumePrev * 100 : null;
    return `${yenShort(r.volume)}<div class="purchase-small">${r.periodCount}件${v === null ? '' : '・前期間比 ' + pct(v, 0)}</div>`;
  };

  // 商品詳細（利益計算）の上に置く市場データ
  function detail(r) {
    const m = r.market, p = r.priority;
    if (!m) return '';
    const rows = Market.PERIODS.map(x => `<td>${change(m.periods[x.key].change)}</td>`).join('');
    const part = !p || p.score === null ? `<p class="purchase-small">探す優先度は集計中です：${esc(p?.reason || '')}</p>`
      : `<div class="mk-detail-score"><span class="mk-score tier-${p.tier}">${p.tier}</span><div>${tierChip(p)}<div class="purchase-small">${esc(p.reason)}</div></div></div>
         <dl class="mk-parts">${p.checks.map(c => `<div><dt>${esc(c.name)}</dt><dd><span class="mk-check ${c.ok ? 'ok' : 'ng'}"><span aria-hidden="true">${c.ok ? '✓' : '×'}</span> ${c.ok ? '満たす' : '満たさない'}</span>${esc(c.text)}</dd></div>`).join('')}</dl>
         <p class="purchase-small">市場判定：${gate.label}／売値の前提 ${yen(m.saleBase)}（7日中央値 ${yen(m.med7)}・直近3日中央値 ${m.med3 === null ? '3件未満' : yen(m.med3)} の低い方）</p>`;
    return `<section class="mk-detail" aria-label="市場データ"><h3>探す優先度</h3>${part}
      <table class="mk-periods"><thead><tr>${Market.PERIODS.map(x => `<th>${x.label}変動</th>`).join('')}</tr></thead><tbody><tr>${rows}</tr></tbody></table>
      <p class="purchase-small">7日の成約 ${m.cnt7}件（1日あたり ${m.perDay7.toFixed(1)}件）／${label()}成約額 ${yenShort(r.volume)}／価格幅 ${m.spread7 === null ? '集計中' : (m.spread7 * 100).toFixed(1) + '％'}</p></section>`;
  }
  // 入力した仕入価格が、直近30日の成約の中でどの水準か
  function position(r, cost) {
    const pos = Market.pricePosition(trades.get(String(r.apparel_id)) || [], asOf, cost);
    if (!pos) return '';
    const text = `直近${pos.days}日の成約 ${pos.count}件のうち、この価格以下で成立したのは ${pos.share.toFixed(0)}％です（最安 ${yen(pos.low)}）。`;
    return `<p class="purchase-note">${text}${pos.share === 0 ? 'スニダンのどの成約よりも安い価格です。真贋・状態・鑑定番号を必ず確認してください。' : ''}</p>`;
  }

  return {init, prepare, enrich, render, priorityCell, changeCell, volumeCell, detail, position, label, yenShort, change, gate: () => gate};
})();
