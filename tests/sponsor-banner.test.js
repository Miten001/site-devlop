"use strict";
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const pages=['index','landing','login','signup','ads','download','dashboard','earn','add','post-task','my-tasks','tasks','quests','rewards','mining','wallet','refer','support'];
for (const page of fs.readdirSync('.').filter(name => name.endsWith('.html'))) {
  const html = fs.readFileSync(page, 'utf8');
  assert(!/acceptable\.a-ads\.com|data-aa\s*=|BEGIN AADS AD UNIT/.test(html), page + ': retired ad embed absent');
  assert(!html.includes('bauval.org'), page + ': third-party script is isolated from app globals');
  const dom = new JSDOM(html);
  const d=dom.window.document;
  const frames=d.querySelectorAll('.ff-sponsor-banner > iframe');
  if (pages.includes(page.replace('.html',''))) {
    assert.equal(frames.length,1,page+': exactly one banner');
    const frame=frames[0];
    assert(!frame.hasAttribute('src'));
    assert(frame.hasAttribute('data-sponsor-frame'));
    assert(d.querySelector('script[src^="assets/js/sponsor-banner.js"][defer]'));
    assert.equal(frame.getAttribute('loading'),'lazy');
    assert.equal(frame.getAttribute('width'),'320');
    assert.equal(frame.getAttribute('height'),'50');
    assert(frame.getAttribute('title'));
    assert.equal(d.body.lastElementChild,frame.parentElement);
    assert.equal(frame.parentElement.parentElement,d.body);
    assert(d.querySelector('link[href^="assets/css/sponsor-banner.css"]'));
  } else assert.equal(frames.length,0,page+': no admin/redirect/creative ads');
  dom.window.close();
}
const embed=fs.readFileSync('assets/adsterra-banner.html','utf8');
assert.match(embed,/'key'\s*:\s*'7045db5b55efe3ba5a0a1e3dc34ebff1'/);
assert.match(embed,/https:\/\/bauval.org\/22\/7045db5b55efe3ba5a0a1e3dc34ebff1/);
assert.match(embed,/'width'\s*:\s*320/);
assert.match(embed,/'height'\s*:\s*50/);
assert(!/setInterval|setTimeout/.test(embed));
const css=fs.readFileSync('assets/css/sponsor-banner.css','utf8');
assert(!/position:\s*(fixed|sticky)|z-index/.test(css));
console.log('Sponsor banner tests passed: retired ads removed, isolated 320x50 embed, lazy footer placement, page coverage and admin exclusions.');

const desktopEmbed=fs.readFileSync('assets/adsterra-desktop.html','utf8');
assert.match(desktopEmbed,/'key'\s*:\s*'34fa5d9809139649a8e23ae1163302d5'/);
assert.match(desktopEmbed,/'width'\s*:\s*728/);
assert.match(desktopEmbed,/'height'\s*:\s*90/);
const vm=require('node:vm');
const loader=fs.readFileSync('assets/js/sponsor-banner.js','utf8');
for(const initial of [false,true]) {
 const dom=new JSDOM('<iframe data-sponsor-frame></iframe>',{url:'https://example.test/site-devlop/'});
 const query={matches:initial,addEventListener(type,fn){this.change=fn;}};
 vm.runInNewContext(loader,{document:dom.window.document,window:{matchMedia:()=>query}});
 const f=dom.window.document.querySelector('iframe');
 assert.equal(f.getAttribute('src'),initial?'assets/adsterra-desktop.html':'assets/adsterra-banner.html');
 assert.equal(f.width,initial?'728':'320');
 query.matches=!initial; query.change();
 assert.equal(f.width,initial?'320':'728');
 assert.equal(dom.window.document.querySelectorAll('iframe').length,1);
 dom.window.close();
}
console.log('Responsive banner selection passed: mobile/desktop unit, dimensions and breakpoint switching.');
