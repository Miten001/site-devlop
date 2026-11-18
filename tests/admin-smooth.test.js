"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const html = fs.readFileSync("admin.html", "utf8");
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function between(start, end) { const at=html.indexOf(start); assert(at>=0); return html.slice(at,html.indexOf(end,at)); }
(async () => {
  const requests=[];
  const context={Promise, api(path){return new Promise((resolve,reject)=>requests.push({path,resolve,reject}));}};
  vm.createContext(context);
  vm.runInContext(between('  var readQueue =', '  function show('),context);
  const reads=Array.from({length:7},()=>context.rpc('admin_campaigns_list',{}));
  assert.equal(requests.length,3,'At most three background RPC reads should start together');
  const mutation=context.rpc('wallet_admin_settle',{});
  assert.equal(requests.length,4,'Payment actions must bypass the read queue');
  requests[3].resolve({ok:true}); await mutation;
  requests[0].resolve({}); await tick();
  assert.equal(requests.length,5,'Finishing a read should release exactly one queue slot');
  // Rejected network reads must release their slot too.
  reads[1].catch(()=>{}); requests[1].reject(new Error('offline')); await tick();
  assert.equal(requests.length,6);
  let finished=2;
  while(finished<requests.length){ if(finished!==3) requests[finished].resolve({}); finished++; await tick(); }
  await Promise.allSettled(reads);
  assert.equal(context.activeReads,0);

  const dom=new JSDOM(html);
  const doc=dom.window.document;
  const renderContext={document:doc,$:id=>doc.getElementById(id),listLimits:{pendingPayments:10,paymentHistory:10},lastQueue:null,fmtUsd:n=>'$'+Number(n||0).toFixed(2),fdateMs:()=>'',esc:s=>String(s||''),earnButton:()=>''};
  vm.createContext(renderContext);
  vm.runInContext(between('  function moreControl(', '  function fmtUsd(')+between('  function renderPayments(', '  /* ==================== member modal'),renderContext);
  const rows=Array.from({length:25},(_,i)=>({id:String(i),kind:'deposit',amount:2,status:'approved'}));
  renderContext.renderPayments({pending:rows,history:rows});
  assert.equal(doc.querySelectorAll('#a-pending tr').length,10);
  assert.equal(doc.querySelectorAll('#a-history tr').length,10);
  assert.equal(doc.getElementById('a-dep').textContent,'25','Summary must still count all pending rows');
  doc.querySelector('#more-pendingPayments button').click();
  assert.equal(doc.querySelectorAll('#a-pending tr').length,20);
  assert.equal(doc.getElementById('a-depv').textContent,'$50.00');
  doc.querySelector('#more-pendingPayments button').click();
  assert.equal(doc.querySelectorAll('#a-pending tr').length,25);
  assert(doc.getElementById('more-pendingPayments').classList.contains('hidden'));
  dom.window.close();
  console.log('Admin smoothness tests passed: bounded background reads, immediate mutations, queue recovery, incremental payment rendering and full totals.');
})().catch(error=>{console.error(error);process.exitCode=1;});
