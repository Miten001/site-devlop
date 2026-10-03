/* =========================================================================
   FLEXFAM — Full-Site Audit & Functional Test Harness
   -------------------------------------------------------------------------
   Covers:
     1. Static HTML & asset integrity check across all 17 site pages.
     2. Runtime DOM load & JS execution in JSDOM (no uncaught exceptions).
     3. Comprehensive button click & UI interaction audit across all pages.
     4. 2-Account End-to-End Campaign Lifecycle & Cross-Account Ownership Fix:
        - Signup Account 1 (Alice) -> initial balance
        - Create Campaign on add.html (authorEmail: alice@test.dev)
        - Alice Dashboard: view, pause, resume campaign
        - Alice Earn page: verified as "Your campaign 👑" (disabled)
        - Signup Account 2 (Bob)
        - Bob Earn page: BUG FIX VERIFIED -> NOT own campaign, button enabled!
        - Bob submits proof -> status 'pending'
        - Alice Dashboard -> reviews & approves submission
        - Bob Earn page / balance -> points credited (+50) & "Completed ✓"
   ========================================================================= */

"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");

let pass = 0;
let fail = 0;

function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name + (extra !== undefined ? "   -> " + JSON.stringify(extra) : ""));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HTML_PAGES = [
  "index.html",
  "landing.html",
  "login.html",
  "signup.html",
  "dashboard.html",
  "earn.html",
  "add.html",
  "post-task.html",
  "my-tasks.html",
  "tasks.html",
  "mining.html",
  "wallet.html",
  "refer.html",
  "admin.html",
  "admin-payments.html",
  "admin-check.html",
  "banner.html",
];

function inlinedHtml(file) {
  const filePath = path.join(ROOT, file);
  let content = fs.readFileSync(filePath, "utf8");
  content = content.replace(/<script\s+src="([^"]+)"><\/script>/gi, (match, src) => {
    const cleanSrc = src.split("?")[0];
    const scriptPath = path.join(ROOT, cleanSrc);
    if (fs.existsSync(scriptPath)) {
      return "<script>" + fs.readFileSync(scriptPath, "utf8") + "<\/script>";
    }
    return match;
  });
  return content;
}

function createDOM(file, options = {}) {
  const { storage = {}, userEmail = null, customFetch = null } = options;
  if (userEmail) {
    storage["ff_session"] = JSON.stringify(userEmail);
  }

  const localStorageMock = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
    setItem(k, v) { storage[k] = String(v); },
    removeItem(k) { delete storage[k]; },
    clear() { for (const k in storage) delete storage[k]; }
  };

  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (err) => errors.push(err.message));

  const dom = new JSDOM(inlinedHtml(file), {
    url: "https://flexfam.io/" + file,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.matchMedia = () => ({
        matches: false,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {}
      });
      window.IntersectionObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      window.URL.createObjectURL = () => "blob:mock-url-" + Math.random().toString(36).slice(2);
      window.URL.revokeObjectURL = () => {};
      window.scrollTo = () => {};
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => "";
      Object.defineProperty(window.navigator, "clipboard", {
        value: { writeText: () => Promise.resolve() },
        configurable: true,
      });

      window.fetch = customFetch || ((url, opts) => {
        const u = String(url);
        if (u.includes("/auth/v1/signup")) {
          const body = JSON.parse((opts && opts.body) || "{}");
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(JSON.stringify({
              user: { id: "uid_" + Math.random().toString(36).slice(2), email: body.email, user_metadata: { display_name: body.data && body.data.display_name } },
              session: { access_token: "tok_" + Math.random().toString(36).slice(2), refresh_token: "ref", expires_in: 3600 }
            }))
          });
        }
        if (u.includes("/auth/v1/token")) {
          const body = JSON.parse((opts && opts.body) || "{}");
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(JSON.stringify({
              user: { id: "uid_" + Math.random().toString(36).slice(2), email: body.email, user_metadata: { display_name: body.email.split("@")[0] } },
              access_token: "tok", refresh_token: "ref", expires_in: 3600
            }))
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve("[]"),
          json: () => Promise.resolve([])
        });
      });

      window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
      window.cancelAnimationFrame = (id) => clearTimeout(id);
      Object.defineProperty(window, "localStorage", { value: localStorageMock, configurable: true });
    }
  });

  return { dom, errors, storage };
}

