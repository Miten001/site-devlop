/* =========================================================================
   FlexFam — MESSAGE BOX "tap to read full" tests
   -------------------------------------------------------------------------
   - har message surface (bell, dashboard inbox, support box, admin log)
     par message tap/click karne se POORA message khulta hai
   - full view me line breaks / wrapping / metadata / escaping
   - read/unread badges + "Mark all read" safe rehte hain
   - proof flow regress nahi hota
   ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? "   -> " + JSON.stringify(extra) : "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function inlinedHtml(file) {
  return read(file).replace(/<script\s+src="([^"]+)"><\/script>/gi, (match, src) => {
    const p = path.join(ROOT, src.split("?")[0]);
    return fs.existsSync(p) ? "<script>" + fs.readFileSync(p, "utf8") + "<\/script>" : match;
  });
}
function createDOM(file, storage, userEmail) {
  if (userEmail) storage["ff_session"] = JSON.stringify(userEmail);
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
      window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.URL.createObjectURL = () => "blob:mock-msg";
      window.URL.revokeObjectURL = () => {};
      window.scrollTo = () => {};
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => "";
      Object.defineProperty(window, "localStorage", { value: localStorageMock, configurable: true });
      window.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("[]"), json: () => Promise.resolve([]) });
    }
  });
  return { dom, errors };
}

const LONG = "Namaste! Ye message bahut lamba hai aur pehle 2 lines me cut ho jaata tha.\n" +
  "Step 2: apna username bhejo. Step 3: screenshot attach karo. " +
  "Aur detail: https://flexfam.io/help/long-article?ref=message-box " +
  "Iske baad bhi kaafi text hai jo ab poora dikhna chahiye — koi ellipsis nahi. " +
  "Ant tak padhne ke liye message par tap karo.";

async function main() {
  /* ---------------------------------------------------------------- */
  console.log("\n[MESSAGES 1] Shared full-message viewer is wired everywhere");
  const mv = read("assets/js/message-view.js");
  const bell = read("assets/js/bell.js");
  const sup = read("assets/js/support.js");
  const dash = read("dashboard.html");
  const admin = read("admin.html");

  check("Shared module exposes register / open / close",
    /register\s*:\s*register/.test(mv) && /open\s*:\s*open/.test(mv) && /close\s*:\s*close/.test(mv));
  check("Viewer has a real modal (not just CSS un-clamp)", /veil\.id = "ffm-modal"/.test(mv) && /role="dialog"/.test(mv));
  check("Viewer preserves line breaks + wraps long words",
    /white-space:pre-wrap/.test(mv) && /overflow-wrap:anywhere/.test(mv) && /replace\(\/\\n\/g, "<br>"\)/.test(mv));
  check("Viewer escapes user-supplied text", /function esc\(/.test(mv) && /rich\(m\.body/.test(mv) && /out \+= esc\(/.test(mv));
  check("Viewer closes with Escape + backdrop + close button",
    /e\.key === "Escape"/.test(mv) && /data-ffm-close/.test(mv) && /t\.id === "ffm-modal"/.test(mv));
  check("Keyboard (Enter/Space) opens a message", /e\.key !== "Enter" && e\.key !== " "/.test(mv));
  check("Bell notifications are registered as tappable rows", /data-msg-id/.test(bell) && /MV\.register/.test(bell));
  check("Bell tap marks only that notification read", /bell_mark_read/.test(bell) && /p_ids: \[it\.id\]/.test(bell));
  check("Dashboard inbox rows are tappable", /data-msg-id/.test(dash) && /MV\.register/.test(dash));
  check("Dashboard tap-to-read hint is visible", /Tap to read full message/.test(dash));
  check("Dashboard marks just the opened message read", /markMessageRead\(m\.id\)/.test(dash));
  check("Support box history is tappable", /data-msg-id/.test(sup) && /MV\.register/.test(sup));
  check("Support history preserves line breaks / wrapping", /white-space:pre-wrap/.test(sup) && /overflow-wrap:anywhere/.test(sup));
  check("Admin message log rows are tappable", /data-msg-id/.test(admin) && /MV\.register/.test(admin));
  check("Admin log cells no longer clip text", /text-overflow:clip/.test(admin) && /overflow:visible/.test(admin));
  check("Admin message log height increased (less vertical cut)", /\.msg-sent \{ max-height: 460px; \}/.test(admin));
  check("Per-message read RPC is defined", /messages_mark_one_read/.test(read("supabase-community.sql")));
  check("Per-message read helper exported from FF", /markMessageRead,/.test(read("assets/js/main.js")));

  const pagesWithBell = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && /assets\/js\/bell\.js/.test(read(f)));
  check("Every page with the bell also loads the shared viewer",
    pagesWithBell.length > 0 && pagesWithBell.every((f) => /assets\/js\/message-view\.js/.test(read(f))),
    pagesWithBell.filter((f) => !/assets\/js\/message-view\.js/.test(read(f))));

  /* ---------------------------------------------------------------- */
  console.log("\n[MESSAGES 2] Full-message modal runtime (blank page)");
  const unit = new JSDOM("<!doctype html><html><head></head><body></body></html>", { runScripts: "dangerously", url: "https://flexfam.io/" });
  const uw = unit.window;
  uw.eval(mv);
  check("window.FFMessage available", !!uw.FFMessage);
  const id = uw.FFMessage.register({
    kind: "📢 Announcement", title: "Long update <b>test</b>", body: LONG + "\n<script>alert(1)</script>",
    meta: ["Broadcast", "FlexFam team", "02 Nov 2026"]
  });
  const holder = uw.document.createElement("div");
  holder.className = "msg-row";
  holder.setAttribute("data-msg-id", id);
  holder.setAttribute("role", "button");
  holder.setAttribute("tabindex", "0");
  holder.innerHTML = "<p>" + uw.FFMessage.clip(LONG, 80) + "</p>";
  uw.document.body.appendChild(holder);

  holder.click();
  const modal = uw.document.getElementById("ffm-modal");
  check("Tap on a message opens the full-message modal", !!modal && modal.classList.contains("open"));
  const body = uw.document.getElementById("ffm-body");
  check("Full body (not a clipped preview) is shown", !!body && body.textContent.includes("Ant tak padhne ke liye message par tap karo."));
  check("Line breaks are preserved", !!body && body.innerHTML.includes("<br>"));
  check("Title + metadata shown", uw.document.getElementById("ffm-head").textContent.includes("Long update") &&
    uw.document.getElementById("ffm-head").textContent.includes("Broadcast"));
  check("HTML in message is escaped (no injected script)", !!body && !body.innerHTML.includes("<script>") && body.innerHTML.includes("&lt;script&gt;"));
  const injected = uw.document.getElementById("ffm-style") ? uw.document.getElementById("ffm-style").textContent : "";
  check("Link is readable + overflow-wrap CSS injected", injected.includes("overflow-wrap:anywhere") &&
    body.innerHTML.includes("flexfam.io/help/long-article"));
  check("Bell 2-line clamp is lifted to 3 lines", injected.includes(".bi-body{-webkit-line-clamp:3"));
  check("Clickable rows get a visible focus / hover affordance", injected.includes("[data-msg-id]:focus-visible") &&
    injected.includes("cursor:pointer"));
  let otherEscape = 0;
  uw.document.addEventListener("keydown", (e) => { if (e.key === "Escape") otherEscape++; });
  uw.document.dispatchEvent(new uw.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape closes the modal", !modal.classList.contains("open"));
  check("Escape does not also close the support box behind it", otherEscape === 0, otherEscape);
  holder.dispatchEvent(new uw.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  check("Enter on a focused row opens the modal again", modal.classList.contains("open"));
  uw.document.querySelector("[data-ffm-close]").click();
  check("Close button closes the modal", !modal.classList.contains("open"));
  unit.window.close();

  /* ---------------------------------------------------------------- */
  console.log("\n[MESSAGES 3] Dashboard inbox: full message on tap + read state");
  const storage = {
    ff_users: JSON.stringify([
      { id: "u_bob", email: "bob@test.dev", name: "Bob", credits: 100 },
      { id: "u_admin", email: "ravanyt001@gmail.com", name: "Admin", credits: 0 }
    ]),
    ff_messages: JSON.stringify([
      { id: "msg_long", audience: "user", to: "bob@test.dev", title: "Payment update", body: LONG, at: Date.now() - 10000, sentBy: "ravanyt001@gmail.com" },
      { id: "msg_short", audience: "all", title: "New tasks live", body: "10 new tasks added today.", at: Date.now() - 20000, sentBy: "ravanyt001@gmail.com" }
    ])
  };
  const dashDom = createDOM("dashboard.html", storage, "bob@test.dev");
  await sleep(80);
  const dd = dashDom.dom.window.document;
  check("Dashboard rendered the long message", dd.getElementById("msg-list").textContent.includes("Payment update"));
  const rows = dd.querySelectorAll("#msg-list .msg-row[data-msg-id]");
  check("Both inbox rows are tappable", rows.length === 2, rows.length);
  check("Unread badge counts both messages", dd.getElementById("msg-unread").textContent === "2", dd.getElementById("msg-unread").textContent);
  const row = dd.querySelector("#msg-list .msg-row[data-msg-id]");
  if (row) row.click();
  await sleep(20);
  const dModal = dd.getElementById("ffm-modal");
  check("Dashboard tap opens full-message modal", !!dModal && dModal.classList.contains("open"));
  check("Dashboard modal shows the ENTIRE message", !!dModal && dModal.textContent.includes("Ant tak padhne ke liye message par tap karo."));
  check("Dashboard modal keeps sender/date metadata", !!dModal && dModal.textContent.includes("Direct message"));
  await sleep(60);
  const reads = JSON.parse(storage["ff_msg_reads"] || "{}");
  check("Only the opened message is marked read", !!reads["bob@test.dev"] && reads["bob@test.dev"].indexOf("msg_long") > -1 &&
    reads["bob@test.dev"].indexOf("msg_short") === -1, reads);
  check("Mark all read button still present", !!dd.getElementById("msg-read-all"));
  if (dd.getElementById("msg-read-all")) dd.getElementById("msg-read-all").click();
  await sleep(60);
  check("Mark all read clears the unread badge", dd.getElementById("msg-unread").classList.contains("hidden"));
  check("No uncaught JS errors on dashboard", dashDom.errors.length === 0, dashDom.errors);
  dashDom.dom.window.close();

  /* ---------------------------------------------------------------- */
  console.log("\n[MESSAGES 4] Proof flow still intact (regression)");
  const P = read("assets/js/proof.js");
  check("FFProof viewer still exists", /viewer\s*:/.test(P) && /ffp-modal/.test(P));
  check("Proof viewer still loaded on owner page", /assets\/js\/proof\.js/.test(read("my-tasks.html")));
  check("Full-message viewer does not replace proof viewer", /ffm-modal/.test(mv) && !/ffp-modal/.test(mv));

  console.log("\n===============================================================");
  console.log(` MESSAGE TESTS: ${pass} PASSED, ${fail} FAILED`);
  console.log("===============================================================");
  if (fail) process.exit(1);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(2); });
