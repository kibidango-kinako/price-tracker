/* Market-wide metrics for the PSA10 dashboards: period changes, traded value,
   search priority and the heatmap layout. Pure functions, no DOM. */
(function(root) {
  'use strict';
  const DAY = 86400000;
  // window = 比較に使う成約の幅。30日・90日は「直近7日」と「その期間前の7日」の中央値を比べる。
  const PERIODS = [
    {key:'1', label:'1日', days:1, window:1},
    {key:'7', label:'7日', days:7, window:7},
    {key:'30', label:'30日', days:30, window:7},
    {key:'90', label:'90日', days:90, window:7}
  ];
  const MIN_SAMPLE = 2;   // 中央値を出すのに必要な成約数。満たさない期間は「集計中」
  const clamp = (v, lo=0, hi=1) => Math.min(hi, Math.max(lo, v));

  function median(values) {
    if (!values.length) return null;
    const s = [...values].sort((a,b) => a-b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2;
  }
  function quantile(values, q) {
    if (!values.length) return null;
    const s = [...values].sort((a,b) => a-b), pos = (s.length - 1) * q, lo = Math.floor(pos);
    return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
  }
  // trades: [{t: epoch ms, p: price}]. 区間は (from, to]。
  const pricesIn = (trades, from, to) => trades.filter(x => x.t > from && x.t <= to).map(x => x.p);

  /* asOf はデータ内の最新成約時刻。閲覧時刻を基準にすると、収集から時間が経つほど
     直近の区間だけ短くなり、成約額の前期間比が実際より悪く見えるため。 */
  function metrics(trades, asOf, dataStart=-Infinity) {
    const periods = {};
    PERIODS.forEach(p => {
      const cur = pricesIn(trades, asOf - p.window * DAY, asOf);
      const past = pricesIn(trades, asOf - (p.days + p.window) * DAY, asOf - p.days * DAY);
      const now = cur.length >= MIN_SAMPLE ? median(cur) : null;
      // 収集開始より前にかかる区間は比較しない（成約が無いのではなく、データが無い）
      const then = past.length >= MIN_SAMPLE && asOf - (p.days + p.window) * DAY >= dataStart ? median(past) : null;
      const span = pricesIn(trades, asOf - p.days * DAY, asOf);
      const prevSpan = pricesIn(trades, asOf - 2 * p.days * DAY, asOf - p.days * DAY);
      const sum = a => a.reduce((x,y) => x + y, 0);
      periods[p.key] = {
        change: now !== null && then > 0 ? (now - then) / then * 100 : null,
        changeYen: now !== null && then > 0 ? now - then : null,
        volume: sum(span), count: span.length,
        volumePrev: asOf - 2 * p.days * DAY >= dataStart ? sum(prevSpan) : null
      };
    });
    const week = trades.filter(x => x.t > asOf - 7 * DAY && x.t <= asOf);
    const prices = week.map(x => x.p);
    const mid = median(prices);
    const activeDays = new Set(week.map(x => Math.floor((asOf - x.t) / DAY))).size;
    return {
      periods, cnt7: week.length, activeDays7: activeDays, perDay7: week.length / 7,
      // 価格のばらつき: 直近7日の成約価格の10〜90％幅 ÷ 中央値
      spread7: prices.length >= 5 && mid > 0 ? (quantile(prices, .9) - quantile(prices, .1)) / mid : null
    };
  }

  /* 探す優先度（0〜100）。スニダン内の成約価格は中央値の近くに集まるため「安値で拾える余地」は
     測れない。代わりに「仕入上限以下で他の販路から買えたとして、売り抜けやすいか」を
     売りやすさ40・相場の向き35・価格の安定25で表す。将来の値動きを示すものではない。 */
  const TIERS = [
    {key:'A', min:78, label:'優先して探す'},
    {key:'B', min:65, label:'候補'},
    {key:'C', min:50, label:'様子見'},
    {key:'D', min:0, label:'見送り'}
  ];
  function priority(m, options={}) {
    const minTrades = options.minTrades ?? 10;
    if (!m || m.cnt7 < minTrades) return {score:null, tier:null, label:'集計中', flags:[], parts:null, reason:m && m.cnt7 ? `直近7日の成約が${m.cnt7}件（設定は${minTrades}件以上）` : '直近7日の成約なし'};
    const c7 = m.periods['7'].change, c30 = m.periods['30'].change;
    const liquidity = .75 * clamp(Math.log1p(m.cnt7) / Math.log1p(70)) + .25 * m.activeDays7 / 7;
    const g7 = c7 === null ? null : clamp(.5 + c7 / 20), g30 = c30 === null ? null : clamp(.5 + c30 / 40);
    let trend = g7 !== null && g30 !== null ? .55 * g7 + .45 * g30 : g7 ?? g30 ?? .5;
    const flags = [];
    if (c7 !== null && c7 >= 20) { flags.push('急騰'); trend = Math.min(trend, .5); }
    if ((c7 !== null && c7 <= -8) || (c30 !== null && c30 <= -20)) flags.push('下落中');
    // 1か月で大きく上がった直後。順位は下げないが、売値の前提が直近の高値である点を示す
    if (c30 !== null && c30 >= 30 && !flags.includes('急騰')) flags.push('30日急伸');
    if (c7 === null && c30 === null) flags.push('変動不明');
    const stability = m.spread7 === null ? .5 : clamp(1 - (m.spread7 - .04) / .2);
    const score = Math.round(100 * (.40 * liquidity + .35 * trend + .25 * stability));
    let tier = TIERS.find(t => score >= t.min);
    // 下落中・急騰直後は売値の前提が崩れやすいので、点数が高くても「様子見」止まりにする
    if (flags.includes('下落中') || flags.includes('急騰')) tier = TIERS[Math.max(2, TIERS.indexOf(tier))];
    const pct = v => v === null ? '集計中' : (v > 0 ? '+' : '') + v.toFixed(1) + '％';
    const reason = [
      `7日で${m.cnt7}件（成約のあった日 ${m.activeDays7}/7）`,
      `7日${pct(c7)}／30日${pct(c30)}`,
      m.spread7 === null ? 'ばらつき不明' : `価格幅${(m.spread7 * 100).toFixed(1)}％`
    ].join('、');
    return {score, tier:tier.key, label:tier.label, flags, parts:{liquidity, trend, stability}, reason};
  }

  // 入力した仕入価格が、直近の成約の中でどの位置にあるか（その価格以下で成立した割合）
  function pricePosition(trades, asOf, cost, days=30) {
    const prices = pricesIn(trades, asOf - days * DAY, asOf);
    if (!(cost > 0) || prices.length < 5) return null;
    return {count:prices.length, share:prices.filter(p => p <= cost).length / prices.length * 100, low:Math.min(...prices), days};
  }

  /* Squarified treemap (Bruls, Huizing, van Wijk). items: [{value, ...}] を大きい順に並べ、
     {x, y, w, h, item} を返す。value が 0 以下のものは描かない。 */
  function treemap(items, width, height) {
    const list = items.filter(i => i.value > 0).sort((a,b) => b.value - a.value);
    const total = list.reduce((s,i) => s + i.value, 0);
    if (!list.length || !(width > 0) || !(height > 0)) return [];
    const scale = width * height / total;
    const nodes = list.map(item => ({item, area:item.value * scale}));
    const out = [];
    let x = 0, y = 0, w = width, h = height, row = [], i = 0;
    const worst = (r, side) => {
      const s = r.reduce((a,n) => a + n.area, 0), max = Math.max(...r.map(n => n.area)), min = Math.min(...r.map(n => n.area));
      return Math.max(side * side * max / (s * s), s * s / (side * side * min));
    };
    const layout = r => {
      const s = r.reduce((a,n) => a + n.area, 0);
      if (w >= h) { const cw = s / h; let cy = y; r.forEach(n => { const ch = n.area / cw; out.push({x, y:cy, w:cw, h:ch, item:n.item}); cy += ch; }); x += cw; w -= cw; }
      else { const ch = s / w; let cx = x; r.forEach(n => { const cw = n.area / ch; out.push({x:cx, y, w:cw, h:ch, item:n.item}); cx += cw; }); y += ch; h -= ch; }
    };
    while (i < nodes.length) {
      const side = Math.min(w, h), next = nodes[i];
      if (!row.length || worst([...row, next], side) <= worst(row, side)) { row.push(next); i++; }
      else { layout(row); row = []; }
    }
    if (row.length) layout(row);
    return out;
  }

  // 変動率を色に。±10％で最も濃くなる。null は「集計中」。
  function heatColor(change) {
    if (change === null || change === undefined || !Number.isFinite(change)) return null;
    if (Math.abs(change) < .5) return '#3a414c';
    const k = clamp(Math.abs(change) / 10, .18, 1);
    const mix = (a, b) => Math.round(a + (b - a) * k);
    const base = [42, 47, 56], to = change > 0 ? [31, 122, 88] : [158, 56, 72];
    return `rgb(${mix(base[0], to[0])},${mix(base[1], to[1])},${mix(base[2], to[2])})`;
  }

  const api = {PERIODS, TIERS, DAY, median, quantile, metrics, priority, pricePosition, treemap, heatColor};
  if (typeof module !== 'undefined') module.exports = api;
  else root.Market = api;
})(typeof window !== 'undefined' ? window : globalThis);
