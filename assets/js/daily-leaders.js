/* Daily rankings are read-only and server-authoritative. No demo winners or prizes. */
(function(){
 'use strict';
 document.addEventListener('DOMContentLoaded',()=>{
  const root=document.getElementById('daily-leaders');if(!root)return;
  const list=document.getElementById('daily-leaders-list'),notice=document.getElementById('daily-leaders-notice'),summary=document.getElementById('daily-leaders-summary');
  const more=document.getElementById('daily-leaders-more'),toggle=document.getElementById('daily-leaders-toggle'),refresh=document.getElementById('daily-leaders-refresh');
  let state=null,expanded=false,hidden=false,busy=false,lastLoaded=0;
  const money=n=>Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:6});
  function render(){
   if(!state)return;
   list.replaceChildren();
   const leaders=Array.isArray(state.leaders)?state.leaders:[];
   (expanded?leaders:leaders.slice(0,6)).forEach(r=>{
    const item=document.createElement('li');if(r.isMe)item.className='is-me';
    for(const [tag,text] of [['span','#'+r.rank+(r.isMe?' · You':'')],['strong','$'+money(r.earned)],['span',(window.FFCountry?FFCountry.flag(r.country):'🌐')+' '+r.member],['small',r.completed+' approved']]){const e=document.createElement(tag);e.textContent=text;item.append(e);}list.append(item);
   });
   list.hidden=hidden;
   more.hidden=leaders.length<=6||hidden;more.textContent=expanded?'Top 6':'View All';more.setAttribute('aria-expanded',String(expanded));
   toggle.textContent=hidden?'Show':'Hide';toggle.setAttribute('aria-expanded',String(!hidden));
   notice.textContent=leaders.length?'':'No approved task earnings today yet. Rankings appear after real task approvals.';
   summary.textContent=state.day+' UTC · '+Number(state.participants||0)+' ranked · Your rank: '+(state.myRank?'#'+state.myRank:'Unranked')+' · Your approved earnings: $'+money(state.myEarned)+'. Resets at '+new Date(state.resetAt).toUTCString();
  }
  async function load(){
   if(busy)return;
   if(!window.FF||!FF.hasServer()){notice.textContent='Daily rankings require a signed-in server account. No demo rankings are shown.';return;}
   busy=true;refresh.disabled=true;
   try{const data=await FF.rpc('daily_task_leaders',{});if(!data||!Array.isArray(data.leaders))throw Error('Invalid leaderboard response');state=data;lastLoaded=Date.now();render();}
   catch(e){state=null;list.replaceChildren();summary.textContent='';more.hidden=true;toggle.hidden=true;notice.textContent='Daily rankings are unavailable. Please try again later.';}
   finally{busy=false;refresh.disabled=false;if(state)toggle.hidden=false;}
  }
  document.addEventListener('ff:country-saved',load);
  more.addEventListener('click',()=>{expanded=!expanded;render();});toggle.addEventListener('click',()=>{hidden=!hidden;render();});refresh.addEventListener('click',load);
  // Refresh only when visible. Server determines the UTC day; browser totals are never trusted.
  const timer=setInterval(()=>{if(!document.hidden&&Date.now()-lastLoaded>=60000)load();},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastLoaded>=60000)load();});
  window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
  load();
 });
})();
