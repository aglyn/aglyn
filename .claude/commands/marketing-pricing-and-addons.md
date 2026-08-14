---
description: "SUPERSEDED 2026-08-14 — master issue AGL-1277 is Done. A dated 2026-08-08 handoff kept for the click-building charter and traps. Use /handoff for the current queue."
---

> ⚠️ **SUPERSEDED (2026-08-14, AGL-1704).** **Master issue AGL-1277 is Done** —
> verified in Linear. Re-derive the pricing queue from Linear rather than this
> file. Two corrections that matter if you read on:
>
> - **Promotion needs Zach's word before it starts; never open a production PR
>   unasked.** See the corrected "Standing" section at the bottom.
> - **There is no `window.AglynModule.canvas`.** `AglynModule` is a dev-only alias
>   of `window.Aglyn`, an `IBesignerAppController` with **no `canvas` property**.
>   Reach the canvas via `window.Aglyn.getBesignerController()`.
>
> The CHARTER OVERRIDE below still stands — it is Zach's, and it is why the site is
> built by clicking.

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
> Also rescinded (AGL-1302): the all-routes `while read p; do curl` republish sweep
> — it forced ~40 Firestore reads per render and burned 87% of the daily free tier.
> Verify ONE route; use POST /api/screens/revalidate for layout-wide invalidation.

Finish the **pricing page** on the Aglyn marketing site. Two jobs: rebuild
`/pricing` from its Figma frames (most of the design is missing, and mobile and
tablet have never been checked), and add the two missing add-ons. Master issue
**AGL-1277**; pricing accuracy notes live on it.

Coordinates: org `aglyn-org` (`jWmGooWE3L`) · host `aglyn-marketing`
(`DXnRbPH4CQ`) · live **`https://aglyn.com`** · Figma `UsUolmsFgfymhaKMLBZvzo`.
Dev servers: console **4200**, tenant **4500** — `preview_start {name:"console"}`
/ `{name:"tenant"}` from `.claude/launch.json`. They die with the session.

Linear: In Progress on start, In Review when it lands, Done once verified in
production. One conventional commit per AGL-###, `git commit --only <paths>`,
**never `git add -A`**. Never `git stash`. Building pages needs **no commit** —
it is Firestore data. `apps/*/next-env.d.ts` shows modified after any dev-server
start; that is noise, never commit it.

---

# Job 1 — rebuild `/pricing` from the design

Screen `v0clP6xQl-` / version `9O5RKr4P9g`.
Editor: `localhost:4200/aglyn-org/hosts/aglyn-marketing/screens/v0clP6xQl-/versions/9O5RKr4P9g/besigner`

Frames Zach supplied — **verify which is which by reading each frame's width,
do not infer from id order**:

| node | expected |
| -- | -- |
| `77:38` | Pricing (desktop, 1440) |
| `247:3566` | ? |
| `572:2890` | ? |
| `572:1218` | ? |

## The page is NOT empty — reconcile, do not wipe

It currently has, in order: hero · 4-card plan grid · **Compare plans** (15
rows) · **Room to grow** (Scale/Advanced/Agency/Enterprise) · **Usage pricing**
table · **Transaction fees** ladder · Pricing FAQ · CTA. Sections 3–6 were built
from `PLAN_ENTITLEMENTS` / `PLAN_PRICING`, not from the frame, and are accurate.
Add what the design has and this lacks; correct what is wrong. Wiping loses
verified-correct content.

## Responsive is half the job

Aglyn pages are responsive through **MUI breakpoint objects in `sx`**
(`gridTemplateColumns: {xs:'1fr', sm:'repeat(2,1fr)', md:'repeat(4,1fr)'}`), not
separate documents. The Figma mobile/tablet frames tell you the intended
behaviour; encode it in `sx`.

Verify by looking, not by reasoning. Assert
`document.documentElement.scrollWidth === clientWidth`. A wide table must scroll
inside its own `overflow-x:auto` container — the page body must never scroll
sideways. The Compare-plans table already does this (`minWidth:'760px'` inside
an `overflowX:'auto'` wrapper); match that pattern.

