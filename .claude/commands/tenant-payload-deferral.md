Finish the **lazy-panel node deferral** (AGL-1285) — the pure half is committed and
tested, nothing calls it, and wiring it needs a working tenant dev server. Then
work the `/pricing` follow-ups.

Coordinates: org `aglyn-org` (`jWmGooWE3L`) · host `aglyn-marketing`
(`DXnRbPH4CQ`) · live **`https://aglyn.com`** · Figma `UsUolmsFgfymhaKMLBZvzo`.
Pricing screen `v0clP6xQl-` / version `9O5RKr4P9g`. Dev servers: console
**4200**, tenant **4500** — `preview_start {name:"console"}` / `{name:"tenant"}`.
They die with the session, and **both died mid-session last time** — restart
before assuming the editor is reachable.

Linear: In Progress on start, In Review when it lands, Done once verified in
production. One conventional commit per AGL-###, `git commit --only <paths>`,
**never `git add -A`**. Commit subjects must be lowercase — commitlint rejects
`fix(mui): Tabs …`. Building pages needs **no commit** — it is Firestore data.
`apps/*/next-env.d.ts` shows modified after any dev-server start; never commit it.

---

# Job 1 — wire the deferral (AGL-1285)

## What already exists

`libs/tenant/runtime/src/lib/defer-lazy-panels.ts` (commit `e9ee70239`), with
12 tests and four negative controls. `deferLazyPanelNodes(nodes)` returns a NEW
node map with the non-landing lazy panels' subtrees removed and those panels
marked `props.aglynDeferred = true`. **Nothing calls it.**

Two decisions in it that must survive any refactor:

- The landing panel is whichever matches `labels[0]`, **not the first child** —
  panels reorder in the hierarchy independently of the label list.
- If no panel matches the first label it defers **nothing**. Refusing to guess
  is the feature.
- It rebuilds rather than mutates, because the composed document is cached by
  `loadPageDataCached`. Mutating poisons every later request for that screen
  with a permanently half-empty page — a bug visible only on cache hits.

## What is missing

Three pieces, and **they must land together**: withholding nodes without the
fetch leaves those panels permanently empty.

1. **A compose-and-return route.** `apps/tenant/app/api/protection/unlock/route.ts`
   is the precedent — it calls `composeScreenNodes` and returns `{ nodes }`. A
   GET equivalent needs the host/path/screen resolution that
   `apps/tenant/app/[host]/[[...slug]]/load-page-data.ts` does (600+ lines:
   collections, templates, redirects, fallbacks, protected/member gating).
   Do not copy-paste it — factor or call it.
2. **The client swap.** `catch-all-client.tsx` already models this exactly with
   `unlockedNodes` (AGL-87) and `memberNodes` (AGL-109): state that replaces
   `nodes` wholesale. A `deferredNodes` sibling fits the same shape.
3. **The trigger.** No plugin change needed — a capture-phase `click` listener
   on `[role="tab"]` in the tenant client, gated on a `hasDeferredNodes` prop,
   is enough. `muiTabs` stays unaware.

Then apply `deferLazyPanelNodes` where the page's `nodes` are finalised, and
pass `hasDeferredNodes`.

## Acceptance — concrete, and it will not show up by eye

`curl -s https://aglyn.com/pricing | grep -o 'Sites (hosts)' | wc -l` must go
from **11 to about 4** (2 rendered + 2 in the flight payload; it is 9 in the
payload today). Then **click a mobile plan tab and confirm it fills in** — a
wrong prune renders an empty panel, which is invisible until someone clicks.
That is why this was not landed unverified.

Expected win ~50 KB gzipped of the page's 141 KB.

---

# Job 2 — the `/pricing` follow-ups

- **AGL-1286** — the compare table sets `bgcolor` / `position: sticky` / borders
  on every one of ~470 cells, so emotion emits a class per combination and the
  page carries ~55 KB more render-blocking CSS than a normal page. Push the
  zebra / Pro-tint / sticky rules up to the container as `nth-of-type`
  descendant selectors. **Two traps**: the sticky first column's background must
  stay **opaque** (a translucent zebra lets scrolling values show through the
  frozen labels), and the group-header rows are `div`s in the same flow, so a
  naive `nth-of-type(even)` zebra counts them.
- **AGL-1284** — shipped and deployed. `/pricing` still styles its toggles from
  the parent container via descendant selectors because it had to work before
  that deploy; harmless, simplifiable onto the Tabs nodes now.
- **AGL-1280** — the metered-infrastructure "cost + 30%" table is deliberately
  NOT on the page. Rates are real (`apps/console/utils/usage-metering.ts`) but
  the console tells customers it is billed "once metered billing is live", and
  the frame's framing ("beyond your plan's included…") is wrong — it meters
  from unit zero. **Zach's call, not an implementation task.**
- **AGL-1282** — the Figma frames drift from code in four places (Pro really
  has product reviews / abandoned cart / commerce analytics; the Event Calendar
  card says "per site" when it is per org; the metered blurb; a duplicated
  `siteExport` row). Fix with `use_figma` **and a pre-flight guard** that
  refuses unless each node's current text matches exactly, then re-run the
  extractor and re-commit `pricing-copy/`.

---

# What is already DONE — do not rebuild

