# Marketing-site build tooling

Working artifacts for the aglyn.com rebuild (Linear project **Marketing site
on Aglyn**). These are authoring inputs for the besigner, not application code
— nothing here is imported by any app.

| File | What it is |
| -- | -- |
| `product-page-skeleton.md` | The `/product/*` page contract: 8 sections, 74 text slots, in document order, plus the invariants (Container geometry, the heading-variant trap, the measured type scale). Derived by reading the built `/product/besigner` document live. |
| `apply-page-copy.js` | Pours one `product-copy/copy-<page>.json` into a freshly-pasted copy of that skeleton, in the besigner's page context. Verifies every section's slot count and writes **nothing** on a mismatch. |
| `verify-applier.mjs` | `node tools/marketing/verify-applier.mjs` — drives the applier over all eight pages against a stub canvas that models the REAL write semantics. |
| `product-copy/copy-<page>.json` | Copy and structure extracted verbatim from the Figma frames, one file per product page, plus a `claimsToVerify` list per page. |
| `extract-solutions-copy.mjs` | Extracts one `solutions-copy/copy-<page>.json` per solutions/use-case frame from a `get_metadata` dump of canvas `163:89`. Unit is a **card in a grid**. |
| `extract-pricing-copy.mjs` | Extracts `pricing-copy/copy-<variant>.json` from the four Pricing frame dumps. Unit is a **row in a table**. See below — it is deliberately not the solutions extractor. |
| `build-pricing-tables.mts` | Builds `pricing-copy/tables.json` FROM `plan-entitlements.ts` and reconciles all six tables it emits — `compare` (rows and plan columns), `tiers`, `usage`, `metered`, `fees`, `addons` — against the extractions, cell by cell. `npm run check:pricing-tables` runs it without writing. Deliberate divergences are declared with the frame's exact stale value, and a declaration the frame has caught up on fails until it is deleted. The tables that read every breakpoint print a compared-cell count; zero is a failure, because a reader that matches nothing reports clean. |

## Why the applier refuses rather than repairs

A positional shift is the failure mode that matters when pouring copy into a
fixed skeleton: every heading is still a heading, every card body still a card
body — just one slot out. A screenshot of that looks entirely correct. So the
applier asserts the slot count of every section up front and returns the
mismatch instead of writing a partial page.

`null` in a flattened slot means **keep what the skeleton already has**, for
values that are invariant across the product pages (the Early-access chip
reads "Now in early access" on every one). Blanking a node because the copy
JSON happened not to name it would be the worst reading of a missing value.

Run it with `{dryRun: true}` first — it returns the before/after pairs.

## `updateNodeProps` REPLACES the prop bag (AGL-1227)

It does not merge. Writing `{ children }` alone strips everything else off the
node — and on this skeleton that is `component: 'h1'…'h3'` on **all seven
headings**, `variant: 'body1'` on the hero body, and `screenId` on the Explore
cards. Always spread: `{ ...plain(node.props), children: value }`.

This is the heading-variant trap from the other side. A `muiTypography` with
neither `component` nor `variant` renders as a **`<p>`** while its node-level
`sx.fontSize` keeps painting it at 72px, so the page screenshots perfectly and
has no `<h1>` on it at all.

**A stub that counts calls proves the plan, never the effect.** The original
harness's `updateNodeProps` was a no-op, so every slot-count and ordering
assertion passed while the semantic damage was invisible. `verify-applier.mjs`
models the replace semantics and asserts the authored props survive; run it
after touching the applier. Its negative control is the real bug — reverting
the spread fails 8 authored props on all eight pages.

## `meta` is a step numeral in one section and a type tag in another (AGL-1233)

How-it-works items carry `meta: "01"`, which is display copy. Early-access stat
items carry `meta: "stat"`, which is **not** — the figure is in `title` and its
label is in `body`. Flattening early-access as `[meta, title]` published

```
stat        stat        stat        stat
1           9           0           1-click
```

on all eight poured pages. `/product/besigner` was hand-built, so the reference
page looked right while every page derived from it was wrong.

**The slot count is 13 under either flatten**, so the applier's own guard — the
thing designed to catch a positional shift — was structurally unable to see it.
Counting slots proves the arity, never the meaning. `verify-applier.mjs` now
asserts the eight stat values themselves; reverting the flatten fails exactly
those eight checks and leaves the write count at 74.

## Explore link cards are not bound by the skeleton

