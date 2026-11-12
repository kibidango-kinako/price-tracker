/* Market overview for the PSA10 dashboards: period switch, summary tiles,
   search candidates, heatmap and the market block of the detail drawer.
   Reads the page's db / tableData; calculations live in market.js. */
const MarketUI = (() => {
  const STORE = 'price-tracker.market.v1';
  let period = '7', pickTab = 'priority', heatCount = 60;
  let loadedDB = null, trades = new Map(), stats = new Map(), asOf = 0, dataStart = 0, dirty = true;
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
    document.querySelector('.purchase-data-disclosure').insertAdjacentHTML('beforeend', `<p class="purchase-data-info">期間の変動は、直近の成約の中央値と、その期間だけ前の成約の中央値を比べます（1日は24時間どうし、7日・30日・90日は7日間どうし）。どちらかの成約が2件未満、または収集開始より前にかかる場合は「集計中」とし、0％とは扱いません。基準はデータ内の最新成約時刻です。成約額は取得できた成約価格の合計で、取引の多い商品は1日あたりの取得数に上限があるため実際より小さくなります。</p><p class="purchase-data-info">探す優先度（0〜100）は、売りやすさ40（7日の成約件数と成約のあった日数）・相場の向き35（7日と30日の変動）・価格の安定25（7日の成約価格の10〜90％幅）の合計です。スニダン内の成約価格は中央値の近くに集まるため、安く買える余地は測っていません。仕入上限以下で他の販路から買えた場合に売り抜けやすいかの目安で、今後の値動きを示すものではありません。7日で20％以上の急騰、7日で8％以上または30日で20％以上の下落は「様子見」以下にします。</p>`);
    document.getElementById('mkPeriods').addEventListener('click', e => { const b = e.target.closest('button[data-key]'); if (b) setPeriod(b.dataset.key); });
    document.getElementById('mkPickTabs').addEventListener('click', e => { const b = e.target.closest('button[data-key]'); if (!b) return; pickTab = b.dataset.key; press('mkPickTabs', pickTab); renderPicks(); });
    document.getElementById('mkHeatCount').addEventListener('change', e => { heatCount = Number(e.target.value); renderHeat(); });
    document.getElementById('mainView').addEventListener('click', e => {
      const b = e.target.closest('.mk-section [data-purchase-id]'); if (b) PurchaseUI.open(b.dataset.purchaseId);
    });
    let timer = null, width = window.innerWidth;
    window.addEventListener('resize', () => { if (window.innerWidth === width) return; width = window.innerWidth; clearTimeout(timer); timer = setTimeout(renderHeat, 150); });
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
    loadedDB = db;
  }

  // PurchaseUI.enrich() から、商品の同定・設定が決まったあとに呼ばれる
  function enrich(settings, assess) {
    load();
    tableData.forEach(r => {
      const m = stats.get(String(r.apparel_id)) || null, a = assess(r), p = m?.periods[period];
      r.market = m;
      r.priority = a.label === 'データ不足'
        ? {score:null, tier:null, label:'集計中', flags:[], parts:null, reason:a.reasons[0]}
        : Market.priority(m, {minTrades:settings.minTrades});
      r.priorityScore = r.priority.score;
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
    renderTiles(); renderPicks(); renderHeat();
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
      note: n => n ? '売りやすさ・相場の向き・価格の安定が揃っている順です。仕入上限以下の出品を他の販路で探し、見つけた価格を「利益を計算」に入れて確かめます。' : '条件を満たす候補がありません。仕入条件（予算・最低件数・目標利益）を確認してください。'},
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
      const head = pickTab === 'priority' ? `<span class="mk-score tier-${r.priority.tier}">${r.priorityScore}</span>` : pickTab === 'volume' ? `<span class="mk-pick-main">${yenShort(r.volume)}</span>` : `<span class="mk-pick-main">${change(r.chg)}</span>`;
      return `<li class="mk-pick"><div class="mk-pick-head"><span class="mk-rank">${i + 1}</span>${head}${tierChip(r.priority)}</div>
        <button type="button" class="mk-pick-body" data-purchase-id="${esc(r.apparel_id)}" aria-label="${esc(title(r))}の利益を計算">
          ${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : '<span class="mk-noimg" aria-hidden="true">PSA10</span>'}
          <span class="mk-pick-text"><span class="mk-pick-name">${esc(title(r))}</span>
            <span class="mk-kv"><span>7日中央値</span><b>${yen(r.med7)}</b></span>
            <span class="mk-kv"><span>仕入上限</span><b class="mk-limit">${a.limit > 0 ? yen(a.limit) : '—'}</b></span>
            <span class="mk-kv"><span>${label()}変動</span><b>${change(r.chg)}</b></span></span></button>
        <p class="purchase-small">${esc(r.priority.reason)}</p>
        ${search ? `<a class="card-market-link" href="${esc(search.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(title(r))}を${search.label}で探す（新しいタブ）">${search.label}で探す ↗</a>` : ''}</li>`;
    }).join('');
  }
  function tierChip(p) {
    const flags = p.flags.map(f => `<span class="mk-flag">${f}</span>`).join('');
    return `<span class="mk-tier tier-${p.tier || 'none'}">${p.label}</span>${flags}`;
  }

  function renderHeat() {
    const box = document.getElementById('mkHeat'); if (!box) return;
    const width = box.clientWidth, height = isMobile() ? 380 : 460;
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
    return `<div class="mk-priority"><div class="mk-priority-top"><span class="mk-score tier-${p.tier}">${p.score}</span>${tierChip(p)}</div>${bars(p)}</div>`;
  }
  const PARTS = [['liquidity', '売りやすさ'], ['trend', '相場の向き'], ['stability', '価格の安定']];
  const bars = p => `<div class="mk-bars mk-bars-labelled" role="img" aria-label="${PARTS.map(([k, name]) => `${name} ${Math.round(p.parts[k] * 100)}`).join('、')}">${PARTS.map(([k, name]) => `<div title="${name} ${Math.round(p.parts[k] * 100)}/100"><span><i style="width:${Math.round(p.parts[k] * 100)}%"></i></span><small>${name}</small></div>`).join('')}</div>`;
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
      : `<div class="mk-detail-score"><span class="mk-score tier-${p.tier}">${p.score}</span><div>${tierChip(p)}<div class="purchase-small">${esc(p.reason)}</div></div></div>
         <dl class="mk-parts">${PARTS.map(([k, name]) => `<div><dt>${name}</dt><dd><span class="mk-bars"><span><i style="width:${Math.round(p.parts[k] * 100)}%"></i></span></span>${Math.round(p.parts[k] * 100)}</dd></div>`).join('')}</dl>`;
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

  return {init, enrich, render, priorityCell, changeCell, volumeCell, detail, position, label, yenShort, change};
})();
