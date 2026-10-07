const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");

// Reusable vector elements & defs
function getDefs(prefix) {
  return `
    <!-- Background Gradient -->
    <linearGradient id="${prefix}bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#040814"/>
      <stop offset="40%" stop-color="#091326"/>
      <stop offset="100%" stop-color="#041a15"/>
    </linearGradient>

    <!-- Glass Card Gradient -->
    <linearGradient id="${prefix}card" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(16, 35, 71, 0.75)"/>
      <stop offset="100%" stop-color="rgba(7, 18, 38, 0.9)"/>
    </linearGradient>

    <!-- Border Glow Gradient -->
    <linearGradient id="${prefix}borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="rgba(0, 245, 155, 0.6)"/>
      <stop offset="50%" stop-color="rgba(255, 208, 67, 0.4)"/>
      <stop offset="100%" stop-color="rgba(0, 229, 255, 0.2)"/>
    </linearGradient>

    <!-- Gold Text Gradient -->
    <linearGradient id="${prefix}gold" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#fff076"/>
      <stop offset="50%" stop-color="#ffd043"/>
      <stop offset="100%" stop-color="#ff9a00"/>
    </linearGradient>

    <!-- Emerald Text Gradient -->
    <linearGradient id="${prefix}emerald" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#00f59b"/>
      <stop offset="100%" stop-color="#38ef7d"/>
    </linearGradient>

    <!-- Button Gradient -->
    <linearGradient id="${prefix}btn" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ffd043"/>
      <stop offset="45%" stop-color="#00f59b"/>
      <stop offset="100%" stop-color="#00e5ff"/>
    </linearGradient>

    <!-- 3D Coin Outer Rim Gradient -->
    <linearGradient id="${prefix}goldRim" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffe484"/>
      <stop offset="40%" stop-color="#ffd043"/>
      <stop offset="70%" stop-color="#e69500"/>
      <stop offset="100%" stop-color="#804a00"/>
    </linearGradient>

    <!-- 3D Coin Inner Face Gradient -->
    <radialGradient id="${prefix}coinFace" cx="35%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#3bf6ad"/>
      <stop offset="60%" stop-color="#14966a"/>
      <stop offset="100%" stop-color="#08523a"/>
    </radialGradient>

    <!-- Ambient Glow Filters -->
    <radialGradient id="${prefix}glowGreen" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#00f59b" stop-opacity="0.45"/>
      <stop offset="60%" stop-color="#00f59b" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#00f59b" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${prefix}glowGold" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffd043" stop-opacity="0.4"/>
      <stop offset="60%" stop-color="#ff9a00" stop-opacity="0.1"/>
      <stop offset="100%" stop-color="#ff9a00" stop-opacity="0"/>
    </radialGradient>

    <filter id="${prefix}shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000000" flood-opacity="0.6"/>
    </filter>
  `;
}

// Vector Tether USDT Coin (scale = radius in px)
function getUsdtCoin(prefix, cx, cy, r) {
  const outerR = r;
  const innerR = r * 0.86;
  const tScale = r / 24;
  return `
    <g transform="translate(${cx}, ${cy})" filter="url(#${prefix}shadow)">
      <!-- Outer Gold Bevel -->
      <circle cx="0" cy="0" r="${outerR}" fill="url(#${prefix}goldRim)"/>
      <!-- Inner Green Face -->
      <circle cx="0" cy="0" r="${innerR}" fill="url(#${prefix}coinFace)"/>
      <circle cx="0" cy="0" r="${innerR}" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="${1.2 * tScale}"/>
      
      <!-- Tether T & Rings Vector -->
      <g transform="scale(${tScale}) translate(-12, -12)">
        <!-- Top Bar -->
        <rect x="5.5" y="6" width="13" height="3" rx="1" fill="#ffffff"/>
        <!-- Vertical Stem -->
        <rect x="10.5" y="8" width="3" height="10" rx="0.8" fill="#ffffff"/>
        <!-- Ring Arc Left & Right -->
        <path d="M 6 12.5 C 6 11 8.5 10 12 10 C 15.5 10 18 11 18 12.5 C 18 14 15.5 15 12 15 C 8.5 15 6 14 6 12.5 Z" fill="none" stroke="#ffffff" stroke-width="1.8"/>
      </g>
      <!-- Top Specular Highlight -->
      <ellipse cx="${-r * 0.25}" cy="${-r * 0.35}" rx="${r * 0.35}" ry="${r * 0.18}" fill="rgba(255,255,255,0.35)"/>
    </g>
  `;
}

