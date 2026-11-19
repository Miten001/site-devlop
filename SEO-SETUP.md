# Search discovery setup

## Implemented
- Canonical absolute URLs and social URL metadata on public marketing pages.
- Home page Organization and WebSite structured data, without fabricated ratings or earnings claims.
- A server-rendered `how-it-works.html` guide linked from both public entry pages.
- `sitemap.xml` containing public, indexable pages only. No invented last-modified dates.
- Account, private workflow, admin and creative pages carry noindex directives. These are search hints, not security controls; authentication and RLS remain necessary.

## Required owner steps after deployment
1. Add the URL-prefix property `https://miten001.github.io/site-devlop/` in Google Search Console.
2. Complete an offered ownership verification method. If using an HTML verification file or meta tag, use the exact file/tag Google provides; none has been invented here.
3. Submit `https://miten001.github.io/site-devlop/sitemap.xml`.
4. Inspect the home page and guide URLs, check that Google can fetch the deployed versions, then request indexing where available.
5. Watch indexing reports and actual search impressions/clicks. Submission does not guarantee indexing, position or traffic.

## GitHub Pages robots.txt limitation
Robots rules are read at the origin root: `https://miten001.github.io/robots.txt`.
A file at `/site-devlop/robots.txt` would NOT control this site's crawling. Therefore no misleading project-level robots.txt was added. Check the origin-root file if crawling is blocked; managing that file requires the repository serving the root site (or an appropriately configured custom domain). Do not block private URLs from crawling merely to hide them: crawlers must be able to fetch noindex directives.

## Sustainable audience growth
Publish useful original guides about actual task requirements, screenshot privacy and campaign budgeting. Share them with relevant communities with permission, and invite real creators to try funded campaigns. Avoid purchased backlinks, keyword stuffing, fake reviews, paid search-result clicks, or incentivized Google searches. Task traffic should never be presented as organic search traffic to ad networks.

## Scope
No changes to wallet, rewards, ad eligibility or database. Marketing copy cannot guarantee income or platform-policy compliance. Search Console submission and live Google indexing have not been performed.
