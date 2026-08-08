---
description: Diff every built marketing surface against its Figma frame (AGL-1241) — the pages were built by cloning, not from the design, and five sections were materially wrong before anyone opened Figma
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


Pick up the aglyn.com rebuild. Every page you need is live and green; the job
now is that **what shipped was not built from the design**.

Work issues in Linear: **In Progress** when you start, **In Review** when it
lands, **Done** once verified in production. One conventional commit per
AGL-### on `main`, `git commit --only <explicit paths>`, never `git add -A`.

Coordinates: org `aglyn-org` (`jWmGooWE3L`) · host `aglyn-marketing`
(`DXnRbPH4CQ`) · live `https://aglyn-marketing.aglyn.app` · Figma
`UsUolmsFgfymhaKMLBZvzo`. Site nav `l3rzTXC4ng`/`rBI3lk6TkH`, Site footer
`31kcPtVdrC`/`rKlUjAVoaw`, layout `Marketing base` `IWHn36dA9w`,
`/product` screen `V0B8e81t1-`/`f7X7DXr4In` (frame `15:32`).

## THE RULE, from Zach, 2026-08-04

**Always reference the design. Open the Figma frame before you author, not
after.** The `/product` overview was built by cloning proven section subtrees
from `/product/besigner` and pouring copy in. That bought consistency with the
detail pages and it was still wrong — the Pro pricing card is *dark* in the
design and shipped light; the hero eyebrow is a pill badge and shipped as a
rule; the second hero CTA is an outlined button and shipped as a text link.
None of that is visible without opening the frame.

**Copy JSON wins on wording, the Figma frame wins on layout and type.** The
design's Explore heading says *"Eight products…"*; the copy says **Nine**,
corrected deliberately. Console-showcase bullets were reworded to drop the
cross-site rollup claim. Confirm this split with Zach if anything looks odd —
he was asked and has not answered yet.

## 1. AGL-1241 — the audit. This is the work.

Not yet diffed against Figma at all:

- **`/product` remaining sections.** Two known suspects: features card icon is
  **48×48** in `16:47` (ours is 44); console-showcase should be a 440px left
  column with **26×26** bullet icons and a contained CTA (`66:164`), ours was
  cloned from the detail Deep-dive, a different bullet treatment.
- **All 9 `/product/*` detail pages** — `111:371` `114:763` `120:1516`
  `121:1905` `122:2294` `123:2683` `124:3072` `637:1218`, plus besigner
  `93:31`. Poured into a skeleton derived from the *built* besigner page, never
  compared to their own frames.
- **Nav** — only the links row was ever checked (`0:27`: 15px/500 on a 32px
  rhythm, confirmed live). Mega menus, drawer and CTA group never compared.
- **Footer** — brand block came from `10:22`; link columns and bottom bar never
  compared to `21:409`.
- **`Marketing base` layout** and any saved templates.

`get_metadata` on a frame gives you exact x/y/width/height per element — that
is usually enough to spot a wrong icon size or a reordered stack. Pull
`get_screenshot` when you need to see treatment (that is how the dark Pro card
was caught).

## 2. Already corrected against the design — do not redo

`/product` hero (pill badge `15:55`, outlined 2nd CTA `15:63`, headline breaks
after "Design it live." via `white-space: pre-line`, 920 block / 680 lede),
pricing (dark Pro card, badge right-aligned in the name row, price+period,
sub-line, tagline, cyan check rows, bold no-check group header), logo strip
(36px chips), section landmarks renamed off the clone sources.

Tour CTA is bound to `/demo` (`tvE5P-PnLs`). The `SHIPPING NEXT` band is
**pulled** per Zach. `/product` is **10 sections**, 200.

## 3. Queued for the next promotion — nothing of mine is unpushed

```
63736a494  fix(mui): the Image element discarded every style the author gave it (AGL-1240)
```

**Batch promotions — Zach has said so twice.** One promotion per session unless
he asks. Verify at the *deployment*, never the merge: a merged production PR is
not a deployed one (#761 merged and produced no deployment at all, stranding a
fix for three hours). `gh api .../commits/<sha>/status` is only trustworthy as
a fresh status on your own new merge.

