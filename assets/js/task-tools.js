/* Server-backed task trust tools. No fabricated offline mutations. */
(function () {
 'use strict';
 document.addEventListener('DOMContentLoaded', () => {
  const root=document.getElementById('task-tools'); if(!root)return;
  const FF=window.FF; let state; const notice=document.getElementById('tools-notice');
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;};
  const fail=e=>{notice.textContent=e.message||'Request failed. Please try again.';};
  async function rpc(name,args){
   if(!new URLSearchParams(location.search).has('admin')) return FF.rpc(name,args);
   let session;try{session=JSON.parse(localStorage.getItem('ff_admin_session')||'null');}catch(_){}
   const cfg=window.FF_SUPABASE_CONFIG;
   if(!session?.access_token||!cfg)throw Error('Sign in through the admin console first.');
   const response=await fetch(cfg.url.replace(/\/+$/,'')+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:cfg.anonKey,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify(args||{})});
   const data=await response.json();if(!response.ok)throw Error(data.message||'Request failed');return data;
  }
  function button(label,action,id,text,stars){const b=el('button',label);b.className='btn btn-ghost btn-sm';b.onclick=async()=>{
   let input=text;if(input===null){input=prompt('Enter a reason (10–2000 characters):');if(input===null)return;if(input.trim().length<10||input.length>2000){fail(Error('Use 10–2000 characters.'));return;}}
   b.disabled=true;try{await rpc('task_tools_action',{p_action:action,p_id:id,p_text:input||'',p_stars:stars||null});await load();notice.textContent='Saved successfully.';}catch(e){fail(e);}finally{b.disabled=false;}
  };return b;}
  function section(title){const box=el('section');box.className='panel';box.append(el('h2',title));root.append(box);return box;}
  function row(box,title,text){const n=el('article');n.append(el('h3',title),el('p',text));box.append(n);return n;}
  async function load(){
   state=await rpc('task_tools_state',{});root.replaceChildren();notice.textContent='';
   const saved=section('Saved tasks');if(!state.saved.length)saved.append(el('p','No saved tasks yet. Save tasks from Task Market.'));
   state.saved.forEach(j=>{const n=row(saved,j.title,j.status+' · Reward $'+Number(j.reward).toFixed(2));const a=el('a','Open Task Market');a.href='tasks.html';n.append(a,button('Remove','unsave',j.id,''));});
   const subs=section('Ratings & rejected submissions');
   if(!state.submissions.length)subs.append(el('p','Your task submissions and poster reviews will appear here.'));
   state.submissions.forEach(s=>{const rating=state.ratings.find(r=>r.target===s.target);const n=row(subs,s.title,s.role+' · '+s.status+' · Other participant rating: '+(rating?rating.average+'/5 ('+rating.count+' ratings)':'Not rated yet'));
    if(s.status==='approved'&&!s.rated){const select=el('select');select.setAttribute('aria-label','Rating');for(let i=1;i<=5;i++){const o=el('option',i+' stars');o.value=i;select.append(o);}n.append(select);const b=el('button','Submit rating');b.className='btn btn-ghost';b.onclick=async()=>{b.disabled=true;try{await rpc('task_tools_action',{p_action:'rate',p_id:s.id,p_text:'',p_stars:Number(select.value)});await load();}catch(e){fail(e);}finally{b.disabled=false;}};n.append(b);}
    if(s.role==='Worker'&&s.status==='rejected'&&!state.disputes.some(d=>d.sub_id===s.id))n.append(button('Raise dispute','dispute',s.id,null));
   });
   const disputes=section('Disputes');disputes.append(el('p','Admins can uphold a rejection or reopen a funded submission for review. Reopening does not pay automatically. Closed or unfunded tasks require Support.'));
   state.disputes.forEach(d=>{const n=row(disputes,d.title,d.status+' · '+d.reason+' · Decision: '+(d.decision||'Awaiting review'));n.append(el('p','Original rejection: '+d.rejection));if(window.FFProof){const proof=el('div');proof.innerHTML=FFProof.viewer(d.proof);n.append(proof);}if(state.isAdmin&&d.status==='open')n.append(button('Uphold rejection','uphold',d.sub_id,null),button('Reopen for review','reopen',d.sub_id,null));});
   const reports=section('Safety reports');state.reports.forEach(r=>{const n=row(reports,r.title,r.status+' · '+r.reason);if(state.isAdmin&&r.status==='open')n.append(button('Mark resolved','resolve_report',r.job_id,''));});
   const stats=section('My task performance');stats.append(el('p','Task Market figures only; paid totals are approved rewards, not pending submissions or campaign visits.'));
   state.performance.forEach(j=>row(stats,j.title,j.status+' · Paid $'+Number(j.paid).toFixed(2)+' · Escrow $'+Number(j.escrow).toFixed(2)+' · Posting fee $'+Number(j.fee).toFixed(2)+' · Approved '+j.filled+'/'+j.slots+' · Pending '+j.pending+' · Rejected '+j.rejected));
  }
  load().catch(fail);
 });
})();