The seven `muiScreenLink` cards carry `children`, `renderAs`, `color` and
`variant` — and **no `screenId`**, including on the built `/product/besigner`
reference page. Pasting the skeleton therefore gives you seven dead links.
Bind them as part of the pour, deriving ids from the screens table at apply
time, and refuse rather than guess if a card's label has no match.

## `claimsToVerify` is not decoration

The build rules forbid claiming capabilities Aglyn does not have. Each copy
file carries the phrases its extractor flagged. **The lists are kept as
written** — they are the record of what was questioned, so a resolved claim is
answered in the copy and in `notes`, never by editing the list.

**26 are resolved** (decided) and applied to the JSONs:

- **Plugins** — *"reviewed before it **ships**"* → *"before it's **listed**"*.
  Review gates the listing; a publisher installing their own unreviewed
  version is deliberate design.
- **Footer strapline** — *"Open source, self-hostable, API-first."* →
  *"Open source. Self-hostable. Yours to run."* The first two are confirmed
  (public, Apache-2.0; Docker + BYO-Firebase). **API-first is a term of art**
  for an API-primary product, which Aglyn is not — it has a REST API beside a
  console-first product.
- **Cross-site rollup** — the nine `for every site` / `across every host`
  metrics constructions are now per-site.
- **Visitors / conversions** — dropped, per the banned-metric list.

### "every site" is not automatically a rollup

The banned claim is an aggregated **data** view. *"Manage every site, team, and
setting in one place"* is management, it is true, and it is deliberately left
alone on all seven pages that carry it — as are the media lines about reusing
one asset across sites, which the `visibleTo` sharing model really does.
Blanket-replacing the phrase would have removed four true claims.

### Three the copy got wrong about our own plans

Checked against `plan-entitlements.ts`, not asked:

| Was | `plan-entitlements.ts` |
| -- | -- |
| gift cards, ungated | `giftCards` starts at **Business** |
| versioning "roll back anytime" | `versioning` starts at **Pro** |
| "every plan … contacts are always metered" | `PLAN_PRICING.free.extraContactsUsdPer1k` is **null** |

All 12 price points in the pricing teaser, and the Pro/Business site and
collaborator limits, **do** match the code.

### Every other plan label checks out

The remaining gates DO have entitlement keys, under names that do not match
the marketing wording — search for the capability, not the noun in the copy:

| Copy | Key | Starts at |
| -- | -- | -- |
| memberships + gated content (Business & up) | `storefrontSubscriptions`, `contentGating` | Business ✓ |
| reviews (Pro & up) | `productReviews` | Pro ✓ |
| video upload (Pro & up) | `videoMedia` | Pro ✓ |
| Stripe payouts (Pro & up) | `marketplaceSelling` | Pro ✓ |
| per-screen analytics (Pro & up) | `screenAnalytics` | Pro ✓ |
| abandoned cart (Pro & up) | `abandonedCart` | Pro ✓ |
| A/B testing (Business and up) | `abTesting` | Business ✓ |

Note the feature arrays hold **seven** entries, not eight — `enterprise`
resolves its features separately, so index 0-6 is free…agency.

### Still open

The Console and Forms **mockups** still show a Contacts
entity and a Campaigns tab; those are inside the images and need fixing in
Figma before re-export, not here. Product overview's `SHIPPING NEXT` roadmap
band (five unshipped features) and its hero routing to Free while
`customDomain` starts at Starter are structural, and that page needs its own
build anyway.

## Pricing needed its own extractor, and a different invariant (AGL-1278)

`extract-solutions-copy.mjs` finds **cards** by grouping same-width sibling
frames. Pricing is **tables** — a 15-row compare table, a 7-row fee ladder,
four plan feature lists — where every row is a distinct two-cell record. Run
the card heuristic over that and a whole table groups into one "card".

So `extract-pricing-copy.mjs` preserves structure instead of classifying it,
and because it classifies less it has to assert more. The invariant is
**conservation**: every text node in the frame appears in the output exactly
once. Under-count is a dropped row, over-count is a row emitted twice, and on
a pricing page a silently dropped row is a *published falsehood* — so it
throws rather than write a plausible-looking file.

This generalizes the Figma float-tail bug the solutions extractor was patched
for (auto-layout division yields `405.3333435058594` and `405.33331298828125`;
grouping on the exact float drops a card while every field stays populated).
Rather than re-derive that one fix, assert the property it was protecting.

Both negative controls refuse to write any output:

```
frame has 243 text nodes but 98 were emitted — 145 lost
frame 77:38 is 1440px wide, which is not one of 375 (mobile), 768 (tablet),
  1920 (widescreen) — refusing to guess the variant from the file name
```

