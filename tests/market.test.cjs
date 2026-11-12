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
test('liquid, rising, tightly priced cards outrank thin or falling ones',()=>{
 const strong=M.priority(M.metrics([...fill(0,7,11000,8),...fill(7,14,10500,8),...fill(30,37,9500,8)],asOf));
 const thin=M.priority(M.metrics([...fill(0,7,11000,2),...fill(7,14,10500,2),...fill(30,37,9500,2)],asOf));
 const falling=M.priority(M.metrics([...fill(0,7,9000,8),...fill(7,14,10000,8),...fill(30,37,12000,8)],asOf));
 assert.equal(strong.tier,'A'); assert.ok(strong.score>thin.score); assert.ok(thin.score>falling.score);
 assert.ok(falling.flags.includes('下落中')); assert.ok(['C','D'].includes(falling.tier));
});
test('a sudden spike is flagged and never ranks above 様子見',()=>{
 const p=M.priority(M.metrics([...fill(0,7,15000,8),...fill(7,14,10000,8),...fill(30,37,10000,8)],asOf));
 assert.ok(p.flags.includes('急騰')); assert.ok(['C','D'].includes(p.tier));
});
test('wide price dispersion lowers the stability part',()=>{
 const tight=M.priority(M.metrics(fill(0,14,10000,4),asOf)), wide=M.priority(M.metrics(fill(0,14,(d,i)=>7000+i*2000,4),asOf));
 assert.equal(tight.parts.stability,1); assert.ok(wide.parts.stability<.2); assert.ok(tight.score>wide.score);
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
test('a large 30-day rise is flagged without lowering the tier',()=>{
 const p=M.priority(M.metrics([...fill(0,7,13500,8),...fill(7,14,13000,8),...fill(30,37,10000,8)],asOf));
 assert.deepEqual(p.flags,['30日急伸']); assert.equal(p.tier,'A');
});
