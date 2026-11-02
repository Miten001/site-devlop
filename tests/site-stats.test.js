/* Dashboard site overview: six real counters, safe fallbacks and refresh.
   No network or Supabase credentials are needed. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const dashboard = read("dashboard.html");
const script = read("assets/js/site-stats.js");
const sql = read("supabase-site-stats.sql");
const panel = dashboard.match(/<section class="panel reveal site-today[\s\S]*?<\/section>/)[0];
const ids = ["site-visitors", "site-registered", "site-total-views", "site-total-registered", "site-running-tasks", "site-completed-tasks"];
const full = {
  visitors_today: 12, registered_today: 3, total_views: 123456,
  total_registered: 7890, running_tasks: 42, completed_tasks: 4567
};
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function rpcError(message, offline) {
  const err = new Error(message);
  if (offline) err.offline = true;
  return err;
}
function createDom(rpc, server = true) {
  const intervals = [];
  const dom = new JSDOM("<!doctype html><html><body>" + panel + "</body></html>", {
    url: "https://example.test/dashboard.html",
    runScripts: "dangerously",
    beforeParse(window) {
      window.FF = { rpc, hasServer: () => server };
      window.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
      Object.defineProperty(window.document, "hidden", { value: false, configurable: true });
    }
  });
  dom.window.eval(script);
  return { dom, doc: dom.window.document, intervals };
}
const text = (doc, id) => doc.getElementById(id).textContent;
const values = (doc) => ids.map((id) => text(doc, id));
const status = (doc) => doc.getElementById("site-stats-status").textContent;

async function main() {
  assert.match(dashboard, /assets\/js\/site-stats\.js\?v=1\.0/);
  assert.equal(/FF\.rpc\("site_today_stats"\)/.test(dashboard), false, "old inline loader must not issue a competing request");
  ids.forEach((id) => assert.ok(dashboard.includes('id="' + id + '"')));
  assert.match(read("assets/css/style.css"), /\.site-today \.site-stats-grid \{ grid-template-columns: repeat\(6/);
  assert.match(read("package.json"), /site-stats\.test\.js/);

  const calls = [];
  const first = deferred();
  const app = createDom((name) => { calls.push(name); return first.promise; });
  await tick(); // let JSDOM fire DOMContentLoaded before inspecting the first load
  assert.deepEqual(values(app.doc), Array(6).fill("—"));
  assert.equal(app.doc.getElementById("site-stats-refresh").disabled, true);
  assert.equal(app.doc.getElementById("site-stats-panel").getAttribute("aria-busy"), "true");
  app.doc.getElementById("site-stats-refresh").click();
  assert.deepEqual(calls, ["site_stats"], "refresh must not overlap an in-flight request");
  first.resolve([full]);
  await tick();
  assert.deepEqual(values(app.doc), ["12", "3", "1,23,456", "7,890", "42", "4,567"]);
  assert.equal(status(app.doc), "Live data");
  assert.equal(app.doc.getElementById("site-stats-panel").dataset.state, "live");
  assert.equal(app.doc.getElementById("site-stats-refresh").disabled, false);
  assert.equal(app.doc.getElementById("site-stats-panel").getAttribute("aria-busy"), "false");

  const next = deferred();
  let rpc = () => next.promise;
  app.dom.window.FF.rpc = (name) => rpc(name);
  app.doc.getElementById("site-stats-refresh").click();
  next.resolve(Object.assign({}, full, { visitors_today: 0, registered_today: 0, total_views: 0, total_registered: 0, running_tasks: 0, completed_tasks: 0 }));
  await tick();
  assert.deepEqual(values(app.doc), Array(6).fill("0"), "real zeroes must render as 0, not dashes");

  rpc = () => Promise.reject(new Error("Temporary server failure"));
  app.doc.getElementById("site-stats-refresh").click();
  await tick(); await tick();
  assert.equal(status(app.doc), "Last snapshot");
  assert.deepEqual(values(app.doc), Array(6).fill("0"), "failed refresh must retain, not invent, data");
  assert.notEqual(app.doc.getElementById("site-stats-panel").dataset.state, "live");
  assert.equal(app.intervals[0].ms, 60000);
  rpc = () => { throw new Error("Hidden page must not fetch"); };
  Object.defineProperty(app.doc, "hidden", { value: true });
  app.intervals[0].fn();
  Object.defineProperty(app.doc, "hidden", { value: false });
  rpc = () => Promise.resolve(full);
  app.intervals[0].fn();
  await tick();
  assert.equal(status(app.doc), "Live data");
  app.dom.window.close();

  const legacyCalls = [];
  const legacy = createDom((name) => {
    legacyCalls.push(name);
    if (name === "site_stats") return Promise.reject(rpcError("Could not find the function public.site_stats (PGRST202)"));
    return Promise.resolve([{ visitors: 8, registered: 2 }]);
  });
  await tick(); await tick();
  assert.deepEqual(legacyCalls, ["site_stats", "site_today_stats"]);
  assert.deepEqual(values(legacy.doc), ["8", "2", "—", "—", "—", "—"]);
  assert.equal(status(legacy.doc), "Daily only");
  assert.match(text(legacy.doc, "site-stats-note"), /supabase-site-stats\.sql/);
  legacy.doc.getElementById("site-stats-refresh").click();
  await tick(); await tick();
  assert.deepEqual(legacyCalls, ["site_stats", "site_today_stats", "site_today_stats"]);
  legacy.dom.window.close();

  const errorCalls = [];
  const error = createDom((name) => {
    errorCalls.push(name);
    return Promise.reject(rpcError("Database unavailable"));
  });
  await tick(); await tick();
  assert.deepEqual(errorCalls, ["site_stats"], "non-404 errors are not missing migrations");
  assert.deepEqual(values(error.doc), Array(6).fill("—"));
  assert.equal(status(error.doc), "Unavailable");
  error.dom.window.close();

  const offlineCalls = [];
  const offline = createDom((name) => { offlineCalls.push(name); return Promise.resolve(full); }, false);
  await tick();
  assert.deepEqual(offlineCalls, [], "demo/local activity is not site-wide data");
  assert.deepEqual(values(offline.doc), Array(6).fill("—"));
  assert.match(text(offline.doc, "site-stats-note"), /Demo and browser-only activity are not included/);
  offline.dom.window.close();

  const partial = createDom(() => Promise.resolve(Object.assign({}, full, { running_tasks: null, completed_tasks: null })));
  await tick();
  assert.deepEqual(values(partial.doc), ["12", "3", "1,23,456", "7,890", "—", "—"]);
  assert.equal(status(partial.doc), "Partial data");
  partial.dom.window.close();

  const invalid = createDom(() => Promise.resolve({ total_views: -1, total_registered: "bad", running_tasks: null }));
  await tick(); await tick();
  assert.deepEqual(values(invalid.doc), Array(6).fill("—"));
  assert.equal(status(invalid.doc), "Unavailable");
  invalid.dom.window.close();

  // Aggregate-only reader, both task sources, UTC boundary and no anon access.
  assert.match(sql, /create or replace function public\.site_stats\(\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = public/);
  assert.match(sql, /set timezone = 'UTC'/);
  assert.match(sql, /if auth\.uid\(\) is null then/);
  assert.match(sql, /where e\.type = 'page_view'/);
  assert.match(sql, /p\.created_at >= current_date::timestamptz/);
  assert.match(sql, /p\.created_at < \(current_date \+ 1\)::timestamptz/);
  assert.match(sql, /public\.market_campaigns where active/);
  assert.match(sql, /public\.jobs where status = ''active''/);
  assert.match(sql, /public\.market_campaign_subs where status = ''approved''/);
  assert.match(sql, /public\.job_subs where status = ''approved''/);
  assert.match(sql, /revoke all on function public\.site_stats\(\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.site_stats\(\) to authenticated/);
  assert.doesNotMatch(sql, /grant[^\n]*to[^\n]*\banon\b/);
  assert.match(read("RUN-ORDER.md"), /supabase-site-stats\.sql/);
  console.log("Site overview: six counters, zeroes, legacy fallback, errors, refresh and SQL permissions: PASS");
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
