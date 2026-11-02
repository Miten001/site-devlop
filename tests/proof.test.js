/* =========================================================================
   FlexFam — PROOF flow tests
   -------------------------------------------------------------------------
   - worker form has BOTH a typed-text box and a screenshot file attach
     (Task Market + point campaigns)
   - typed text / link / screenshot survive together in one submission
   - legacy "text | https://...png" proofs still render
   - task poster, admin payments panel and the shared viewer show the typed
     text and the full screenshot (not a truncated raw string)
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
      window.URL.createObjectURL = () => "blob:mock-proof";
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

async function main() {
  console.log("\n[PROOF 1] Both proof options exist in the forms");
  const tasks = read("tasks.html"), earn = read("earn.html"), post = read("post-task.html"), mine = read("my-tasks.html");
  check("Task Market: typed proof is a textarea box", /<textarea id="jm-proof"/.test(tasks));
  check("Task Market: separate proof link field", /id="jm-link"/.test(tasks));
  check("Task Market: screenshot file attach", /<input type="file" id="jm-file"/.test(tasks));
  check("Task Market: attach field is NOT hidden by default", /<div class="field" style="text-align:left" id="jm-attach-field">/.test(tasks));
  check("Campaigns: typed proof + link + file attach", /<textarea id="cm-text"/.test(earn) && /id="cm-proof"/.test(earn) && /id="cm-file"/.test(earn));
  check("Post a Task: proof instructions is a typing box", /<textarea id="j-proof"/.test(post));
  check("Post a Task: example screenshot file attach", /<input type="file" id="j-proof-file"/.test(post));
  check("Post a Task: explains both worker options", /typed text \/ link/.test(post) && /screenshot file attach/.test(post));
  check("Task Market shows the buyer's example screenshot", /id="jm-example"/.test(tasks));
  check("Admin job edit: proof note is a typing box", /<textarea id="je-proof"/.test(read("admin.html")));
  check("My Tasks: all-submissions history panel", /id="hist-body"/.test(mine));
  check("Shared proof helper loaded on owner + admin pages",
    ["tasks.html", "earn.html", "post-task.html", "my-tasks.html", "dashboard.html", "admin.html", "admin-payments.html"]
      .every((f) => read(f).includes("assets/js/proof.js")));

  console.log("\n[PROOF 2] encode / decode / display");
  const storage = {
    ff_users: JSON.stringify([
      { id: "u_alice", email: "alice@test.dev", name: "Alice", credits: 100 },
      { id: "u_bob", email: "bob@test.dev", name: "Bob", credits: 100 },
      { id: "u_admin", email: "ravanyt001@gmail.com", name: "Admin", credits: 0 }
    ]),
    ff_wallets: JSON.stringify({
      "alice@test.dev": { available: 100, locked: 0, totalEarned: 0, totalDeposited: 0, totalWithdrawn: 0, txns: [] }
    })
  };
  const setup = createDOM("tasks.html", storage, "alice@test.dev");
  await sleep(40);
  const win = setup.dom.window;
  const P = win.FFProof, W = win.FF.W;
  check("FFProof helper available", !!P);

  const text = "Subscribed as @bob_dev\nStep 2: liked the latest video";
  const link = "https://example.com/post/123";
  const shot = "https://example.com/storage/v1/object/public/proofs/bob/shot.png";
  const proof = P.build({ text, link, image: shot });
  const parsed = P.parse(proof);
  check("Typed text survives (multi-line)", parsed.text === text, parsed.text);
  check("Proof link survives", parsed.links.indexOf(link) > -1, parsed.links);
  check("Screenshot survives", parsed.images.indexOf(shot) > -1, parsed.images);
  check("Typed text does NOT contain the raw URL", parsed.text.indexOf("https://") < 0);

  const legacy = P.parse("my username is @bob | " + shot);
  check("Legacy 'text | screenshot.png' text parsed", legacy.text === "my username is @bob", legacy.text);
  check("Legacy screenshot detected", legacy.shot === shot, legacy.shot);

  const exampleNote = P.parse("Subscribe, then send your username\n" + "📎 Screenshot: " + shot);
  check("Buyer's typed instructions + example screenshot parse apart",
    exampleNote.text === "Subscribe, then send your username" && exampleNote.shot === shot, exampleNote);

  const embedded = P.parse(P.build({ text: "hello", image: "data:image/jpeg;base64," + "A".repeat(500) }));
  check("Embedded screenshot kept out of typed text", embedded.text === "hello" && embedded.images.length === 1);
  check("Raw audit view masks base64 data", P.viewer(P.build({ text: "hello", image: "data:image/jpeg;base64," + "A".repeat(500) })).includes("[embedded screenshot]"));

  const cell = P.cell(proof, { title: "Subscribe task", worker: "Bob" });
  check("Proof cell has a screenshot thumbnail", cell.includes("<img") && cell.includes(shot));
  check("Proof cell has a full-proof button", cell.includes("View full proof"));
  check("Viewer escapes HTML in typed text", !P.viewer(P.build({ text: "<script>alert(1)</script>" })).includes("<script>"));
  check("Viewer shows screenshot + link + note", (() => {
    const v = P.viewer(proof, { note: "Please check fast" });
    return v.includes(shot) && v.includes(link) && v.includes("Please check fast");
  })());

  console.log("\n[PROOF 3] worker submission → poster + admin see the same proof");
  const job = W.postJob("alice@test.dev", "Alice", {
    title: "Subscribe to my YouTube channel", category: "social",
    description: "Open the channel, subscribe with your real account, like the latest video and send a screenshot.",
    url: "", proofNote: "Screenshot + your username", reward: 0.10, slots: 2
  });
  check("Task posted in local ledger", !!job && job.id);
  const sub = W.submitProof("bob@test.dev", "Bob", job.id, proof, "Done from my main account");
  check("Proof submitted with text + link + screenshot", !!sub && sub.proof === proof);

  const exampleShot = "https://example.com/storage/v1/object/public/proofs/alice/example.png";
  const job2 = W.postJob("alice@test.dev", "Alice", {
    title: "Follow my Instagram page", category: "social",
    description: "Open the profile, follow with your real account and send a screenshot of the followed state.",
    url: "", proofNote: "Send your username + screenshot\n📎 Screenshot: " + exampleShot,
    reward: 0.10, slots: 2
  });
  check("Second task posted with an example screenshot in proofNote", !!job2 && job2.proofNote.includes(exampleShot));
  setup.dom.window.close();

  const owner = createDOM("my-tasks.html", storage, "alice@test.dev");
  await sleep(60);
  const od = owner.dom.window.document;
  check("Poster sees the pending submission", od.getElementById("rev-body").innerHTML.includes("View full proof"));
  check("Poster sees typed proof preview in table", od.getElementById("rev-body").textContent.includes("Subscribed as @bob_dev"));
  check("Poster sees screenshot thumbnail in table", od.getElementById("rev-body").innerHTML.includes(shot));
  check("Poster history panel lists the submission", od.getElementById("hist-body").innerHTML.includes("View full proof"));

  const viewBtn = od.querySelector('#rev-body [data-view]');
  if (viewBtn) viewBtn.click();
  await sleep(20);
  const viewerHtml = od.getElementById("sm-proof-viewer").innerHTML;
  check("Poster review modal shows full typed text", viewerHtml.includes("Subscribed as @bob_dev") && viewerHtml.includes("Step 2"));
  check("Poster review modal shows full screenshot", viewerHtml.includes(shot));
  check("Poster review modal shows worker note", viewerHtml.includes("Done from my main account"));
  check("Poster review modal shows proof link", viewerHtml.includes(link));

  const cellBtn = od.querySelector("#hist-body .ffp-view");
  if (cellBtn) cellBtn.click();
  await sleep(20);
  const modal = od.getElementById("ffp-modal");
  check("Shared full-proof lightbox opens", !!modal && modal.classList.contains("open"));
  check("Shared lightbox shows typed text + screenshot", !!modal && modal.textContent.includes("Subscribed as @bob_dev") && modal.innerHTML.includes(shot));
  check("No uncaught JS errors on owner page", owner.errors.length === 0, owner.errors);
  owner.dom.window.close();

  const admin = createDOM("admin-payments.html", storage, "ravanyt001@gmail.com");
  await sleep(60);
  const ad = admin.dom.window.document;
  check("Admin payments queue shows View full proof", ad.getElementById("js-body").innerHTML.includes("View full proof"));
  check("Admin payments queue shows the screenshot thumbnail", ad.getElementById("js-body").innerHTML.includes(shot));
  check("No uncaught JS errors on admin payments page", admin.errors.length === 0, admin.errors);
  admin.dom.window.close();

  const worker = createDOM("tasks.html", storage, "bob@test.dev");
  await sleep(60);
  const wd = worker.dom.window.document;
  const doBtn = wd.querySelector('[data-job="' + job2.id + '"]');
  check("Worker sees the buyer's task in the market", !!doBtn);
  if (doBtn) doBtn.click();
  await sleep(20);
  const example = wd.getElementById("jm-example");
  check("Worker sees the buyer's example screenshot", !!example && !example.classList.contains("hidden") && example.innerHTML.includes(exampleShot));
  check("Buyer's typed instructions shown without the raw image URL",
    wd.getElementById("jm-proofnote").textContent.includes("Send your username") &&
    !wd.getElementById("jm-proofnote").textContent.includes("https://"));
  check("Worker form still has BOTH proof inputs", !!wd.querySelector('textarea#jm-proof') && !!wd.querySelector('input#jm-file'));
  check("No uncaught JS errors on worker page", worker.errors.length === 0, worker.errors);
  worker.dom.window.close();

  console.log("\n===============================================================");
  console.log(` PROOF TESTS: ${pass} PASSED, ${fail} FAILED`);
  console.log("===============================================================");
  if (fail) process.exit(1);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(2); });
