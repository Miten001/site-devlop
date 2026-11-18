"use strict";
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const pages=['index','landing','login','signup','ads','download','dashboard','earn','add','post-task','my-tasks','tasks','quests','rewards','mining','wallet','refer','support'];
for (const page of pages) {
  const dom=new JSDOM(fs.readFileSync(page+'.html','utf8'));
  const d=dom.window.document;
  const ads=d.querySelectorAll('iframe[data-aa="2462511"]');
  assert.equal(ads.length,1,page+': exactly one banner');
  const frame=ads[0];
  assert.equal(frame.getAttribute('src'),'https://acceptable.a-ads.com/2462511/?size=Adaptive');
  assert.equal(frame.getAttribute('loading'),'lazy');
  assert(frame.getAttribute('title'));
  assert.equal(frame.parentElement.parentElement,d.body,page+': banner must sit outside forms and main content');
  assert.equal(d.body.lastElementChild,frame.parentElement,page+': banner is last');
  assert(d.querySelector('link[href^="assets/css/sponsor-banner.css"]'));
  assert(!frame.closest('form, .modal, .modal-veil, .task-card, .job-card'));
  dom.window.close();
}
for (const page of ['admin','admin-payments','admin-check','profile','banner']) {
  assert(!fs.readFileSync(page+'.html','utf8').includes('data-aa="2462511"'),page+': no ads in admin, redirect or banner creative');
}
const css=fs.readFileSync('assets/css/sponsor-banner.css','utf8');
assert(!/position:\s*(fixed|sticky)|z-index/.test(css));
assert.match(css,/max-width: 100%/);
console.log('Sponsor banner tests passed: public/member coverage, HTTPS unit ID, lazy loading, accessible label, footer placement and excluded admin pages.');
