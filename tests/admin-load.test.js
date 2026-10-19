/* Admin dashboard: rows must appear without waiting for slow lifetime counts.
   No network/Supabase credentials required. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const json = (value) => ({ ok: true, text: () => Promise.resolve(JSON.stringify(value)) });

async function main() {
  const pendingEvents = deferred();
  const countRequests = [];
  const paths = [];
  const html = fs.readFileSync(path.join(__dirname, "../admin.html"), "utf8");
  const dom = new JSDOM(html, {
    url: "https://example.test/admin.html",
    runScripts: "dangerously",
    beforeParse(window) {
      window.FF_SUPABASE_CONFIG = { url: "https://db.example.test", anonKey: "public-test-key" };
      window.FF_ADMIN_EMAILS = ["admin@example.test"];
      window.localStorage.setItem("ff_admin_session", JSON.stringify({
        access_token: "test-token", user: { email: "admin@example.test" }
      }));
      window.fetch = (url, options) => {
        const u = String(url);
        paths.push(u);
        if (u.includes("/rest/v1/events?") && !(options.headers || {}).Prefer) return pendingEvents.promise;
        if ((options.headers || {}).Prefer === "count=exact") {
          const request = deferred();
          countRequests.push(request);
          return request.promise;
        }
        if (u.includes("/rest/v1/profiles?")) return Promise.resolve(json([{
          id: "member-1", email: "member@example.test", display_name: "Member", created_at: "2026-10-18T00:00:00Z"
        }]));
        if (u.includes("/rest/v1/balances?")) return Promise.resolve(json([]));
        return Promise.resolve(json([]));
      };
    }
  });
  try {
    const doc = dom.window.document;
    await tick();
    await tick();
    assert.match(doc.getElementById("t-members").textContent, /member@example.test/,
      "members should render while events are still in flight");
    assert.equal(doc.getElementById("btn-refresh").disabled, true);
    assert.equal(countRequests.length, 0, "counts should not compete with initial data requests");
    assert(paths.some((url) => url.includes("select=type,page,vid,day,ts_client,url,label,task_title,task_id,email,user_name")),
      "events should only request columns the admin page uses");

    pendingEvents.resolve(json([{ type: "page_view", page: "index.html", vid: "test", day: "2026-10-18",
      ts_client: "2026-10-18T05:00:00Z", email: "member@example.test" }]));
    await tick();
    assert.equal(doc.getElementById("k-views").textContent, "1");
    assert.equal(doc.getElementById("btn-refresh").disabled, false,
      "dashboard should be usable before lifetime counts finish");
    assert.equal(countRequests.length, 2, "exact totals should be limited to two concurrent queries");
    countRequests[0].resolve({ ok: true, headers: { get: () => "0-0/4321" } });
    await tick();
    assert.equal(doc.getElementById("k-views").textContent, "4,321",
      "the exact count should replace the window fallback without repainting tables");
    assert.equal(countRequests.length, 3, "the next count starts when a slot is free");
    doc.getElementById("btn-refresh").click();
    await tick();
    assert.equal(countRequests.length, 5, "a new refresh gets its own count queries");
    countRequests[1].resolve({ ok: true, headers: { get: () => "0-0/9999" } });
    countRequests[2].resolve({ ok: true, headers: { get: () => "0-0/9999" } });
    await tick();
    assert.notEqual(doc.getElementById("k-today").textContent, "9,999",
      "slow counts from an older refresh must not overwrite current data");
    for (let i = 3; i < 10; i++) {
      if (countRequests[i]) countRequests[i].resolve({ ok: true, headers: { get: () => "0-0/2" } });
      await tick();
    }
    console.log("Admin progressive loading, bounded queries and stale-refresh handling: PASS");
  } finally {
    dom.window.close();
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