When AGL-1240 deploys, every `/product/*` hero and deep-dive mockup gets back
its authored 16px radius and drop shadow, and the `/product` hero's `maxWidth`
takes over from the interim `props.width: 100%`.

## 4. Still open, unrelated to the audit

- **AGL-1234** — all nine pages share two mockups. Blocked: the MCP screenshot
  renders the node's own bounds (764×664), not the 920×580 the design shows,
  because the crop lives in the *parent* frame. Needs export frames in Figma —
  the natural place to also fix the Console/Forms mockups, which still show a
  Contacts entity and a Campaigns tab inside the artwork.
- **AGL-1235** — the statement pull-quote's emphasised phrase. Needs an
  inline-text container: `muiTypography` is `textEditable`, therefore a leaf,
  so no span can go inside it.
- **AGL-1237** — Accordion. Fix is on production; the drawer's collapse
  behaviour was never witnessed at mobile width. Confirm it.
- **Footer logo** is the on-light lockup on dark (7.08:1). Figma wants
  `aglyn-logo-text-light` (`341:1223`), which is not in the library. Zach's call.
- **8 unbound footer links** (Guides, Status, six socials) still need URLs.

## Hazards measured the hard way — each cost real time

**A component SAVE never reaches the live site.** Save writes
`components/{id}/versions/{versionId}` (msgpack); the tenant reads the **parent**
doc, and only **FILE ▸ Publish again** copies onto it. A screen save republishes
itself; a component save does not. Mine sat 56 minutes apart while I polled.

**`canvas.deleteNode` deletes the whole subtree.** Rewriting the parent's
`nodes` array does not detach the child. It took a 253-node document to 88 and
needed **21** `c.undo()` calls, because `deleteNode` saves history itself. Set
`nodes: []` first, or collapse the wrapper in place. And a node snapshot taken
*before* a re-parent restores the stale `parentId` when you write it back —
always integrity-check (no missing ids, no duplicates, `child.parentId ===
parent`) before saving.

**`text-decoration` propagates and a descendant cannot cancel it.** I tried to
ship whole-tile links against an un-deployed fix by moving every style onto a
Stack *inside* the anchor. Layout, padding, colour all transferred; the
underline did not, and `getComputedStyle(child).textDecorationLine` reads
`"none"` while the ancestor's underline still paints. 30 tiles shipped
underlined. If a component's own styling is unreachable, anything *propagated*
cannot be fixed from its children.

**A Stack's `direction` prop beats the node's `sx`.** Setting `display: flex` in
sx left the chip row a column and every chip filled the width. Change the prop.

**`sx` composed after `{...rest}` REPLACES the node's styles.** Three
components had it — Screen Link's Link Container sibling, and Image (AGL-1240),
where it silently discarded every authored radius and shadow site-wide. Worth
grepping for the pattern.

**The besigner is only scriptable in dev.** `window.AglynModule` is gated on
`NODE_ENV !== 'production'`, so script against `nx serve console` on localhost
(it hits production Firebase). `for...in` over a node's props does not see
nested observables — `props.sx` reads `{}`; use `node.toJSON()`.

**Serving a temp file from `apps/console/public/` is how you get data into the
page** — but `await fetch(...)` at the top of a `javascript_tool` call makes the
whole thing a promise CDP can drop mid-run ("Promise was collected"). Fetch and
cache to `window` in one call, then do the work synchronously in the next.
Delete the temp files and `git rm --cached` them afterwards.

**Chrome's window would not resize below ~606px or above ~2226px on this
machine.** MUI's temporary Drawer renders nothing until opened, so there is no
DOM to inspect at desktop width. Plan mobile verification around that.

## Concurrent sessions

Another session runs against the same `main` and working tree, and something
there **auto-stages files**. Always `git commit --only <your paths>`. A `git
push` after a failed commit publishes THEIR commits too. Never `git stash`.
That session promoted #763 mid-run, which is how AGL-1240's prerequisites
reached production — check `origin/production` before assuming a queue is yours.
