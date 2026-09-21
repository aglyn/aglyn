# Marketing-site build tooling

Working artifacts for the aglyn.com rebuild (Linear project **Marketing site
on Aglyn**). These are authoring inputs for the besigner, not application code
— nothing here is imported by any app.

| File | What it is |
| -- | -- |
| `product-page-skeleton.md` | The `/product/*` page contract: 8 sections in document order (74 text slots with a seven-card Explore grid; the Explore count follows the copy), plus the invariants (Container geometry, the heading-variant trap, the measured type scale). Derived by reading the built `/product/besigner` document live. |
| `apply-page-copy.js` | Pours one `product-copy/copy-<page>.json` into a freshly-pasted copy of that skeleton, in the besigner's page context. Verifies every section's slot count and writes **nothing** on a mismatch. |
| `verify-applier.mjs` | `node tools/marketing/verify-applier.mjs` — drives the applier over all eight pages against a stub canvas that models the REAL write semantics. |
| `pour-page.mjs` | `node tools/marketing/pour-page.mjs --host <h> --screen <s> --copy <file> [--apply]` — pours a `copy-<page>.json` into a screen version through **Firestore**, because the besigner route is closed (AGL-2920). Dry run by default; `--apply` writes a NEW version and moves the screen's `versionId` to it, never touching the source version and never publishing. |
| `firestore-canvas.mjs` | The `canvas` that `pour-page.mjs` hands the applier, backed by a stored `nodes` map. Resolves a child given either as a `NodeId` or as an inline node, because `AglynNodeSchema.nodes` is `NodeId[] \| AglynNodeSchema[]` and both are valid documents. |
| `verify-pour-canvas.mjs` | `node tools/marketing/verify-pour-canvas.mjs` — drives the REAL applier over a stored-shaped document in both the normalized and denormalized child forms, asserts they produce an identical page, and asserts the refusals still refuse. |
| `product-copy/copy-<page>.json` | Copy and structure extracted verbatim from the Figma frames, one file per product page, plus a `claimsToVerify` list per page. |
| `shared-copy/band-<name>.json` | A block placed on **many** pages, worded once. `band-ai.json` is the first (AGL-2921) — see "One band on twenty-five pages" below. |
| `blog-copy/post-<slug>.json` | One blog post: prose rather than slots, every internal link resolved against the real tree, and the rolling-out notice held outside the body. Three so far (AGL-2922) — see "Blog posts are prose, so the contract is the links" below. |
| `extract-solutions-copy.mjs` | Extracts one `solutions-copy/copy-<page>.json` per solutions/use-case frame from a `get_metadata` dump of canvas `163:89`. Unit is a **card in a grid**. |
| `extract-pricing-copy.mjs` | Extracts `pricing-copy/copy-<variant>.json` from the four Pricing frame dumps. Unit is a **row in a table**. See below — it is deliberately not the solutions extractor. |
| `build-pricing-tables.mts` | Builds `pricing-copy/tables.json` FROM `plan-entitlements.ts` and reconciles all six tables it emits — `compare` (rows and plan columns), `tiers`, `usage`, `metered`, `fees`, `addons` — against the extractions, cell by cell. `npm run check:pricing-tables` runs it without writing. Deliberate divergences are declared with the frame's exact stale value, and a declaration the frame has caught up on fails until it is deleted. The tables that read every breakpoint print a compared-cell count; zero is a failure, because a reader that matches nothing reports clean. A rate the code charges but no row publishes is a failure too: `RATE_KEYS` enumerates every `extra*` field off `PLAN_PRICING` itself, so a new overage rate fails on the commit that adds it rather than after somebody reads an invoice line with no published price. A row we publish that the frame carries nowhere is declared in `USAGE_EXPECTED_ABSENT` and resolves — failing until the entry is deleted — once every breakpoint carries it. |

## The besigner route is closed, so the pour goes through Firestore

