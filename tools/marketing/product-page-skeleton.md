# `/product/*` page skeleton — the text-slot contract

Derived by reading the built `/product/besigner` document live
(screen `o1Q1hKCS-O`, version `2LvVaALEET`) on 2026-08-03.
**8 sections, 74 text slots**, in document order. Every other `/product/*`
page is this skeleton with the copy swapped.

| # | `ariaLabel` | slots | order of the text nodes |
| - | -- | -- | -- |
| 0 | Hero | 5 | eyebrow · **h1** · body · button · button |
| 1 | Statement | 1 | one large statement paragraph |
| 2 | Capabilities | 14 | eyebrow · **h2** · then **6 ×** (card title, card body) |
| 3 | Deep-dive · canvas | 9 | eyebrow · **h2** · body · then **3 ×** (title, body) |
| 4 | How it works | 11 | eyebrow · **h2** · then **3 ×** (step number, step title, step body) |
| 5 | Explore the platform | 17 | eyebrow · **h2** · body · then **7 ×** (screen-link label, body) |
| 6 | Early access | 13 | chip · **h2** · body · button · button · then **4 ×** (figure, label) |
| 7 | CTA | 4 | **h2** · body · button · button |

Node kinds in the slot lists: `txt` = `muiTypography`, `BTN` = `muiButton`,
`LNK` = `muiScreenLink`. Headings carry `props.component: 'h1'|'h2'` —
**never** `variant`, see the trap below.

## Section 5 is per-page

"Explore the platform" links to the *other* products. On `/product/besigner`
it lists Console · Commerce · Forms & Inbox · Media · Workflows · Plugins ·
Analytics — i.e. the nine products minus the page you are on, minus
Marketing. On every other page, swap the page's own entry out and **Besigner
in**, keeping seven. The `screenId` on each `muiScreenLink` must be re-pointed
to match.

## Invariants that are already correct in the skeleton — do not re-derive

- **Container:** `section` (full-bleed background + vertical padding, no
  horizontal padding) → `muiContainer` props `{maxWidth: 'xl'}` → content.
  **The invariant is the stock breakpoint `'xl'` — never an `sx` cap, never a
  pixel literal.** AGL-1298 banned bespoke `Container.maxWidth` values
  outright and swept the 144 containers that carried a hand-rolled `sx` pixel
  cap onto stock MUI widths. Prose bands — legal, docs, blog and changelog
  bodies — are the one deliberate exception and use `'md'`; see the "Prose
  Container" preset.

  **The column is viewport-derived, not a number you set.** Container caps at
  `min(viewport, breakpoint)` and then subtracts its own gutters (24px either
  side from `sm` up, 16px at `xs`). At the two desktop widths the frames are
  drawn to, stock `xl` lands on the design **exactly**:

  | canvas | `xl` renders | design column | source |
  | -- | -- | -- | -- |
  | 1440 | `min(1440,1536) − 48` = **1392** | **1392** | `pricing-copy/copy-desktop.json`, 9 sections |
  | 1920 | `min(1920,1536) − 48` = **1488** | **1488** | `pricing-copy/copy-widescreen.json`, 9 sections |
  | 768 | `768 − 48` = 720 | 688 | `pricing-copy/copy-tablet.json`, 11 sections |
  | 375 | `375 − 32` = 343 | 335 | `pricing-copy/copy-mobile.json`, 10 sections |

  Desktop and widescreen match to the pixel — **there is nothing to fix
  there.** Tablet is 32 narrower than stock and mobile 8; AGL-2362 measured
  both and closed **no change**. The reason is in the git history rather than
  in the pixels: the AGL-1282 re-extract (`241f6fc00` → `aa3234865`,
  2026-08-08) moved desktop from a 1280 column to 1392 and widescreen to 1488,
  and **left tablet and mobile untouched**. Their 40px and 20px margins are the
  same vintage as the 1280 AGL-2360 proved fictional — an unfinished re-cut,
  not a brand decision. Re-cut those two frames if you want them consistent;
  do **not** move the theme's gutters, and never reach for a pixel cap.

  **Read the group width, not the section band.** Every section's own `widthPx`
  is the frame width at *every* variant — 1440 at desktop as much as 375 at
  mobile — because a section band is full-bleed by construction. Reading the
  band as the column is what produced the claim that mobile is full-bleed and
  32 out. It is not: four of its six sections measure 335, "Usage pricing"
  measures 343 (already exactly stock), and only "Compare features" measures
  375 — a horizontally-scrolling table that bleeds on purpose, which is a
  per-section `maxWidth={false}` choice and not a gutter at all.

  `npm run check:marketing-width-doctrine` reconciles all four frames against
  this arithmetic and pins each delta, with desktop and widescreen held at 0 as
  the control: a theme-level `MuiContainer` gutter override moves every
  breakpoint at once, so it cannot buy tablet without breaking them.

  > ⚠️ **This bullet asserted the opposite until 2026-08-19, and its wording
  > is the trap.** It read *"`{maxWidth: false}` sx `{maxWidth: '1328px'}` →
  > content. 1328 − 48 gutters = the 1280 content column Figma uses at both
  > 1440 and 1920. Not `'lg'` (1200), not `'xl'` (1536)"* — a bespoke cap of
  > exactly the shape AGL-1298 bans, justified by a column the design does not
  > use. **1280 was never the design column**: it appears in no recorded
  > measurement anywhere under `tools/marketing/`, and 1328 is simply 1280 +
  > 48. That last clause is the sentence most likely to make a future agent
  > narrow the live site by 112px to close a diff that does not exist. It is
  > backwards. Do not restore it.
