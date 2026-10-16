/* Shared calculation rules. Rates are editable assumptions, not fetched fee schedules. */
(function(root) {
  'use strict';
  const defaults = {venue:'snkr', fee:9.3, shipping:240, extra:0, buyFees:0, targetRoi:10, targetProfit:2000, minTrades:10, maxAge:3, budget:0};
  function timestamp(value) {
    if (!value) return NaN;
    const s = String(value).replace(' ', 'T');
    return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(s) ? s : s + (s.length === 10 ? 'T00:00:00+09:00' : '+09:00'));
  }
  function calculate(sale, cost, settings) {
    const s = {...defaults, ...settings};
    if (!(sale > 0) || !Number.isFinite(sale)) return {net:null, limit:null, profit:null, roi:null};
    const net = sale * (1 - s.fee / 100) - s.shipping - s.extra;
    const limit = Math.max(0, Math.floor(Math.min(net / (1 + s.targetRoi / 100), net - s.targetProfit) - s.buyFees));
    const total = cost > 0 && Number.isFinite(cost) ? cost + s.buyFees : null;
    const profit = total === null ? null : net - total;
    return {net, limit, profit, roi:total === null ? null : profit / total * 100};
  }
  function assess(row, settings, cost, now = Date.now()) {
    const s = {...defaults, ...settings};
    const age = (now - timestamp(row.last_tx)) / 86400000;
    const reasons = [];
    if (row.identityUncertain) reasons.push('同名・同型番の商品があります。言語・仕様を商品ページで確認してください');
    if (!(row.med7 > 0) || row.cnt7 === 0) reasons.push('直近7日の成約なし');
    else if (row.cnt7 < s.minTrades) reasons.push('取引件数が設定未満');
    if (!Number.isFinite(age) || age < -1 / 24 || age > s.maxAge) reasons.push('最終取引が古い・日時不明');
    const calc = calculate(row.med7, cost, s);
    const ref = calculate(row.med7, row.mn7, s);
    const hasCost = cost > 0;
    const basis = hasCost ? calc : ref;
    const withinBudget = !s.budget || (hasCost ? cost : row.mn7) + s.buyFees <= s.budget;
    const profitable = basis.profit !== null && basis.profit + 1e-7 >= s.targetProfit && basis.roi + 1e-7 >= s.targetRoi;
    const trendOK = row.trendScore >= 3;
    const eligible = !reasons.length && profitable && withinBudget && trendOK;
    let label = reasons.length ? 'データ不足' : eligible ? (hasCost ? '条件達成' : '参考候補') : hasCost ? '見送り' : '価格待ち';
    if (!reasons.length) {
      if (!withinBudget) reasons.push('予算超過');
      if (!profitable) reasons.push('目標利益に未達');
      if (!trendOK) reasons.push('下落傾向・トレンド不明');
      if (!hasCost) reasons.push('過去安値での試算。実際の仕入価格を入力してください');
    }
    const confidence = row.identityUncertain ? '低' : row.cnt7 >= 20 && age <= 1 ? '高' : row.cnt7 >= s.minTrades && age <= s.maxAge ? '中' : '低';
    return {...calc, reference:ref, age, eligible, label, reasons, confidence, hasCost};
  }
  // Missing values always follow valid values, regardless of sort direction.
  function compareRows(a,b,key,direction=-1) {
    const x=a[key], y=b[key];
    const missing=v=>v==null || (typeof v==='number' && !Number.isFinite(v)) || v==='' || (key==='rank' && typeof v==='number' && v<=0);
    if(missing(x) && missing(y)) return 0;
    if(missing(x)) return 1;
    if(missing(y)) return -1;
    return direction * (typeof x==='string' || typeof y==='string'
      ? String(x).localeCompare(String(y),'ja',{numeric:true}) : x-y);
  }
  const api = {defaults, timestamp, calculate, assess, compareRows};
  if (typeof module !== 'undefined') module.exports = api;
  else root.Purchase = api;
})(typeof window !== 'undefined' ? window : globalThis);
