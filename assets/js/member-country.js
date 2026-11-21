/* Voluntary country sharing. Never infer country from IP, language or timezone. */
(function(){
 'use strict';
 const codes='AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
 function flag(code){return codes.includes(code)?String.fromCodePoint(...Array.from(code,c=>127397+c.charCodeAt(0))):'🌐';}
 window.FFCountry={codes,flag};
 document.addEventListener('DOMContentLoaded',()=>{
  const root=document.getElementById('member-country');if(!root)return;
  if(new URLSearchParams(location.search).has('worker')){const pref=document.getElementById('country-preference');if(pref)pref.hidden=true;return;}
  const label=document.createElement('label');label.textContent='Country flag (optional, publicly shown on leaderboards) ';
  const select=document.createElement('select');select.setAttribute('aria-label','Public leaderboard country');const empty=document.createElement('option');empty.value='';empty.textContent='🌐 Not shared';select.append(empty);
  let names;try{names=new Intl.DisplayNames(['en'],{type:'region'});}catch(_){}
  codes.map(code=>({code,name:names?names.of(code):code})).sort((a,b)=>a.name.localeCompare(b.name)).forEach(({code,name})=>{const o=document.createElement('option');o.value=code;o.textContent=flag(code)+' '+name;select.append(o);});
  const save=document.createElement('button');save.type='button';save.className='btn btn-ghost btn-sm';save.textContent='Save country';const message=document.createElement('span');message.setAttribute('role','status');
  label.append(select);root.append(label,save,message);
  if(!window.FF||!FF.hasServer()){select.disabled=save.disabled=true;message.textContent='Sign in to a server account to save your preference.';return;}
  FF.rpc('member_country_get',{}).then(code=>{select.value=code||'';}).catch(()=>{message.textContent='Could not load country preference. Try again later.';});
  save.addEventListener('click',async()=>{save.disabled=true;try{await FF.rpc('member_country_set',{p_country:select.value||null});message.textContent='Country preference saved.';document.dispatchEvent(new Event('ff:country-saved'));}catch(e){message.textContent=e.message||'Could not save country.';}finally{save.disabled=false;}});
 });
})();
