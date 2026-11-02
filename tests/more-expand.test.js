/* =========================================================================
   FlexFam — "+N more" expand tests
   -------------------------------------------------------------------------
   Screenshot issue: admin → Posted tasks → "Running / workers" me
   "+38 more" sirf likha hua tha, click karne par kuch nahi hota tha.
   Ab dono jagah (admin workers + referral pyramid) "+N more" ek real
   button hai jo chhupe hue sab items dikhata hai aur dobara tap par
   wapas chhupa deta hai.
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
const tick = () => new Promise((r) => setTimeout(r, 0));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function inlinedHtml(file) {
  return read(file).replace(/<script\s+src="([^"]+)"><\/script>/gi, (match, src) => {
    const p = path.join(ROOT, src.split("?")[0]);
    return fs.existsSync(p) ? "<script>" + fs.readFileSync(p, "utf8") + "<\/script>" : match;
  });
}
function jsdomOptions(extra) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (err) => errors.push(err.message));
  return Object.assign({
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.scrollTo = () => {};
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => "";
      window.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("[]"), json: () => Promise.resolve([]) });
      if (extra) extra(window);
    }
  }, { errors });
}

async function main() {
  console.log("\n[MORE 1] Static wiring");
  const admin = read("admin.html");
  const refer = read("refer.html");
  check("Admin renders a real +N more button", /class="workers-more" data-workers-more/.test(admin));
  check("Admin renders ALL remaining workers (hidden by default)", /class="workers-extra/.test(admin) && /rest\.map\(workerRow\)/.test(admin));
  check("Admin keeps expansion across refresh / filters", /var expandedWorkers = \{\}/.test(admin) && /!!expandedWorkers\[j\.id\]/.test(admin));
  check("Admin has a toggle handler", /closest\("\[data-workers-more\]"\)/.test(admin) && /Show less ▴/.test(admin));
  check("Admin +N more button is keyboard/ARIA aware", /aria-expanded/.test(admin) && /:focus-visible/.test(admin));
  check("Old dead text '+38 more' is gone", !/camp-sub">\+\' \+ \(workers\.length - 6\)/.test(admin));
  check("Posted tasks panel explains the tap", /\+N more<\/b> par tap/.test(admin));
  check("Referral pyramid has a real +N more button", /data-pyr-more/.test(refer) && /class="pyr-more"/.test(refer));
  check("Referral pyramid renders hidden extra names", /pyr-extra hidden/.test(refer));
  check("Referral pyramid click handler registered on the list", /pyr-body"\)\.addEventListener\("click"/.test(refer));
  check("Referral names are no longer ellipsis-clipped", /class="pyr-names"/.test(refer) && !/white-space:nowrap;overflow:hidden;text-overflow:ellipsis/.test(refer));

  /* ---------------------------------------------------------------- */
  console.log("\n[MORE 2] Admin Posted tasks — click reveals all workers");
  const aOpts = jsdomOptions((window) => {
    window.FF_SUPABASE_CONFIG = { url: "https://db.example.test", anonKey: "public-test-key" };
    window.FF_ADMIN_EMAILS = ["admin@example.test"];
  });
  const aDom = new JSDOM(admin, Object.assign({ url: "https://example.test/admin.html" }, aOpts));
  await tick();
  await tick();
  const ad = aDom.window.document;
  const tbody = ad.getElementById("t-jobs");
  check("Posted tasks table body exists", !!tbody);
  const rows = Array.from({ length: 38 }, (_, i) =>
    '<div style="white-space:nowrap"><span class="st-pill">…</span> hiddenWorker' + (i + 1) + "</div>").join("");
  tbody.innerHTML = "<tr><td>" +
    '<div>✅ visibleWorker1</div>' +
    '<div class="workers-extra hidden">' + rows + "</div>" +
    '<button type="button" class="workers-more" data-workers-more="job-1" data-count="38" aria-expanded="false">+38 more ▾</button>' +
    "</td></tr>";
  const btn = tbody.querySelector("[data-workers-more]");
  const extra = tbody.querySelector(".workers-extra");
  check("Collapsed by default (only 6 names visible)", extra.classList.contains("hidden") && btn.textContent.includes("+38 more"));
  btn.click();
  check("Tap on +38 more reveals the hidden workers", !extra.classList.contains("hidden") &&
    extra.textContent.includes("hiddenWorker38"));
  check("Button becomes 'Show less' with aria-expanded=true", btn.textContent.includes("Show less") &&
    btn.getAttribute("aria-expanded") === "true");
  btn.click();
  check("Second tap collapses again", extra.classList.contains("hidden") &&
    btn.textContent.includes("+38 more") && btn.getAttribute("aria-expanded") === "false");
  check("Clicking a worker name does NOT re-toggle the list", (() => {
    btn.click(); // open again
    const before = extra.classList.contains("hidden");
    const name = extra.querySelector("div");
    if (name) name.click();
    return before === extra.classList.contains("hidden");
  })());
  check("No uncaught JS errors on admin page", aOpts.errors.length === 0, aOpts.errors);
  aDom.window.close();

  /* ---------------------------------------------------------------- */
  console.log("\n[MORE 3] Referral pyramid — click reveals all names");
  const rOpts = jsdomOptions((window) => {
    /* refer.html auth-guarded hai — bina user ke pyramid script hi nahi chalti */
    window.localStorage.setItem("ff_session", JSON.stringify("bob@test.dev"));
    window.localStorage.setItem("ff_users", JSON.stringify([
      { id: "u_bob", email: "bob@test.dev", name: "Bob", credits: 100 }
    ]));
  });
  const rDom = new JSDOM(inlinedHtml("refer.html"), Object.assign({ url: "https://example.test/refer.html" }, rOpts));
  await tick();
  await tick();
  const rd = rDom.window.document;
  const pyr = rd.getElementById("pyr-body");
  check("Pyramid body exists", !!pyr);
  pyr.innerHTML = '<div><div class="pyr-names">' +
    'alpha, beta, gamma' +
    '<span class="pyr-extra hidden">, delta, epsilon, zeta</span>' +
    '<button type="button" class="pyr-more" data-pyr-more="0" data-count="3" aria-expanded="false">+3 more ▾</button>' +
    "</div></div>";
  const rBtn = pyr.querySelector("[data-pyr-more]");
  const rExtra = pyr.querySelector(".pyr-extra");
  check("Pyramid collapsed by default", rExtra.classList.contains("hidden") && rBtn.textContent.includes("+3 more"));
  rBtn.click();
  check("Tap reveals all names", !rExtra.classList.contains("hidden") && rExtra.textContent.includes("zeta"));
  check("Pyramid button becomes 'Show less'", rBtn.textContent.includes("Show less") &&
    rBtn.getAttribute("aria-expanded") === "true");
  rBtn.click();
  check("Pyramid collapses with original +N label", rExtra.classList.contains("hidden") && rBtn.textContent.includes("+3 more"));
  check("No uncaught JS errors on refer page", rOpts.errors.length === 0, rOpts.errors);
  rDom.window.close();

  console.log("\n===============================================================");
  console.log(` MORE TESTS: ${pass} PASSED, ${fail} FAILED`);
  console.log("===============================================================");
  if (fail) process.exit(1);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(2); });
