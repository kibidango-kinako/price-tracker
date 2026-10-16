// BOX/pack calculations always use comparable, per-unit observed transactions.
const boxPurchaseCosts = new Map();
let boxPurchaseFees = {fee:9.3, shipping:240, buyFees:0};
function renderBoxPurchase() {
  const yen = n => n == null ? '—' : '¥' + Math.floor(n).toLocaleString('ja-JP');
  let panel = document.getElementById('boxPurchase');
  if (!panel) {
    panel = document.createElement('dialog'); panel.id='boxPurchase'; panel.className='purchase-detail';
    panel.setAttribute('aria-label','BOX・パックの利益計算');
    document.getElementById('mainView').append(panel);
    panel.addEventListener('cancel', e => {e.preventDefault(); closeBoxPurchase();});
    document.addEventListener('keydown', e => { if(e.key === 'Escape' && panel.open) {e.preventDefault(); closeBoxPurchase();} });
    panel.addEventListener('click', e => {if(e.target===panel) {const r=panel.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeBoxPurchase();} });
    matchMedia('(max-width:767px)').addEventListener('change', e => {if(panel.open){panel.close(); e.matches?panel.showModal():panel.show();}});
  }
  const p = productList.find(x => x.apparel_id === selectedId);
  if (!p) { panel.textContent='計算できる商品がありません。'; return; }
  const escBox = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  panel.innerHTML = `<div class="drawer-heading"><span class="purchase-eyebrow">PROFIT CALCULATOR</span><button class="purchase-secondary" id="closeBoxPurchase" aria-label="BOXの商品詳細を閉じる">閉じる</button></div><h2>${escBox(p.product_name)}</h2><p class="purchase-note">1個あたりの仕入商品代金から利益を計算します。<br>データ生成：${escBox(DATA.generated_at)} ／ 日次集計基準日：${escBox(DATA.today)}（日本時間）</p>
    <div class="purchase-grid"><label>仕入商品代金（1${p.product_type === 'BOX' ? 'BOX' : 'パック'}・円）<input type="number" id="boxCost" min="1" max="100000000" step="1" placeholder="仕入価格を入力" value="${boxPurchaseCosts.get(selectedId) || ''}"></label><label>販売手数料（％）<input id="boxFee" type="number" min="0" max="99.9" step="0.1" value="${boxPurchaseFees.fee}" required></label><label>販売送料・梱包等（円）<input id="boxShipping" type="number" min="0" max="1000000" value="${boxPurchaseFees.shipping}" required></label><label>仕入時費用（円）<input id="boxBuyFees" type="number" min="0" max="1000000" value="${boxPurchaseFees.buyFees}" required></label></div>
    <p class="purchase-note">仕入上限の条件：利益率10％以上・利益額2,000円以上。費用は試算用の初期値です。1個あたりの費用を入力してください。</p><div id="boxPurchaseResult" aria-live="polite"></div><button class="purchase-secondary" id="openBoxChart">この商品のチャートを見る</button><a class="purchase-view-link" href="${escBox(p.url)}" target="_blank" rel="noopener noreferrer">SNKRDUNKの商品ページ ↗</a>`;
  document.getElementById('closeBoxPurchase').onclick=closeBoxPurchase;
  document.getElementById('openBoxChart').onclick=()=>{closeBoxPurchase();document.getElementById('boxChartDisclosure').open=true;renderChart();document.getElementById('boxChartDisclosure').scrollIntoView({behavior:'smooth',block:'start'});};
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

function openBoxPurchase() {
  const y=window.scrollY, panel=document.getElementById('boxPurchase');
  if(!panel.open) {window.innerWidth<768?panel.showModal():panel.show();}
  document.body.classList.add('detail-open');
  document.getElementById('closeBoxPurchase').focus({preventScroll:true});
  window.scrollTo({top:y,behavior:'instant'});
  requestAnimationFrame(()=>window.scrollTo({top:y,behavior:'instant'}));
}
function closeBoxPurchase() {
  document.getElementById('boxPurchase').close(); document.body.classList.remove('detail-open');
  const row=[...document.querySelectorAll('#tblBody tr')].find(el=>el.dataset.id===selectedId);
  row?.querySelector('button')?.focus({preventScroll:true});
}
function initBoxLayout() {
  const main=document.getElementById('mainView'), chart=main.querySelector('.panel');
  const disclosure=document.createElement('details'); disclosure.id='boxChartDisclosure'; disclosure.className='box-chart-disclosure';
  disclosure.innerHTML='<summary>価格推移・商品を選択</summary>'; main.append(disclosure); disclosure.append(chart);
  disclosure.addEventListener('toggle',()=>{if(disclosure.open&&DATA)renderChart();});
  main.insertAdjacentHTML('afterbegin','<section class="purchase-intro"><div><span class="purchase-eyebrow">MARKET / BOX & PACK</span><h2>BOXの仕入も、数字で判断。</h2><p>商品を選び、1個あたりの利益をチェック。</p></div></section>');
  document.getElementById('tblBody').closest('table').classList.add('box-market-table');
  const list=document.getElementById('tblBody').closest('.panel');
  list.querySelector('.tbl-outer').insertAdjacentHTML('beforebegin','<div class="mobile-sort-bar"><label for="boxSortSelect">並替:</label><select id="boxSortSelect" aria-label="BOX一覧の並び順"><option value="count">取引件数</option><option value="avg_price">平均単価</option><option value="chg">前回取引日比</option><option value="units">販売個数</option><option value="product_name">商品名</option><option value="product_type">種別</option><option value="min_price">最小単価</option><option value="max_price">最大単価</option><option value="lowest_price">出品最安</option></select><button class="mobile-sort-btn" id="boxSortDirection">↓ 降順</button></div>');
  document.getElementById('boxSortSelect').onchange=e=>{sortKey=e.target.value;renderTable();};
  document.getElementById('boxSortDirection').onclick=()=>{sortDir*=-1;renderTable();};
  const search=document.getElementById('tableSearch'); search.classList.add('search-input');search.setAttribute('aria-label','BOX・パックの商品名で検索');
}
