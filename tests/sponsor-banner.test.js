"use strict";
const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const pages=['index','landing','login','signup','ads','download','dashboard','earn','add','post-task','my-tasks','tasks','quests','rewards','mining','wallet','refer','support'];
const socialURL='https://bauval.org/14/2b37c852b12c715a01df6d09b7680298';
for (const page of fs.readdirSync('.').filter(name=>name.endsWith('.html'))) {
 const html=fs.readFileSync(page,'utf8');
 assert(!/acceptable\.a-ads\.com|data-aa\s*=|data-sponsor-frame|assets\/(adsterra-banner|adsterra-desktop|spin-social-ad)\.html/.test(html),page+': no legacy ad wrappers');
 const dom=new JSDOM(html), d=dom.window.document;
 const loaders=d.querySelectorAll('script[src^="assets/js/sponsor-banner.js"]');
 if(pages.includes(page.replace('.html',''))) {
  assert.equal(loaders.length,1,page+': one loader');
  const loader=loaders[0];
  assert(!loader.async && !loader.defer);
  assert(!loader.hasAttribute('async') && !loader.hasAttribute('defer'));
  assert(loader.closest('.ff-sponsor-banner'));
  assert.equal(loader.closest('.ff-sponsor-banner').parentElement,d.body);
  assert.equal(d.querySelectorAll('.ff-sponsor-banner iframe').length,0,'No custom iframe');
  assert(d.querySelector('link[href^="assets/css/sponsor-banner.css"]'));
 } else assert.equal(loaders.length,0);
 const social=Array.from(d.scripts).filter(script=>script.src===socialURL);
 assert.equal(social.length,['rewards.html','index.html','landing.html','login.html','signup.html'].includes(page)?1:0);
 if(social.length) {
  assert.equal(d.body.lastElementChild,social[0]);
  assert.equal(social[0].getAttribute('data-cfasync'),'false');
  assert(!html.includes('showSpinAdvertisement'));
  assert(!d.getElementById('spin-ad-slot'));
 }
 dom.window.close();
}
const source=fs.readFileSync('assets/js/sponsor-banner.js','utf8');
for(const width of [320,390,767,768,1280]) {
 const writes=[], styles={};
 const slot={style:{setProperty:(k,v)=>{styles[k]=v;}}};
 const document={readyState:'loading',currentScript:{closest:()=>slot},write:html=>writes.push(html)};
 const window={innerWidth:width};
 const context=vm.createContext({document,window});
 vm.runInContext(source,context);
 assert.equal(writes.length,1);
 const desktop=width>=768;
 assert.equal(window.atOptions.width,desktop?728:320);
 assert.equal(window.atOptions.height,desktop?90:50);
 assert.equal(window.atOptions.format,'iframe','Keep the provider-generated format');
 assert(writes[0].includes('https://bauval.org/22/'+window.atOptions.key));
 assert.equal(styles['--banner-height'],desktop?'90px':'50px');
 vm.runInContext(source,context); assert.equal(writes.length,1,'No repeat insertion');
}
let lateWrites=0;
vm.runInNewContext(source,{window:{innerWidth:1280},document:{readyState:'complete',write:()=>lateWrites++}});
assert.equal(lateWrites,0,'Never document.write after parsing');
for(const file of ['assets/adsterra-banner.html','assets/adsterra-desktop.html','assets/spin-social-ad.html']) assert(!fs.existsSync(file));
console.log('Ad placement tests passed: direct host-page tags, single-size banner, no custom iframe, no refresh, Social Bar before body close and no spin coupling.');