// Vector Lightning Icon
function getLightning(x, y, scale = 1, fill = "#00f59b") {
  return `<path transform="translate(${x}, ${y}) scale(${scale})" d="M7 1L1 9h5l-2 7 8-9H7l2-7z" fill="${fill}"/>`;
}

// Vector Flame Icon
function getFlame(x, y, scale = 1, fill = "#ff9a00") {
  return `<path transform="translate(${x}, ${y}) scale(${scale})" d="M6 1C5.8 2.5 4.8 3.8 3.5 4.8 2 6 1.5 7.5 1.5 9.2 1.5 12 3.8 14 6.5 14S11.5 12 11.5 9.2c0-1.5-.7-2.8-1.8-3.8 0 1.2-.6 2.2-1.5 2.8 0-2-1-4-2.2-7.2z" fill="${fill}"/>`;
}

// Vector Checkmark
function getCheck(x, y, scale = 1, fill = "#00f59b") {
  return `<path transform="translate(${x}, ${y}) scale(${scale})" d="M1 5l3 3L11 1" fill="none" stroke="${fill}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// Common font style block
const FONT_STYLE = `
  <style>
    .brand { font-family: Inter, system-ui, -apple-system, Roboto, 'Segoe UI', Arial, sans-serif; font-weight: 900; }
    .title { font-family: Inter, system-ui, -apple-system, Roboto, 'Segoe UI', Arial, sans-serif; font-weight: 800; }
    .body { font-family: Inter, system-ui, -apple-system, Roboto, 'Segoe UI', Arial, sans-serif; font-weight: 600; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-weight: 700; }
  </style>
`;

// 1. Leaderboard 728x90
function make728x90() {
  const p = "l728_";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="728" height="90" viewBox="0 0 728 90" role="img" aria-label="FlexFam — free social exchange: earn USDT for small social tasks">
  <defs>${getDefs(p)}</defs>
  ${FONT_STYLE}

  <!-- Base -->
  <rect width="728" height="90" rx="12" fill="url(#${p}bg)"/>
  <rect width="728" height="90" rx="12" fill="none" stroke="url(#${p}borderGrad)" stroke-width="1.4"/>

  <!-- Glowing Orbs -->
  <circle cx="50" cy="45" r="75" fill="url(#${p}glowGold)"/>
  <circle cx="360" cy="45" r="90" fill="url(#${p}glowGreen)"/>
  <circle cx="650" cy="45" r="80" fill="url(#${p}glowGreen)"/>

  <!-- Left: Brand Block -->
  <g transform="translate(18, 15)">
    <!-- Logo Icon Box -->
    <rect x="0" y="3" width="40" height="40" rx="10" fill="url(#${p}card)" stroke="rgba(0,245,155,0.4)" stroke-width="1.2"/>
    ${getLightning(13, 11, 1.6, "#00f59b")}
    <text x="50" y="27" class="brand" font-size="25" fill="#ffffff" letter-spacing="-0.5px">Flex<tspan fill="url(#${p}gold)">Fam</tspan></text>
    <text x="50" y="44" class="title" font-size="11" fill="#8ea5c8" letter-spacing="0.5px">EARN USDT DAILY</text>
  </g>

  <!-- Center: High-Impact Payout Box -->
  <g transform="translate(225, 11)">
    <!-- USDT 3D Coin -->
    ${getUsdtCoin(p, 26, 34, 25)}

    <g transform="translate(62, 2)">
      <!-- Exchange tag -->
      <rect x="0" y="0" width="196" height="20" rx="10" fill="rgba(0,245,155,0.15)" stroke="rgba(0,245,155,0.35)" stroke-width="1"/>
      ${getFlame(8, 2, 1.1, "#ffd043")}
      <text x="26" y="14" class="title" font-size="10" fill="#00f59b" letter-spacing="0.6px">SOCIAL EXCHANGE TASKS</text>

      <!-- Big claim-free headline -->
      <g transform="translate(0, 44)">
        <text x="0" y="0" class="brand" font-size="24" fill="url(#${p}emerald)" letter-spacing="-0.6px">EARN USDT <tspan fill="#ffffff" font-size="15">DAILY</tspan></text>
      </g>
      <text x="0" y="60" class="body" font-size="10.5" fill="#9fb0d5">Follow · Subscribe · Join · Visit — 9 platforms</text>
    </g>
  </g>

  <!-- Right: CTA Button -->
  <g transform="translate(545, 17)">
    <rect x="0" y="0" width="164" height="42" rx="21" fill="url(#${p}btn)" filter="url(#${p}shadow)"/>
    <!-- Gloss -->
    <rect x="2" y="2" width="160" height="18" rx="9" fill="rgba(255,255,255,0.35)"/>
    <text x="82" y="26" class="brand" font-size="14.5" fill="#051020" text-anchor="middle" letter-spacing="0.3px">CLAIM FREE ➔</text>
    <text x="82" y="52" class="title" font-size="9.5" fill="#7ce6ae" text-anchor="middle">✓ 100% FREE • NO FEES</text>
  </g>
</svg>`;
}

