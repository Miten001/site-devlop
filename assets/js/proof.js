/* =========================================================================
   FlexFam — shared PROOF helper
   -------------------------------------------------------------------------
   Ek submission me ab teen cheezein alag-alag rehti hain:
     1. ✍️  typed text  (username, ID, steps, explanation — multi-line)
     2. 🔗  proof link  (optional)
     3. 📎  screenshot  (file attach → Supabase Storage URL, ya small
                         compressed data URL jab storage available na ho)

   Sab kuch existing `proof` TEXT column me human-readable lines ke taur par
   save hota hai, isliye koi SQL migration zaroori nahi aur purane
   "text | https://...png" wale submissions bhi parse ho jaate hain.

   `FFProof.cell()` / `FFProof.viewer()` / `FFProof.open()` se task poster
   (My Tasks), admin (Proofs / Payments / member modal) aur worker (My
   submissions) ko typed text + bada screenshot ek hi jagah dikhta hai.

   Standalone: kisi bhi FF/Wallet API par dependency nahi (upload ke liye
   FF.hasServer() / FF.accessToken() optional use hote hain).
   ========================================================================= */
(function () {
  "use strict";

  var SHOT_MARK = "📎 Screenshot:";
  var LINK_MARK = "🔗 Proof link:";
  var URL_RE = /https?:\/\/[^\s|]+/gi;
  var IMG_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)(\?|#|$)/i;
  var VID_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
  var STORAGE = /\/storage\/v1\/object\/public\/proofs\//i;

  var registry = {};       // id -> {proof, meta}
  var registryKeys = {};   // same proof+meta kabhi dobara register na ho (poll/re-render)
  var seq = 0;
  var veil = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }
  function clip(s, n) {
    var t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    return t.length > (n || 100) ? t.slice(0, n) + "…" : t;
  }
  function isUrl(u) { return /^(https?:\/\/|data:image\/|data:video\/)/i.test(String(u || "").trim()); }
  function isImage(u) {
    u = String(u || "").trim();
    if (/^data:image\//i.test(u)) return true;
    if (!/^https?:\/\//i.test(u)) return false;
    if (IMG_EXT.test(u)) return true;
    return STORAGE.test(u) && !VID_EXT.test(u);
  }
  function isVideo(u) {
    u = String(u || "").trim();
    return /^data:video\//i.test(u) || (/^https?:\/\//i.test(u) && VID_EXT.test(u));
  }
  function maskData(raw) {
    return String(raw || "").replace(/data:(image|video)\/[^;]+;base64,[A-Za-z0-9+/=]+/gi, "[embedded screenshot]");
  }

  /* ------------------------- encode ------------------------- */
  /* Text, link aur screenshot EK SAATH bhejne ke liye. Sab lines
     human-readable hain — SQL editor me bhi proof samajh aata hai. */
  function build(parts) {
    parts = parts || {};
    var text = String(parts.text || "").trim();
    var link = String(parts.link || "").trim();
    var image = String(parts.image || "").trim();
    var lines = [];
    if (text) lines.push(text);
    if (link && text.indexOf(link) < 0) lines.push(LINK_MARK + " " + link);
    if (image) lines.push(SHOT_MARK + " " + image);
    return lines.join("\n");
  }

  /* ------------------------- decode ------------------------- */
  /* Purane (legacy) proofs bhi handle: plain text, plain URL,
     "text | https://...png", ya marker wale naye proofs. */
  function parse(raw) {
    var source = String(raw == null ? "" : raw);
    var textLines = [], images = [], links = [];
    source.split(/\r?\n/).forEach(function (line) {
      var t = line.trim();
      if (!t) { textLines.push(""); return; }

      var m = t.match(/^(?:📎\s*)?Screenshot\s*:\s*(.+)$/i);
      if (m) {
        var shot = m[1].trim();
        if (isImage(shot) || isVideo(shot)) images.push(shot);
        else textLines.push(line);
        return;
      }
      m = t.match(/^(?:🔗\s*)?(?:Proof\s+)?Link\s*:\s*(.+)$/i);
      if (m) { links.push(m[1].trim()); return; }

      /* data URL kabhi text me nahi dikhana — DOM me lakhon characters */
      if (/^data:(image|video)\//i.test(t)) { images.push(t); return; }

      /* legacy combined format: "worker text | https://....png" */
      if (t.indexOf("|") > -1) {
        var chunks = t.split("|"), kept = [];
        chunks.forEach(function (c) {
          var v = c.trim();
          if (!v) return;
          if (isImage(v) || isVideo(v)) { images.push(v); return; }
          if (/^https?:\/\//i.test(v) && chunks.length > 1) { links.push(v); return; }
          kept.push(v);
        });
        if (kept.length) textLines.push(kept.join(" · "));
        return;
      }

      /* line poora image/video URL ho to alag attachment hai */
      if ((isImage(t) || isVideo(t)) && !/[^\s]\s/.test(t)) { images.push(t); return; }

      (t.match(URL_RE) || []).forEach(function (u) {
        if (isImage(u) || isVideo(u)) { if (images.indexOf(u) < 0) images.push(u); }
        else if (links.indexOf(u) < 0) links.push(u);
      });
      textLines.push(maskData(line));
    });

    var text = textLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    /* "https://x" type ka plain proof typed text + link dono me na dikhe */
    if (links.indexOf(text) > -1 || images.indexOf(text) > -1) text = "";
    return {
      raw: source,
      text: text,
      images: images,
      links: links,
      shot: images[0] || "",
      link: links[0] || ""
    };
  }

  function richText(text) {
    var src = maskData(String(text || "")), out = "", last = 0, m;
    var re = /https?:\/\/[^\s]+/gi;
    while ((m = re.exec(src)) !== null) {
      out += esc(src.slice(last, m.index));
      out += '<a href="' + esc(m[0]) + '" target="_blank" rel="noopener">' + esc(m[0]) + "</a>";
      last = m.index + m[0].length;
    }
    out += esc(src.slice(last));
    return out.replace(/\n/g, "<br>");
  }

  function label(s) {
    return '<div class="ffp-label">' + esc(s) + "</div>";
  }

  /* Poora proof: typed text + bada screenshot + link + note — review ke liye */
  function viewer(proof, meta) {
    var p = parse(proof);
    meta = meta || {};
    var html = '<div class="ffp-viewer">';

    var chips = [];
    if (meta.worker) chips.push("👤 " + esc(meta.worker));
    if (meta.reward) chips.push("💵 " + esc(meta.reward));
    if (meta.status) chips.push('<span class="badge ' + esc(meta.status) + '">' + esc(meta.status) + "</span>");
    if (meta.at) chips.push("🕒 " + esc(meta.at));
    if (chips.length) html += '<div class="ffp-chips">' + chips.join('<span class="ffp-sep">·</span>') + "</div>";

    html += '<div class="ffp-block">' + label("✍️ Typed proof / message") +
      '<div class="ffp-typed">' + (p.text ? richText(p.text) : '<span class="ffp-none">No typed text — worker used the screenshot / link option.</span>') + "</div></div>";

    if (p.images.length) {
      html += '<div class="ffp-block">' + label("📎 Screenshot / attachment (" + p.images.length + ")") + '<div class="ffp-shots">';
      p.images.forEach(function (u) {
        if (isVideo(u)) {
          html += '<div class="ffp-shot"><video controls preload="metadata" src="' + esc(u) + '"></video></div>';
        } else {
          html += '<a class="ffp-shot" href="' + esc(u) + '" target="_blank" rel="noopener" title="Open full screenshot">' +
            '<img src="' + esc(u) + '" alt="Proof screenshot" loading="lazy" onerror="this.style.display=\'none\'" /></a>';
        }
      });
      html += "</div></div>";
    }

    if (p.links.length) {
      html += '<div class="ffp-block">' + label("🔗 Proof link") + '<div class="ffp-links">';
      p.links.forEach(function (u) {
        html += '<a class="btn btn-ghost btn-sm" href="' + esc(u) + '" target="_blank" rel="noopener">Open proof link ↗</a>' +
          '<span class="ffp-url">' + esc(clip(u, 90)) + "</span>";
      });
      html += "</div></div>";
    }

    if (meta.note) html += '<div class="ffp-block">' + label("📝 Note to the buyer") + '<div class="ffp-typed">' + richText(meta.note) + "</div></div>";
    if (meta.reason) html += '<div class="ffp-block">' + label("Rejection reason") + '<div class="ffp-typed">' + richText(meta.reason) + "</div></div>";

    html += '<details class="ffp-raw"><summary>Raw proof (audit)</summary><pre>' + esc(clip(maskData(p.raw), 1200)) + "</pre></details>";
    return html + "</div>";
  }

  /* Table cell: thumbnail + typed text ka chhota preview + "View full proof" */
  function cell(proof, meta) {
    var raw = String(proof == null ? "" : proof);
    if (!raw.trim()) return '<span class="ffp-none">—</span>';
    var p = parse(raw), id = register(raw, meta);
    var preview = p.text ? clip(p.text, 72) : (p.shot ? (isVideo(p.shot) ? "🎬 Video attached" : "📷 Screenshot attached") : (p.link ? "🔗 Link submitted" : "Proof submitted"));
    var thumb = "";
    if (p.shot) {
      thumb = '<button type="button" class="ffp-thumb" data-proof-view="' + id + '" title="View full proof">' +
        (isVideo(p.shot) ? "🎬" : '<img src="' + esc(p.shot) + '" alt="Proof screenshot" loading="lazy" onerror="this.style.display=\'none\'" />') +
        "</button>";
    } else if (p.link) {
      thumb = '<button type="button" class="ffp-thumb ffp-thumb-link" data-proof-view="' + id + '" title="View proof link">🔗</button>';
    }
    return '<div class="ffp-cell">' + thumb +
      '<div class="ffp-cell-body"><span class="ffp-text" title="' + esc(preview) + '">' + esc(preview) + "</span>" +
      '<button type="button" class="ffp-view" data-proof-view="' + id + '">View full proof ↗</button></div></div>';
  }

  function register(proof, meta) {
    var raw = String(proof == null ? "" : proof);
    var key = raw.length + ":" + raw.slice(0, 120) + ":" + raw.slice(-120) + ":" + JSON.stringify(meta || {});
    if (registryKeys[key]) return registryKeys[key];
    var id = "p" + (++seq);
    registry[id] = { proof: raw, meta: meta || {} };
    registryKeys[key] = id;
    return id;
  }

  /* ------------------------- full-screen viewer ------------------------- */
  function ensureStyles() {
    if (!document || !document.head || document.getElementById("ffp-style")) return;
    var st = document.createElement("style");
    st.id = "ffp-style";
    st.textContent = [
      ".ffp-card{width:min(760px,100%);text-align:left}",
      ".ffp-chips{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--ink-mute,#626d80);margin:2px 34px 14px 0}",
      ".ffp-sep{color:var(--line-2,#ccc)}",
      ".ffp-block{margin-top:16px}",
      ".ffp-label{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-mute,#626d80);margin-bottom:7px}",
      ".ffp-typed{white-space:pre-wrap;word-break:break-word;background:var(--bg-3,#eef1f6);border:1px solid var(--line,rgba(16,27,48,.1));border-radius:12px;padding:12px 14px;font-size:13.8px;line-height:1.65;color:var(--ink,#1b2330);max-height:260px;overflow:auto}",
      ".ffp-typed a{color:var(--blue,#2f6fed);word-break:break-all}",
      ".ffp-none{color:var(--ink-mute,#626d80);font-size:12.5px}",
      ".ffp-shots{display:flex;gap:12px;flex-wrap:wrap}",
      ".ffp-shot{display:block;border:1px solid var(--line,rgba(16,27,48,.1));border-radius:12px;overflow:hidden;background:var(--bg-3,#eef1f6)}",
      ".ffp-shot img,.ffp-shot video{display:block;max-width:100%;max-height:56vh;object-fit:contain}",
      ".ffp-links{display:flex;gap:10px;align-items:center;flex-wrap:wrap}",
      ".ffp-url{font-size:11.5px;color:var(--ink-mute,#626d80);word-break:break-all}",
      ".ffp-raw{margin-top:18px;font-size:12px;color:var(--ink-mute,#626d80)}",
      ".ffp-raw summary{cursor:pointer;font-weight:700}",
      ".ffp-raw pre{white-space:pre-wrap;word-break:break-all;background:var(--bg-3,#eef1f6);padding:10px;border-radius:10px;font-size:11px;max-height:150px;overflow:auto}",
      ".ffp-cell{display:flex;align-items:center;gap:9px;flex-wrap:wrap;max-width:280px}",
      ".ffp-thumb{width:66px;height:50px;flex:0 0 66px;padding:0;border:1px solid var(--line,rgba(16,27,48,.1));border-radius:9px;background:var(--bg-3,#eef1f6);cursor:pointer;overflow:hidden;display:grid;place-items:center;font-size:20px;color:var(--ink-mute,#626d80)}",
      ".ffp-thumb img{width:100%;height:100%;object-fit:cover;display:block}",
      ".ffp-thumb:hover{border-color:var(--cyan,#0f7ea8)}",
      ".ffp-cell-body{display:flex;flex-direction:column;gap:2px;min-width:0}",
      ".ffp-text{font-size:12px;color:var(--ink-dim,#4a5568);max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".ffp-view{border:0;background:none;padding:0;color:var(--blue,#2f6fed);font-size:11.5px;font-weight:800;cursor:pointer;text-align:left}",
      ".ffp-view:hover{text-decoration:underline}"
    ].join("\n");
    document.head.appendChild(st);
  }

  function ensureModal() {
    if (veil && veil.parentNode) return veil;
    veil = document.createElement("div");
    veil.className = "modal-veil";
    veil.id = "ffp-modal";
    veil.setAttribute("aria-hidden", "true");
    veil.innerHTML = '<div class="modal ffp-card" role="dialog" aria-modal="true" aria-label="Proof details" tabindex="-1">' +
      '<button class="m-close" type="button" data-ffp-close aria-label="Close proof">✕</button>' +
      '<h3 style="margin:0 40px 4px 0;font-size:20px">🧾 Proof details</h3>' +
      '<div id="ffp-body"></div></div>';
    document.body.appendChild(veil);
    return veil;
  }

  function open(proof, meta) {
    ensureStyles();
    var v = ensureModal();
    var m = meta || {};
    var head = v.querySelector("h3");
    if (head) head.innerHTML = "🧾 " + esc(m.title || "Proof details");
    var body = v.querySelector("#ffp-body");
    if (body) body.innerHTML = viewer(proof, m);
    v.classList.add("open");
    v.setAttribute("aria-hidden", "false");
    var close = v.querySelector("[data-ffp-close]");
    if (close && close.focus) { try { close.focus(); } catch (e) {} }
  }

  function close() {
    if (!veil) return;
    veil.classList.remove("open");
    veil.setAttribute("aria-hidden", "true");
  }

  function bind() {
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest("[data-ffp-close]")) { close(); return; }
      var btn = t.closest("[data-proof-view]");
      if (btn) {
        var rec = registry[btn.getAttribute("data-proof-view")];
        if (rec) { e.preventDefault(); open(rec.proof, rec.meta); }
        return;
      }
      if (t.id === "ffp-modal") close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && veil && veil.classList.contains("open")) close();
    });
  }

  /* ------------------------- file handling ------------------------- */
  function validate(file, maxMB) {
    var limit = Number(maxMB) || 5;
    if (!file) throw new Error("Choose a screenshot first");
    var type = String(file.type || "");
    if (!/^image\/(png|jpe?g|webp|gif|bmp|avif)$/i.test(type) && !/^video\/(mp4|webm|quicktime)$/i.test(type)) {
      throw new Error("Attach an image (PNG/JPG/WEBP/GIF) or a short MP4 video");
    }
    if (Number(file.size) > limit * 1024 * 1024) {
      throw new Error("File is larger than " + limit + " MB — attach a smaller screenshot");
    }
    return true;
  }

  function readDataUrl(file) {
    return new Promise(function (resolve, reject) {
      if (typeof FileReader === "undefined") return reject(new Error("This browser cannot read files — use the link option"));
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || "")); };
      r.onerror = function () { reject(new Error("Could not read that file")); };
      r.readAsDataURL(file);
    });
  }

  /* Local/offline fallback: screenshot ko chhota karke proof ke andar hi
     embed kar dete hain, taaki buyer + admin bina storage bucket ke bhi
     screenshot dekh saken. Canvas na ho to original data URL use hota hai. */
  function compress(file) {
    if (/^video\//i.test(String(file.type || ""))) {
      return readDataUrl(file).then(function (u) {
        if (u.length > 900000) throw new Error("Video is too large without storage — paste a link instead");
        return u;
      });
    }
    var canvas = null, ctx = null;
    try {
      canvas = document.createElement("canvas");
      ctx = canvas.getContext && canvas.getContext("2d");
    } catch (e) { ctx = null; }
    if (!ctx) return readDataUrl(file);

    return readDataUrl(file).then(function (dataUrl) {
      return new Promise(function (resolve) {
        var img = new Image();
        var finish = function (url) { resolve(url || dataUrl); };
        img.onload = function () {
          try {
            var side = 1100, q = 0.70, out = "";
            for (var i = 0; i < 4; i++) {
              var scale = Math.min(1, side / Math.max(img.width || 1, img.height || 1));
              canvas.width = Math.max(1, Math.round((img.width || 1) * scale));
              canvas.height = Math.max(1, Math.round((img.height || 1) * scale));
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              out = canvas.toDataURL("image/jpeg", q);
              /* Embedded fallback ko ~200 KB ke andar rakho — admin list me
                 300 proofs bhi ho to payload phatega nahi. */
              if (out.length > 100 && out.length <= 260000) break;
              side = Math.round(side * 0.75);
              q = Math.max(0.35, q - 0.13);
            }
            finish(out.length > 100 ? out : dataUrl);
          } catch (e) { finish(dataUrl); }
        };
        img.onerror = function () { finish(dataUrl); };
        img.src = dataUrl;
      });
    });
  }

  function tryStorageUpload(file) {
    var FF = window.FF, cfg = window.FF_SUPABASE_CONFIG;
    if (!FF || !FF.hasServer || !FF.hasServer() || !FF.accessToken || !cfg || !cfg.url) {
      return Promise.reject(new Error("No server session"));
    }
    return FF.accessToken().then(function (token) {
      if (!token) throw new Error("Session expired");
      var exts = {
        "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
        "image/bmp": "bmp", "image/avif": "avif", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov"
      };
      var ext = exts[String(file.type || "").toLowerCase()] || "png";
      var uid = "user";
      try {
        var a = FF.DB && FF.DB.auth && FF.DB.auth();
        if (a && a.userId) uid = a.userId;
      } catch (e) {}
      var base = String(cfg.url).replace(/\/+$/, "");
      var path = uid + "/" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + "." + ext;
      return fetch(base + "/storage/v1/object/proofs/" + path, {
        method: "POST",
        headers: {
          apikey: cfg.anonKey,
          Authorization: "Bearer " + token,
          "Content-Type": file.type || "image/png",
          "x-upsert": "false"
        },
        body: file
      }).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return base + "/storage/v1/object/public/proofs/" + path;
      });
    });
  }

  /* Promise<string>: Storage URL, ya (bucket na ho to) embedded screenshot. */
  function upload(file, opts) {
    opts = opts || {};
    validate(file, opts.maxMB || 5);
    return tryStorageUpload(file).catch(function (err) {
      if (window.console && console.warn) {
        console.warn("[FlexFam] Screenshot upload unavailable (" + (err && err.message) +
          ") — embedding a compressed copy. Run supabase-proof-storage.sql for full quality.");
      }
      return compress(file);
    });
  }

  function previewUrl(file) {
    try {
      if (window.URL && URL.createObjectURL) return URL.createObjectURL(file);
    } catch (e) {}
    return "";
  }
  function releasePreview(url) {
    try { if (url && window.URL && URL.revokeObjectURL) URL.revokeObjectURL(url); } catch (e) {}
  }

  var api = {
    esc: esc, clip: clip, build: build, parse: parse, viewer: viewer, cell: cell,
    open: open, close: close, shot: function (p) { return parse(p).shot; },
    validate: validate, upload: upload, previewUrl: previewUrl, releasePreview: releasePreview
  };
  window.FFProof = api;

  if (document) {
    ensureStyles();
    bind();
    if (!document.head) {
      document.addEventListener("DOMContentLoaded", ensureStyles);
    }
  }
})();
