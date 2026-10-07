# FlexFam ad kit

Ready-to-share banner creatives for GitHub Pages and affiliate placements.

- Landing URL: https://miten001.github.io/site-devlop/landing.html
- Banner preview page: https://miten001.github.io/site-devlop/ads.html
- Download page: https://miten001.github.io/site-devlop/download.html

Every asset has an SVG source and a PNG render. Add `?ref=YOURCODE` or `?r=YOURCODE` to the landing URL before sharing so referrals are preserved.

Compatibility alias added for direct shares:

- `flexfam-photo-125x125.png` — 125×125 PNG badge URL
- `flexfam-photo-125x125.svg` — matching SVG source

## Regenerating these creatives

Banner artwork lives in [`generate-banners.js`](../../generate-banners.js) (SVG → PNG via `@resvg/resvg-js`).

```bash
npm i            # installs @resvg/resvg-js + jsdom from devDependencies
npm run build:banners
zip -j flexfam-ad-kit.zip flexfam-*.png flexfam-*.svg ad-kit.json README.md   # run from this folder
```

Copy rules for this kit: no dollar-per-day promises. Headlines describe the mechanism
(small social tasks → points → real USDT, 9 platforms), never an earnings guarantee.
