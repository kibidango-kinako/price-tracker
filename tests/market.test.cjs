const test=require('node:test'), assert=require('node:assert/strict');
const M=require('../assets/market.js');
const D=M.DAY, asOf=Date.parse('2026-11-12T01:00:00+09:00');
// n件/日・価格 price の成約を、asOf から from〜to 日前の範囲に並べる
const fill=(from,to,price,perDay=3)=>{const out=[];for(let d=from;d<to;d++)for(let i=0;i<perDay;i++)out.push({t:asOf-d*D-(i+1)*3600000,p:typeof price==='function'?price(d,i):price});return out;};
test('period change compares the latest window with the window one period earlier',()=>{
 const m=M.metrics([...fill(0,7,11000),...fill(7,14,10000),...fill(30,37,8800)],asOf);
 assert.equal(m.periods['7'].change,10); assert.equal(m.periods['7'].changeYen,1000);
 assert.equal(m.periods['30'].change,25);
 assert.equal(m.periods['90'].change,null);
 assert.equal(m.cnt7,21); assert.equal(m.activeDays7,7);
});
test('traded value sums the period and the one before it',()=>{
 const m=M.metrics([...fill(0,7,10000,2),...fill(7,14,10000,1)],asOf);
 assert.equal(m.periods['7'].volume,140000); assert.equal(m.periods['7'].count,14);
 assert.equal(m.periods['7'].volumePrev,70000);
});
test('windows that reach before the first collected trade are withheld, not treated as zero',()=>{
 const trades=[...fill(0,7,10000),...fill(30,37,10000)], start=asOf-40*D;
 const m=M.metrics(trades,asOf,start);
 assert.equal(m.periods['30'].change,0);
 assert.equal(m.periods['30'].volumePrev,null);
 assert.equal(m.periods['7'].volumePrev,0);
 assert.equal(M.metrics(trades,asOf,asOf-33*D).periods['30'].change,null);
});
test('a single trade is not enough for a change',()=>{
 const m=M.metrics([{t:asOf-3600000,p:10000},...fill(7,14,9000)],asOf);
 assert.equal(m.periods['7'].change,null); assert.equal(m.spread7,null);
});
test('priority is withheld below the minimum trade count',()=>{
 const p=M.priority(M.metrics(fill(0,3,10000,1),asOf));
 assert.equal(p.score,null); assert.equal(p.tier,null); assert.equal(p.label,'集計中');
 assert.notEqual(M.priority(M.metrics(fill(0,3,10000,1),asOf),{minTrades:3}).score,null);
});
test('sale basis is the lower of the 7-day and 3-day medians',()=>{
 const falling=M.metrics([...fill(0,3,9000),...fill(3,7,10000),...fill(7,14,10000)],asOf);
 assert.equal(falling.med7,10000); assert.equal(falling.med3,9000); assert.equal(falling.saleBase,9000); assert.equal(falling.gap3,-10);
 const rising=M.metrics([...fill(0,3,11000),...fill(3,7,10000),...fill(7,14,10000)],asOf);
 assert.equal(rising.saleBase,10000); assert.equal(rising.gap3,10);
 // 直近3日が3件未満なら7日中央値をそのまま使う
 const thin=M.metrics([{t:asOf-3600000,p:8000},...fill(3,7,10000)],asOf);
 assert.equal(thin.med3,null); assert.equal(thin.gap3,null); assert.equal(thin.saleBase,10000);
 assert.equal(M.metrics([],asOf).saleBase,null);
});
test('trade count is compared with the previous week, unless that week predates collection',()=>{
 const m=M.metrics([...fill(0,7,10000,3),...fill(7,14,10000,2)],asOf);
 assert.equal(m.cntPrev7,14); assert.equal(m.volRatio,1.5);
 assert.equal(M.metrics(fill(0,7,10000,3),asOf).volRatio,null);
 const early=M.metrics([...fill(0,7,10000,3),...fill(7,10,10000,2)],asOf,asOf-10*D);
 assert.equal(early.cntPrev7,null); assert.equal(early.volRatio,null);
});
// 前週 prev 円 → 今週 now 円、今週 perDay 件／日・前週 prevPerDay 件／日
const card=(now,prev,perDay=3,prevPerDay=3)=>M.metrics([...fill(0,7,now,perDay),...fill(7,14,prev,prevPerDay)],asOf);
const blue={level:'blue'}, tierOf=(m,o={})=>M.priority(m,{gate:blue,...o}).tier;
test('market gate turns red on a broad decline and yellow on a weak market',()=>{
 const cards=(n,now)=>Array.from({length:n},()=>card(now,10000));
 assert.equal(M.gate(cards(30,10000)).level,'blue');
 const red=M.gate([...cards(20,9600),...cards(10,10000)]);
 assert.equal(red.level,'red'); assert.equal(red.label,'仕入停止'); assert.equal(red.median,-4); assert.ok(Math.abs(red.down-2/3)<1e-9);
 // 中央値は−3％より上でも、3％超下げた商品が半数なら仕入停止
 const half=M.gate([...cards(15,9690),...cards(15,10100)]);
 assert.ok(half.median>-3); assert.equal(half.down,.5); assert.equal(half.level,'red');
 assert.equal(M.gate([...cards(20,9850),...cards(10,10000)]).level,'yellow');
 // 中央値は横ばいでも、下げた商品が上げた商品より10ポイント以上多ければ注意
 assert.equal(M.gate([...cards(6,9000),...cards(2,11000),...cards(22,10000)]).level,'yellow');
 assert.equal(M.gate([...cards(15,11000),...cards(15,10000)]).level,'blue');
});
test('market gate is withheld when too few cards can be compared',()=>{
 const g=M.gate(Array.from({length:19},()=>card(9000,10000)));
 assert.equal(g.level,null); assert.equal(g.count,19);
 // 7日5件未満・前週と比べられない商品は数えない
 assert.equal(M.gate([...Array.from({length:19},()=>card(9000,10000)),M.metrics(fill(0,7,9000,3),asOf),M.metrics([...fill(0,2,9000,2),...fill(7,14,10000)],asOf)]).count,19);
});
test('cards clear of every falling pattern are candidates; rising trade count ranks first',()=>{
 const steady=M.priority(card(10000,10000),{gate:blue}), busy=M.priority(card(10000,10000,5,3),{gate:blue});
 assert.equal(steady.tier,'B'); assert.equal(steady.label,'候補'); assert.deepEqual(steady.flags,[]);
 assert.equal(busy.tier,'A'); assert.equal(busy.label,'優先して探す'); assert.ok(busy.score>steady.score);
 assert.equal(tierOf(card(10000,10000,5,4)),'A');          // ちょうど1.25倍
 assert.ok(steady.checks.every(c=>c.ok)); assert.equal(steady.checks.length,4);
});
test('each falling pattern alone moves a card to 様子見, two or more to 見送り',()=>{
 const flagsOf=(m,o={})=>M.priority(m,{gate:blue,...o}).flags;
 assert.deepEqual(flagsOf(card(9200,10000)),['下落中']);      // 7日 −8％
 assert.equal(tierOf(card(9210,10000)),'B');
 assert.deepEqual(flagsOf(card(11500,10000)),['急騰']);       // 7日 +15％
 assert.equal(tierOf(card(11490,10000)),'B');
 assert.deepEqual(flagsOf(card(10000,10000,8,8)),['過熱']);   // 7日56件
 assert.deepEqual(flagsOf(card(10000,10000),{rank:20}),['過熱']);
 assert.equal(tierOf(card(10000,10000),{rank:21}),'B');
 assert.equal(tierOf(card(10000,10000),{rank:0}),'B');        // 順位不明は過熱としない
 assert.deepEqual(flagsOf(card(10000,10000,2,4)),['成約減']); // 前週の半分
 const dip=M.metrics([...fill(0,3,9500),...fill(3,7,10000),...fill(7,14,10000)],asOf);
 assert.deepEqual(flagsOf(dip),['直近安']); assert.equal(tierOf(dip),'C');
 for(const m of [card(9200,10000),card(11500,10000),card(10000,10000,8,8),card(10000,10000,2,4)]) assert.equal(tierOf(m),'C');
 const both=M.priority(card(9000,10000,2,4),{gate:blue});
 assert.equal(both.tier,'D'); assert.deepEqual(both.flags,['下落中','成約減']); assert.ok(both.score<M.priority(card(9200,10000),{gate:blue}).score);
});
test('a card that cannot be compared with last week is not a candidate',()=>{
 const p=M.priority(M.metrics(fill(0,7,10000),asOf),{gate:blue});
 assert.equal(p.tier,'C'); assert.deepEqual(p.flags,['変動不明']);
});
test('no card is a candidate while the market gate is red',()=>{
 const red={level:'red'}, p=M.priority(card(10000,10000,5,3),{gate:red});
 assert.equal(p.tier,'C'); assert.deepEqual(p.flags,['全面安']); assert.match(p.reason,/仕入停止/);
 assert.equal(M.priority(card(9000,10000,2,4),{gate:red}).tier,'D');
 assert.equal(M.priority(card(10000,10000,5,3),{gate:{level:'yellow'}}).tier,'A');
 assert.equal(M.priority(card(10000,10000,5,3)).tier,'A');   // 判定できない日は候補を止めない
});
test('aim price sits below the breakeven limit by the gate margin',()=>{
 assert.equal(M.aim(20000,'blue'),19000); assert.equal(M.aim(20000,'yellow'),18000);
 assert.equal(M.aim(20000,null),18000); assert.equal(M.aim(20000,'red'),null);
 assert.equal(M.aim(0,'blue'),null); assert.equal(M.aim(null,'blue'),null); assert.equal(M.aim(18403,'blue'),17482);
});
test('price position reports the share of recent trades at or below the cost',()=>{
 const trades=fill(0,10,(d,i)=>9000+i*1000,3);
 const pos=M.pricePosition(trades,asOf,9000); assert.equal(pos.count,30); assert.equal(pos.low,9000); assert.ok(Math.abs(pos.share-100/3)<1e-9);
 assert.equal(M.pricePosition(trades,asOf,8000).share,0);
 assert.equal(M.pricePosition(trades.slice(0,4),asOf,9000),null);
 assert.equal(M.pricePosition(trades,asOf,0),null);
});
test('treemap fills the box in proportion to value without overlap',()=>{
 const items=[6,6,4,3,2,2,1,0,-1].map((value,id)=>({value,id}));
 const nodes=M.treemap(items,600,400);
 assert.equal(nodes.length,7);
 const total=24; nodes.forEach(n=>{assert.ok(Math.abs(n.w*n.h-n.item.value/total*240000)<1e-6); assert.ok(n.x>=-1e-9&&n.y>=-1e-9&&n.x+n.w<=600+1e-6&&n.y+n.h<=400+1e-6);});
 for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j];const ox=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x),oy=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);assert.ok(ox<1e-6||oy<1e-6);}
 assert.deepEqual(M.treemap([],600,400),[]); assert.deepEqual(M.treemap(items,0,400),[]);
});
test('heat colour separates rising, falling, flat and missing',()=>{
 assert.equal(M.heatColor(null),null); assert.equal(M.heatColor(NaN),null);
 assert.equal(M.heatColor(0.2),'#3a414c');
 const g=M.heatColor(8).match(/\d+/g).map(Number), r=M.heatColor(-8).match(/\d+/g).map(Number);
 assert.ok(g[1]>g[0]); assert.ok(r[0]>r[1]);
 assert.equal(M.heatColor(30),M.heatColor(10));
});