`apply-page-copy.js` opens with `window.AglynModule.canvas` and says to paste
it into the besigner's own page context. On `app.aglyn.com` that context is not
reachable: `AglynModule` is absent from the top frame, the two real canvas
frames both throw `SecurityError` on any property read, and neither
`window.Aglyn` nor `window.__AGLYN_PLUGIN_HOST__` carries a canvas. Measured
2026-09-20 with the besigner fully loaded.

`pour-page.mjs` therefore supplies a canvas backed by the stored document
instead. It does **not** re-implement the contract — it reads and evaluates
`apply-page-copy.js` verbatim, exactly as `verify-applier.mjs` does. The slot
assertions, the flattens and the prop-spread stay in one place, because each of
those guards exists thanks to a bug that already happened once, and a second
copy is a second place for them to rot.

The node schema is the part worth knowing: `AglynNodeSchema.nodes` is
`NodeId[] | AglynNodeSchema[]`. A lookup that only understood ids would resolve
every child of a denormalized document to `undefined`, walk to zero text nodes,
and report a slot-count mismatch — a shape fault that reads as a copy fault, on
the one tool whose job is to refuse a shifted pour. `verify-pour-canvas.mjs`
drives both forms and requires them to agree.

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

The `muiScreenLink` cards carry `children`, `renderAs`, `color` and
`variant` — and **no `screenId`**, including on the built `/product/besigner`
reference page. Pasting the skeleton therefore gives you a grid of dead links.
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

## One band on twenty-five pages (AGL-2921)

The format had **no way to say a block is shared**. `product-copy/` and
`solutions-copy/` each hold one page's own sections, and `apply-page-copy.js`
pours one file into one canvas — so "the same band on every product, segment
and solutions page" could only be expressed by pasting the same six strings
into twenty-five files, where the second edit forks them and nothing notices.

`shared-copy/band-ai.json` is the smallest thing that says it instead: the
band's copy **once**, a `slotContract` in the same shape as the section
contracts in the applier, and a `targets` list of the pages it rides on with
each one's copy file. `verify-applier.mjs` asserts the heading appears in no
page file, that the flatten arity matches the declared slot count, that the
rolling-out line is the last slot, and that every named target file exists.

Two things about it are load-bearing:

- **Pour the page copy FIRST, then place the band.** The applier asserts the
  canvas holds exactly as many root sections as the 8-section contract, so a
  page already carrying the band is a page it will refuse forever after. To
  re-pour, remove the band, pour, place it again. The harness carries this as
  a negative control — a nine-section canvas must be refused — so the ordering
  is checked rather than remembered.
- **On the canvas it is one reusable component, instanced per page.** Not
  twenty-five copies of a section. It is what the platform's own building
  rules tell a customer to do with a block that repeats, and it makes the
  rolling-out line's eventual deletion one edit instead of twenty-five.

## `copy-ai.json` is authored, not extracted (AGL-2920)

Every other file here is a record of a Figma frame. `/product/ai` has no
frame, so `figmaNodeId`, `frameName` and `frameSize` are null, each `notes`
describes the skeleton slot rather than a drawn section, and every capability
claim carries its source in `claimsToVerify` — a path under
`apps/docs/docs/ai/` or in the AI plugin — because there was no design to
check the copy against, only the product.

It pours through the unchanged applier as an ordinary 8-section deck, with two
differences from the older ones:

- **Ten Explore cards**, like `copy-datasets.json`: Aglyn AI is not one of the
  roster of ten, so there is no self-link to omit. Grow the grid to ten before
  pouring — the applier takes that section's count from `explore.items`.
- **The early-access chip is poured**, not kept. `eyebrow` is set, so the
  applier writes over the skeleton's "Now in early access"; every other deck
  leaves it null. That is why the page writes 80 slots where Datasets writes
  79, and the harness derives the figure rather than pinning it.