`/pricing` matches the design at all three breakpoints and is live. Built this
session: the scale-strip, the full 8-plan × 50-row compare table with a frozen
first column, zebra + Pro tint, the usage table with its Enterprise column,
side-by-side add-on cards, the **working Monthly/Annual billing toggle**, the
**mobile plan selectors** for both tables, uniform `#fbfbfb` background, CTAs
above the feature lists, and `content-visibility: auto` on the four below-fold
sections.

**AGL-1281 is DONE** despite its title — both the toggle and the mobile
selector shipped, using `muiTabs`/`muiTabPanel`, which hold real React state.
Read the issue body before acting on the title. This project has burned four
sessions on already-shipped backlog items; **check git and the live page first**.

Also fixed live: the CTA section was rendering **white text on a light
background** — headline, lede and a button all `common.white`. It was invisible.

## Generators — regenerate, never hand-edit

- `tools/marketing/extract-pricing-copy.mjs` → `pricing-copy/copy-<variant>.json`.
  Verbatim record of the frames, so it **reproduces the design's errors on
  purpose**. Invariant: every text node appears exactly once, or it throws.
- `tools/marketing/build-pricing-tables.mts` → `pricing-copy/tables.json`. Every
  published number is read from `plan-entitlements.ts`. Run with
  `SWC_NODE_PROJECT=tools/marketing/tsconfig.tables.json node --import @swc-node/register/esm-register …`.
  It prints code-vs-frame disagreements rather than silently preferring code —
  **3 are expected** (Pro's three commerce features). More than 3 means new drift.

To feed data into the besigner, serve `tables.json` over a local CORS server and
`fetch` it from the page; a big JSON literal in the tool payload gets blocked.

---

# Hard-won, do not rediscover

## Measuring page weight

**Measure gzipped.** Everything here compresses ~10:1, and raw bytes rank fixes
wrongly. 128 KB of inline CSS is **10 KB on the wire**; stripping every legacy
vendor prefix (25% of the raw CSS) saves **634 bytes**. Interning the 2,762 `sx`
objects (213 distinct) cuts raw 35% but gzip only 10%. The levers that survive
compression remove *content*, not *repetition*.

The RSC flight payload is 63% of the wire cost **but does not block first
paint** — it streams after the visible HTML (hero at 12% through the document,
first `__next_f.push` at 25%, zero flight bytes before the hero).

## Verification traps that produce confident wrong answers

- **`getComputedStyle().gridTemplateColumns` resolves to pixel tracks after
  layout.** A `/repeat\(8,/` probe finds 52 rows before layout and **0** after —
  the same check "proves" the table vanished. Count **tracks**, not the shorthand.
- **A hidden or minimised browser window reports collapsed geometry** —
  `scrollHeight` equal to the viewport, every element width 0, `display:none`
  ancestors. It looks exactly like you broke the page. Negative-control against
  a page you did not touch: `/solutions/agencies` reported the identical `823`.
- **`content-visibility: auto` needs a frame to realise.** Scroll in one tool
  call and measure in the next, or offscreen content stays unlaid-out.
- `<aglyn-text>` uses **closed** shadow roots — panel text is unreadable from
  JS. Verify content with `curl` + `grep -o … | wc -l`, which needs no layout.
- **ISR: the first read after a save is reliably stale.** Read 2–3 times and
  trust agreement; some pages took 4–5.

## Besigner mechanics

- **Save**: `[...document.querySelectorAll('button')].find(b => /^save$/i.test(b.textContent.trim()))?.click()`,
  then poll until **both** `isInitialSame` and `isInitialConfirmed`. Never click
  by coordinate. The button is only *named* "Save" while the doc is dirty and
  the toolbar re-renders **asynchronously** — a one-line edit followed
  immediately by the lookup finds nothing and throws.
- **Keep the poll under 45 s** — the CDP `Runtime.evaluate` timeout. A 120 s
  loop times out mid-save.
- **An extension disconnect discards unsaved canvas edits.** Save in small
  batches; one lost a full restyle last session.
- `toJSON().nodes` **omits the `nodes` key** on a childless node, so
  `.nodes.length` throws right after you clear a container. Use `?.nodes ?? []`.
- `node.sx` is directly writable on the live MobX proxy; `props` must go through
  `updateNodeProps`, which **replaces** the bag — always spread.
- Dismiss the AGL-1256 recovery banner (`Discard`) first, but check
  `isInitialSame`/`isInitialConfirmed` first — if both are true the canvas
  already matches the server and discarding only dismisses the offer.

## Ground truth

`libs/aglyn/src/lib/app-utils/plan-entitlements.ts` wins over Figma, always.
Never run `tools/scripts/setup-stripe.mjs` (writes to live Stripe). Never change
a price in code to match a frame.

---

# Standing

Promote when work lands: build console locally first (`npx nx build console
--skip-nx-cache` — a green PR proves nothing), open `main` → `production`,
**merge, never squash**, then confirm the new sha reaches **READY** via the
Vercel MCP (`gh api` cannot poll it). Plugin changes under `libs/plugins/**`
build the **tenant** too — a CANCELED tenant build there is wrong, not normal.
**Never open a production PR unasked.**

Never claim a mockup is a screenshot. Never invent legal copy. Where there is no
honest content, say so.
