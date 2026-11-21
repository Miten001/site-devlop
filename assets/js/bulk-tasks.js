/* Atomic server-backed bulk posting. Unknown outcomes retry the same frozen request. */
(function(){
 'use strict';
 const round=(n,d)=>Math.round((n+Number.EPSILON)*10**d)/10**d;
 function quote(tasks,fee){return tasks.reduce((s,t)=>{const b=round(Number(t.reward)*Number(t.slots),8);s.budget+=b;s.fee+=round(b*fee/100,4);s.total=round(s.budget+s.fee,8);return s;},{budget:0,fee:0,total:0});}
 window.FFBulk={quote};
 document.addEventListener('DOMContentLoaded',async()=>{
  const editor=document.getElementById('bulk-editor');if(!editor)return;
  const $=id=>document.getElementById(id),FF=window.FF,user=FF&&FF.currentUser();
  if(!user||!FF.hasServer()){$('bulk-notice').textContent='Bulk publishing requires a signed-in server account.';return;}
  const key='ff_bulk_drafts:'+user.email;let tasks=[],pending=null,config,categories=[],busy=false,previewed=false;
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;};
  const notice=text=>{$('bulk-notice').textContent=text;};
  function persist(){sessionStorage.setItem(key,JSON.stringify({tasks,pending}));}
  function changed(){previewed=false;$('bulk-preview').hidden=true;$('bulk-publish').hidden=true;try{persist();}catch(e){notice('Draft storage is unavailable. Enable site storage before publishing.');}}
  function controls(){const locked=busy||!!pending;editor.querySelectorAll('input,textarea,select,button').forEach(n=>n.disabled=locked);$('bulk-add').disabled=locked||tasks.length>=10;$('bulk-review').disabled=locked||!tasks.length;$('bulk-publish').disabled=busy;}
  function button(parent,text,fn){const b=el('button',text);b.type='button';b.className='btn btn-ghost btn-sm';b.onclick=fn;parent.append(b);}
  function render(){editor.replaceChildren();tasks.forEach((task,i)=>{
   const box=el('section');box.className='panel';box.append(el('h2','Task '+(i+1)));const fields=el('div');fields.className='bulk-fields';
   for(const [name,title,type] of [['title','Title (6–120 characters)','input'],['category','Category','select'],['description','Task instructions (20–10000 characters)','textarea'],['proofNote','Proof requirements (no passwords or OTPs)','textarea'],['url','Destination URL (optional)','input'],['reward','Reward per worker (USDT)','input'],['slots','Worker slots','input']]){
    const label=el('label',title),input=el(type);input.dataset.field=name;
    if(type==='select')categories.forEach(c=>{const o=el('option',c.name);o.value=c.key;input.append(o);});
    if(name==='reward'||name==='slots'){input.type='number';input.min=name==='slots'?'1':String(config.minJobReward);input.step=name==='slots'?'1':'0.00000001';}else if(name==='url')input.type='url';
    if(name==='title')input.maxLength=120;if(type==='textarea')input.maxLength=10000;
    input.value=task[name];input.addEventListener('input',()=>{task[name]=input.value;changed();});label.append(input);fields.append(label);
   }
   box.append(fields);button(box,'Duplicate draft',()=>{if(tasks.length>=10){notice('Maximum 10 tasks per batch.');return;}tasks.splice(i+1,0,{...task});changed();render();});button(box,'Remove draft',()=>{tasks.splice(i,1);changed();render();});editor.append(box);
  });controls();}
  function validate(){if(!tasks.length||tasks.length>10)throw Error('Add 1–10 tasks.');return tasks.map((t,i)=>{
   const r=Number(t.reward),slots=Number(t.slots),prefix='Task '+(i+1)+': ';
   if(t.title.trim().length<6||t.title.length>120)throw Error(prefix+'use a title of 6–120 characters.');
   if(t.description.trim().length<20||t.description.length>10000)throw Error(prefix+'use instructions of 20–10000 characters.');
   if(!Number.isFinite(r)||r<Number(config.minJobReward)||r>1000000||!Number.isInteger(slots)||slots<1||slots>100000)throw Error(prefix+'check the reward and slots.');
   let url=t.url.trim();if(url){url=FF.normalizeUrl(url);if(!url)throw Error(prefix+'use a valid HTTP/HTTPS URL.');}
   return {...t,url,reward:r,slots};
  });}
  function preview(items){const q=quote(items,Number(config.platformFeePct));const box=$('bulk-preview');box.replaceChildren(el('h2','Review '+items.length+' tasks'));
   items.forEach((t,i)=>box.append(el('p',(i+1)+'. '+t.title+' · '+t.category+' · '+t.slots+' workers × $'+t.reward+' · '+(t.url||'No external URL'))));
   box.append(el('p','Worker budget: $'+q.budget.toFixed(8)+' · Fee ('+config.platformFeePct+'%): $'+q.fee.toFixed(4)+' · Total: $'+q.total.toFixed(8)),el('p','Fees and category limits are checked again by the server. Any failure rolls back the full batch.'));
   box.hidden=false;$('bulk-publish').hidden=false;return q;
  }
  $('bulk-add').onclick=()=>{tasks.push({title:'',category:categories[0].key,description:'',proofNote:'',url:'',reward:String(config.minJobReward),slots:'1'});changed();render();};
  $('bulk-review').onclick=()=>{try{preview(validate());previewed=true;notice('Review each draft and the total before confirming.');}catch(e){notice(e.message);}};
  $('bulk-publish').onclick=async()=>{
   if(busy)return;
   try{
    if(!pending){if(!previewed)throw Error('Preview the batch first.');const items=validate(),q=quote(items,Number(config.platformFeePct));if(!confirm('Publish '+items.length+' tasks and charge $'+q.total.toFixed(8)+' including fees?'))return;
     if(!window.crypto||!crypto.randomUUID)throw Error('A secure HTTPS browser is required.');pending={id:crypto.randomUUID(),tasks:items,total:q.total};
     try{persist();}catch(e){pending=null;throw Error('Cannot safely save the request ID. Enable site storage and try again.');}
    }
    busy=true;controls();notice('Publishing atomically…');
    const result=await FF.rpc('jobs_post_bulk',{p_request:pending.id,p_tasks:pending.tasks,p_expected_total:pending.total});
    if(!result||typeof result.ok!=='boolean')throw Error('Unconfirmed server response.');
    if(!result.ok){pending=null;persist();notice('No tasks were published and no batch funds were charged: '+result.error);previewed=false;$('bulk-publish').hidden=true;return;}
    const count=result.published;pending=null;tasks=[];persist();render();$('bulk-preview').hidden=true;$('bulk-publish').hidden=true;notice(count+' tasks published successfully. Open My Tasks to manage them.');
   }catch(e){notice(pending?'Outcome not confirmed. Do not create another batch. Retry this same request to avoid duplicate charges. '+e.message:e.message);if(pending)$('bulk-publish').textContent='Retry same batch safely';}
   finally{busy=false;controls();}
  };
  try{
   const saved=JSON.parse(sessionStorage.getItem(key)||'null');if(saved){tasks=Array.isArray(saved.tasks)?saved.tasks:[];pending=saved.pending||null;}
   const feed=await FF.rpc('jobs_feed',{});config=feed.config;categories=feed.categories||[];if(!config||!categories.length)throw Error('Live posting configuration unavailable.');
   if(pending){tasks=pending.tasks;preview(tasks);$('bulk-publish').textContent='Retry same batch safely';notice('An earlier batch is unconfirmed. Retry its original request before editing.');}
   else notice('Add your drafts, then preview the budget. Existing per-category limits apply.');
   render();
  }catch(e){notice(e.message||'Could not load bulk posting.');}
 });
})();