async function runAudit() {
  console.log("===============================================================");
  console.log("   FLEXFAM FULL-SITE AUDIT & FUNCTIONAL TEST SUITE");
  console.log("===============================================================");

  /* -------------------------------------------------------------
     SECTION 1: Static HTML & Asset Audit
     ------------------------------------------------------------- */
  console.log("\n[SECTION 1] Static HTML & Asset Integrity Check");

  for (const file of HTML_PAGES) {
    const fullPath = path.join(ROOT, file);
    const exists = fs.existsSync(fullPath);
    check(`${file} exists on disk`, exists);
    if (!exists) continue;

    const content = fs.readFileSync(fullPath, "utf8");
    check(`${file} is non-empty (${content.length} bytes)`, content.length > 50);
    check(`${file} has DOCTYPE declaration`, /<!DOCTYPE html>/i.test(content));
    check(`${file} has <title> tag`, /<title>[^<]+<\/title>/i.test(content));
    check(`${file} has responsive meta viewport`, /name=["']viewport["']/i.test(content));

    // Verify linked stylesheets exist
    const cssMatches = Array.from(content.matchAll(/<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi));
    for (const match of cssMatches) {
      const href = match[1].split("?")[0];
      if (!href.startsWith("http")) {
        const cssPath = path.join(ROOT, href);
        check(`${file} -> stylesheet ${href} exists`, fs.existsSync(cssPath), href);
      }
    }

    // Verify linked external JS scripts exist
    const scriptMatches = Array.from(content.matchAll(/<script\s+[^>]*src=["']([^"']+)["']/gi));
    for (const match of scriptMatches) {
      const src = match[1].split("?")[0];
      if (!src.startsWith("http")) {
        const jsPath = path.join(ROOT, src);
        check(`${file} -> script ${src} exists`, fs.existsSync(jsPath), src);
      }
    }
  }

  /* -------------------------------------------------------------
     SECTION 2: Runtime DOM Load & Initialization Check
     ------------------------------------------------------------- */
  console.log("\n[SECTION 2] Runtime DOM Load & Initialization (JSDOM)");

  for (const file of HTML_PAGES) {
    const demoStorage = {
      ff_session: JSON.stringify("demo@flexfam.io"),
      ff_users: JSON.stringify([{
        name: "Demo Star",
        email: "demo@flexfam.io",
        memberId: "FF-DEMO",
        credits: 250,
        earned: 500,
        spent: 250,
        activity: [],
        campaigns: [],
        refCode: "FF-DEMO",
        joined: Date.now(),
        weekly: [10, 20, 30]
      }])
    };

    const { dom, errors } = createDOM(file, { storage: demoStorage, userEmail: "demo@flexfam.io" });
    await sleep(40);

    const doc = dom.window.document;
    check(`${file} loads cleanly without uncaught JS exceptions`, errors.length === 0, errors);
    check(`${file} document.title is populated`, doc.title && doc.title.length > 0, doc.title);
    check(`${file} body element is present`, !!doc.body);

    dom.window.close();
  }

  /* -------------------------------------------------------------
     SECTION 3: Interactive UI Elements & Button Click Audit
     ------------------------------------------------------------- */
  console.log("\n[SECTION 3] Interactive UI Elements & Button Click Audit");

  for (const file of HTML_PAGES) {
    const demoStorage = {
      ff_session: JSON.stringify("demo@flexfam.io"),
      ff_users: JSON.stringify([{
        name: "Demo Star",
        email: "demo@flexfam.io",
        memberId: "FF-DEMO",
        credits: 500,
        earned: 500,
        spent: 0,
        activity: [],
        campaigns: [{
          id: "camp_demo",
          platform: "youtube",
          action: "Subscribe",
          user: "Demo Star",
          title: "Demo Channel",
          url: "https://youtube.com/@demo",
          payout: 20,
          mine: true,
          authorEmail: "demo@flexfam.io",
          created: Date.now(),
          actions: 2,
          spent: 40,
          active: true
        }],
        refCode: "FF-DEMO",
        joined: Date.now(),
        weekly: [10, 20, 30]
      }]),
      ff_campaigns: JSON.stringify([{
        id: "camp_demo",
        platform: "youtube",
        action: "Subscribe",
        user: "Demo Star",
        title: "Demo Channel",
        url: "https://youtube.com/@demo",
        payout: 20,
        mine: true,
        authorEmail: "demo@flexfam.io",
        created: Date.now(),
        actions: 2,
        spent: 40,
        active: true
      }])
    };

    const { dom, errors } = createDOM(file, { storage: demoStorage, userEmail: "demo@flexfam.io" });
    await sleep(40);

    const doc = dom.window.document;
    const clickableEls = doc.querySelectorAll("button, .chip, [data-filter], [data-tab], [data-close-modal], .burger");
    let clickCount = 0;
    let clickErrors = [];

    for (const el of clickableEls) {
      try {
        el.click();
        clickCount++;
      } catch (err) {
        clickErrors.push(`Error clicking ${el.tagName}#${el.id || el.className}: ${err.message}`);
      }
    }

    check(`${file} (${clickCount} clickable elements tested, 0 throw errors)`, clickErrors.length === 0, clickErrors);
    dom.window.close();
  }

  /* -------------------------------------------------------------
     SECTION 4: 2-Account End-to-End Campaign Lifecycle Loop
     ------------------------------------------------------------- */
  console.log("\n[SECTION 4] 2-Account End-to-End Campaign Lifecycle & Cross-Ownership Fix");

  const sharedStorage = {};

  // Step 4.1: Alice Signup on signup.html
  console.log("\n  --- Step 4.1: Alice Signup ---");
  const signupDom = createDOM("signup.html", { storage: sharedStorage });
  await sleep(30);
  const aliceSignupRes = await signupDom.dom.window.FF.signupMember("Alice", "alice@test.dev", "password123");
  check("Alice signup succeeds", !!aliceSignupRes);
  signupDom.dom.window.FF.awardCredits("alice@test.dev", 475, "Initial creator balance"); // 25 welcome + 475 = 500
  signupDom.dom.window.close();

  // Step 4.2: Alice Adds Campaign on add.html
  console.log("\n  --- Step 4.2: Alice Posts Campaign on add.html ---");
  const addDom = createDOM("add.html", { storage: sharedStorage, userEmail: "alice@test.dev" });
  await sleep(30);
  const aliceUser = addDom.dom.window.FF.currentUser();
  check("Alice is logged in with credits", aliceUser && aliceUser.credits === 500, aliceUser ? aliceUser.credits : null);

  const addDoc = addDom.dom.window.document;
  const form = addDoc.getElementById("add-form") || addDoc.querySelector("form");
  const ytPicker = addDoc.querySelector('[data-pf="youtube"]');
  if (ytPicker) ytPicker.click();

  const titleInput = addDoc.getElementById("camp-title");
  const urlInput = addDoc.getElementById("camp-url");
  const payoutSlider = addDoc.getElementById("camp-payout");
  const limitInput = addDoc.getElementById("camp-limit");

  titleInput.value = "Alice Tech Channel";
  urlInput.value = "https://youtube.com/@alicetech";
  if (payoutSlider) payoutSlider.value = "50";
  if (limitInput) limitInput.value = "10";

  form.dispatchEvent(new addDom.dom.window.Event("submit", { cancelable: true, bubbles: true }));
  await sleep(30);

  const createdCamps = addDom.dom.window.FF.DB.campaigns();
  const campaignPayload = createdCamps.find((c) => c.authorEmail === "alice@test.dev");
  check("Campaign created successfully via add.html form", !!campaignPayload);
  addDom.dom.window.close();

  // Step 4.3: Alice Views Dashboard (Campaign listing & Pause/Resume)
  console.log("\n  --- Step 4.3: Alice Dashboard (Pause / Resume lifecycle) ---");
  const aliceDashDom = createDOM("dashboard.html", { storage: sharedStorage, userEmail: "alice@test.dev" });
  await sleep(30);
  const aliceDoc = aliceDashDom.dom.window.document;
  const toggleBtn = aliceDoc.querySelector(`[data-toggle-camp="${campaignPayload.id}"]`);
  check("Alice sees pause/resume toggle for her campaign on Dashboard", !!toggleBtn);

  // Pause the campaign
  if (toggleBtn) toggleBtn.click();
  await sleep(30);
  let storedCamp = aliceDashDom.dom.window.FF.DB.campaigns().find((c) => c.id === campaignPayload.id);
  check("Alice campaign is now PAUSED (active === false)", storedCamp && storedCamp.active === false);

  // Resume the campaign (re-query the button from updated DOM)
  const resumeBtn = aliceDoc.querySelector(`[data-toggle-camp="${campaignPayload.id}"]`);
  if (resumeBtn) resumeBtn.click();
  await sleep(30);
  storedCamp = aliceDashDom.dom.window.FF.DB.campaigns().find((c) => c.id === campaignPayload.id);
  check("Alice campaign is now RESUMED (active === true)", storedCamp && storedCamp.active === true);
  aliceDashDom.dom.window.close();

  // Step 4.4: Alice visits Earn page (Own Campaign Check)
  console.log("\n  --- Step 4.4: Alice Earn Page (Own Campaign Check) ---");
  const aliceEarnDom = createDOM("earn.html", { storage: sharedStorage, userEmail: "alice@test.dev" });
  await sleep(30);
  const aliceEarnDoc = aliceEarnDom.dom.window.document;
  const aliceTaskBtn = aliceEarnDoc.querySelector(`[data-task="${campaignPayload.id}"]`);
  check("Alice sees her campaign on Earn page", !!aliceTaskBtn);
  check("Alice campaign button shows 'Your campaign 👑'", aliceTaskBtn && aliceTaskBtn.textContent.trim().includes("Your campaign"));
  check("Alice campaign button is DISABLED for owner", aliceTaskBtn && aliceTaskBtn.disabled === true);
  aliceEarnDom.dom.window.close();

  // Step 4.5: Bob Signup on signup.html
  console.log("\n  --- Step 4.5: Bob Signup ---");
  const bobSignupDom = createDOM("signup.html", { storage: sharedStorage });
  await sleep(30);
  const bobSignupRes = await bobSignupDom.dom.window.FF.signupMember("Bob", "bob@test.dev", "password123");
  check("Bob signup succeeds", !!bobSignupRes);
  const bobInitialUser = bobSignupDom.dom.window.FF.currentUser();
  check("Bob has +25 welcome bonus points", bobInitialUser && bobInitialUser.credits === 25, bobInitialUser ? bobInitialUser.credits : null);
  bobSignupDom.dom.window.close();

  // Step 4.6: Bob visits Earn page (CROSS-ACCOUNT OWNERSHIP BUG FIX VERIFICATION)
  console.log("\n  --- Step 4.6: Bob Earn Page (Cross-Account Ownership Fix Verification) ---");
  const bobEarnDom = createDOM("earn.html", { storage: sharedStorage, userEmail: "bob@test.dev" });
  await sleep(30);
  const bobEarnDoc = bobEarnDom.dom.window.document;
  const bobTaskBtn = bobEarnDoc.querySelector(`[data-task="${campaignPayload.id}"]`);

  check("Bob sees Alice's campaign on Earn page", !!bobTaskBtn);
  check("BUG FIX: Alice's campaign does NOT show 'Your campaign 👑' to Bob", bobTaskBtn && !bobTaskBtn.textContent.includes("Your campaign"), bobTaskBtn ? bobTaskBtn.textContent.trim() : null);
  check("BUG FIX: Bob's campaign action button shows 'Start Task'", bobTaskBtn && bobTaskBtn.textContent.trim().includes("Start Task"), bobTaskBtn ? bobTaskBtn.textContent.trim() : null);
  check("BUG FIX: Bob's campaign action button is ENABLED", bobTaskBtn && bobTaskBtn.disabled === false);

  // Step 4.7: Bob Submits Proof
  console.log("\n  --- Step 4.7: Bob Submits Proof ---");
  bobTaskBtn.click();
  const campModal = bobEarnDoc.getElementById("camp-modal");
  check("Task modal opens when Bob clicks 'Start Task'", campModal && campModal.classList.contains("open"));

  const proofInput = bobEarnDoc.getElementById("cm-proof");
  const noteInput = bobEarnDoc.getElementById("cm-note");
  const submitProofBtn = bobEarnDoc.getElementById("cm-submit");

  proofInput.value = "https://youtube.com/screenshot_bob_sub123";
  noteInput.value = "Subscribed to Alice Tech Channel!";
  submitProofBtn.click();
  await sleep(30);

  const bobSubs = bobEarnDom.dom.window.FF.DB.campSubs();
  const bobSub = bobSubs.find((s) => s.campaignId === campaignPayload.id && s.worker === "bob@test.dev");
  check("Campaign submission recorded with status 'pending'", !!bobSub && bobSub.status === "pending", bobSub);
  check("Submission owner is Alice", bobSub && bobSub.owner === "alice@test.dev", bobSub ? bobSub.owner : null);

  const bobTaskBtnAfter = bobEarnDoc.querySelector(`[data-task="${campaignPayload.id}"]`);
  check("After proof submission, Bob's button shows 'Pending review'", bobTaskBtnAfter && bobTaskBtnAfter.textContent.trim().includes("Pending review"));
  check("After proof submission, Bob's button is disabled", bobTaskBtnAfter && bobTaskBtnAfter.disabled === true);
  bobEarnDom.dom.window.close();

  // Step 4.8: Alice Reviews and Approves Bob's Submission on Dashboard
  console.log("\n  --- Step 4.8: Alice Reviews & Approves Submission ---");
  const aliceReviewDashDom = createDOM("dashboard.html", { storage: sharedStorage, userEmail: "alice@test.dev" });
  await sleep(30);
  const aliceReviewDoc = aliceReviewDashDom.dom.window.document;
  const approveBtn = aliceReviewDoc.querySelector(`[data-camp-ok="${bobSub.id}"]`);
  check("Alice sees Bob's pending submission on her Dashboard", !!approveBtn);

  if (approveBtn) approveBtn.click();
  await sleep(30);

  const updatedSubs = aliceReviewDashDom.dom.window.FF.DB.campSubs();
  const reviewedSub = updatedSubs.find((s) => s.id === bobSub.id);
  check("Submission status is now 'approved'", reviewedSub && reviewedSub.status === "approved", reviewedSub ? reviewedSub.status : null);
  aliceReviewDashDom.dom.window.close();

  // Step 4.9: Bob Receives Points & Campaign shows Completed
  console.log("\n  --- Step 4.9: Bob Points Credited & Task Completed ---");
  const bobFinalEarnDom = createDOM("earn.html", { storage: sharedStorage, userEmail: "bob@test.dev" });
  await sleep(30);
  const bobFinalUser = bobFinalEarnDom.dom.window.FF.currentUser();
  // Bob started with 25 welcome points + earned 50 payout from approved campaign = 75 points
  check("Bob received +50 points payout (total credits = 75)", bobFinalUser && bobFinalUser.credits === 75, bobFinalUser ? bobFinalUser.credits : null);

  const bobFinalTaskBtn = bobFinalEarnDom.dom.window.document.querySelector(`[data-task="${campaignPayload.id}"]`);
  check("Alice's campaign now displays 'Completed ✓' for Bob", bobFinalTaskBtn && bobFinalTaskBtn.textContent.trim().includes("Completed"));
  check("Completed campaign button is disabled", bobFinalTaskBtn && bobFinalTaskBtn.disabled === true);
  bobFinalEarnDom.dom.window.close();

  /* -------------------------------------------------------------
     SECTION 5: Error Tracking & Admin Live Issue Alerts
     ------------------------------------------------------------- */
  console.log("\n[SECTION 5] User Error Tracking & Admin Issue Alerts");

  const errorEventsLog = [];
  const customFetchWithEvents = (url, opts) => {
    const u = String(url);
    if (opts && opts.method === "POST" && u.includes("/rest/v1/events")) {
      const rows = JSON.parse(opts.body || "[]");
      (Array.isArray(rows) ? rows : [rows]).forEach((r) => errorEventsLog.push(r));
      return Promise.resolve({ ok: true, status: 201, text: () => Promise.resolve("[]"), json: () => Promise.resolve([]) });
    }
    if (u.includes("/rest/v1/events")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => `0-${errorEventsLog.length}/${errorEventsLog.length}` },
        text: () => Promise.resolve(JSON.stringify(errorEventsLog)),
        json: () => Promise.resolve(errorEventsLog)
      });
    }
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("[]"), json: () => Promise.resolve([]) });
  };

  // 1. User triggers an error toast (e.g. invalid URL or form error)
  const userErrorDom = createDOM("add.html", {
    storage: sharedStorage,
    userEmail: "bob@test.dev",
    customFetch: customFetchWithEvents
  });
  await sleep(30);

  userErrorDom.dom.window.FF.toast("Please enter a valid URL — e.g. t.me/yourchannel", "err");
  await sleep(50);
  userErrorDom.dom.window.close();

  check("User error toast is tracked to analytics events", errorEventsLog.some((e) => e.type === "app_error" && e.label.includes("valid URL")), errorEventsLog);

  // 2. Admin opens admin.html and views error panel & stat cards
  const adminStorage = {
    ...sharedStorage,
    ff_admin_session: JSON.stringify({
      access_token: "mock-admin-token-123",
      user: { email: "ravanyt001@gmail.com" }
    })
  };

  const adminDom = createDOM("admin.html", {
    storage: adminStorage,
    customFetch: (url, opts) => {
      const u = String(url);
      if (opts && opts.method === "POST" && u.includes("/rest/v1/events")) {
        const rows = JSON.parse(opts.body || "[]");
        (Array.isArray(rows) ? rows : [rows]).forEach((r) => errorEventsLog.push(r));
        return Promise.resolve({ ok: true, status: 201, text: () => Promise.resolve("[]"), json: () => Promise.resolve([]) });
      }
      if (u.includes("/rest/v1/events")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: (h) => (h && h.toLowerCase() === "content-range" ? `0-0/${errorEventsLog.length}` : null) },
          text: () => Promise.resolve(JSON.stringify(errorEventsLog)),
          json: () => Promise.resolve(errorEventsLog)
        });
      }
      if (u.includes("/rest/v1/profiles")) {
        const profiles = [
          { id: "usr_alice", email: "alice@test.dev", display_name: "Alice", created_at: new Date().toISOString() },
          { id: "usr_bob", email: "bob@test.dev", display_name: "Bob", created_at: new Date().toISOString() }
        ];
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: () => Promise.resolve(JSON.stringify(profiles)),
          json: () => Promise.resolve(profiles)
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve("[]"),
        json: () => Promise.resolve([])
      });
    }
  });
  await sleep(100);
  const adminDoc = adminDom.dom.window.document;

  const errorRows = adminDoc.getElementById("t-errors");
  check("Admin sees the user error in the 'User Errors & Issues' panel", errorRows && errorRows.innerHTML.includes("valid URL"));
  check("Admin error card is populated", adminDoc.getElementById("k-errors") && adminDoc.getElementById("k-errors").textContent !== "—");

  adminDom.dom.window.close();

  /* -------------------------------------------------------------
     AUDIT SUMMARY
     ------------------------------------------------------------- */
  console.log("\n===============================================================");
  console.log(` AUDIT COMPLETE: ${pass} PASSED, ${fail} FAILED`);
  console.log("===============================================================");

  if (fail > 0) {
    process.exit(1);
  }
}

runAudit().catch((err) => {
  console.error("FATAL AUDIT RUNNER ERROR:", err);
  process.exit(2);
});