- **The hero is the deliberate exception**: its mockup overflows the container
  to the right. Container gets `overflow: visible`, the section
  `overflow: hidden`.
- **Never set `variant: 'h1'…'h6'` together with an explicit `sx.fontSize`.**
  The theme runs `responsiveFontSizes`, which emits the h1–h6 sizes inside
  media queries; a plain `sx.fontSize` has equal specificity but loses to the
  media query. It renders 96px where you asked for 72 and the screenshot looks
  entirely plausible. Put the tag in `props.component` instead.
- **Measured type scale** (all exact against Figma): H1 72/900 · section H2
  44/800 · deep-dive & how-it-works H2 34/700 · CTA H2 56/900 white · eyebrow
  13/600 `#E040FB` · card title 19/600 · card body 16/400 · step number 40/300
  `#757575` · step title 24/600 · link-card title 17/600 · fact number 44/800
  cyan · badge 14/500.
- **Token map:** `text.primary` · `text.secondary` · `grey.300` (Figma
  `border/default`) · `grey.600` · `primary.main` (cyan) · `secondary.main`
  (the pink eyebrows) · `background.paper` · `background.default` (the grey
  bands) · `quaternary.main` (the Early-access band) · `common.white`.
- Two unavoidable literals: the CTA gradient
  `linear-gradient(190.72deg, #00b0ff 36.6%, #7a5cf0 76.87%, #e040fb 109.81%)`
  and the icon-tile tints `#E6F5FF` / `#EEF0F2` / `#FBE6FE` — `sx` cannot
  express a theme token at alpha and there is no tint token.

## The build loop per page

1. Open the **source** besigner (`/product/besigner` above), click the canvas,
   `Cmd+A` then `Cmd+C`. The clipboard is detached nested JSON mirrored into
   `localStorage`, so it survives navigation (AGL-1202).
2. Open the **target** page's besigner, click the canvas, `Cmd+V`.
3. Run `apply-page-copy.js` with that page's `copy-<page>.json`. It asserts the
   slot count per section and refuses to write on a mismatch — a silent
   positional shift is the failure mode to fear here.
4. Re-point section 5's `screenId`s.
5. **Save**, and confirm the toolbar flips to "Up to date" before navigating —
   unsaved canvas work is lost on navigation with no prompt.
6. Measure on Preview, not on the canvas: the canvas is a closed shadow root.
   Text lives inside `<aglyn-text>` shadow roots, so `document.body.innerText`
   is empty — query `document.querySelectorAll('aglyn-text')` and read
   `el.shadowRoot.textContent`, then style-check `el.parentElement`.

## Target screens

The nine screens already exist and are bound to `Marketing base`. Derive their
ids from `hosts/DXnRbPH4CQ.screens` **at apply time** — never transcribe an id
from an earlier dry run or a screenshot; that already shipped two dangling nav
links once.
