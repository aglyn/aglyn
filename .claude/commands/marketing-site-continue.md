---
description: "STALE 2026-08-08 handoff — the promotion section granted a standing promote (now corrected) and its canvas recipes are wrong. AGL-1245 is still open. Use /handoff."
---

> ⚠️ **CORRECTED 2026-08-14 (AGL-1704).** A dated 2026-08-08 session handoff. For
> the current promotion flow and working agreements read
> `.claude/commands/handoff.md`; where it disagrees, it wins. Two fixes applied
> below: the **"Standing"** section used to read *"Promote to production when work
> lands"* — **promotion needs Zach's word and you never open a production PR
> unasked** — and the canvas-scripting note pointed at a
> `window.AglynModule.canvas` that **does not exist**. Master issue **AGL-1245 is
> still open** (In Review), so the page-building work here is not spent.

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

Finish the **Marketing site on Aglyn** — 13 routes are still blank, the launch
page wants more depth, and three follow-ups are open. Master issue **AGL-1245**
(In Progress).

Coordinates: org `aglyn-org` (`jWmGooWE3L`) · host `aglyn-marketing`
(`DXnRbPH4CQ`) · live **`https://aglyn.com`** · Figma `UsUolmsFgfymhaKMLBZvzo`.
Dev servers: console **4200**, tenant **4500** — start with
`preview_start {name:"console"}` / `{name:"tenant"}` (they are in
`.claude/launch.json`). They die with the session; check before assuming a
browser failure is the extension.

Linear: In Progress on start, In Review when it lands, Done once verified in
production. One conventional commit per AGL-###, `git commit --only <paths>`,
**never `git add -A`** — a concurrent session auto-stages. Never `git stash`.
Building pages needs **no commit at all**: it is Firestore data.
`apps/*/next-env.d.ts` shows modified after any dev-server start — that is
noise, never commit it.

---

# Measured state — 2026-08-05, re-measure before trusting

**`aglyn.com` is live and serving the marketing host.** `/` is the **Launching
soon** page (public beta, launching fall 2026). The full marketing home moved to
**`/preview`** — it is intact, 7 sections. The site is still `Disallow: /` with
an empty sitemap, so nothing is indexed.

**18 routes built, 13 blank.** All nine `/legal/*` are live and clean.

```bash
for p in "" preview product pricing demo solutions contact-sales use-cases blog \
         about changelog newsroom press careers contact developers-home; do
  printf "%-18s %s\n" "/$p" "$(curl -s "https://aglyn.com/$p" | grep -o '<section' | wc -l | tr -d ' ')"
done
```

Blank: `/use-cases` + all 6 details · `/blog` · `/about` · `/changelog` ·
`/newsroom` · `/press` · `/careers` · `/contact` · `/developers-home` ·
`/solutions/{creators,developers,enterprise,small-business}`.
Built already: `/solutions/{agencies,startups}` (3 sections each).

Editor URL takes the host **SLUG**, not the id:
`localhost:4200/aglyn-org/hosts/aglyn-marketing/screens/<screenId>/versions/<versionId>/besigner`

## Screen ids — the blank routes you are here to build

| route | screen | version |
| -- | -- | -- |
| `/contact` | `L8XSG9JJHA` | `yZXiMUNhIY` |
| `/solutions/creators` | `9oMHVvUMka` | `EpsyopDL-C` |
| `/solutions/developers` | `wWWSUKjovU` | `nauBAcW7Qz` |
| `/solutions/enterprise` | `NPIsO9Lg8-` | `LHkOXjZYTp` |
| `/solutions/small-business` | `BeW736mgrm` | `HSyZ6qgxfd` |
| `/use-cases` | `SUbVFdFMhq` | `9WrY1BQyhI` |
| `/use-cases/blogs` | `9lkqqFmZSX` | `zi2yHd2RkE` |
| `/use-cases/documentation` | `d2iJT9j7rx` | `6G7cuu060_` |
| `/use-cases/membership-sites` | `OIrdl8NAV5` | `6s2tnMz5xC` |
| `/use-cases/online-stores` | `sz1ylWD-gE` | `FIj-gNCNSQ` |
| `/use-cases/portfolios` | `9G0NLaTOHW` | `v7qLco3MBN` |
| `/use-cases/saas-websites` | `RW-hQ3pFrd` | `d9TSmLvHmK` |
| `/blog` | `r_RYOXo-98` | `Ypqcc29Ka4` |
| `/about` | `72IbwUtsnt` | `Ls58PvR9eQ` |
| `/careers` | `OWenRu2OWa` | `iQG2q0eESQ` |
| `/press` | `q3RLZRAhLZ` | `WBEWmOHq6I` |
| `/changelog` | `fVtBO2SzO4` | `wXJ-FQHdih` |
| `/newsroom` | `m3k_-trStA` | `FpZY-m2rM9` |
| `/developers-home` | `O_NEU9R5en` | `uh6D__zlZ3` |

