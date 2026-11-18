const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('support.html', 'utf8');
const script = fs.readFileSync('assets/js/support-tickets.js', 'utf8');
const sql = fs.readFileSync('supabase-support-tickets.sql', 'utf8');
const wait = () => new Promise(resolve => setTimeout(resolve, 20));
const ticket = { id:'test-ticket', subject:'<img src=x onerror=alert(1)>', status:'open', category:'deposit', created_at:'2026-11-16T10:00:00Z', updated_at:'2026-11-16T10:00:00Z' };
async function setup({ user=true, server=true, staff=false, status='open', error=false, adminMode=false, adminSession=true }={}) {
 const dom = new JSDOM(html, { runScripts:'outside-only', url:'https://example.com/support.html'+(adminMode?'?admin=1':'') });
 const calls=[]; const current={...ticket,status};
 dom.window.FF={currentUser:()=>user?{email:'member@test.dev'}:null, hasServer:()=>server, rpc:async(name,args)=>{
  calls.push([name,args]);
  if(error) throw new Error('Connection failed');
  if(name==='support_list') return {isAdmin:staff,tickets:[current]};
  if(name==='support_thread') return {ticket:current,replies:[{body:'<script>unsafe</script>',is_staff:true,created_at:ticket.created_at}]};
  if(name==='support_create') return ticket.id;
  return {ok:true};
 }};
 if(adminMode) {
  if(adminSession) dom.window.localStorage.setItem('ff_admin_session',JSON.stringify({access_token:'test-admin-token'}));
  dom.window.FF_SUPABASE_CONFIG={url:'https://example.com',anonKey:'test-key'};
  const memberRpc=dom.window.FF.rpc;
  dom.window.fetch=async(url,options)=>{
   assert.equal(options.headers.Authorization,'Bearer test-admin-token');
   const data=await memberRpc(url.split('/').pop(),JSON.parse(options.body));
   return {ok:true,json:async()=>data};
  };
 }
 dom.window.eval(script); await wait(); return {dom,calls,d:dom.window.document};
}
(async()=>{
 let ctx=await setup({user:false}); assert.match(ctx.d.getElementById('support-notice').textContent,/sign in/i); assert.equal(ctx.calls.length,0); ctx.dom.window.close();
 ctx=await setup({server:false}); assert.match(ctx.d.getElementById('support-notice').textContent,/offline/); assert.equal(ctx.calls.length,0); ctx.dom.window.close();
 ctx=await setup(); assert.equal(ctx.d.querySelectorAll('.ticket-item').length,1); assert.equal(ctx.d.querySelectorAll('#ticket-list img').length,0);
 ctx.d.querySelector('.ticket-item').click(); await wait();
 assert.match(ctx.d.getElementById('ticket-replies').textContent,/<script>unsafe/); assert.equal(ctx.d.querySelectorAll('#ticket-replies script').length,0);
 assert(ctx.d.getElementById('staff-controls').classList.contains('hidden'));
 ctx.d.getElementById('reply-body').value='Please check the transaction';
 ctx.d.getElementById('support-reply').dispatchEvent(new ctx.dom.window.Event('submit',{cancelable:true})); await wait();
 assert(ctx.calls.some(([name,args])=>name==='support_respond' && args.p_status===null));
 ctx.d.getElementById('ticket-subject').value='Deposit missing'; ctx.d.getElementById('ticket-body').value='Transaction reference: abc';
 ctx.d.getElementById('support-create').dispatchEvent(new ctx.dom.window.Event('submit',{cancelable:true})); await wait();
 assert(ctx.calls.some(([name,args])=>name==='support_create' && args.p_subject==='Deposit missing')); ctx.dom.window.close();
 ctx=await setup({staff:true}); ctx.d.querySelector('.ticket-item').click(); await wait(); assert(!ctx.d.getElementById('staff-controls').classList.contains('hidden'));
 ctx.d.getElementById('reply-status').value='resolved'; ctx.d.getElementById('support-reply').dispatchEvent(new ctx.dom.window.Event('submit',{cancelable:true})); await wait();
 assert(ctx.calls.some(([name,args])=>name==='support_respond' && args.p_status==='resolved')); ctx.dom.window.close();
 ctx=await setup({status:'resolved'}); ctx.d.querySelector('.ticket-item').click(); await wait(); assert(ctx.d.getElementById('support-reply').classList.contains('hidden')); ctx.dom.window.close();
 ctx=await setup({error:true}); assert.match(ctx.d.getElementById('support-notice').textContent,/Connection failed/); assert(ctx.d.getElementById('support-app').classList.contains('hidden')); ctx.dom.window.close();
 ctx=await setup({adminMode:true,staff:true,user:false}); assert.match(ctx.d.getElementById('ticket-list-title').textContent,/All support/); assert(ctx.d.getElementById('new-ticket').closest('section').classList.contains('hidden')); ctx.dom.window.close();
 ctx=await setup({adminMode:true,adminSession:false,user:false}); assert.equal(ctx.calls.length,0); assert.match(ctx.d.getElementById('support-notice').textContent,/admin console/); ctx.dom.window.close();
 ctx=await setup({adminMode:true,staff:false}); assert.match(ctx.d.getElementById('support-notice').textContent,/Admin access required/); assert(ctx.d.getElementById('support-app').classList.contains('hidden')); ctx.dom.window.close();
 assert.match(sql,/enable row level security/g); assert.match(sql,/user_id\s*=\s*auth.uid\(\)/); assert.match(sql,/for update/i); assert.match(sql,/Only admins can change ticket status/); assert.match(sql,/pg_advisory_xact_lock/); assert.match(sql,/from public, anon/); assert.match(sql,/grant execute[\s\S]*to authenticated/);
 for(const page of ['dashboard','wallet','earn','tasks','quests','rewards','refer','admin']) assert.match(fs.readFileSync(page+'.html','utf8'),/href="support.html(?:\?admin=1)?"/);
 console.log('Support tests passed: auth/offline guards, member create/reply, admin status, resolved tickets, escaping, errors, navigation and SQL guards.');
})().catch(error=>{ console.error(error); process.exitCode=1; });
