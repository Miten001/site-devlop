/* Voluntary country sharing. Never infer country from IP, language or timezone. */
(function(){
 'use strict';
 const codes='AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
 function flag(code){return codes.includes(code)?String.fromCodePoint(...Array.from(code,c=>127397+c.charCodeAt(0))):'🌐';}
 window.FFCountry={codes,flag};
 function populate(select,signup){
  select.replaceChildren();
  const option=(value,text)=>{const o=document.createElement('option');o.value=value;o.textContent=text;select.append(o);};
  option('','Choose your country');option('private','🌐 Prefer not to share');
  let names;try{names=new Intl.DisplayNames(['en'],{type:'region'});}catch(_){}
  codes.map(code=>({code,name:names?names.of(code):code})).sort((a,b)=>a.name.localeCompare(b.name)).forEach(({code,name})=>option(code,flag(code)+' '+name));
 }
 document.addEventListener('DOMContentLoaded',()=>{
  const signup=document.getElementById('signup-country');if(signup)populate(signup,true);
  const root=document.getElementById('member-country');if(!root)return;
  const container=root.closest('details')||root;
  container.hidden=true;
  if(new URLSearchParams(location.search).has('worker')){const pref=document.getElementById('country-preference');if(pref)pref.hidden=true;return;}
  if(!window.FF||!FF.hasServer())return;
  const label=document.createElement('label');label.textContent='Which country are you from? Your flag will be shown on leaderboards. ';
  const select=document.createElement('select');select.setAttribute('aria-label','Public leaderboard country');populate(select,false);
  const save=document.createElement('button');save.type='button';save.className='btn btn-ghost btn-sm';save.textContent='Save country';
  const message=document.createElement('span');message.setAttribute('role','status');label.append(select);root.append(label,save,message);
  let loaded=false;
  FF.rpc('member_country_status',{}).then(status=>{
   loaded=true;container.hidden=!!(status&&status.answered);if(!container.hidden&&container.tagName==='DETAILS')container.open=true;
  }).catch(()=>{container.hidden=false;select.disabled=save.disabled=true;message.textContent='Could not load country preference. Reload to try again.';});
  save.addEventListener('click',async()=>{
   if(!loaded||!select.value){message.textContent='Choose a country or Prefer not to share.';return;}
   save.disabled=true;
   try{await FF.rpc('member_country_set',{p_country:select.value==='private'?null:select.value});container.hidden=true;document.dispatchEvent(new Event('ff:country-saved'));}
   catch(e){message.textContent=e.message||'Could not save country. Please try again.';}
   finally{save.disabled=false;}
  });
 });
})();
