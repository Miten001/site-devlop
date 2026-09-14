/* FlexFam analytics — Supabase-backed, graceful when unconfigured. */
(function () {
  "use strict";
  var cfg = window.FF_SUPABASE_CONFIG || null;
  var enabled = !!(cfg && cfg.url && cfg.anonKey && !cfg.url.includes("your-project") && !cfg.anonKey.includes("your-anon"));
  var client = null, queue = [], loading = false;
  function visitorId() { try { var v=localStorage.getItem("ff_vid"); if(!v){v="v-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10);localStorage.setItem("ff_vid",v);} return v; } catch(e){return "v-anon";} }
  function ensure() { if(client||loading||!enabled)return; loading=true; import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm").then(function(m){client=m.createClient(cfg.url,cfg.anonKey);flush();}).catch(function(){enabled=false;queue=[];}); }
  function event(type,data){var e={type:type,page:location.pathname.split("/").pop()||"index.html",path:location.pathname,title:(document.title||"").slice(0,140),ref:(document.referrer||"").slice(0,400),vid:visitorId(),lang:(navigator.language||"").slice(0,20),ua:(navigator.userAgent||"").slice(0,220),day:new Date().toISOString().slice(0,10),ts_client:new Date().toISOString()}; Object.assign(e,data||{}); return e;}
  function flush(){if(!client)return; while(queue.length){var x=queue.shift(); client.from(x.table).insert(x.row).then(function(){});}}
  function track(type,data){if(!enabled)return;queue.push({table:"events",row:event(type,data)});client?flush():ensure();}
  function saveCampaign(c){if(!enabled)return;queue.push({table:"campaigns",row:{campaign_id:String(c.id||""),platform:String(c.platform||""),action:String(c.action||""),title:String(c.title||"").slice(0,120),url:String(c.url||"").slice(0,400),payout:Number(c.payout||0),owner:visitorId(),source:"web",day:new Date().toISOString().slice(0,10),ts_client:new Date().toISOString()}});client?flush():ensure();}
  document.addEventListener("DOMContentLoaded",function(){track("page_view");});
  document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;var h=a.getAttribute("href")||"";if(!/^https?:\/\//i.test(h))return;var d={url:h.slice(0,400),label:(a.textContent||"").trim().slice(0,80)};track(h.indexOf("t.me/sub_for_sub_bot")!==-1?"telegram_bot_click":"link_click",d);},true);
  window.FFA={track:track,saveCampaign:saveCampaign,visitorId:visitorId,get enabled(){return enabled;}};
})();
