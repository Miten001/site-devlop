"use strict";
const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const signup=fs.readFileSync('signup.html','utf8');
const page=fs.readFileSync('assets/js/signup-page.js','utf8');
function make(){return new JSDOM(signup,{url:'https://example.test/signup.html?ref=FF-9F97D63C',runScripts:'outside-only',virtualConsole:new VirtualConsole()});}
let dom=make();dom.window.eval(page);dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
assert.match(dom.window.document.querySelector('[role=alert]').textContent,/could not load/);
assert(dom.window.document.querySelector('button[type=submit]').disabled);
const submit=new dom.window.Event('submit',{cancelable:true});dom.window.document.getElementById('signup-form').dispatchEvent(submit);assert(submit.defaultPrevented);dom.window.close();
dom=make();dom.window.FF={captureRefCode:()=> 'FF-9F97D63C'};dom.window.eval(page);dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
assert.equal(dom.window.document.getElementById('ref-hint-code').textContent,'FF-9F97D63C');assert(!dom.window.document.getElementById('ref-hint').classList.contains('hidden'));dom.window.close();
dom=new JSDOM('<body></body>',{url:'https://example.test',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
const w=dom.window;
w.localStorage.setItem('ff_session',JSON.stringify('new@test.dev'));
w.localStorage.setItem('ff_users',JSON.stringify([{email:'new@test.dev',joined:2000}]));
w.localStorage.setItem('ff_messages',JSON.stringify([
 {id:'old',audience:'all',at:1000}, {id:'boundary',audience:'all',at:2000}, {id:'new',audience:'all',at:3000},
 {id:'dm',audience:'user',to:'new@test.dev',at:1000}, {id:'other',audience:'user',to:'other@test.dev',at:3000}
]));
w.eval(fs.readFileSync('assets/js/main.js','utf8'));
assert.deepEqual(Array.from(w.FF.inboxMessages(),m=>m.id),['new','boundary','dm']);dom.window.close();
const sql=fs.readFileSync('supabase-announcements-signup-cutoff.sql','utf8');
for(const name of ['messages_inbox','messages_mark_read','messages_mark_one_read','bell_feed','bell_mark_read'])assert(sql.includes('function public.'+name+'('));
assert.match(sql,/select created_at from auth.users where id = auth.uid\(\)/);
assert.match(sql,/created_at >= public.member_joined_at\(\)/);
assert.match(sql,/create policy "read own messages"/);
assert(!sql.includes('delete from public.messages'));
console.log('Signup/announcement tests passed: missing-engine fail-safe, referral hint, pre-signup broadcast cutoff, preserved DMs and SQL coverage.');