## ⚠️ `/pricing` at mobile/tablet is UNVERIFIED — and the obvious tools lie

Two dead ends, both of which produce a **confident-looking false pass**:

- **`mcp__claude-in-chrome__resize_window` resizes the OS window but does NOT
  reflow the page viewport.** `document.documentElement.clientWidth` stayed
  `1800` after resizing to 390 and again to 520, across a reload. Any overflow
  assertion taken this way is measuring the desktop layout.
- **The in-app browser (`mcp__Claude_Browser__*`) emulates mobile correctly**
  — `resize_window {preset:"mobile"}` gives a true `clientWidth: 375` — **but
  when its pane is hidden the renderer suspends and every `getBoundingClientRect`
  returns 0.** A check then reports `scrollWidth === clientWidth`, zero
  offenders, zero inner scrollers — all vacuously true of a page with no layout.
  The tell is `document.body.getBoundingClientRect().width === 0`.

**Guard every responsive check**: bail unless `document.body` has a non-zero
width AND `clientWidth` is actually the width you asked for. Wake a suspended
pane by scrolling the page in a loop with short awaits, then re-measure; that
worked for the launching-soon page earlier. If neither browser will cooperate,
say the check is unverified — do not report a pass.

# Job 2 — the two missing add-ons

`Event Calendar $9/mo` and `POS Pro register $89/mo` are real, live in Stripe
and in code, and absent from `/pricing`. Add them to the Usage-pricing section
as add-on-only line items.

⚠️ **Do not bundle Event Calendar into a plan.** `eventCalendar` is `false` on
every plan including Advanced — only the $9 add-on enables it. The Drive doc
flags "bundle into Advanced vs keep add-on-only" as an **open packaging
decision**. Documenting current behaviour is a copy fix; changing it is Zach's
call.

---

# Pricing ground truth — verified 2026-08-06

**The code wins over the frame.** Figma is hand-maintained and has already been
caught drifting twice.

| plan | monthly / annual-mo | digital fee | physical fee |
| -- | -- | -- | -- |
| Free | $0 | 0% | 0% |
| Starter | $25 / $16 | 5% | 2% |
| Pro | $56 / $39 | 3% | 0% |
| Business | $139 / $99 | 2% | 0% |
| Scale | $249 / $179 | 1% | 0% |
| Advanced | $399 / $299 | 0% | 0% |
| Agency | $799 / $649 | 0% | 0% |
| Enterprise | quoted per deal | — | — |

`hostLimit` 1/1/3/10/15/25/100 · `apiAccess` **Business and up** · add-ons
Starter→Agency: host 10/8/5/5/4/3 · seat 5/4/3/2/2/2 · collaborator 3/2/1/1/1/1
· dataset 2/2/1/1/1/1 · contacts per 1k 1/.75/.5/.4/.25/.2 · API per 1k
—/—/.5/.35/.2/.15.

**Enterprise has no Stripe SKU by design** (Decision Log §4) — it is a
contact-sales motion. `STRIPE_PRICE_ENTERPRISE` is correctly absent; all six
self-serve plans have monthly and yearly envs set in production.

Source of truth: `libs/aglyn/src/lib/app-utils/plan-entitlements.ts`. Drive:
`Platform Docs › Pricing & Packaging › 00-Pricing-Source-of-Truth` — **updated
2026-08-06 and now accurate**; it was stale on the fee ladder and on a resolved
Stripe follow-up. Never run `tools/scripts/setup-stripe.mjs` (writes to live
Stripe). Never change prices in code to match a frame.

---

# Getting a design out of Figma — this cost hours, do not rediscover it

1. **`get_metadata` with no nodeId returns 2 pages. The file has 14.** Pages are
   not discoverable through the API.
2. To get a page's **canvas id**: open the file in the browser and click the page
   in the Pages list — the URL's `node-id` becomes it (Solutions is `163:89`).
   Reachable no other way.
3. `get_metadata` on a canvas is **~376 KB**. It overflows the tool limit and is
   written to a file. **Parse that file with a script; never read it into
   context.**
4. **A text node's text is its `name` attribute** in that dump. That is verbatim
   extraction — never transcribe copy from a screenshot.
