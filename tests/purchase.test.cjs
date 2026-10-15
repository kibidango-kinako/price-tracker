const {test} = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/purchase.js');
const now = Date.parse('2026-10-16T08:00:00+09:00');
const row = {med7:30000, mn7:20000, cnt7:25, last_tx:'2026-10-16 07:00', trendScore:5};
test('fees, shipping, acquisition fees and ROI share the same cost basis', () => {
 const c = P.calculate(30000,20000,{buyFees:1000});
 assert.equal(c.net,26970); assert.equal(c.profit,5970); assert.equal(c.roi,5970/21000*100);
});
test('purchase limit satisfies both targets; the next yen fails a target', () => {
 for (const settings of [{}, {buyFees:1500,targetProfit:8000}, {fee:10,shipping:160,targetRoi:20}]) {
  const s = {...P.defaults,...settings}, c=P.calculate(30000,null,s), at=P.calculate(30000,c.limit,s), next=P.calculate(30000,c.limit+1,s);
  assert.ok(at.profit >= s.targetProfit && at.roi >= s.targetRoi);
  assert.ok(next.profit < s.targetProfit || next.roi < s.targetRoi);
 }
});
test('missing or invalid costs never produce an actual profit',()=>{
 for(const n of [null,undefined,0,-10,NaN,Infinity]) assert.equal(P.calculate(30000,n,{}).profit,null);
 assert.equal(P.calculate(null,100,{}).limit,null);
});
test('stale or absent trades cannot become candidates despite an upward trend',()=>{
 for(const patch of [{last_tx:'2026-10-01 00:00'},{cnt7:0,med7:null},{cnt7:1},{last_tx:null}]) {
  const a=P.assess({...row,...patch},{},1000,now); assert.equal(a.eligible,false);assert.equal(a.label,'データ不足');
 }
});
test('historic low is a reference candidate; only an entered price can meet conditions',()=>{
 assert.equal(P.assess(row,{},null,now).label,'参考候補');
 assert.equal(P.assess(row,{},20000,now).label,'条件達成');
 assert.equal(P.assess(row,{},30000,now).label,'見送り');
 assert.equal(P.assess(row,{budget:19000},20000,now).eligible,false);
 assert.equal(P.assess({...row,trendScore:1},{},20000,now).eligible,false);
});
test('Japan timestamps do not depend on the viewer timezone',()=>{
 assert.equal(P.timestamp('2026-10-16 08:00'), now);
 assert.equal(P.timestamp('2026-10-15T23:00:00Z'),now);
});
test('lower selling prices reduce profit by their fee-adjusted amount',()=>{
 const a=P.calculate(30000,20000,{}), b=P.calculate(27000,20000,{});
 assert.ok(Math.abs((a.profit-b.profit)-2721)<1e-6);
});
test('ambiguous product variants cannot become candidates',()=>{
 const a=P.assess({...row,identityUncertain:true},{},1000,now);
 assert.equal(a.label,'データ不足'); assert.equal(a.eligible,false);
});
test('budget includes acquisition fees',()=>{
 assert.equal(P.assess(row,{budget:20000,buyFees:1000},19500,now).eligible,false);
});