## Screens worth copying from

`/` (launching soon) `yFjgqiG2wm`/`2FVD2R8Jx_` · `/preview` (full home)
`AGSSMcO-Xc`/`iwP-3G8PTb` · `/product` `V0B8e81t1-`/`f7X7DXr4In` · `/pricing`
`v0clP6xQl-`/`9O5RKr4P9g` · `/demo` `tvE5P-PnLs`/`-P4ocjKPMB` · `/solutions`
`eASC4CX44X`/`mUpwD1qYEM` · `/solutions/agencies` `nFjLN34Bh3`/`0Pa4zmBS8O` ·
`/solutions/startups` `IE_lkDK2s2`/`x879dJDZ3q` · **`/contact-sales`**
`ZrJJCE4-TF`/`Ws4-z9eRkD` (the real-form reference) · `/legal`
`MxuaTpTwfk`/`IpFQ51Z2y3` · `/legal/privacy` `hzng724SgS`/`W8U1wTRJQz`.

Version ids above were current on 2026-08-05 — if one 404s, read the real one
from the screen's **Details** link on
`/aglyn-org/hosts/aglyn-marketing/screens`.

## Datasets and media

Datasets: `Launch notifications` `Z9cz7lQ4bN` (`email · name · role · interest`)
· `Sales enquiries` `tJ5-1CNbp3` (`name · work_email · company · team_size ·
interested_in · message`). **`formField.fieldName` must equal the dataset key
exactly** — a mismatch silently writes a blank column.

Media (`media:org:jWmGooWE3L/<id>`): logo `4GF1hRJBUp` · Besigner canvas
`QCIPR2-aZl` · Besigner interactions `fMH14YUTvT` · Console dashboard
`6mmzuZ3inp` · Commerce storefront `htLaZI7Jfy` · Forms builder `ngzQcFKgYo` ·
Media library `mEQDmxQYR-` · Analytics overview `7DwmoSuNDA` · Workflow
automation `rgm440r2Km` · Marketplace browse `qloB601MFX`.

---

# Thread 1 — the 13 blank routes

Order by who actually hits them:

1. **`/contact`** — linked from the footer and from `/legal`'s "Questions about
   any of this?" block. Mirror `/contact-sales` (`ZrJJCE4-TF`): a **real**
   `form`, never a mock. `formName` alone routes to the Inbox.
2. **The 4 remaining `/solutions/*` details** — `/solutions` already lists and
   links all six; four of those links are dead. `agencies` and `startups` are
   built; clone their shape, write real copy.
3. **`/use-cases`** listing + 6 details.
4. **`/about`, `/careers`, `/press`, `/blog`, `/changelog`, `/newsroom`,
   `/developers-home`.**

Every one of these is chrome + a hero + its own body. The Figma designs exist —
see the page list below.

# Thread 2 — the launching-soon page

Screen **`yFjgqiG2wm`** / `2FVD2R8Jx_`, slug `/`. Currently 13 sections, 11
images, no layout attached (deliberate — it must expose **no** nav links to
unfinished pages). Header + footer are built into the screen itself.

- **9 unused mockups** are sitting in Figma (node ids below) if you want more
  product sections. Six were added this way already; the recipe is proven.
- The notify form writes to the Inbox **and** dataset `Launch notifications`
  (`Z9cz7lQ4bN`, keys `email · name · role · interest`). Proven end-to-end.
- **Not yet done:** a mobile screenshot of the six newest sections. Desktop is
  measured (alternating columns, zero overflow); mobile is safe by construction
  (copy precedes image in DOM) but has not been *observed*.

# Thread 3 — three open follow-ups