5. Frame ids are **not sequential siblings** — each frame carries its own session
   id (163, 164, 165, 189, 190, 206…). Probing near a known id finds nothing.
6. `download_assets` and `get_screenshot` both render a node's **own bounds**;
   neither honours a parent frame's clip. That is the open blocker on AGL-1234.

**`tools/marketing/extract-solutions-copy.mjs` is a working extractor — adapt
it.** Two silent-drop bugs it already solves:

- **Figma float tails.** Auto-layout division yields `405.3333435058594` and
  `405.33331298828125`; grouping cards on the exact float puts one in a group of
  one and **drops it**. The file still parses, every field is populated, and a
  naive validator says "clean" — the page has just lost a card. Round the width.
  The extractor **throws** if a grid loses a card.
- A card leading with a step numeral keeps it as `meta`, never `title`
  (AGL-1233) — flattening publishes `01 / 02 / 03` as the headings.

Write extracted copy to `tools/marketing/pricing-copy/copy-<variant>.json` in the
same schema as `tools/marketing/solutions-copy/*.json`, and commit it. That is
what makes the build checkable instead of trusted.

---

# Besigner mechanics

Canvas API (dev only): `window.AglynModule.canvas` —
`addNodeFromNested(nested, parent, index?)` · `updateNodeProps(node, props)`
(**replaces** the prop bag — always spread `{...node.props, …}`) ·
`deleteNode(node)` (recurses) · `makeNested(node)`.

## Saving — the recipe that actually works

**Never click Save by coordinate.** chrome-mcp screenshot widths vary between
calls on the same window (1568 and 1512 observed against a constant
`innerWidth` 1800), so a cached coordinate lands in dead space. Three clicks
provably inside the button's rect failed in a row.

```js
[...document.querySelectorAll('button')]
  .find(b => /^save$/i.test(b.textContent.trim()))?.click()
```

Then poll until **both** `Aglyn.canvas.isInitialSame` and
`Aglyn.canvas.isInitialConfirmed` are true — the second is the
server-acknowledged baseline (AGL-1262). **Do not navigate away before it is
true**; the save is async and navigation kills it. 15 consecutive saves, zero
retries, once this replaced coordinate clicking.

Dismiss the AGL-1256 recovery banner first — a button reading exactly
`Discard`. It also makes a pour report "not empty" when the recovered draft is
already on canvas.

When batching pages, **throw** if a save is unconfirmed so the batch halts
instead of navigating away from unsaved work.

## Component gotchas

- `div` is **not** a registered componentId — use `componentId:'section'` with
  `props.element` (validated against `section|div|article|aside|nav|header|footer|main`).
- Icons need a denormalized `iconPath` or they render the help glyph (AGL-1212).
  `@mdi/js` is in `node_modules`; generate paths from it. Serve them to the page
  over a local CORS server — the extension blocks long path-like strings in tool
  output.
- `image` defaults `objectFit:'cover'`, so a fixed-height box **crops**. Use
  `width:'100%'` / `height:'auto'` / `objectFit:'contain'`. It is `selfClosing`
  — never give it children (SSR 500, AGL-579).
- `muiButton`: `screenId` internal, `href` external and gated by
  `/^(https?:\/\/|mailto:|tel:|\/|#)/i` — anything else is silently dropped.
- Reusables to reuse, not rebuild: `Product detail hero` (`T-RdDkvVLW`, props
  eyebrow/headline/lede) and `Marketing CTA` (`TGUPvfojEg`, props headline/lede).
- The canvas is a **closed** shadow root — `document.querySelectorAll` returns 0
  while it renders fine. Trust `AglynModule.canvas.toJSON()` and a screenshot.

## Type scale in use

eyebrow 13px/600/1.04px `#0090d9` · section h2 `{xs:24,sm:28,md:30}`/800/1.2 ·
lede 16px/1.6 `text.secondary` · card title 17px/700 · card body 15px/1.6 ·
statement `{xs:22,sm:26,md:34}`/700/1.18. Elevations already on the site:
`0px 4px 12px -2px rgba(0,0,0,0.08)` · `0px 12px 28px -10px rgba(0,0,0,0.14)` ·
`0px 24px 48px -12px rgba(0,0,0,0.18)`. Radius 8px.

