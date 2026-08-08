---
description: The nav chrome is LIVE — finish the marketing site: publish the footer brand block, build /product overview (11 sections, the applier refuses it by design), and land the stranded dropClearedProps fix
---

> ⚠️ **CHARTER OVERRIDE (Zach, 2026-08-08) — supersedes anything below that
> says otherwise.** The marketing site is built by CLICKING in the besigner, in
> Zach's authenticated browser, exactly as a no-code subscriber would: screens,
> layouts, reusable components, templates, the attribute/style panels. **No JSON
> Editor, no Raw Markup, no custom CSS/sx, and no admin scripts that write node
> data.** When the styles panel can't express something, the answer is a new
> user-friendly style form field component (file it as a `Gap ·` issue), not a
> workaround. One-shot scripts are not committed. The full charter is in the
> Linear project description and in memory as `project_marketing_site_charter`.
> In particular, ignore any "you do not need the besigner / use an admin script"
> guidance below — that drift is exactly what this banner corrects.


Pick up the aglyn.com rebuild. The nav chrome shipped on 2026-08-04; what is
left is the footer, the `/product` index, and three decisions that are yours.

Work issues in Linear: **In Progress** when you start, **In Review** when it
lands, **Done** once verified in production. One conventional commit per
AGL-### on `main`, `git commit --only <explicit paths>`, never `git add -A`.

Coordinates: org `aglyn-org` (`jWmGooWE3L`) · host `aglyn-marketing`
(`DXnRbPH4CQ`) · live `https://aglyn-marketing.aglyn.app` · Figma
`UsUolmsFgfymhaKMLBZvzo`. Site nav `l3rzTXC4ng`/`rBI3lk6TkH`, Site footer
`31kcPtVdrC`/`rKlUjAVoaw`, layout `Marketing base` `IWHn36dA9w`.

## What is already LIVE — do not rebuild it

- **All 8 `/product/*` detail pages**, poured, Explore links bound (7 each).
- **Product mega menu** — 9 icon tiles + FEATURED column with gradient and
  "See all products →".
- **Solutions mega menu** — 6 icon tiles, BY USE CASE, and the **dark**
  FOR DEVELOPERS card (`#161C21` — it is dark BY DESIGN, do not "fix" it).
- **Beta pill** in the nav, and the **mobile drawer** (hamburger below 900px,
  Product/Solutions accordions, Pricing/Docs/Blog, CTAs, GitHub line).
- Hover on both mega menus works in production (AGL-1229).
- `/product/*` 500s are cleared (AGL-1226).

## 1. Publish the footer brand block — built, saved, NOT published

`31kcPtVdrC` already contains the Figma `10:22` block: on-dark logo, tagline,
Beta pill, and the "ARE YOU A DEVELOPER?" card with Zach's approved strapline
**"Open source. Self-hostable. Yours to run."** The live footer still shows the
old `Aglyn` placeholder because only the NAV was published.

FILE ▸ Publish again, then **poll the live site for a NEW string** — the first
poll after publishing shows nothing; propagation + ISR takes ~60 s.

**Decision needed first (Zach):** the logo is `aglyn-logo-lockup-color.svg`,
which the DAM files under `brand/**logos-on-light**`, used on a dark footer. It
measures 7.08:1 so it is legible, but Figma specifies a LIGHT wordmark
(`aglyn-logo-text-light`, 17.18:1) **that does not exist in the library**.
`aglyn-logo-full-dark.svg` is NOT the on-dark variant — it renders identically
to the on-light lockup under a misleading name. Either accept the interim (one
prop to swap) or export `341:1223` from Figma and upload it.

## 2. `/product` overview — 11 sections, its own build

`copy-product-overview.json` is the real exception and `apply-page-copy.js`
**refuses it by design**. It is the `/product` index (`V0B8e81t1-`), not a
detail page: no Statement, no Capabilities/Deep-dive pair, a centred hero with
the mockup below, plus a logo strip, a pricing teaser and a roadmap band.

Its `claimsToVerify` is the largest remaining. Already settled by measurement —
**all 12 price points and the Pro/Business site + collaborator limits match
`plan-entitlements.ts`**. Still open on that page:

