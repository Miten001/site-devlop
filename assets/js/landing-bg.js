/* ============================================================
   FLEXFAM landing — living background (video-style motion layer)
   A lightweight full-screen canvas that keeps the page feeling
   alive: drifting aurora orbs, rising crypto coins, twinkling
   sparkles and the occasional shooting-star comet.
   Respects prefers-reduced-motion and pauses in hidden tabs.
   ============================================================ */
(function () {
  "use strict";

  /* Headless DOM environments (e.g. jsdom in the test suite) cannot draw on
     canvas — skip the motion layer silently. */
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || "")) return;

  var cv = document.getElementById("bgMotion");
  if (!cv) return;
  var ctx = null;
  try { ctx = cv.getContext("2d"); } catch (e) { ctx = null; }
  if (!ctx) return;

  var reduced = false;
  try { reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0;
  var orbs = [], coins = [], sparks = [];
  var comet = null, cometAt = 3.5, T = 0, last = 0;

  var ORB_COLORS = [
    [247, 148, 29],  /* brand orange  */
    [255, 122, 24],  /* deep orange   */
    [47, 111, 237],  /* electric blue */
    [23, 178, 106],  /* growth green  */
    [255, 176, 71],  /* gold          */
    [28, 159, 216],  /* cyan          */
    [224, 110, 40]   /* amber         */
  ];

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function newCoin(scatter) {
    var roll = Math.random();
    var ch = roll < 0.45 ? "\u20AE" : roll < 0.72 ? "\u2726" : "\u20BF"; /* ₮ ✦ ₿ */
    return {
      fx: Math.random(),
      y: scatter ? Math.random() * H : H + rnd(20, 80),
      size: rnd(13, 27),
      v: rnd(14, 34),
      sway: rnd(8, 26),
      swf: rnd(0.3, 0.9),
      ph: rnd(0, 6.28),
      a: rnd(0.10, 0.30),
      ch: ch,
      col: ch === "\u20AE" ? "#26a17b" : ch === "\u20BF" ? "#f7931a" : "#e8a33d"
    };
  }

  function build() {
    orbs.length = 0; coins.length = 0; sparks.length = 0;

    var orbCount = W < 640 ? 5 : 7;
    for (var i = 0; i < orbCount; i++) {
      orbs.push({
        fx: Math.random(), fy: Math.random(),
        ax: rnd(0.06, 0.16), ay: rnd(0.05, 0.14),
        sx: rnd(0.05, 0.12), sy: rnd(0.05, 0.12),
        px: rnd(0, 6.28), py: rnd(0, 6.28),
        r: rnd(0.16, 0.30),
        a: rnd(0.05, 0.11),
        c: ORB_COLORS[i % ORB_COLORS.length]
      });
    }

    var coinCount = W < 640 ? 9 : W < 1024 ? 12 : 16;
    for (var j = 0; j < coinCount; j++) coins.push(newCoin(true));

    var sparkCount = W < 640 ? 24 : 46;
    for (var k = 0; k < sparkCount; k++) {
      sparks.push({
        fx: Math.random(), fy: Math.random(),
        r: rnd(0.8, 2.1),
        sp: rnd(0.5, 1.6),
        ph: rnd(0, 6.28),
        base: rnd(0.12, 0.4),
        warm: Math.random() < 0.45
      });
    }
  }

  function size() {
    W = window.innerWidth;
    H = window.innerHeight;
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function drawOrbs() {
    var m = Math.min(W, H);
    for (var i = 0; i < orbs.length; i++) {
      var o = orbs[i];
      var x = (o.fx + Math.sin(T * o.sx + o.px) * o.ax) * W;
      var y = (o.fy + Math.cos(T * o.sy + o.py) * o.ay) * H;
      var r = o.r * m * (1 + 0.08 * Math.sin(T * 0.4 + i));
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      var c = o.c;
      g.addColorStop(0, "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + o.a + ")");
      g.addColorStop(1, "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.2832);
      ctx.fill();
    }
  }

  function drawSparks() {
    for (var s = 0; s < sparks.length; s++) {
      var p = sparks[s];
      var tw = 0.5 + 0.5 * Math.sin(T * p.sp + p.ph);
      ctx.globalAlpha = p.base * tw;
      ctx.fillStyle = p.warm ? "#f7941d" : "#5b6b8c";
      ctx.beginPath();
      ctx.arc(p.fx * W, p.fy * H, p.r, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawCoins(dt) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (var i = 0; i < coins.length; i++) {
      var cn = coins[i];
      cn.y -= cn.v * dt;
      if (cn.y < -40) { coins[i] = newCoin(false); continue; }
      var x = cn.fx * W + Math.sin(T * cn.swf + cn.ph) * cn.sway;
      ctx.globalAlpha = cn.a;
      ctx.fillStyle = cn.col;
      ctx.font = "700 " + cn.size + "px system-ui, -apple-system, sans-serif";
      ctx.fillText(cn.ch, x, cn.y);
    }
    ctx.globalAlpha = 1;
  }

  function spawnComet() {
    var fromLeft = Math.random() < 0.5;
    var sp = rnd(260, 420);
    var ang = rnd(0.12, 0.30);
    comet = {
      x: fromLeft ? -80 : W + 80,
      y: rnd(H * 0.05, H * 0.35),
      vx: (fromLeft ? 1 : -1) * sp * Math.cos(ang),
      vy: sp * Math.sin(ang),
      len: rnd(150, 260)
    };
  }

  function drawComet(dt) {
    if (!comet && T >= cometAt) spawnComet();
    if (!comet) return;
    comet.x += comet.vx * dt;
    comet.y += comet.vy * dt;
    var mag = Math.sqrt(comet.vx * comet.vx + comet.vy * comet.vy) || 1;
    var tx = comet.x - (comet.vx / mag) * comet.len;
    var ty = comet.y - (comet.vy / mag) * comet.len;
    var lg = ctx.createLinearGradient(comet.x, comet.y, tx, ty);
    lg.addColorStop(0, "rgba(255,255,255,0.95)");
    lg.addColorStop(0.25, "rgba(255,176,71,0.75)");
    lg.addColorStop(1, "rgba(247,148,29,0)");
    ctx.strokeStyle = lg;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(comet.x, comet.y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,240,214,0.95)";
    ctx.beginPath();
    ctx.arc(comet.x, comet.y, 2.6, 0, 6.2832);
    ctx.fill();
    if (comet.x < -comet.len - 80 || comet.x > W + comet.len + 80 || comet.y > H + 80) {
      comet = null;
      cometAt = T + rnd(4, 9);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) { last = now; return; }
    var dt = Math.min((now - last) / 1000 || 0.016, 0.05);
    last = now;
    T += dt;

    ctx.clearRect(0, 0, W, H);
    drawOrbs();
    drawSparks();
    drawCoins(dt);
    drawComet(dt);
  }

  function staticFrame() {
    T = 2;
    ctx.clearRect(0, 0, W, H);
    drawOrbs();
    drawSparks();
  }

  size();
  build();

  if (reduced) {
    staticFrame();
  } else {
    requestAnimationFrame(function (t) { last = t; frame(t); });
  }

  var rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      size();
      build();
      if (reduced) staticFrame();
    }, 180);
  });
})();