### Variant comes from the frame's measured width

The four node ids arrive without a breakpoint attached, and they do not sort
by one. Reading each frame's own `width` is the only non-guessing
way to tell `572:2890` (768, tablet) from `77:38` (1440, desktop) — so the
extractor keys on width and **refuses** an unrecognised one rather than
falling back to file name or argument order.

| node | frame | width |
| -- | -- | -- |
| `77:38` | Pricing | 1440 |
| `247:3566` | Pricing — Mobile | 375 |
| `572:2890` | Pricing — Tablet | 768 |
| `572:1218` | Pricing — Widescreen | 1920 |

Widescreen is geometrically identical to desktop — same height, same six
sections, same section heights, the content column re-resolved for a wider
canvas.

### The measured content columns

Read off the extracts themselves, not off memory. `widthPx` on each content
section is the design's own inner width:

| variant | canvas | design column | gutters | sections recorded |
| -- | -- | -- | -- | -- |
| desktop | 1440 | **1392** | 48 | 9 |
| widescreen | 1920 | **1488** | 432 | 9 |
| tablet | 768 | **688** | 80 | 11 |
| mobile | 375 | **335** | 40 | 10 |

A stock `maxWidth="xl"` Container caps at `min(viewport, 1536)` and subtracts
its own gutters, so it renders **1392 at 1440** and **1488 at 1920** — the
design columns exactly, at both desktop widths. Nothing to reconcile there;
`xl` never renders as a 1536-wide column at any real breakpoint. At 768 and
375 MUI's stock gutters differ from the frames' (720 vs 688; 343 vs 335) —
tracked on AGL-2362, which measured both and closed **no change**: the
AGL-1282 re-extract re-cut desktop and widescreen off the fictional 1280
column on 2026-08-08 and never touched tablet or mobile, so those margins are
an unfinished re-cut rather than a brand decision. Re-cut the frames if you
want them consistent; do not move the theme's gutters and do not hand-roll a
cap.

The design column is the **group** `widthPx`, not the section's. Every section
band equals the frame width at every variant, mobile included — reading the
band is what produced the "mobile is full-bleed, 32 out" claim. Mobile
actually runs 335 on four sections, 343 on "Usage pricing" (already exactly
what stock renders) and 375 only on "Compare features", a scrolling table that
bleeds on purpose via `maxWidth={false}`.

> ⚠️ This paragraph asserted a "same 1280 content column" until 2026-08-19,
> and `product-page-skeleton.md` prescribed a bespoke `sx {maxWidth: '1328px'}`
> to hit it — the exact shape AGL-1298 bans. **1280 was never the design
> column.** It appears in no `widthPx` in any extract here; 1328 is just
> 1280 + 48. The correct invariant is stock `xl`, and the column follows from
> the viewport.

### Regenerating

`get_metadata` on any of these frames is ~150 KB and overflows the tool's
output limit, so it lands in a file; pass those files as arguments. The dumps
are **not** committed — the extracted JSON is the durable record, the same way
`solutions-copy/` is. Re-fetch by node id from the table above.

## The frame is a record of the design, never of the truth

`plan-entitlements.ts` wins over Figma on every number. The frames have been
caught drifting twice — the `hostLimit` bullets still said 25 where Agency
allows 100, in four separate responsive variants. `pricing-copy/*.json` is a
verbatim record of the design and so **reproduces the design's errors on
purpose**; it is an extraction, not a copy deck.

The frame also omits **units** the code carries. Its add-on block renders
`$9 / mo` and `$89 / mo` flat, where the code says Event Calendar is $9/mo
*per host* and POS Pro is $89/mo *per extra register/location* (AGL-1279).
Publishing a per-host price as a per-org one is the copy bug that shape of
omission produces.

## Chrome is not a page section

Extractions disagree about whether the nav and footer are "sections". They are
the *layout's* — a screen document contains neither — so the applier filters
them out before matching. Analytics and Marketing looked like 10-section pages
purely because of that; all **eight detail pages are the same 8-section
skeleton**, and all eight pour cleanly (73–74 writes each).

`copy-product-overview.json` is the real exception: **11 page sections**. It is
the `/product` index, not a detail page — no Statement, no Capabilities/
Deep-dive pair, a centred hero with the mockup below, and three sections the
detail pages never have (a logo strip, a pricing teaser and a roadmap band). The
applier refuses it by design; it needs its own build.