It also carries three keys the applier never reads and a besigner pass must
place by hand: `seo` (title and description are fields on the screen's detail
page, not text nodes — the surface `docs/PRICING_SURFACES.md` records as
missed twice), `disclosure` (the rolling-out notice, below), and `placements`
(the nav entry, the footer entry and the eleventh `/product` grid card, which
belong to the layout and to another page).

### The rolling-out line is a slot, not a sentence

`disclosure` is a **discrete, removable** element: its own notice band under
the hero, not a qualifier threaded through the prose. Generative building is
behind `release_ai_generative`, which is off in production — every generative
route answers 404 — so the notice is required until the flip, and the flip
then **deletes** it rather than rewriting the page around it, the same way the
`:::caution Rolling out` admonitions come out of `apps/docs/docs/ai/`.

The split it makes is the honest one: the assistant that answers questions is
released (`release_assist`, and `ai-assist.ts` carries no flag at all); it is
generative **building** that is rolling out. A page that blurs the two
undersells what works or oversells what does not.

`copy-product-overview.json` is the real exception: **11 page sections**. It is
the `/product` index, not a detail page — no Statement, no Capabilities/
Deep-dive pair, a centred hero with the mockup below, and three sections the
detail pages never have (a logo strip, a pricing teaser and a roadmap band). The
applier refuses it by design; it needs its own build.

## Blog posts are prose, so the contract is the links (AGL-2922)

A blog post has no skeleton to pour into: the body is a markdown block on a
`blog` collection entry, not 74 slots in a fixed section order. There was no
home for post bodies at all — the four posts already published were written
straight into the CMS, and the only trace of them in this repository is their
cover art in `tools/scripts/generate-blog-covers.mjs`. `blog-copy/` is that
home, in the shape the rest of this directory already uses: one file per post,
`seo` and `disclosure` as top-level keys the applier never reads, and
`claimsToVerify` carrying the provenance of every capability sentence.

`body` is an **array of markdown blocks** rather than one string, for the same
reason `product-copy` bodies are arrays: a block is the unit that gets edited,
moved and diffed. Join with a blank line to get the entry body.

Since there is no arity to assert, the harness asserts the two things that can
actually go wrong:

- **Every link resolves.** A docs link is checked against a real file under
  `apps/docs/docs/`; a site link against the routes the live sitemap serves.
  These posts were written from a keyword plan dated 2026-09-13 whose internal
  links had already rotted — it names `/alternatives/framer`, which this site
  does not have, and a docs path `ai/generate-a-page` that is really
  `building-sites/screens-and-layouts/generate-a-page.md`. Reinstating either
  is the harness's negative control, and it fails on both at once. Each link
  also records `verifiedAgainst`, so the next reader checks the claim rather
  than the memory of it.
- **The rolling-out notice is a block, not a sentence.** Same doctrine as the
  shared band and as `/product/ai`: `disclosure` sits outside `body`, so the
  flip deletes one block per post. A post whose disclosure wording had leaked
  into a paragraph would look identical in the JSON and be impossible to
  remove cleanly, so the harness asserts `body` does not contain it — and that
  all three posts carry the *same* wording, the one the docs use.

⛔ **`/product/ai` is not a live route.** Its copy deck is committed here but
the page has not been built on the canvas, so no post links it. Each file's
`linksConsideredAndNotUsed` records that as a publish precondition; swap the
link in once the page is live. Routes are verified against
`https://aglyn.com/sitemaps/pages/1.xml`, which is the only record of what the
marketing site actually publishes — `seed-marketing-screens.mjs` seeds a
subset and knows nothing about `/alternatives/*` or `/pricing`.

Two things these files do **not** do. They carry no price, credit count or
time-saved figure: `docs/PRICING_SURFACES.md` owns the first and nothing
measures the others yet (AGL-3024's live run records credits and tokens per
document kind, and is what a cost line would have to come from). And the
covers are not generated — add a `POSTS` entry to
`tools/scripts/generate-blog-covers.mjs` and upload the PNG to the media
library separately, which an agent cannot do.
