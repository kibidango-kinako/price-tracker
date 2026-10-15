// BOX/pack calculations always use comparable, per-unit observed transactions.
const boxPurchaseCosts = new Map();
let boxPurchaseFees = {fee:9.3, shipping:240, buyFees:0};
function renderBoxPurchase() {
  const yen = n => n == null ? '—' : '¥' + Math.floor(n).toLocaleString('ja-JP');
  let panel = document.getElementById('boxPurchase');
  if (!panel) {
    panel = document.createElement('section'); panel.id='boxPurchase'; panel.className='panel';
    document.getElementById('mainView').prepend(panel);
  }
  const p = productList.find(x => x.apparel_id === selectedId);
  if (!p) { panel.textContent='計算できる商品がありません。'; return; }
  const escBox = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  panel.innerHTML = `<h2 style="font-size:20px">BOX・パックの仕入利益を計算</h2><p class="purchase-note">下の商品選択で切り替えます。${escBox(p.product_name)}<br>データ生成：${escBox(DATA.generated_at)} ／ 日次集計基準日：${escBox(DATA.today)}（日本時間）</p>
    <div class="purchase-grid"><label>仕入商品代金（1${p.product_type === 'BOX' ? 'BOX' : 'パック'}・円）<input type="number" id="boxCost" min="1" max="100000000" step="1" placeholder="仕入価格を入力" value="${boxPurchaseCosts.get(selectedId) || ''}"></label><label>販売手数料（％）<input id="boxFee" type="number" min="0" max="99.9" step="0.1" value="${boxPurchaseFees.fee}" required></label><label>販売送料・梱包等（円）<input id="boxShipping" type="number" min="0" max="1000000" value="${boxPurchaseFees.shipping}" required></label><label>仕入時費用（円）<input id="boxBuyFees" type="number" min="0" max="1000000" value="${boxPurchaseFees.buyFees}" required></label></div>
    <p class="purchase-note">仕入上限の条件：利益率10％以上・利益額2,000円以上。費用は試算用の初期値です。1個あたりの費用を入力してください。</p><div id="boxPurchaseResult" aria-live="polite"></div>`;
  const now = Date.now(), from = now-7*86400000;
  const txs = DATA.transactions.filter(t=>t.apparel_id === selectedId && t.unit_price>0 && Purchase.timestamp(t.transaction_date) >= from && Purchase.timestamp(t.transaction_date) <= now);
  const prices = txs.map(t=>t.unit_price).sort((a,b)=>a-b);
  const mid=prices.length>>1;
  const sale = prices.length ? Math.floor(prices.length%2 ? prices[mid] : (prices[mid-1]+prices[mid])/2) : null;
  const last = txs.length ? Math.max(...txs.map(t=>Purchase.timestamp(t.transaction_date))) : null;
  function update() {
    const costEl=document.getElementById('boxCost');
    const fields=['boxFee','boxShipping','boxBuyFees'].map(id=>document.getElementById(id));
    if ([costEl,...fields].some(el=>!el.checkValidity())) { document.getElementById('boxPurchaseResult').textContent='入力値を確認してください。金額は0以上、仕入商品代金は1円以上で入力してください。'; return; }
    const settings={fee:Number(fields[0].value),shipping:Number(fields[1].value),buyFees:Number(fields[2].value)};
    boxPurchaseFees = settings;
    if (costEl.value) boxPurchaseCosts.set(selectedId,Number(costEl.value)); else boxPurchaseCosts.delete(selectedId);
    const c=Purchase.calculate(sale,Number(costEl.value)||null,settings);
    const sufficient=prices.length>=10 && last!==null && now-last<=3*86400000;
    const status = !sufficient ? 'データ不足' : costEl.value ? c.profit>=2000 && c.roi>=10 ? '利益条件達成' : '利益条件未達' : '仕入価格を入力';
    document.getElementById('boxPurchaseResult').innerHTML=`<span class="purchase-badge">${status}</span><div class="purchase-metrics"><div class="purchase-metric">7日成約中央値<strong>${yen(sale)}</strong></div><div class="purchase-metric">仕入上限（商品代金）<strong>${c.limit === 0 ? '条件を満たす価格なし' : yen(c.limit)}</strong></div><div class="purchase-metric">入力価格での利益<strong>${c.profit==null?'—':yen(c.profit)}</strong></div></div><p class="purchase-note">取得 ${prices.length}件 / 7日。${!sufficient?'10件未満または3日以内の成約なしのため、上限は参考値です。':''}トレンド判定は含みません。出品最安値は単位の確認ができないため、計算に使用しません。</p><div style="overflow-x:auto"><table class="purchase-scenarios"><thead><tr><th>販売シナリオ</th><th>販売価格</th><th>利益額</th><th>利益率</th></tr></thead><tbody>${[0,5,10].map(drop=>{const value=sale ? Math.floor(sale*(1-drop/100)):null;const result=Purchase.calculate(value,Number(costEl.value)||null,settings);return `<tr><td>${drop?drop+'％下落':'7日中央値'}</td><td>${yen(value)}</td><td>${yen(result.profit)}</td><td>${result.roi==null?'—':result.roi.toFixed(1)+'％'}</td></tr>`;}).join('')}</tbody></table></div>`;
  }
  [panel.querySelector('#boxCost'),...panel.querySelectorAll('#boxFee,#boxShipping,#boxBuyFees')].forEach(el=>el.addEventListener('input',update));
  update();
}
