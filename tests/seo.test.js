"use strict";
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const base='https://miten001.github.io/site-devlop/';
const files=['index.html','landing.html','how-it-works.html','ads.html','download.html'];
for(const file of files){
 const dom=new JSDOM(fs.readFileSync(file,'utf8')); const d=dom.window.document;
 const url=base+(file==='index.html'?'':file);
 assert.equal(d.querySelectorAll('link[rel="canonical"]').length,1);
 assert.equal(d.querySelector('link[rel="canonical"]').getAttribute('href'),url);
 assert.equal(d.querySelector('meta[property="og:url"]').content,url);
 assert(d.querySelector('meta[name="description"]').content.length>40);
 assert(!/noindex/.test(d.querySelector('meta[name="robots"]')?.content||''));
 for(const a of d.querySelectorAll('a[href]')){
  const href=a.getAttribute('href');
  if(/^[a-z-]+\.html(?:[?#]|$)/.test(href)) assert(fs.existsSync(href.split(/[?#]/)[0]),href);
 }
 dom.window.close();
}
const xml=new JSDOM(fs.readFileSync('sitemap.xml','utf8'),{contentType:'text/xml'});
assert.equal(xml.window.document.querySelectorAll('url').length,files.length);
const locations=Array.from(xml.window.document.querySelectorAll('loc')).map(el=>el.textContent);
assert.equal(new Set(locations).size,files.length);
for(const file of files) assert(locations.includes(base+(file==='index.html'?'':file)));
xml.window.close();
for(const file of ['wallet','dashboard','support','my-tasks','rewards','admin','admin-payments','login','signup']){
 const dom=new JSDOM(fs.readFileSync(file+'.html','utf8'));
 assert.match(dom.window.document.querySelector('meta[name="robots"]').content,/noindex/);
 dom.window.close();
}
for(const file of ['index.html','landing.html']) assert.match(fs.readFileSync(file,'utf8'),/href="how-it-works.html"/);
const home=new JSDOM(fs.readFileSync('index.html','utf8'));
const schema=JSON.parse(home.window.document.querySelector('script[type="application/ld+json"]').textContent);
assert.equal(schema['@context'],'https://schema.org');
assert(schema['@graph'].some(item=>item['@type']==='WebSite'));
assert(!JSON.stringify(schema).includes('aggregateRating'));
home.window.close();
console.log('SEO tests passed: canonicals, metadata, guide links, sitemap, noindex boundaries and valid structured data.');
