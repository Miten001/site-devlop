(function(){
 'use strict';
 document.addEventListener('DOMContentLoaded',()=>{
  const root=document.getElementById('workflow-app');if(!root)return;
  const notice=document.getElementById('workflow-notice'),FF=window.FF;
  const node=(tag,text)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;return e;};
  const fail=e=>{notice.textContent=e.message||'Unable to load task workspace.';};
  const section=title=>{const e=node('section');e.className='panel';e.append(node('h2',title));root.append(e);return e;};
  function action(parent,label,fn){const b=node('button',label);b.className='btn btn-ghost';b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();await load();notice.textContent='Saved successfully.';}catch(e){fail(e);}finally{b.disabled=false;}};parent.append(b);return b;}
  function field(parent,label,tag,value){const wrap=node('label',label),e=node(tag);e.value=value||'';wrap.append(e);parent.append(wrap);return e;}
  function publicCard(p){
   const box=section(p.headline||'Worker portfolio');box.append(node('p',p.bio||''),node('p','Approved tasks: '+p.approvedTasks+' · Rating: '+(p.rating||'Not rated')+' ('+p.ratingCount+' ratings)'));
   if(p.sample&&/^https:\/\//i.test(p.sample)){const a=node('a','View work sample (external website)');a.href=p.sample;a.target='_blank';a.rel='noopener noreferrer nofollow';box.append(a);}
  }
  async function publicRpc(id){const cfg=window.FF_SUPABASE_CONFIG;if(!cfg)throw Error('Site connection not configured.');const r=await fetch(cfg.url.replace(/\/+$/,'')+'/rest/v1/rpc/portfolio_public',{method:'POST',headers:{apikey:cfg.anonKey,Authorization:'Bearer '+cfg.anonKey,'Content-Type':'application/json'},body:JSON.stringify({p_user:id})});const data=await r.json();if(!r.ok)throw Error(data.message||'Portfolio unavailable');return data;}
  async function load(){
   const publicId=new URLSearchParams(location.search).get('worker');
   if(publicId){const p=await publicRpc(publicId);root.replaceChildren();document.getElementById('workspace-title').textContent='Worker Portfolio';notice.textContent='';if(p)publicCard(p);else notice.textContent='This portfolio is not published.';return;}
   const state=await FF.rpc('task_workflow_state',{});root.replaceChildren();notice.textContent='';
   const portfolio=section('My public portfolio'),p=state.portfolio||{};
   portfolio.append(node('p','Publishing is optional. Only your headline, bio, sample link, approved-task count and aggregate rating become public. Email, earnings and submitted proofs are never included. Use only work you have permission to share.'));
   const headline=field(portfolio,'Headline','input',p.headline);headline.maxLength=120;
   const bio=field(portfolio,'About your skills','textarea',p.bio);bio.maxLength=1000;
   const sample=field(portfolio,'Work sample URL (HTTPS, optional)','input',p.sample_url);sample.type='url';sample.maxLength=1000;
   const publish=field(portfolio,'Publish my portfolio','input');publish.type='checkbox';publish.checked=p.published===true;
   action(portfolio,'Save portfolio',async()=>{if(sample.value&&!/^https:\/\/[^\s]+$/.test(sample.value))throw Error('Use a valid HTTPS sample URL.');await FF.rpc('portfolio_save',{p_published:publish.checked,p_headline:headline.value,p_bio:bio.value,p_sample:sample.value});});
   if(p.published){const a=node('a','Open / copy my public portfolio link');a.href='task-workflow.html?worker='+encodeURIComponent(state.userId);portfolio.append(a);}
   const holds=section('My reserved tasks');holds.append(node('p','Holds expire after 15 minutes and do not renew on reopening. Maximum 2 active holds. Submit before expiry; expired holds do not guarantee a slot. No payment is earned by reserving.'));
   if(!state.reservations.length)holds.append(node('p','No active reservations. Use Start task in Task Market.'));
   state.reservations.forEach(r=>{const row=node('article');row.append(node('h3',r.title),node('p',r.status+' · Reserved until '+new Date(r.expires_at).toLocaleString()));const a=node('a','Continue task');a.href='tasks.html?job='+encodeURIComponent(r.job_id);row.append(a);action(row,'Release reservation',()=>FF.rpc('task_reserve',{p_job:r.job_id,p_release:true}));holds.append(row);});
   const corrections=section('Proof corrections');corrections.append(node('p','Posters may request up to 3 correction rounds while a submission is pending. A correction does not release payment. Corrected proofs follow the normal approval process.'));
   state.submissions.forEach(s=>{const row=node('article');row.append(node('h3',s.title),node('p',s.role+' · '+s.status+(s.awaiting?' · Correction requested':'')));
    if(s.instructions)row.append(node('p','Correction instructions: '+s.instructions));
    if(window.FFProof){const proof=node('div');proof.innerHTML=FFProof.viewer(s.proof);row.append(proof);}
    const a=node('a','View worker portfolio');a.href='task-workflow.html?worker='+encodeURIComponent(s.worker);row.append(a);
    if(s.role==='Poster'&&s.status==='pending'&&!s.awaiting&&s.rounds<3){const instructions=field(row,'Explain the correction (10–2000 characters)','textarea');instructions.maxLength=2000;action(row,'Request correction',()=>{if(instructions.value.trim().length<10)throw Error('Use at least 10 characters.');return FF.rpc('task_correct',{p_sub:s.id,p_resubmit:false,p_text:instructions.value});});}
    if(s.role==='Worker'&&s.status==='pending'&&s.awaiting){const text=field(row,'Corrected proof text','textarea');text.maxLength=10000;const link=field(row,'Proof link (optional)','input');link.type='url';const file=field(row,'Corrected screenshot (optional, maximum 5 MB)','input');file.type='file';file.accept='image/*';action(row,'Submit corrected proof',async()=>{const f=file.files[0];if(!f&&(text.value+' '+link.value).trim().length<6)throw Error('Add proof text, a link or a screenshot.');let image='';if(f){FFProof.validate(f,5);image=await FFProof.upload(f,{maxMB:5});}const proof=FFProof.build({text:text.value,link:link.value,image});await FF.rpc('task_correct',{p_sub:s.id,p_resubmit:true,p_text:proof});});}
    corrections.append(row);
   });
  }
  load().catch(fail);
 });
})();
