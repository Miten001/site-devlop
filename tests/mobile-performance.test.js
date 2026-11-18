"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

for (const file of fs.readdirSync(".").filter((name) => name.endsWith(".html"))) {
  const dom = new JSDOM(fs.readFileSync(file, "utf8"));
  for (const menu of dom.window.document.querySelectorAll(".mobile-nav, .side-nav, .nav-links, .admin-sec-nav")) {
    const support = menu.querySelector('a[href^="support.html"]');
    if (!support) continue;
    const links = Array.from(menu.querySelectorAll("a, button"));
    const following = links.slice(links.indexOf(support) + 1);
    assert(following.every((link) => link.hasAttribute("data-logout")), file + ": support must be the final option before Logout");
    assert.equal(menu.querySelectorAll('a[href^="support.html"]').length, 1, file + ": no duplicate support link");
  }
  dom.window.close();
}

const source = fs.readFileSync("assets/js/landing-bg.js", "utf8");
function background({ light=false, saveData=false, cores=8, hidden=false }={}) {
  const frames = new Map(), events = {};
  let nextId=0, contexts=0, paints=0;
  const gradient={addColorStop(){}};
  const ctx=new Proxy({}, {get:(_, name)=>name==="clearRect" ? ()=>paints++ : name==="createRadialGradient" || name==="createLinearGradient" ? ()=>gradient : ()=>{}, set:()=>true});
  const document={hidden, getElementById:()=>({getContext:()=>{ contexts++; return ctx; }}), addEventListener:(name,fn)=>{events[name]=fn;}};
  const window={innerWidth:1280,innerHeight:800,devicePixelRatio:1,matchMedia:()=>({matches:light}),addEventListener(){}};
  vm.runInNewContext(source,{window,document,navigator:{userAgent:"Browser",hardwareConcurrency:cores,connection:{saveData}},requestAnimationFrame:fn=>{frames.set(++nextId,fn);return nextId;},cancelAnimationFrame:id=>frames.delete(id),setTimeout,clearTimeout});
  return {frames,events,document,contexts:()=>contexts,paints:()=>paints,step(time){const [id,fn]=frames.entries().next().value;frames.delete(id);fn(time);}};
}
for (const options of [{light:true},{saveData:true},{cores:2}]) {
  const bg=background(options);
  assert.equal(bg.contexts(),0,"Light mode must not allocate a canvas");
  assert.equal(bg.frames.size,0,"Light mode must not run an animation loop");
}
const bg=background();
assert.equal(bg.frames.size,1);
bg.step(0); bg.step(40);
const paints=bg.paints(); assert(paints>0);
bg.step(50); assert.equal(bg.paints(),paints,"Background drawing is capped at 30fps");
bg.document.hidden=true; bg.events.visibilitychange(); assert.equal(bg.frames.size,0,"Hidden tabs stop scheduling frames");
bg.document.hidden=false; bg.events.visibilitychange(); bg.events.visibilitychange(); assert.equal(bg.frames.size,1,"Resume schedules exactly one loop");
const css=fs.readFileSync("assets/css/mobile.css","utf8");
assert.match(css,/font-size: 16px/);
assert.match(css,/100dvh/);
assert.match(css,/prefers-reduced-motion/);
console.log("Mobile/performance tests passed: support order, low-power canvas guards, 30fps cap, hidden-tab pause/resume and responsive CSS safeguards.");
