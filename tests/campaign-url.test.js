"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx={window:{},URL};vm.runInNewContext(fs.readFileSync('assets/js/campaign-url.js','utf8'),ctx);
const validator=ctx.window.FFCampaignURL;
for(const [platform,domains] of Object.entries(validator.hosts)){
 for(const domain of domains){
  assert(validator.matches(platform,'https://'+domain+'/user'),platform+': '+domain);
  assert(validator.matches(platform,'https://www.'+domain+'/user'));
  assert(!validator.matches(platform,'https://'+domain+'.evil.example/user'));
  assert(!validator.matches(platform,'https://not'+domain+'/user'));
  assert(!validator.matches(platform,'https://evil.example/?url=https://'+domain));
  assert(!validator.matches(platform,'https://'+domain+'@evil.example'));
  assert(!validator.matches(platform,'https://evil@'+domain));
 }
 assert(!validator.matches(platform,'https://unrelated.example/path'));
 assert(!validator.matches(platform,'javascript:alert(1)'));
 assert(!validator.matches(platform,'not-a-url'));
}
assert(validator.matches('website','https://example.org/page'));
assert(validator.matches('website','https://youtube.com/@user'));
assert(!validator.matches('website','file:///etc/passwd'));
assert(!validator.matches('unknown','https://example.com'));
const page=fs.readFileSync('add.html','utf8');
assert(page.includes('assets/js/campaign-url.js?v=1.1'));
assert(page.includes('urlInput.setCustomValidity(value && !normalized ? message : "")'));
assert(page.includes('return !value || !!normalized;'));
assert(!sqlBlocks());
function sqlBlocks(){return /raise exception/i.test(fs.readFileSync('supabase-campaign-warning-only.sql','utf8'));}
assert(fs.readFileSync('admin.html','utf8').includes('Platform/link mismatch'));
assert(validator.warning('youtube','YouTube').includes('You may continue'));
assert(page.includes('aria-describedby="camp-url-warning"'));
assert(page.includes('if (!validatePlatformURL())'));
const sql=fs.readFileSync('supabase-campaign-platform-links.sql','utf8');
for(const domains of Object.values(validator.hosts))for(const domain of domains)assert(sql.includes("'"+domain+"'"),domain+' parity');
assert(sql.includes('before insert or update of platform,url'));
assert(sql.includes("right(host,length(d)+1)='.'||d"));
console.log('Campaign URL tests passed: all platforms, aliases, subdomains, spoofed hosts, userinfo, schemes, Website Visits and backend trigger coverage.');
