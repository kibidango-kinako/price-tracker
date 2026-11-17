/* Market-wide metrics for the PSA10 dashboards: period changes, traded value,
   market gate, search priority and the heatmap layout. Pure functions, no DOM. */
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
  const MIN_RECENT = 3;   // 直近3日の中央値を出すのに必要な成約数
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
    // 直近3日の中央値。7日中央値は下落の途中で遅れるので、売値の前提は低い方を使う
    const last3 = pricesIn(trades, asOf - 3 * DAY, asOf);
    const med3 = last3.length >= MIN_RECENT ? median(last3) : null;
    // 前週の成約件数。収集開始より前にかかる場合は比べない
    const cntPrev7 = asOf - 14 * DAY >= dataStart ? pricesIn(trades, asOf - 14 * DAY, asOf - 7 * DAY).length : null;
    return {
      periods, cnt7: week.length, activeDays7: activeDays, perDay7: week.length / 7,
      med7: mid, med3, saleBase: mid === null ? null : med3 === null ? mid : Math.min(mid, med3),
      gap3: mid > 0 && med3 !== null ? (med3 - mid) / mid * 100 : null,
      cntPrev7, volRatio: cntPrev7 > 0 ? week.length / cntPrev7 : null,
      // 価格のばらつき: 直近7日の成約価格の10〜90％幅 ÷ 中央値
      spread7: prices.length >= 5 && mid > 0 ? (quantile(prices, .9) - quantile(prices, .1)) / mid : null
    };
  }

  /* 市場ゲート。2026年7〜11月のスニダンPSA10成約（ポケモン）では、個別カードの形より市場全体の向きが
     その後2週間の値動きを決めていた。全面安の日は、どの条件のカードも約3割が1割以上下げている。
     level: red＝仕入停止、yellow＝注意、blue＝通常、null＝比べられる商品が少なく判定できない。 */
  const GATE = {minCount:5, minCards:20, band:3, redMedian:-3, redDown:.5, yellowMedian:-1, yellowBreadth:.10};
  const GATE_LABEL = {red:'仕入停止', yellow:'注意', blue:'通常'};
  // 上限（損益分岐点）からどれだけ下を狙うか。上限ちょうどの仕入れは通常時でも3〜5割が赤字だった
  const SAFETY = {blue:.05, yellow:.10};
  function gate(list) {
    const changes = list.filter(m => m && m.cnt7 >= GATE.minCount && m.periods['7'].change !== null).map(m => m.periods['7'].change);
    if (changes.length < GATE.minCards) return {level:null, label:'集計中', median:null, up:null, down:null, count:changes.length};
    const mid = median(changes), up = changes.filter(v => v > GATE.band).length / changes.length, down = changes.filter(v => v < -GATE.band).length / changes.length;
    const level = mid <= GATE.redMedian || down >= GATE.redDown ? 'red' : mid <= GATE.yellowMedian || down - up >= GATE.yellowBreadth ? 'yellow' : 'blue';
    return {level, label:GATE_LABEL[level], median:mid, up, down, count:changes.length};
  }
  // 狙い値。全面安（red）では出さない。判定できない日は注意と同じ幅にする
  function aim(limit, level) {
    if (!(limit > 0) || level === 'red') return null;
    return Math.floor(limit * (1 - (SAFETY[level] ?? SAFETY.yellow)));
  }

  /* 探す優先度。同じ成約データで「その日の売値前提に対し、3〜14日後の成約中央値がどうなったか」を調べ、
     全面安を除く局面で下落が多かった状態を外す。過熱（上位・成約過多）、下落中、急騰直後、直近3日の値崩れ、
     成約件数の半減の5つ。残った商品のうち成約件数が前週の1.25倍以上を「優先して探す」とする。
     相場の向きの強さ・価格の安定・レアリティ・価格帯は、市場全体の動きを引くと差が出なかったため使わない。
     スニダン内の成約だけを見ており、他の販路で上限以下で買える確率は測っていない。 */
  const TIERS = [
    {key:'A', label:'優先して探す'},
    {key:'B', label:'候補'},
    {key:'C', label:'様子見'},
    {key:'D', label:'見送り'}
  ];
  const RULE = {hotCount:50, hotRank:20, fall:-8, surge:15, gap:-4, volMin:.5, volUp:1.25};
  function priority(m, options={}) {
    const minTrades = options.minTrades ?? 10, level = options.gate?.level ?? null, rank = options.rank;
    if (!m || m.cnt7 < minTrades) return {score:null, tier:null, label:'集計中', flags:[], checks:null, reason:m && m.cnt7 ? `直近7日の成約が${m.cnt7}件（設定は${minTrades}件以上）` : '直近7日の成約なし'};
    const c7 = m.periods['7'].change, hotRank = rank > 0 && rank <= RULE.hotRank;
    const checks = [
      {key:'heat', name:'過熱なし', ok:m.cnt7 < RULE.hotCount && !hotRank,
        text:hotRank ? `ランキング${rank}位` : `7日${m.cnt7}件`, flag:'過熱'},
      {key:'move', name:'値動き', ok:c7 !== null && c7 > RULE.fall && c7 < RULE.surge,
        text:c7 === null ? '前週と比べられない' : `7日${c7 > 0 ? '+' : ''}${c7.toFixed(1)}％`, flag:c7 === null ? '変動不明' : c7 <= RULE.fall ? '下落中' : '急騰'},
      {key:'recent', name:'直近3日', ok:m.gap3 === null || m.gap3 > RULE.gap,
        text:m.gap3 === null ? '直近3日の成約が少ない' : `7日中央値比${m.gap3 > 0 ? '+' : ''}${m.gap3.toFixed(1)}％`, flag:'直近安'},
      {key:'volume', name:'成約件数', ok:m.volRatio === null || m.volRatio > RULE.volMin,
        text:m.volRatio === null ? '前週と比べられない' : `前週の${m.volRatio.toFixed(2)}倍`, flag:'成約減'}
    ];
    const failed = checks.filter(c => !c.ok), flags = failed.map(c => c.flag);
    if (level === 'red') flags.unshift('全面安');
    const rising = m.volRatio !== null && m.volRatio >= RULE.volUp;
    // 全面安の日は条件を満たしていても候補にしない（条件を満たすカードも満たさないカードも同じだけ下げた）
    const key = failed.length >= 2 ? 'D' : failed.length === 1 || level === 'red' ? 'C' : rising ? 'A' : 'B';
    const tier = TIERS.find(t => t.key === key);
    // 並び順のための値。区分が先、同じ区分の中は成約件数の伸びが大きい順
    const score = (TIERS.length - 1 - TIERS.indexOf(tier)) * 100 + Math.round(clamp((m.volRatio ?? 0) / 5) * 99);
    const reason = level === 'red' && !failed.length ? '市場が全面安のため仕入停止。条件は満たしています'
      : failed.length ? failed.map(c => `${c.flag}（${c.text}）`).join('、')
      : `4条件を満たす。成約件数は${m.volRatio === null ? '前週と比べられない' : '前週の' + m.volRatio.toFixed(2) + '倍'}`;
    return {score, tier:tier.key, label:tier.label, flags, checks, reason};
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

  const api = {PERIODS, TIERS, GATE, RULE, SAFETY, DAY, median, quantile, metrics, gate, aim, priority, pricePosition, treemap, heatColor};
  if (typeof module !== 'undefined') module.exports = api;
  else root.Market = api;
})(typeof window !== 'undefined' ? window : globalThis);