// 2. Banner 468x60
function make468x60() {
  const p = "b468_";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="468" height="60" viewBox="0 0 468 60" role="img" aria-label="FlexFam — earn USDT for small social tasks">
  <defs>${getDefs(p)}</defs>
  ${FONT_STYLE}

  <rect width="468" height="60" rx="10" fill="url(#${p}bg)"/>
  <rect width="468" height="60" rx="10" fill="none" stroke="url(#${p}borderGrad)" stroke-width="1.2"/>

  <circle cx="35" cy="30" r="50" fill="url(#${p}glowGold)"/>
  <circle cx="230" cy="30" r="60" fill="url(#${p}glowGreen)"/>
  <circle cx="410" cy="30" r="50" fill="url(#${p}glowGreen)"/>

  <!-- Logo -->
  <g transform="translate(14, 11)">
    <text x="0" y="21" class="brand" font-size="20" fill="#ffffff" letter-spacing="-0.5px">Flex<tspan fill="url(#${p}gold)">Fam</tspan></text>
    <g transform="translate(0, 27)">
      ${getLightning(0, 0, 0.9, "#00f59b")}
      <text x="12" y="9" class="title" font-size="9.5" fill="#00f59b">9 PLATFORMS</text>
    </g>
  </g>

  <!-- Value & Coin -->
  <g transform="translate(130, 9)">
    ${getUsdtCoin(p, 18, 21, 18)}
    <g transform="translate(44, 4)">
      <g transform="translate(0, 18)">
        <text x="0" y="0" class="brand" font-size="16" fill="url(#${p}emerald)" letter-spacing="-0.3px">EARN USDT <tspan fill="#ffffff" font-size="12" font-weight="800">DAILY</tspan></text>
      </g>
      <text x="0" y="33" class="body" font-size="9.5" fill="#9fb0d5">Follow · Sub · Join · Visit</text>
    </g>
  </g>

  <!-- CTA -->
  <g transform="translate(340, 12)">
    <rect x="0" y="0" width="114" height="36" rx="18" fill="url(#${p}btn)" filter="url(#${p}shadow)"/>
    <rect x="2" y="2" width="110" height="15" rx="7.5" fill="rgba(255,255,255,0.35)"/>
    <text x="57" y="23" class="brand" font-size="12.5" fill="#051020" text-anchor="middle">JOIN FREE ➔</text>
  </g>
</svg>`;
}

// 3. Rectangle 300x250
function make300x250() {
  const p = "r300_";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="250" viewBox="0 0 300 250" role="img" aria-label="FlexFam social exchange — earn USDT for small tasks (300x250)">
  <defs>${getDefs(p)}</defs>
  ${FONT_STYLE}

  <rect width="300" height="250" rx="16" fill="url(#${p}bg)"/>
  <rect width="300" height="250" rx="16" fill="none" stroke="url(#${p}borderGrad)" stroke-width="1.4"/>

  <circle cx="150" cy="35" r="100" fill="url(#${p}glowGold)"/>
  <circle cx="150" cy="135" r="120" fill="url(#${p}glowGreen)"/>

  <!-- Logo Header -->
  <g transform="translate(0, 16)">
    <text x="150" y="25" class="brand" font-size="26" fill="#ffffff" text-anchor="middle" letter-spacing="-0.5px">Flex<tspan fill="url(#${p}gold)">Fam</tspan></text>
    
    <g transform="translate(56, 33)">
      <rect x="0" y="0" width="188" height="18" rx="9" fill="rgba(0,245,155,0.15)" stroke="rgba(0,245,155,0.3)" stroke-width="1"/>
      ${getLightning(10, 2, 0.9, "#00f59b")}
      <text x="104" y="13" class="title" font-size="8.5" fill="#00f59b" text-anchor="middle" letter-spacing="0.7px">FREE SOCIAL EXCHANGE</text>
    </g>
  </g>

  <!-- Feature Center Card -->
  <g transform="translate(20, 76)">
    <rect width="260" height="98" rx="14" fill="url(#${p}card)" stroke="rgba(0,245,155,0.3)" stroke-width="1.2"/>
    
    <!-- 3D Coin -->
    ${getUsdtCoin(p, 42, 49, 26)}

    <g transform="translate(82, 14)">
      <text x="0" y="14" class="title" font-size="10" fill="#9fb0d5" letter-spacing="0.4px">SOCIAL TASKS PAY</text>
      <g transform="translate(0, 44)">
        <text x="0" y="0" class="brand" font-size="19" fill="url(#${p}emerald)" letter-spacing="-0.4px">EARN USDT DAILY</text>
      </g>
      <g transform="translate(0, 62)">
        ${getCheck(0, 0, 0.9, "#ffd043")}
        <text x="14" y="8" class="title" font-size="9.5" fill="#ffd043">Follow · Sub · Join · Visit</text>
      </g>
    </g>
  </g>

  <!-- CTA -->
  <g transform="translate(20, 186)">
    <rect width="260" height="42" rx="21" fill="url(#${p}btn)" filter="url(#${p}shadow)"/>
    <rect x="2" y="2" width="256" height="18" rx="9" fill="rgba(255,255,255,0.35)"/>
    <text x="130" y="26" class="brand" font-size="15" fill="#051020" text-anchor="middle" letter-spacing="0.3px">JOIN FREE — NO CARD ➔</text>
  </g>
  <text x="150" y="240" class="body" font-size="9" fill="#8ea5c8" text-anchor="middle">Points → real USDT • BEP20 &amp; UPI</text>
</svg>`;
}

