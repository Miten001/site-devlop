"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const script=fs.readFileSync('assets/js/member-country.js','utf8');
const pause=()=>new Promise(r=>setTimeout(r,25));
function page(){return new JSDOM('<details><summary>My country flag</summary><div id="member-country"></div></details>',{url:'https://example.test/dashboard.html',runScripts:'outside-only',virtualConsole:new VirtualConsole()});}
(async()=>{
 for(const country of ['IN',null]){
  const d=page();d.window.FF={hasServer:()=>true,rpc:async()=>({answered:true,country})};d.window.eval(script);d.window.document.dispatchEvent(new d.window.Event('DOMContentLoaded'));await pause();assert(d.window.document.querySelector('details').hidden,'saved country/privacy choice hides full option');d.window.close();
 }
 const d=page();let fail=true;const calls=[];
 d.window.FF={hasServer:()=>true,rpc:async(n,a)=>{calls.push([n,a]);if(n==='member_country_status')return {answered:false};if(fail)throw Error('Save failed');}};
 d.window.eval(script);d.window.document.dispatchEvent(new d.window.Event('DOMContentLoaded'));await pause();
 const doc=d.window.document;assert(!doc.querySelector('details').hidden);
 doc.querySelector('select').value='IN';doc.querySelector('button').click();await pause();assert(!doc.querySelector('details').hidden,'failed save does not hide prompt');
 fail=false;doc.querySelector('button').click();await pause();assert(doc.querySelector('details').hidden);assert(calls.some(([n,a])=>n==='member_country_set'&&a.p_country==='IN'));d.window.close();
 const signup=new JSDOM(fs.readFileSync('signup.html','utf8'),{url:'https://example.test/signup.html',runScripts:'outside-only',virtualConsole:new VirtualConsole()});signup.window.eval(script);signup.window.document.dispatchEvent(new signup.window.Event('DOMContentLoaded'));await pause();
 const select=signup.window.document.getElementById('signup-country');assert(select.required);assert(select.querySelector('option[value="IN"]'));assert(select.querySelector('option[value="private"]'));signup.window.close();
 const auth=new JSDOM('<body></body>',{url:'https://example.test',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
 auth.window.FF_SUPABASE_CONFIG={url:'https://backend.example',anonKey:'public'};let body;
 auth.window.fetch=async(url,opts)=>{body=JSON.parse(opts.body);return {ok:true,text:async()=>JSON.stringify({user:{id:'new-member',created_at:'2026-11-01T00:00:00Z'},session:{access_token:'test',refresh_token:'test',expires_at:9999999999}})};};
 auth.window.eval(fs.readFileSync('assets/js/main.js','utf8'));
 await auth.window.FF.signupMember('New User','new@example.test','password123','IN');assert.equal(body.data.country_code,'IN');auth.window.close();
 const sql=fs.readFileSync('supabase-country-once-signup.sql','utf8');assert(sql.includes('after insert on auth.users'));assert(sql.includes("new.raw_user_meta_data->>'country_code'"));assert(sql.includes('exception when check_violation'));assert(sql.includes('drop not null'));assert(!sql.includes('delete from public.member_countries'));
 console.log('Country once tests passed: saved/private choices stay hidden, retry on save failure, signup country choices and auth metadata, server signup trigger/completion checks.');
})().catch(e=>{console.error(e);process.exitCode=1;});