- the `SHIPPING NEXT` roadmap band — five unshipped features;
- the hero routes to Free while `customDomain` starts at **Starter**;
- "Nine products, one platform." is already corrected in the JSON.

## 3. Land the stranded `dropClearedProps` fix (AGL-1226)

`d4b968094` is on `main` and on `origin/production` but **is not in the live
build** — it missed the 00:06Z promotion by three minutes and the next merge hit
the daily limit. The live 500 was cleared by a DATA fix (two CTA buttons per
screen, `color: null` → `'inherit'`, on all nine screens), so the instances are
safe but **the class is not**: any newly-cleared colour on any site reproduces
it. Deploy it, then re-check all nine pages return 200.

## Hazards measured this session — each cost real time

**`updateNodeProps` REPLACES the prop bag; it does not merge.** Passing
`{ children }` alone strips `component: 'h1'` off every heading. A Typography
with neither `component` nor `variant` renders as a `<p>` while `sx.fontSize`
keeps painting it at 72px — so the page screenshots perfectly with no `<h1>` on
it. Always spread: `{ ...plain(node.props), children: value }` (AGL-1227).

**A cleared attribute persists as `null`, and `null` is not "use the default"
in React.** It reaches MUI, which capitalizes it and throws error #7 during
SSR — a hard 500, not a degraded render (AGL-1226).

**Icon nodes need `iconPath`, not just `iconId`** — the path is denormalized at
author time (AGL-1212). Resolve it from `@mdi/js`; a bare `iconId` paints a
help diamond on the live site.

**Publishing is a Firestore write + ISR revalidation, NOT a Vercel deploy.**
That is how the live 500 was fixed while deploys were rate-limited. It also
means the snackbar is not evidence: poll the live HTML for a string that only
the new version contains, and pick one that did not exist before — half my
first check passed on strings that predated the change and proved nothing.

**Screenshot coordinates are SCALED.** A hover that "does nothing" is
indistinguishable from a broken interaction. Measure the element's rect,
convert (`shot = css × 1512/innerWidth`), then hover. I wrote off a working fix
once on a 37 px miss.

**Harvest structurally, not by loose predicates.** Pulling drawer entries from
the live panels gave 10 products and 12 solutions until the filter became
"parent is exactly `[muiScreenLink, muiTypography]`". A description-based
filter still swept in the featured column's blurb.

**Check contrast before accepting a colour instruction.** In MUI `.light` is
LIGHTER than `.main` — `primary.light` on the Beta pill would have been
1.92:1. Shipped `primary.dark` at 4.30:1, which is still under AA's 4.50 for
11px text; `#0077B0` (4.52:1) is the only value that clears it. Zach's call.

**`gh api .../commits/<sha>/status` never re-evaluates.** It is valid only for
the attempt that wrote it, and wrong two ways: re-reading the same sha later,
AND reading the already-green production commit *before* merging — that one
reads `success` forever and cannot tell you the window is open. Merging on it
puts `origin/production` ahead of the live build.

**Verify a responsive change at the target width BEFORE publishing.** The
mobile drawer hides the desktop links; had it been broken, mobile would have
lost navigation entirely.

## Concurrent sessions

Another session runs against the same `main` and the same working tree.
Something there **auto-stages files** — `apps/console/public/__*-tmp.*`
appeared staged more than once. Always `git commit --only <your paths>`, and
know that a `git push` after a failed commit will publish THEIR commits too
(that happened once). Never `git stash`.

Serving a temp file from `apps/console/public/` is a good way to get data into
the besigner page without pasting it — just delete it and `git rm --cached` it
afterwards.

## Still open beyond the above

- The 8 unbound footer links (Guides, Status, and six socials) need real URLs.
- Error screens `/404` `/401` `/503` exist but are **not wired**; there is no
  `forbidden` slot, so the design's 403 has nowhere to bind.
- Console + Forms **mockups** still show a Contacts entity and a Campaigns tab
  — inside the images, so they need a Figma fix before re-export.
- `memberships`/`reviews`/`video`/`payouts` plan labels are all CORRECT; they
  live under `storefrontSubscriptions`, `contentGating`, `productReviews`,
  `videoMedia`, `marketplaceSelling`. Search the capability, not the noun.