// 4. Square 250x250
function make250x250() {
  const p = "s250_";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="250" height="250" viewBox="0 0 250 250" role="img" aria-label="FlexFam social exchange — small tasks, real USDT (250x250)">
  <defs>${getDefs(p)}</defs>
  ${FONT_STYLE}

  <rect width="250" height="250" rx="14" fill="url(#${p}bg)"/>
  <rect width="250" height="250" rx="14" fill="none" stroke="url(#${p}borderGrad)" stroke-width="1.3"/>

  <circle cx="125" cy="35" r="85" fill="url(#${p}glowGold)"/>
  <circle cx="125" cy="130" r="100" fill="url(#${p}glowGreen)"/>

  <!-- Logo -->
  <g transform="translate(0, 15)">
    <text x="125" y="23" class="brand" font-size="24" fill="#ffffff" text-anchor="middle" letter-spacing="-0.5px">Flex<tspan fill="url(#${p}gold)">Fam</tspan></text>
    <g transform="translate(52, 30)">
      <rect x="0" y="0" width="146" height="17" rx="8.5" fill="rgba(0,245,155,0.15)" stroke="rgba(0,245,155,0.3)" stroke-width="1"/>
      ${getLightning(8, 2, 0.8, "#00f59b")}
      <text x="80" y="12" class="title" font-size="8.5" fill="#00f59b" text-anchor="middle" letter-spacing="0.8px">SOCIAL EXCHANGE</text>
    </g>
  </g>

  <!-- Center Card -->
  <g transform="translate(16, 68)">
    <rect width="218" height="96" rx="12" fill="url(#${p}card)" stroke="rgba(0,245,155,0.25)" stroke-width="1"/>
    
    ${getUsdtCoin(p, 36, 40, 22)}

    <g transform="translate(68, 12)">
      <text x="0" y="14" class="title" font-size="9" fill="#9fb0d5" letter-spacing="0.4px">SOCIAL TASKS PAY</text>
      <g transform="translate(0, 38)">
        <text x="0" y="0" class="brand" font-size="22" fill="url(#${p}emerald)" letter-spacing="-0.5px">EARN USDT</text>
        <text x="0" y="20" class="title" font-size="10.5" fill="#ffffff">for small tasks</text>
      </g>
    </g>
    <text x="109" y="79" class="title" font-size="8" fill="#ffd043" text-anchor="middle" letter-spacing="0.2px">Follow · Subscribe · Join · Visit</text>
  </g>

  <!-- CTA -->
  <g transform="translate(16, 176)">
    <rect width="218" height="38" rx="19" fill="url(#${p}btn)" filter="url(#${p}shadow)"/>
    <rect x="2" y="2" width="214" height="16" rx="8" fill="rgba(255,255,255,0.35)"/>
    <text x="109" y="24" class="brand" font-size="13.5" fill="#051020" text-anchor="middle" letter-spacing="0.3px">START EARNING ➔</text>
  </g>
  <text x="125" y="234" class="body" font-size="8.5" fill="#8ea5c8" text-anchor="middle">100% Free • Instant Withdrawal</text>
</svg>`;
}

// 5. Mobile 320x50
function make320x50() {
  const p = "m320_";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="50" viewBox="0 0 320 50" role="img" aria-label="FlexFam mobile banner — small social tasks, real USDT">
  <defs>${getDefs(p)}</defs>
  ${FONT_STYLE}

  <rect width="320" height="50" rx="8" fill="url(#${p}bg)"/>
  <rect width="320" height="50" rx="8" fill="none" stroke="url(#${p}borderGrad)" stroke-width="1"/>

  <circle cx="30" cy="25" r="40" fill="url(#${p}glowGold)"/>
  <circle cx="160" cy="25" r="45" fill="url(#${p}glowGreen)"/>
  <circle cx="280" cy="25" r="40" fill="url(#${p}glowGreen)"/>

  <!-- Logo -->
  <g transform="translate(8, 9)">
    <text x="0" y="19" class="brand" font-size="16" fill="#ffffff" letter-spacing="-0.5px">Flex<tspan fill="url(#${p}gold)">Fam</tspan></text>
    <g transform="translate(0, 23)">
      ${getLightning(0, 0, 0.75, "#00f59b")}
      <text x="10" y="8" class="title" font-size="8" fill="#00f59b">9 PLATFORMS</text>
    </g>
  </g>

  <!-- Payout & Coin -->
  <g transform="translate(86, 8)">
    ${getUsdtCoin(p, 14, 17, 14)}
    <g transform="translate(34, 3)">
      <g transform="translate(0, 17)">
        <text x="0" y="0" class="brand" font-size="15" fill="url(#${p}emerald)" letter-spacing="-0.3px">EARN USDT</text>
      </g>
      <text x="0" y="28" class="body" font-size="8" fill="#9fb0d5">Small tasks pay</text>
    </g>
  </g>

  <!-- CTA -->
  <g transform="translate(228, 8)">
    <rect x="0" y="0" width="84" height="34" rx="17" fill="url(#${p}btn)" filter="url(#${p}shadow)"/>
    <rect x="2" y="2" width="80" height="14" rx="7" fill="rgba(255,255,255,0.35)"/>
    <text x="42" y="22" class="brand" font-size="11" fill="#051020" text-anchor="middle">JOIN ➔</text>
  </g>
</svg>`;
}