---

# Verifying

- **ISR: the first read after a save is reliably stale.** `?cb=` does not bust it
  (query strings are not in the cache key). Read 2–3 times and trust agreement
  between reads 2 and 3. Some pages took 4–5 reads.
- `grep -c` counts **lines**, not occurrences — on one-line HTML it lies. Use
  `grep -o … | wc -l`.
- Lazy-loaded images report `naturalWidth 0` until scrolled into view.
  `complete:false` means **in flight, not failed**. Force `loading='eager'` and
  await `load` before calling an image broken.
- "Did it load" is not "does it look right." Compare rendered size against
  natural size, and look at the thing.
- Run the negative control. A test that passes when you break the code is
  worthless — this session caught a dropped Figma card and a stale spec mock
  exactly this way.

---

# State of the marketing site

**All 28 routes have content; 0 blank.** Every internal link resolves (38 links
crawled, 36 real pages, 0 dead). Six leftover test screens deleted (`/home`,
`/about-us`, `/contact-us`, `/shop`, `/cart`, `/account`) — all now 404, with a
302 `/about-us → /about` kept for old bookmarks. `/404`, `/401`, `/503` are
functional error screens, **not** test pages — keep them.

The 12 solutions/use-case detail pages were rebuilt from their frames on
2026-08-06 and now match the design (8–9 sections each, was 3). Extracted copy
is committed at `tools/marketing/solutions-copy/`.

Shipped and production-verified this session: AGL-1267 (collection template
screens are not pages) · AGL-1269 (honest publish toast) · AGL-1270 (commerce
PDP/catalog templates) · AGL-1272 (`.aglyn.app` → custom domain, 307) ·
AGL-1276 (**security**: `cname` was client-writable by any editor; rules
deployed to prod `aglyn-main`).

## Open

- **AGL-1234** — the nine `/product/*` pages all ship the same two mockups.
  **Blocked on an artwork call**: the design's 920×580 crop is the parent frame
  clipping the instance, and no export path reproduces it. Reaching the design's
  aspect discards the bottom ~27% of each mockup. Console and Forms mockups also
  show a Contacts entity and Campaigns tab that do not exist — those need a Figma
  fix regardless. The upload/crop/verify pipeline is proven and ready.
- **AGL-1277** — this issue. Also records that the **Figma pricing compare table
  still shows five tiers** when seven plans exist; the table is the stale
  artifact, not the site.
- **AGL-935** — mailboxes now exist; only attorney review remains. Not
  engineering.
- **AGL-1266** — not reproducible (zero `css-` classes on five surfaces). The
  real half of that report is **AGL-1268** (`link-box` renders a `div` vs an `a`
  depending on the screens map).
- **AGL-1268 / AGL-1271** — agents were mid-flight when the session ended; check
  for `worktree-agent-*` branches before redoing that work.
- **AGL-1273** — the canonical redirect does not preserve query strings
  (reading `searchParams` would make the tenant catch-all dynamic, an AGL-1152
  regression). **AGL-1274 / AGL-1275** — canonical tag and apex-domain docs.

---

# Standing

**Promotion needs Zach's word before it starts — never open a production PR
unasked.** (Corrected 2026-08-14, AGL-1704: this section used to open "Promote
when work lands", contradicting its own later line.) When he gives the word: gate
the pinned SHA in a **worktree, never the live checkout** — build + test + lint,
every exit code read bare, never through a pipe; a green PR proves nothing. Then
open `main` → `production`, **merge, never squash, never rebase**, and confirm the
new sha reaches **READY** — a merged PR is not a deploy. Do not create a
`promote/*` or any other intermediate branch; push to `main` immediately and batch
there. A CANCELED tenant build is normal when the diff touches only
`apps/console`; prove it by diffing the live sha against production HEAD.

Never claim a mockup is a screenshot. Never invent legal copy. Where there is no
honest content, say so — `/careers` leads with "No open roles right now."

The scratchpad is session-scoped tmp and is wiped between sessions. Everything
durable belongs in this file, in Linear, or in the repo.
