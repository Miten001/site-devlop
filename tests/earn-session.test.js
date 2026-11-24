"use strict";
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('earn.html','utf8');
const stateFn=html.slice(html.indexOf('  function bonusState()'),html.indexOf('  function isBonusDone('));
const marker='  mClaim.addEventListener("click", () => {';
const start=html.indexOf(marker)+marker.length;
const end=html.indexOf('\n  });',start);
const body=html.slice(start,end);
function scenario({member,expireAfterAward=false}){
 let current=member,awards=0,closed=0,rendered=0;
 const ctx={window:{},FF:{currentUser:()=>current,PLATFORMS:{website:{name:'Website'}},awardCredits:()=>{awards++;if(expireAfterAward)current=null;},sfx:{coin(){}},toast(){}},guestUser:()=>({name:'Guest',email:'',guest:true}),pendingTask:{id:'bonus',platform:'website',payout:1},bonusAccount:'a@example.test',user:member,bonusMap:()=>({'a@example.test':{done:true}}),isBonusDone:()=>false,markBonusDone(){},closeModal(){closed++;},renderBonuses(){rendered++;ctx.bonusState();}};
 vm.createContext(ctx);vm.runInContext(stateFn,ctx);vm.runInContext('(function(){'+body+'})()',ctx);return {ctx,awards,closed,rendered};
}
const guest=scenario({member:null});assert.equal(guest.awards,0);assert.equal(guest.closed,1);assert(guest.ctx.user.guest);
const switched=scenario({member:{email:'b@example.test'}});assert.equal(switched.awards,0);
const expired=scenario({member:{email:'a@example.test'},expireAfterAward:true});assert.equal(expired.awards,1);assert(expired.ctx.user.guest);assert.equal(expired.rendered,1);
assert(html.includes('if (!pendingTask) { clearInterval(timer); return; }'));
assert(!html.includes('user = FF.currentUser();'));
assert(!html.includes('user = FF.currentUser() || user;'));
for(const page of ['index','landing','login','signup']){
 const source=fs.readFileSync(page+'.html','utf8');
 assert.equal((source.match(/https:\/\/bauval.org\/14\/2b37c852b12c715a01df6d09b7680298/g)||[]).length,1);
 assert(!source.includes('Notification.requestPermission'));
}
console.log('Earn session tests passed: logged-out/account-switched claims blocked, null-after-credit render safe, timer guard and single pre-signup Social Bar tags.');