// 6. Skyscraper 160x600
function make160x600() {
  const p = "sky160_";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="600" viewBox="0 0 160 600" role="img" aria-label="FlexFam skyscraper — social exchange, earn USDT">
  <defs>${getDefs(p)}</defs>
  ${FONT_STYLE}

  <rect width="160" height="600" rx="14" fill="url(#${p}bg)"/>
  <rect width="160" height="600" rx="14" fill="none" stroke="url(#${p}borderGrad)" stroke-width="1.3"/>

  <circle cx="80" cy="50" r="90" fill="url(#${p}glowGold)"/>
  <circle cx="80" cy="240" r="100" fill="url(#${p}glowGreen)"/>
  <circle cx="80" cy="460" r="90" fill="url(#${p}glowGold)"/>

  <!-- Logo -->
  <g transform="translate(0, 22)">
    <text x="80" y="26" class="brand" font-size="22" fill="#ffffff" text-anchor="middle" letter-spacing="-0.5px">Flex<tspan fill="url(#${p}gold)">Fam</tspan></text>
    <g transform="translate(14, 36)">
      <rect x="0" y="0" width="132" height="18" rx="9" fill="rgba(0,245,155,0.15)" stroke="rgba(0,245,155,0.3)" stroke-width="1"/>
      ${getLightning(8, 3, 0.8, "#00f59b")}
      <text x="75" y="13" class="title" font-size="8.5" fill="#00f59b" text-anchor="middle" letter-spacing="0.4px">SOCIAL EXCHANGE</text>
    </g>
  </g>

  <!-- Big USDT Coin -->
  ${getUsdtCoin(p, 80, 138, 34)}

  <!-- Value Card -->
  <g transform="translate(12, 192)">
    <rect width="136" height="130" rx="12" fill="url(#${p}card)" stroke="rgba(0,245,155,0.3)" stroke-width="1.2"/>
    <text x="68" y="24" class="title" font-size="8" fill="#9fb0d5" text-anchor="middle" letter-spacing="0.5px">FREE SOCIAL EXCHANGE</text>
    <text x="68" y="58" class="brand" font-size="19" fill="url(#${p}emerald)" text-anchor="middle" letter-spacing="-0.4px">EARN USDT</text>
    <text x="68" y="80" class="brand" font-size="11" fill="#ffffff" text-anchor="middle" letter-spacing="0.3px">SOCIAL TASKS PAY</text>
    <text x="68" y="104" class="title" font-size="9" fill="#ffd043" text-anchor="middle">Points → real USDT</text>
    <text x="68" y="118" class="body" font-size="8.5" fill="#8ea5c8" text-anchor="middle">Instant Withdrawal</text>
  </g>

  <!-- Features list -->
  <g transform="translate(16, 342)">
    <g transform="translate(0, 0)">
      ${getCheck(0, 2, 0.9, "#00f59b")}
      <text x="18" y="11" class="title" font-size="10" fill="#ffffff">Telegram · YouTube</text>
    </g>
    <g transform="translate(0, 28)">
      ${getCheck(0, 2, 0.9, "#00f59b")}
      <text x="18" y="11" class="title" font-size="10" fill="#ffffff">Follows · Subscribes</text>
    </g>
    <g transform="translate(0, 56)">
      ${getCheck(0, 2, 0.9, "#00f59b")}
      <text x="18" y="11" class="title" font-size="10" fill="#ffffff">Free Mining Rigs</text>
    </g>
    <g transform="translate(0, 84)">
      ${getCheck(0, 2, 0.9, "#00f59b")}
      <text x="18" y="11" class="title" font-size="10" fill="#ffffff">Website Visits</text>
    </g>
  </g>

  <!-- Big CTA at bottom -->
  <g transform="translate(12, 480)">
    <rect width="136" height="46" rx="23" fill="url(#${p}btn)" filter="url(#${p}shadow)"/>
    <rect x="2" y="2" width="132" height="20" rx="10" fill="rgba(255,255,255,0.35)"/>
    <text x="68" y="28" class="brand" font-size="14" fill="#051020" text-anchor="middle" letter-spacing="0.3px">JOIN FREE ➔</text>
    <text x="68" y="60" class="title" font-size="9" fill="#7ce6ae" text-anchor="middle">✓ 100% FREE TO JOIN</text>
  </g>
</svg>`;
}

// 7. Button 125x125
function make125x125() {
  const p = "b125_";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="125" height="125" viewBox="0 0 125 125" role="img" aria-label="FlexFam button — social exchange, earn USDT">
  <defs>${getDefs(p)}</defs>
  ${FONT_STYLE}

  <rect width="125" height="125" rx="10" fill="url(#${p}bg)"/>
  <rect width="125" height="125" rx="10" fill="none" stroke="url(#${p}borderGrad)" stroke-width="1.2"/>

  <circle cx="62" cy="30" r="50" fill="url(#${p}glowGold)"/>
  <circle cx="62" cy="70" r="50" fill="url(#${p}glowGreen)"/>

  <!-- Logo -->
  <text x="62" y="21" class="brand" font-size="16" fill="#ffffff" text-anchor="middle" letter-spacing="-0.5px">Flex<tspan fill="url(#${p}gold)">Fam</tspan></text>

  <!-- Center Value -->
  <g transform="translate(10, 28)">
    <rect width="105" height="48" rx="8" fill="url(#${p}card)" stroke="rgba(0,245,155,0.25)" stroke-width="1"/>
    <text x="52" y="14" class="title" font-size="7.5" fill="#9fb0d5" text-anchor="middle">SOCIAL TASKS</text>
    <g transform="translate(52, 33)">
      <text x="0" y="0" class="brand" font-size="12.5" fill="url(#${p}emerald)" text-anchor="middle" letter-spacing="-0.2px">EARN USDT</text>
    </g>
    <text x="52" y="44" class="title" font-size="7" fill="#ffd043" text-anchor="middle">points → real USDT</text>
  </g>

  <!-- CTA -->
  <g transform="translate(10, 84)">
    <rect width="105" height="28" rx="14" fill="url(#${p}btn)" filter="url(#${p}shadow)"/>
    <rect x="1.5" y="1.5" width="102" height="12" rx="6" fill="rgba(255,255,255,0.35)"/>
    <text x="52" y="18" class="brand" font-size="10" fill="#051020" text-anchor="middle" letter-spacing="0.2px">JOIN FREE ➔</text>
  </g>
</svg>`;
}