- **AGL-935** — Privacy/Terms are live, but two blockers stand: **attorney
  review never happened**, and the policies point users at `privacy@aglyn.com`
  and `security@aglyn.com`, which per the issue may not exist. Either create the
  mailboxes or repoint those four references to `info@`. Zach's call.
- **AGL-1266** — every tenant page hydrates with an emotion `css-` vs `mui-`
  class mismatch. Pre-existing, site-wide, confirmed on `/product` too.
- **`demo.aglyn.com` 404s** — app-level, no host carries that cname.
  `demo.aglyn.app` is fine. Pre-existing.

---

# Hazards that cost real hours. Read before touching the editor.

## Saving in the besigner is genuinely unreliable

Three separate things break it. Handle all three or you will silently lose work
and think you saved it.

1. **The AGL-1256 recovery banner** ("Unsaved changes … were recovered from this
   browser") pins **above** the toolbar and shifts everything down ~47px, so any
   cached coordinate misses. Dismiss it first:
   ```js
   [...document.querySelectorAll('button')]
     .find(b => /^discard$/i.test(b.textContent.trim()))?.click()
   ```
   It also makes a pour return **ABORT: not empty** — the recovered draft is
   already on canvas, so the content is fine and only needs saving.
2. **Coordinates are SCREENSHOT space, not CSS.** Measure, then scale:
   `shotX = cssX * (screenshotWidth / window.innerWidth)`. Clicking the CSS
   value lands past the button's edge and does nothing.
3. **`find` + ref-click is unreliable** for this button (the known chrome-mcp
   click-dispatch gotcha). It worked about half the time.

**The recipe:** dismiss banner → pour → poll your result global until it is not
`pending` → click the measured coordinate → click again → confirm the toolbar
reads **UP TO DATE** (or the snackbar says "Screen saved successfully" /
"Already saved"). **Only then navigate away** — the save is async and navigation
kills it. Never treat one failed `curl` as proof; check the toolbar.

## Figma: the MCP under-reports, and exports bake in grey

- **`get_metadata` with no nodeId returns 2 pages. The file has 14.** Do not
  trust it. The real pages: UI Kit & Tokens · Mega Menu & Nav · SEO & Social ·
  Components — marketing · Layouts — marketing · Templates — marketing ·
  Homepage Concepts (A·B·C) · Pricing · Demo · Sales · **Product Pages** ·
  **Solutions** · **Blog** · **Company** · **Legal** · **Landing Pages**.
  The designs for every blank route in Thread 1 live on those pages.
- **Mockups are component SYMBOLS on `0:1`, not instances.** Enumerating
  instances inside a few frames finds 3 and hides 15.

  Unused (9): Console Hosts `153:85` · Commerce Orders `143:141` · Workflow Runs
  `145:147` · Marketplace Listing `148:219` · Analytics Screen `150:167` · Media
  Asset Detail `141:157` · Inbox Submissions `134:37` · Email Campaign `184:81`
  · Marketing Overlays `184:143`.

  In use (9): Besigner Canvas `11:28` · Besigner Interactions `152:77` · Console
  Dashboard `26:32` · Commerce Storefront `143:49` · Forms Builder `152:141` ·
  Media Library `141:41` · Analytics Overview `150:69` · Workflow Automation
  `145:53` · Marketplace Browse `148:61`.

- **The Figma canvas grey is IN the pixels.** A symbol export returns 1024×684
  padded with `srgba(229,229,229)`; a white-fuzz trim does nothing. Sample the
  corner and trim against it:
  ```bash
  magick in.png -bordercolor "$(magick in.png -format '%[pixel:p{2,2}]' info:)" \
    -border 1 -fuzz 3% -trim +repage out.png   # 951x626
  ```
  Exporting an *instance* instead gives **white** bleed — always check `p{2,2}`.

## markdown-lite constrains long-form content

`libs/aglyn/src/lib/app-utils/markdown-lite.ts`:

- Headings **clamp to h2/h3**. `#` never yields an `h1` — the page hero supplies it.
- **A list directly under a paragraph is folded into it** as literal `-`. Insert
  a blank line before every list.
- **No horizontal rule** — `---` renders as literal text. Strip it.
- **No inline code** — convert backticks to bold. Backticks also break
  template-literal injection.
- **Non-http links degrade to plain text** — no `mailto:` links in markdown.
- `tableOfContents` binds via `forNodeId` → the markdown node's `$id`.

## Components

- **`div` is not registered.** An unknown `componentId` silently falls back to a
  bare `<div>` with your props leaking onto the DOM.
- **`image` defaults `objectFit` to `cover`** — a fixed-height box **crops**, and
  in a flex column it stretches to the container. Set explicit `width`/`height`
  on the natural ratio plus `objectFit:'contain'` and `flexShrink:0`. It is
  `selfClosing` — never give it children (SSR 500, AGL-579).
- `muiButton`: `screenId` = internal, `href` = external and gated by
  `/^(https?:\/\/|mailto:|tel:|\/|#)/i` — anything else is **silently dropped**.
- `section.element` is validated against
  `section|div|article|aside|nav|header|footer|main`. Setting `h1` silently
  falls back to `div`.
- No divider and no chip component exist. `muiStack` has no `alignItems`.
- Icons need `iconPath` or they render the help glyph (AGL-1212). Lift from an
  existing node; never invent.

## DAM

- **Drive is mounted locally** —
  `~/Library/CloudStorage/GoogleDrive-zach@aglyn.com/Shared drives/…`. Searching
  Drive in the **browser** finds nothing: that session is the personal @gmail
  account. Use the filesystem.
- Upload = fetch → `new File` → `DataTransfer` → `input.files` → dispatch
  `change`. **Build the DataTransfer synchronously after all fetches** — items do
  not survive `await` boundaries. `dt.files.length` reads unreliably; trust
  `input.files.length`.
- Find a new media id by curling `/api/media/cdn/org:jWmGooWE3L/{id}` and
  matching dimensions. The DAM DOM exposes the **folder** in the storage URL, not
  the id.

## Verifying

- ISR: the first read after a save is reliably stale. `?cb=` does **not** bust it
  (query strings are not in the cache key). Read 2–3 times and trust agreement
  between reads 2 and 3.
- **"Did it load" is not "does it look right."** A logo that rendered 420×24 from
  a 76×23 source was cropped garbage, and `naturalWidth > 0` said it was fine.
  Compare rendered size against natural size, and look at the thing.
- **Verify before deleting, not after.** Checking references before removing an
  orphan is what caught the homepage still pointing at an untrimmed image.
- The canvas is a **closed** shadow root: `document.querySelectorAll` returns 0
  while it renders perfectly. Trust the canvas controller's `toJSON()` and a
  screenshot. **Corrected 2026-08-14 (AGL-1704): `window.AglynModule.canvas` does
  not exist**, and it is not dev-only in the way this implied — `window.Aglyn` is
  assigned in every environment and `AglynModule` is just its non-production
  alias. Both are an `IBesignerAppController` with no `canvas`; use
  `window.Aglyn.getBesignerController()`.

---

# Never claim a mockup is a screenshot

A section once read *"This is the actual builder. Not a mockup of one."*
directly above a Figma mockup. That is a false claim on the company homepage.
Describe what the product does; do not assert the image is a product capture.

Same rule for legal text: the Drive documents carry a **DRAFT — ATTORNEY REVIEW
REQUIRED** banner. Zach's standing decision is to strip it at publish time, and
the residential address is replaced with `[Registered agent address — pending]`.
**Never invent legal copy** — an empty page beats a fabricated Terms of Service.

---

# Standing

**Promotion needs Zach's word before it starts — never open a production PR
unasked.** (Corrected 2026-08-14, AGL-1704: this section used to read "Promote to
production when work lands", which an agent would take as a standing grant.) When
he gives the word: gate the pinned SHA in a **worktree, never the live checkout**
— build + test + lint, every exit code read bare, never through a pipe; a green
PR proves nothing. Then open a `main` → `production` PR, **merge, never squash,
never rebase**, and confirm the new sha reaches **READY** — a merged PR is not a
deploy. Do not create a `promote/*` or any other intermediate branch; push to
`main` immediately and batch there. A CANCELED tenant/docs build is normal when
the diff touches only `apps/console`; prove it by diffing the live sha against
production HEAD rather than assuming.

**Do not look for a handoff file.** The scratchpad is session-scoped tmp and is
wiped between sessions — the previous one lost its screen map and every staged
export that way. Everything durable is in this file. If you stage work to the
scratchpad mid-session, treat it as disposable and write anything worth keeping
back into here or into Linear.
