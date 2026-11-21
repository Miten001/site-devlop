"use strict";
const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('bulk-tasks.html','utf8'),script=fs.readFileSync('assets/js/bulk-tasks.js','utf8');
const sql=fs.readFileSync('supabase-bulk-tasks.sql','utf8');
assert(sql.includes('enable row level security'));assert(sql.includes('primary key(user_id,request_id)'));
assert(sql.includes('previous.payload<>p_tasks'));assert(sql.includes('pg_advisory_xact_lock'));
assert(sql.includes('for update'));assert(sql.includes('for share'));assert(sql.includes('available<total'));
assert(sql.includes('abs(total-p_expected_total)'));assert(sql.includes('perform public.jobs_post('));
assert(sql.includes('exception when others then'));assert(sql.includes("'ok',false"));
assert(!/create or replace function public.wallet_create_withdraw/.test(sql));
assert(sql.includes('n>10'));assert(sql.includes('from public,anon'));
const wait=()=>new Promise(r=>setTimeout(r,30));
(async()=>{
 const d=new JSDOM(html,{url:'https://example.test/bulk-tasks.html',runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=d.window;
 const calls=[];let attempt=0;
 w.confirm=()=>true;
 w.FF={currentUser:()=>({email:'poster@example.test'}),hasServer:()=>true,normalizeUrl:v=>new URL(v).href,rpc:async(n,a)=>{
  if(n==='jobs_feed')return {config:{minJobReward:0.01,platformFeePct:5},categories:[{key:'other',name:'Other'}]};
  calls.push(JSON.parse(JSON.stringify(a)));attempt++;if(attempt===1)throw Error('Lost response');return {ok:true,published:2,replayed:true};
 }};
 w.eval(script);await wait();const doc=w.document;
 doc.getElementById('bulk-add').click();
 for(const [name,value] of Object.entries({title:'Useful test task',description:'Please provide thoughtful product feedback.',reward:'0.10',slots:'2'})){
  const input=doc.querySelector('[data-field="'+name+'"]');input.value=value;input.dispatchEvent(new w.Event('input'));
 }
 const duplicate=Array.from(doc.querySelectorAll('button')).find(b=>b.textContent==='Duplicate draft');duplicate.click();assert.equal(doc.querySelectorAll('#bulk-editor section').length,2);
 doc.getElementById('bulk-review').click();assert(doc.getElementById('bulk-preview').textContent.includes('$0.42000000'));
 doc.getElementById('bulk-publish').click();await wait();
 assert.equal(calls.length,1);assert(doc.querySelector('#bulk-editor input').disabled);assert.match(doc.getElementById('bulk-notice').textContent,/Outcome not confirmed/);
 doc.getElementById('bulk-publish').click();await wait();assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
 assert.equal(doc.querySelectorAll('#bulk-editor section').length,0);assert.match(doc.getElementById('bulk-notice').textContent,/2 tasks published successfully/);
 const q=w.FFBulk.quote([{reward:0.03,slots:3},{reward:0.01,slots:1}],5);assert.equal(q.total,0.105);
 w.close();
 console.log('Bulk tasks tests passed: duplicate/preview, exact fee estimate, frozen unknown-outcome retry, idempotency payload, success state and static transactional/authorization guards.');
})().catch(e=>{console.error(e);process.exitCode=1;});