// 8. OpenGraph 1200x630
function make1200x630() {
  const p = "og1200_";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="FlexFam Social Preview">
  <defs>${getDefs(p)}</defs>
  ${FONT_STYLE}

  <rect width="1200" height="630" fill="url(#${p}bg)"/>
  <rect width="1200" height="630" fill="none" stroke="url(#${p}borderGrad)" stroke-width="2"/>

  <!-- Dramatic ambient glow spheres -->
  <circle cx="200" cy="150" r="280" fill="url(#${p}glowGold)"/>
  <circle cx="950" cy="300" r="340" fill="url(#${p}glowGreen)"/>
  <circle cx="450" cy="500" r="260" fill="url(#${p}glowGreen)"/>

  <!-- Left Side: Copy and Branding -->
  <g transform="translate(90, 80)">
    <!-- Pill -->
    <rect x="0" y="0" width="280" height="36" rx="18" fill="rgba(0,245,155,0.15)" stroke="rgba(0,245,155,0.4)" stroke-width="1.5"/>
    ${getLightning(16, 8, 1.4, "#00f59b")}
    <text x="148" y="23" class="title" font-size="13" fill="#00f59b" text-anchor="middle" letter-spacing="1.2px">FREE SOCIAL EXCHANGE</text>

    <!-- Logo -->
    <g transform="translate(0, 60)">
      <rect x="0" y="8" width="64" height="64" rx="16" fill="url(#${p}card)" stroke="rgba(0,245,155,0.4)" stroke-width="2"/>
      ${getLightning(20, 18, 2.3, "#00f59b")}
      <text x="80" y="56" class="brand" font-size="54" fill="#ffffff" letter-spacing="-1px">Flex<tspan fill="url(#${p}gold)">Fam</tspan></text>
    </g>

    <!-- Main Headline -->
    <g transform="translate(0, 160)">
      <text x="0" y="50" class="brand" font-size="56" fill="#ffffff" letter-spacing="-1px">Earn Real USDT</text>
      <text x="0" y="115" class="brand" font-size="56" fill="url(#${p}emerald)" letter-spacing="-1px">Social Tasks Pay</text>
      <text x="0" y="166" class="body" font-size="20" fill="#a4b8db">Follow · subscribe · join · visit — points &amp; USDT</text>
      <text x="0" y="196" class="body" font-size="16" fill="#7ce6ae">Grow your own pages on 9 platforms · 100% free to join</text>
    </g>

    <!-- CTA Button -->
    <g transform="translate(0, 370)">
      <rect width="280" height="64" rx="32" fill="url(#${p}btn)" filter="url(#${p}shadow)"/>
      <rect x="3" y="3" width="274" height="28" rx="14" fill="rgba(255,255,255,0.35)"/>
      <text x="140" y="39" class="brand" font-size="20" fill="#051020" text-anchor="middle" letter-spacing="0.5px">JOIN FREE TODAY ➔</text>
      <text x="310" y="38" class="title" font-size="16" fill="#ffd043">✓ Instant BEP20 &amp; UPI Payouts</text>
    </g>
  </g>

  <!-- Right Side: 3D Holographic Card & Coin -->
  <g transform="translate(740, 100)">
    <rect width="370" height="430" rx="24" fill="url(#${p}card)" stroke="rgba(0,245,155,0.3)" stroke-width="2" filter="url(#${p}shadow)"/>
    
    <!-- Big 3D Coin -->
    ${getUsdtCoin(p, 185, 120, 72)}

    <text x="185" y="240" class="title" font-size="16" fill="#9fb0d5" text-anchor="middle">SMALL TASKS · REAL USDT</text>
    <text x="185" y="295" class="brand" font-size="44" fill="url(#${p}emerald)" text-anchor="middle" letter-spacing="-1px">EARN USDT</text>
    <text x="185" y="325" class="title" font-size="18" fill="#ffffff" text-anchor="middle">Daily Streak · 9 Ranks</text>

    <!-- Mini perks -->
    <g transform="translate(45, 355)">
      <rect width="280" height="42" rx="21" fill="rgba(0,0,0,0.4)" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
      ${getLightning(18, 11, 1.2, "#ffd043")}
      <text x="148" y="26" class="title" font-size="12.5" fill="#ffd043" text-anchor="middle">Follow · Subscribe · Join · Visit</text>
    </g>
  </g>
</svg>`;
}

const ASSETS = [
  { file: "flexfam-leaderboard-728x90", w: 728, h: 90, svgGen: make728x90 },
  { file: "flexfam-banner-468x60", w: 468, h: 60, svgGen: make468x60 },
  { file: "flexfam-rectangle-300x250", w: 300, h: 250, svgGen: make300x250 },
  { file: "flexfam-square-250x250", w: 250, h: 250, svgGen: make250x250 },
  { file: "flexfam-mobile-320x50", w: 320, h: 50, svgGen: make320x50 },
  { file: "flexfam-skyscraper-160x600", w: 160, h: 600, svgGen: make160x600 },
  { file: "flexfam-button-125x125", w: 125, h: 125, svgGen: make125x125 },
  { file: "flexfam-photo-125x125", w: 125, h: 125, svgGen: make125x125 },
  { file: "flexfam-og-1200x630", w: 1200, h: 630, svgGen: make1200x630 }
];

console.log("Generating ultra-crisp vector banners...");
const adsDir = path.join(__dirname, "assets/img/ads");

for (const a of ASSETS) {
  const svgContent = a.svgGen();
  const svgPath = path.join(adsDir, a.file + ".svg");
  fs.writeFileSync(svgPath, svgContent, "utf8");

  const resvg = new Resvg(svgContent, { fitTo: { mode: "width", value: a.w } });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  const pngPath = path.join(adsDir, a.file + ".png");
  fs.writeFileSync(pngPath, pngBuffer);

  console.log(`Rendered ${a.file} -> ${pngData.width}x${pngData.height} (${pngBuffer.length} bytes)`);
}

// Copy to root convenience files
fs.copyFileSync(path.join(adsDir, "flexfam-leaderboard-728x90.png"), path.join(__dirname, "banner.png"));
fs.copyFileSync(path.join(adsDir, "flexfam-leaderboard-728x90.png"), path.join(__dirname, "banner728.png"));
fs.copyFileSync(path.join(adsDir, "flexfam-banner-468x60.png"), path.join(__dirname, "banner468.png"));
fs.copyFileSync(path.join(adsDir, "flexfam-rectangle-300x250.png"), path.join(__dirname, "banner300.png"));
fs.copyFileSync(path.join(adsDir, "flexfam-square-250x250.png"), path.join(__dirname, "banner250.png"));
fs.copyFileSync(path.join(adsDir, "flexfam-square-250x250.png"), path.join(__dirname, "banner250v2.png"));
fs.copyFileSync(path.join(adsDir, "flexfam-mobile-320x50.png"), path.join(__dirname, "banner320.png"));
fs.copyFileSync(path.join(adsDir, "flexfam-skyscraper-160x600.png"), path.join(__dirname, "banner160.png"));
fs.copyFileSync(path.join(adsDir, "flexfam-button-125x125.png"), path.join(__dirname, "banner125.png"));

// Update assets/img/ legacy shortcuts
fs.copyFileSync(path.join(adsDir, "flexfam-banner-468x60.png"), path.join(__dirname, "assets/img/banner-468x60.png"));
fs.copyFileSync(path.join(adsDir, "flexfam-button-125x125.png"), path.join(__dirname, "assets/img/banner-125x125.png"));

console.log("All attractive banners generated and synced successfully!");
