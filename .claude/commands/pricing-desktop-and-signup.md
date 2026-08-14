---
description: "STALE 2026-08-08 handoff — its 'Canvas scripting' section was wrong on all three globals (corrected) and its promotion note now requires Zach's word. Use /handoff."
---

> ⚠️ **CORRECTED 2026-08-14 (AGL-1704).** A dated 2026-08-08 session handoff. For
> the current promotion flow and working agreements read
> `.claude/commands/handoff.md`; where it disagrees, it wins. Fixed below: the
> **"Canvas scripting"** section named the wrong global three times over (there is
> no `…​.canvas`, and `window.Aglyn` is the besigner app controller, **not** the
> Firebase app), and the **Standing** bullet now states that **promotion needs
> Zach's word and you never open a production PR unasked**.

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

Finish **AGL-1286** (applied and saved, verification incomplete), then bring the
**`/pricing` desktop layout** closer to Figma, then wire the **plan CTAs to the
preselected signup/upgrade path** on `app.aglyn.com`.

Coordinates: org `aglyn-org` (`jWmGooWE3L`) · host slug **`aglyn-marketing`**,
id `DXnRbPH4CQ` · live **`https://aglyn.com`** · Figma `UsUolmsFgfymhaKMLBZvzo`
(desktop Pricing frame `77:38`, mobile `247:3566`, page `77:37`) · pricing
screen `v0clP6xQl-` version `9O5RKr4P9g`.

Besigner URL — **the `[host]` segment is the SLUG, not the id**; using the id
renders "This page isn't here":

```
https://app.aglyn.com/aglyn-org/hosts/aglyn-marketing/screens/v0clP6xQl-/versions/9O5RKr4P9g/besigner
```

---

# THE PUBLISH RECIPE — read this before touching anything

Three things cost a lot of time to learn. None is guessable.

**1. A besigner save does NOT reach the live site.** The editor shows
`UP TO DATE` and offers *Unpublish* but no *Publish*. The page sat unchanged
for four minutes after a confirmed save. You must call:

```
POST https://app.aglyn.com/api/screens/revalidate
Authorization: Bearer <idToken>
{ "hostId": "DXnRbPH4CQ", "screenId": "v0clP6xQl-" }
```

Returns `{"revalidated":["/aglyn-marketing/pricing"],"reason":"ok"}`. Must be
called **from a page on `app.aglyn.com`** — App Check blocks Node.

**2. There are TWO Firebase apps signed in, and only one token works.**
IndexedDB `firebaseLocalStorageDb` → `firebaseLocalStorage` holds both:

| record key suffix | provider | works? |
| -- | -- | -- |
| `AGLYN_PRESENCE` | `custom` (co-editing), no email claim | **NO — 403 `email-unverified`** |
| `DEFAULT_AGLYN` | `saml.aglyn-workspace`, `email_verified: true` | **YES** |

Take the **first** record and you get the presence token and a 403 that looks
exactly like an SSO/email-verification bug. It is not one — Zach's SSO account
is verified. Always match `/DEFAULT_AGLYN$/` on `fbase_key`.

**3. The first read after a revalidate is stale.** Twice this session a
screenshot or `curl` showed the old page and I reported a fix as not working
when it had. Read 2–3 times, ~20s apart, and trust agreement — the same rule as
the ISR reads.

## Canvas scripting

> ⚠️ **CORRECTED 2026-08-14 (AGL-1704) — the three lines below were wrong.**
> Read from the source, not from this note: `window.Aglyn` is **not** the Firebase
> app — `apps/console/constants/app-setup.tsx` assigns it an
> `IBesignerAppController`, and sets `window.AglynModule` to that **same object**
> as a dev-only alias (`if (!IS_PRODUCTION)`). `__AGLYN_PLUGIN_HOST__.aglyn` is
> also that same object (`setRealmPluginHost({ React, jsxRuntime, aglyn: Aglyn })`).
> **`IBesignerAppController` has no `canvas` property at all**, so every
> `…​.canvas` path below is wrong. The canvas is reached through:
>
> ```js
> const c = window.Aglyn.getBesignerController()
> ```

~~`window.__AGLYN_PLUGIN_HOST__.aglyn.canvas` — **not** `window.AglynModule`
(that note was stale) and not `window.Aglyn` (that is the Firebase app).~~

