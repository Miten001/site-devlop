/* ============================================================
   FLEXFAM — campaign server sync
   ------------------------------------------------------------
   PROBLEM: "Add Page" campaigns sirf localStorage mein save hote
   the (ff_campaigns), isliye sirf banane wale ke browser mein
   dikhte the — dusre members ko kabhi nahi.

   FIX: ye file campaign system ko Supabase se jodti hai (bilkul
   wallet.js / task marketplace jaisa pattern):
     * Server session hai   -> har action RPC (campaigns_*) chalta
       hai aur server ka feed localStorage cache mein adopt hota
       hai, isliye purane pages (earn/dashboard) jaise the waise
       hi kaam karte hain — bas ab sabko dikhta hai.
     * Demo/local account   -> purana browser-only behaviour.

   REQUIREMENT: supabase-campaigns.sql pehle Supabase mein run
   hona chahiye. Warna RPC fail hoga aur local mode chalega.
   ============================================================ */

(function () {
  "use strict";
  if (!window.FF) return;

  function num(n) { return Number(n || 0); }

  function dedupeById(list) {
    const seen = {};
    const out = [];
    (list || []).forEach((x) => {
      if (x && x.id && !seen[x.id]) { seen[x.id] = 1; out.push(x); }
    });
    return out;
  }

  /* Server feed -> wahi shapes jo pages pehle se render karte hain
     (earn.html: FF.DB.campaigns() / myCampSubs / doneMap,
      dashboard.html: user.campaigns / campSubsFor). */
  function adopt(feed) {
    if (!feed) return false;
    const u = FF.currentUser();
    if (!u) return false;

    const camps = [];
    (feed.open || []).forEach((c) => camps.push({
      id: c.id, platform: c.platform, action: c.action,
      user: c.user || "Member", title: c.title, url: c.url || "",
      payout: num(c.payout), mine: !!c.mine, active: c.active !== false,
      authorEmail: c.authorEmail || "", created: num(c.created),
      actions: num(c.actions), spent: num(c.spent),
    }));
    (feed.mine || []).forEach((c) => camps.push({
      id: c.id, platform: c.platform, action: c.action,
      user: c.user || u.name, title: c.title, url: c.url || "",
      payout: num(c.payout), mine: true, active: c.active !== false,
      authorEmail: c.authorEmail || u.email, created: num(c.created),
      actions: num(c.actions), spent: num(c.spent),
    }));
    FF.DB.saveCampaigns(dedupeById(camps));

    const subs = [];
    (feed.mySubs || []).forEach((s) => subs.push({
      id: s.id, campaignId: s.campaignId, campaignTitle: s.campaignTitle || "",
      worker: u.email, workerName: u.name, owner: "",
      payout: num(s.payout), proof: s.proof || "", note: s.note || "",
      status: s.status, reason: s.reason || "",
      at: num(s.at), reviewedAt: s.reviewedAt ? num(s.reviewedAt) : null,
    }));
    (feed.inbox || []).forEach((s) => subs.push({
      id: s.id, campaignId: s.campaignId, campaignTitle: s.campaignTitle || "",
      worker: s.workerEmail || "", workerName: s.workerName || "Member",
      owner: u.email, payout: num(s.payout),
      proof: s.proof || "", note: s.note || "",
      status: s.status, reason: s.reason || "",
      at: num(s.at), reviewedAt: s.reviewedAt ? num(s.reviewedAt) : null,
    }));
    FF.DB.saveCampSubs(dedupeById(subs));

    if (Array.isArray(feed.done)) {
      const dm = FF.DB.doneMap();
      dm[u.email] = feed.done.slice();
      FF.DB.saveDoneMap(dm);
    }

    /* Dashboard "My campaigns" user record mein mirror karo. */
    FF.updateUser(u.email, {
      campaigns: (feed.mine || []).map((c) => ({
        id: c.id, platform: c.platform, action: c.action,
        title: c.title, url: c.url || "", payout: num(c.payout),
        active: c.active !== false, actions: num(c.actions),
        spent: num(c.spent), created: num(c.created),
      })),
    });

    document.dispatchEvent(new CustomEvent("ff:campaigns-synced"));
    return true;
  }

  /* Points payout ke baad header chips (points/USDT) ko turant
     refresh karne ke liye wallet state dobara laao. */
  function syncWallet() {
    try {
      if (FF.W && FF.W.api && FF.W.serverReady && FF.W.serverReady()) {
        FF.W.api.wallet().catch(() => {});
      }
    } catch (e) { /* ignore */ }
  }

  /* Browser me kamaye points (welcome bonus, daily missions, campaigns)
     server ledger me NHI hote — aur campaigns_post/review SERVER balance
     check karte hain. Isliye campaign banane/approve karne se PEHLE jo
     points is browser me kamae gaye the (server snapshot se upar wale)
     unhe wallet_import_points se server par bhej do. warna naya user
     "Not enough points — you have 0 on the server" error par atak jaata hai. */
  function ensurePointsImported() {
    if (!FF.hasServer() || !FF.W || !FF.W.api) return Promise.resolve();
    const u = FF.currentUser();
    if (!u) return Promise.resolve();
    const marks = FF.store.get("ff_srv_sync", {});
    const mark = Object.assign({ pts: 0, usdt: 0 }, marks[u.email]);
    const excess = Math.max(0, Math.floor(Number(u.credits || 0)) - Number(mark.pts || 0));
    if (excess < 1) return Promise.resolve();
    return FF.rpc("wallet_import_points", { p_points: excess })
      .then(() => FF.W.api.wallet().catch(() => {}))
      .catch(() => { /* import SQL installed nahi / daily cap — aage baro, server
                        apna clear error de dega agar points kam hain */ });
  }

  function refresh() {
    if (!FF.hasServer()) return Promise.resolve(false);
    return FF.rpc("campaigns_feed")
      .then((feed) => adopt(feed))
      .catch(() => false);
  }

  /* ---------- FF API wrap: server mode = Postgres, warna local ---------- */

  const localAdd = FF.addCampaign;
  FF.addCampaign = function (camp) {
    if (!FF.hasServer()) return localAdd(camp);
    return ensurePointsImported().then(() => FF.rpc("campaigns_post", {
      p_id: camp.id, p_platform: camp.platform, p_action: camp.action,
      p_title: camp.title, p_url: camp.url, p_payout: Number(camp.payout || 0),
    }).then((feed) => { adopt(feed); return camp; }));
  };

  const localSubmit = FF.submitCampaignProof;
  FF.submitCampaignProof = function (email, name, campaignId, proof, note) {
    if (!FF.hasServer()) return localSubmit(email, name, campaignId, proof, note);
    return FF.rpc("campaigns_submit_proof", {
      p_campaign: campaignId, p_proof: proof, p_note: note || "",
    }).then((feed) => { adopt(feed); });
  };

  const localReview = FF.reviewCampaignSub;
  FF.reviewCampaignSub = function (subId, approve, reason) {
    if (!FF.hasServer()) return localReview(subId, approve, reason);
    return ensurePointsImported().then(() => FF.rpc("campaigns_review", {
      p_sub: subId, p_approve: !!approve, p_reason: reason || "",
    }).then((feed) => { adopt(feed); syncWallet(); }));
  };

  const localUpdate = FF.updateCampaign;
  FF.updateCampaign = function (id, patch) {
    if (!FF.hasServer() || !patch || !("active" in patch)) return localUpdate(id, patch);
    return FF.rpc("campaigns_toggle", { p_campaign: id, p_active: !!patch.active })
      .then((feed) => { adopt(feed); });
  };

  const localDelete = FF.deleteCampaign;
  FF.deleteCampaign = function (id) {
    if (!FF.hasServer()) return localDelete(id);
    return FF.rpc("campaigns_delete", { p_campaign: id })
      .then((feed) => { adopt(feed); });
  };

  FF.campaignsSync = { refresh: refresh, adopt: adopt };

  /* Har page load par server se fresh campaign state lo
     (SQL installed na ho to chup-chaap local mode chalta rahega). */
  document.addEventListener("DOMContentLoaded", () => { refresh(); });
})();
