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
  horizontal padding) → `muiContainer` props `{maxWidth: false}` sx
  `{maxWidth: '1328px'}` → content. 1328 − 48 gutters = the 1280 content
  column Figma uses at both 1440 and 1920. Not `'lg'` (1200), not `'xl'` (1536).
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