- `c.nodes.size`, `c.getNode(id)`, `c.isInitialSame`, `c.isInitialConfirmed`
- `node.sx` is directly assignable on the live MobX proxy; clone with
  `JSON.parse(JSON.stringify(node.sx))`, mutate, assign back.
- `props` must go through `updateNodeProps`, which **replaces** the bag — spread.
- Save: `[...document.querySelectorAll('button')].find(b => /^save$/i.test(b.textContent.trim())).click()`
  then poll until **both** `isInitialSame` and `isInitialConfirmed`. The button
  only exists while dirty and the toolbar re-renders async.
- **Promises do not return through the chrome JS tool.** Park results on
  `window.__x` in one call and read them in the next.
- On first load the editor may show *"Someone else saved this screen while you
  were editing. Saving is paused"* — **reload before editing** or nothing saves.

---

# Job 1 — AGL-1286: finish verifying (do NOT re-apply)

**The transformation is already applied, saved and revalidated (200).** Do not
run it again. It needs verification only.

What was done to the compare table (container `qprGeTy2PI`, 58 rows × 9 cells):

- each **row** now carries the base `bgcolor` that used to be on every cell;
- **cells** lost `px`, `py`, `textAlign`, and lost `bgcolor` except columns
  **0** and **3**;
- **column 0 keeps its own opaque `bgcolor`** — it is the sticky frozen column
  and without an opaque background the scrolling values show through it;
- **column 3 keeps the Pro tint** (`#eaf6fd` / `#e3f2fb`);
- the container gained:
  ```js
  '& > div > p':                 { px: 1.5, py: 1.25, textAlign: 'center' }
  '& > div > p:first-of-type':   { textAlign: 'left', position: 'sticky', left: 0,
                                   zIndex: 1, borderRight: '1px solid',
                                   borderColor: 'divider' }
  ```

Cells went from ~7–9 sx keys to 3–4. Spot-checked correct on row 3.

**Verify, in this order:**

1. `grep -c 'first-of-type'` on `https://aglyn.com/pricing` — was **0** on the
   first read after revalidate, which is the stale-read trap, not a failure.
   Re-read a few times. If it stays 0, the save did not reach the served page
   and that is the real finding.
2. Inline CSS size. Baseline **127,694 chars / 561 rules** (from the issue). The
   first post-change read gave 128,071 / 918 — almost certainly the stale page.
   Note **139,708 was measured on localhost, not live** — do not compare against it.
3. **Look at the table at 1440px.** The acceptance is visual: zebra intact,
   Pro column tinted, first column frozen AND opaque while scrolling
   horizontally, no sideways page scroll. A translucent frozen column is the
   failure mode to hunt for.
4. Re-check 375 / 768 to confirm nothing regressed.

**Do not judge this by "distinct sx count".** I used that as the verification
metric and it read 18 → 17, which looked like failure when the change was
correct. Emotion emits one class per distinct `sx`; what shrank is
*declarations per class* and payload bytes, not the class count.

---

# Job 2 — desktop `/pricing` closer to the Figma design

Zach: *"desktop design for the pricing page could use some work to better match
the design in figma."* Not yet diagnosed — start by diffing, not editing.

Desktop frame `77:38` (1440×6747), sections in order: `NavBar 72`, `Hero 343`,
`Plans 906`, `Compare features 2733`, `Usage pricing 1092`, `FAQ 689`,
`CTA 452`, `Footer 460`. The built page has 6 root sections (nav and footer come
from the shared layout "Marketing base", which is **locked** in this screen —
edit it via EDIT LAYOUT, not here).

Desktop `Plans` structure: `row` HORIZONTAL gap 24 with 4 cards at 302×428, then
`scale-strip` VERTICAL 1280×342 = a header Frame plus four `strip · X` rows,
each HORIZONTAL gap 24 with 3 children.

Suggested approach: `get_screenshot` the Figma section, screenshot the live page
at 1440, and diff section by section — spacing, type scale, card proportions.
Fix the largest divergences first and say which you did not do.

---

# Job 3 — plan CTAs deep-link into the preselected signup/upgrade path

Zach: *"use our preselected path for new account plan and upgrade path to
app.aglyn.com that we created to directly subscribe to that plan upon clicking
on one of the tier buttons on our pricing page."*

That path already exists — **find it before building anything**. Look at
`AGL-1117` (plan-aware onboarding deep-links from the marketing site → console)
and `project_org_promotion_arc` / `project_selfserve_addons_arc`. Grep the
console for the signup/checkout route and the query parameter it reads for a
preselected plan.

Then bind each tier's CTA on `/pricing` to it. The CTAs are `muiScreenLink` /
`muiButton` nodes inside each plan card (4 cards in each of the two billing
panels, plus the scale-strip rows for Scale/Advanced/Agency/Enterprise, plus the
mobile plan-selector panels — **the deferred panels too**, so expect more than
one set). Use `AppLink`, never a raw MUI `href` — `href` full-reloads the SPA.

Get the plan slug ↔ button mapping from `plan-entitlements.ts`, which is ground
truth over Figma, always.

---

# Already done, do not redo

- **AGL-1292** dark mode — a site only goes dark if it authored `colorSchemes.dark`.
  Live. `/pricing` dark went 539 invisible elements → **0**.
- **AGL-1285 / 1287 / 1289** payload and critical-path work — all live.
  `/pricing` 141 → ~104 KB gz; `load` 4.7s → 0.66–1.9s; deferred fetch 88 → 36 KB.
- **Mobile billing toggle** — three fixes, live and verified by screenshot.
  Root cause worth remembering: in `tabs.tsx` the styled `Box` wraps **both the
  strip and the tab panels**, so a `bgcolor` on a `muiTabs` node paints behind
  the panel content. Put pill styling on `& .MuiTabs-root`.
- **AGL-1282** Figma frame drift — fixed in all four variants.

## Measured and DECLINED — do not reopen without new evidence

- Dropping the MobX canvas runtime: **18 KB gz, 2.7%** of the critical path.
- Per-component MUI lazy registration: A/B build measured **36 KB gz, ≤5.3%**.
  MUI's shared base ships the moment any component is used.
- The 674 KB of critical-path JS is React + MUI base + emotion + Next. A floor.

**To size "what would removing X save", delete X and build it** — two 22-second
Turbopack builds beat every form of bundle attribution. `@next/bundle-analyzer`
is not installed and you do not need it; the webpack build prints no size column.

---

# Open, needing Zach

- **AGL-1293** brand blue fails AA as text: `#0090d9` is 3.51:1, theme
  `primary.main` `#00b0ff` is 2.43:1. `#0073ae` is the first value that clears
  AA on white, `#fafafa` and the Pro tint. `#0090d9` is node data (~165 nodes);
  `#00b0ff` is code (`console.theme.ts`) and repaints every surface. **His call.**
- **AGL-1280** metered-billing framing. His call.
- **AGL-1291** blog entries ship with **no `<h1>`** — entry template data, needs
  `component: 'h1'`. Reproduces live on two entries.
- **AGL-1288** the `S:0` streaming slot — needs confirming in real Chrome; the
  byte claim in its description was wrong and is corrected in a comment.
- `pricing-copy/` re-extraction still owed after the AGL-1282 frame fixes; needs
  the four `get_metadata` dumps, which are not committed.

---

# Traps that will waste your time

- **The Browser pane reports ZERO geometry when hidden** — `innerWidth/Height: 0`,
  `scrollHeight: 0`, every rect empty. Layout measurement is invalid; contrast
  and computed styles still work. Screenshots still render.
- **No `paint` entries in that pane**, so FCP/LCP cannot be measured there.
  PageSpeed Insights returns 429 without an API key.
- **`<aglyn-text>` uses closed shadow roots** — panel text is unreadable from JS.
  Verify content with `curl` + `grep -o … | wc -l`.
- **`content-visibility: auto`** needs a frame — scroll in one call, measure in
  the next.
- **`encodedBodySize` is COMPRESSED**, `decodedBodySize` is not. The whole
  page-weight conclusion turns on which you are holding.
- Standing: **promotion needs Zach's word before it starts — never open a
  production PR unasked** (corrected 2026-08-14, AGL-1704). When he gives the
  word: gate the pinned SHA in a **worktree, never the live checkout** — build +
  test + lint, every exit code read bare, never through a pipe — then `main` →
  `production`, **merge never squash, never rebase**, and confirm the sha reaches
  READY via the Vercel MCP. No `promote/*` or other intermediate branch; push to
  `main` immediately and batch there. One conventional commit per AGL-###,
  `git commit --only`, never `git add -A`. Commit subjects lowercase. Never commit
  `apps/*/next-env.d.ts`.
