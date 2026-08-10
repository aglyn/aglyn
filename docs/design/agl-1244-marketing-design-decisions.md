# AGL-1244 — marketing design-system decisions

Decision memo. Six items left open by the AGL-1241 audit, each one measured against
production rather than restated from the issue. Written 2026-08-09.

**Everything below is measured.** Node data was read directly from production
Firestore (`hosts/DXnRbPH4CQ`, aglyn.com) with the admin SDK; rendered values were
measured in a browser against the live site. No canvas was edited.

**Two items are already resolved and can be struck** (4 and 6). **Three are
one-line decisions** (2, 3, 5). **One genuinely needs your design judgement** —
the tile tints in item 1.

---

## Summary table

| # | Item | State | Decision needed |
| - | ---- | ----- | --------------- |
| 1 | Raw hex vs theme tokens | 19 nav nodes, not 27. Buckets (a) and (b) are **already empty** | **Yours** — the 3 tile tints only |
| 2 | `Deep-dive · canvas` landmark | Confirmed a real `region` landmark on all 9 | One line |
| 3 | Dead nodes on `/product` | Two **orphaned sections**, 26 nodes, not 2 | One line |
| 4 | Stale Figma layer names | **Done 2026-08-09** — but the sweep missed a class | One line (re-sweep scope) |
| 5 | Mobile gutter | Live is uniformly 16px. Figma is the inconsistent one | One line |
| 6 | Mockup dimensions | **Stale — resolved.** All assets now 1840×1160 | Strike it |

---

## 1 · Raw hex vs theme tokens

### What is actually true today

The issue's "27 of 223" is **stale**. Counting both `bgcolor` and `backgroundColor`
on every node of the Site nav component (`l3rzTXC4ng`):

| | |
| - | - |
| Nav nodes | **222** published / **223** in the besigner version doc |
| Nodes carrying a raw colour literal (light base) | **19**, not 27 |
| …by key | `backgroundColor` **15**, `color` **3**, `bgcolor` **1** |

The drop from 27 is explained: AGL-1293 moved 614 nodes onto the `primary.dark`
token after this issue was filed. The remaining 19 are the genuine backlog.

**Which key each count came from matters, and here is the answer to the shadowing
question.** Across the entire host — every screen, layout, component and template,
published docs and besigner version docs — exactly **four** nodes carry both keys:

| Node | `bgcolor` (shadowed) | `backgroundColor` (appended) |
| - | - | - |
| `components/TGUPvfojEg#VbGSO0v12z` — Marketing CTA, **published** | `background.paper` | `rgb(22, 28, 33)` |
| `components/TGUPvfojEg/versions/aIMBoSU_AY#VbGSO0v12z` | `background.paper` | `rgb(22, 28, 33)` |
| `screens/tvE5P-PnLs/versions/-P4ocjKPMB#8Ir0kH2hcO` — Demo | `background.paper` | `rgb(22, 28, 33)` |
| `screens/O_NEU9R5en/versions/uh6D__zlZ3#n0TgY3Ely9` — developers-home | `background.default` | `grey.900` |

**None of them is on the nav**, so the 19 above is a true count, not an undercount.

### The shadowing is benign — verified, not assumed

MUI's `styleFunctionSx` maps `bgcolor` and `backgroundColor` onto the *same*
`css.backgroundColor` slot with a bare assignment, so the loser is deleted rather
than overridden and the winner is decided by **object key order — last wins**.

That raised a real worry: if Firestore returned map fields lexicographically
sorted, `backgroundColor` would sort before `bgcolor` and the *published* doc
would render the stale token while the *besigner* (msgpack, insertion-ordered)
rendered the author's colour — "right in the canvas, wrong in production".

**I read the four documents and that does not happen.** Firestore returns these
maps in **insertion order**; none of the four came back sorted. Both storage forms
agree, so canvas and production agree. Confirmed on the live page: the CTA section
on `/product/besigner` computes `background-color: rgb(22, 28, 33)` — the appended
value — over the shadowed `bgcolor: background.paper`. (It is moot there anyway: a
gradient `backgroundImage` paints over it.)

So the collisions are **dead keys, not a rendering bug**. Cleaning them is tidiness,
not a fix. One caveat worth recording: `tools/scripts/backfill-scheme-dark.mjs`
reads `sx.bgcolor ?? sx.backgroundColor`, which prefers the *shadowed* value — so on
those four nodes it derived the dark counterpart from the colour that never renders.

### The three buckets

**(a) An exact token already exists — mechanical.** **Already done, nothing left.**
Zero `#E0E0E0` remain anywhere on the host; `grey.300` is used 7× in the nav.

**(b) `rgba(0,0,0,0.12)` → `divider` — a convention decision.** **This bucket is
empty.** Every occurrence of `rgba(0,0,0,0.12)` on the entire host — 12 documents —
is inside a `boxShadow` string. There is not one instance where it is used as a
colour. The issue's own caveat ("where it is a colour rather than part of a
`boxShadow` string") selects the empty set. **No decision required; strike it.**

**(c) No token exists yet — the real item.** This is the only live part, and the
pairing is cleaner than the issue suggested. All 15 tinted tiles live in the nav
mega-menu, and each tint maps 1:1 onto the token its own icon already uses:

| Tint | Tiles | Icon colour on the same tile | Nearest existing token |
| - | - | - | - |
| `#E6F5FF` | 6 | `primary.dark` | none — `primary.light` is `#33BFFF` |
| `#EEF0F2` | 4 | `tertiary.main` | none |
| `#FBE6FE` | 5 | `secondary.main` | none |

(The issue said `primary.main`; it is actually `primary.dark`. The asymmetry it
spotted is real and total — **every** icon colour is a token, **every** tile
background is a literal.)

The other three literals are separate and smaller:

- Dark surface `#161C21` — one node, `dSJLa-tFZg`, and it is the lone surviving
  `bgcolor` key in the nav. **It exactly equals `background.default` in the dark
  scheme**, but no light-scheme token equals it. Same colour appears in the footer
  as `rgb(22, 28, 33)` — the notation split the issue flagged, confirmed.
- On-dark text `#7FD4F5` / `#B7BEC8` — 3 nodes in the nav, 5 more in the footer,
  plus `#5A6675` and `#9BAAB6`. No token is close.

### Options for (c), costed

**Option A — add real palette entries.** The palette is a *hybrid*: values are data
(the `hosts/{id}.theme` document, editable in the theme builder) but **the set of
keys is code**. `hostThemeToThemeOptions` iterates a hard-coded allowlist
(`primary, secondary, tertiary, surface, error, warning, info, success`); anything
else written into the theme document is silently dropped at conversion. So a new
`tint` slot is an **8-file commit**:

`libs/shared/data/types/src/lib/host-theme.ts` · `libs/shared/ui/theme/src/lib/util/host-theme.ts`
(the `colorKeys` array) · `libs/shared/ui/theme/src/vendor/mui.ts` (module augmentation) ·
`libs/shared/ui/theme/src/lib/console.theme.ts` (brand default, both schemes) ·
`libs/shared/ui/theme/src/lib/util/create-responsive-theme.ts` · the theme-editor
constants · the colour-picker token list · optionally `theme.types.ts`.

That is exactly the ledger `tertiary` and `surface` already occupy, so the path is
proven. Cost: one commit, a deploy, and the slot then exists for **every** site on
the platform — which is either the point or the objection.

**Option B — use existing keys' unused shades.** `primary`, `secondary` and
`tertiary` all have `.light` slots that the marketing site does not use for these
tiles. Writing the three tints into `theme.colorSchemes.{light,dark}.*.light`
needs **no commit** — but the theme-editor UI only writes `main`, so it takes a
small Firestore script (the same way AGL-1293 set `primary.dark`). Cheapest real
tokenisation. The objection: `.light` has a conventional meaning in MUI (a lighter
shade of the ramp) and a 90 %-desaturated tint is not that, so you would be
overloading a slot rather than naming a concept.

**Option C — an `alpha()` convention.** ⚠️ **`alpha()` cannot work.** Node `sx` is
static persisted data; nothing evaluates a string as code. Worse, the colour-field
validator *accepts* `alpha(#00b0ff, 0.08)`, stores it, and the CSS parser then drops
it — a silent no-op. The working equivalent is native CSS:
`color-mix(in srgb, var(--mui-palette-primary-main) 8%, transparent)`. That is a
static string, it is token-aware, it flips with the scheme for free, and it needs
**no commit at all**. It changes the exact colour slightly and needs one visual check.

**Option D — leave them.** They render correctly and each already carries a curated
`@scheme dark` counterpart. Cost is zero; the tints simply stay unnamed.

### ⚠️ The dark-mode entanglement — true of A, B and C

Each of the 15 tile nodes carries an `@scheme dark` slice holding a hand-curated
dark counterpart (`#E6F5FF`→`#143043`, `#EEF0F2`→`#262b31`, `#FBE6FE`→`#3d1443`).
Those slices exist **because** the value is a literal — a token flips on its own.

So tokenising the base **must also delete the slice**. Leaving both would make the
slice override a token, which `backfill-scheme-dark.mjs`'s own `checkSlice`
assertion flags as a violation. Whichever option you pick, the unit of work is
"replace the literal *and* drop the slice", 15 nodes, and the dark values above must
be carried into the token's dark scheme so dark mode is unchanged.

### Recommendation

**Option A, scoped to one new key.** Add a single `tint` palette entry with
`primary` / `secondary` / `tertiary` counterparts rather than three unrelated keys —
i.e. name the *concept* once. The tints are 1:1 with tokens the tiles already use,
which is the strongest possible signal that they are a systematic part of the
palette and not one-off decoration. It is one commit on a proven path, and it makes
the pattern reusable for the tenant sites this is ultimately a product for.

**If you want it done tonight with no deploy, take Option C** — `color-mix()` against
the palette vars gets you token-following tints today, and Option A can absorb it
later without re-authoring the nodes.

**I would not do Option B.** Overloading `.light` saves a commit and costs you the
name, which is the whole point of the exercise.

### One live defect found along the way

Nav node `j3-xhzRxT3` (a 300px mega-menu panel) sets
`backgroundColor: 'quaternary.main'`. **There is no `quaternary` key in the
palette** — it is not in the allowlist. The declaration reaches CSS verbatim, is
invalid, and is dropped: the panel renders with no background at all. Confirmed
live — `quaternary` appears 4× in the served HTML and in **zero** CSS rules. It
wants a real token; worth folding into whichever option you choose.

---

## 2 · The `Deep-dive · canvas` landmark

### What is actually true today

Confirmed on all nine `/product/*` pages: `<section aria-label="Deep-dive · canvas">`.
A `<section>` with an accessible name is exposed as a **`region` landmark**, so this
is squarely an accessibility question.

Two corrections to the issue:

1. **It is misleading on all nine, including `/product/besigner`.** That page's
   deep-dive section is headed *"Add motion and logic, no code."* and its mockup is
   the interactions inspector. It is about interactions, not the canvas. The issue
   assumed besigner was the accurate one; it is not.
2. **The problem is not confined to this label.** Every section label on these pages
   is the Figma layer name: `Hero`, `Statement`, `Capabilities`,
   `Deep-dive · canvas`, `How it works`, `Explore the platform`, `Early access`,
   `CTA`. "Statement" and "CTA" are no more useful to a screen-reader user than the
   deep-dive label is.

**And the fix needs no copywriting.** Every deep-dive section already contains its
own accurate, distinct `<h2>`:

| Page | Existing heading |
| - | - |
| besigner | Add motion and logic, no code. |
| console | Manage every site, side by side. |
| commerce | Every order, online and in person. |
| forms | Build any form right on the page. |
| media | Folders in the grid, drag to organize. |
| workflows | Connect your site's events to actions. |
| plugins | Add a head start in a click. |
| analytics | Zoom into any screen. |
| marketing | Announcement bars and popups, without code. |

### Should a Figma layer name ever become an `aria-label`?

**No — and this is the general rule, not a judgement call about this one string.**
A layer name is a *designer's addressing scheme*: it names the slot in the
composition ("Hero", "CTA", "left", "grid"). An `aria-label` is *user-facing content*
that overrides the element's natural name. The two have different audiences and
different lifecycles — which is exactly why these drifted: the copy was rewritten by
the feature-accuracy pass and the layer names were not.

There is also a specific accessibility rule at stake: an `aria-label` on a section
that contains a heading **replaces** that heading as the region's accessible name.
So today the good heading is being suppressed in favour of the stale layer name.

### Recommendation — one line

**Point each section at the heading it already contains** (`aria-labelledby`), or
simply drop the `aria-label` so the heading names the region. Either way the label
becomes self-maintaining: rewrite the copy and the landmark follows.

Deviating from the frame is the right call and costs nothing — the frame name stays
the designer's address for the slot, which is what it is for.

Execution: a mechanical edit to one `aria-label` prop per section, 9 pages ×
8 sections. Do the deep-dive first if you want it scoped small.

---

## 3 · Two dead nodes on `/product`

### What is actually true today — bigger than the issue says

Both nodes still exist and still do not render. But they are **not two stray
`h1` nodes inside the Hero**. They are the `h1`s of **two complete orphaned hero
sections** cloned from `/product/besigner`:

| | |
| - | - |
| Orphaned sections | `dpoUIhmkxY`, `tEZMO_WOn1` — both root-level `<section>` |
| The cited nodes | `ufgjbCiIGD`, `SAMYp8yXY9` — the `h1` inside each |
| Each section holds | 13 nodes — eyebrow stack, `h1`, body paragraph, button stack |
| **Total dead weight from these two** | **26 nodes** |
| Total unreachable nodes on the screen | **61 of 371** (16 %) |

**Why they do not render, precisely.** The renderer walks the **child list**
(`_@_.nodes`), which holds 10 entries and does not include either section. But both
sections still carry `parentId: "_@_"`. That inconsistency — a dangling `parentId`
with no matching child-list entry — is the fingerprint of a besigner delete or
reparent that dropped the child-list entry and left the node records behind.

**They are not free.** They ship in the payload on every request: the copy *"Design
your whole site on a living canvas."* appears twice in the served HTML of
`/product`, and all four node ids are present. It renders as nothing (the page has
exactly one `h1`, correctly *"Design it live. Ship it instantly."*) but it is paid
for on every uncached request.

| | raw | gzipped | share of node payload |
| - | - | - | - |
| Whole node map | 109,041 B | 16,804 B | — |
| All 61 unreachable | 20,231 B | 3,492 B | **20.8 %** |
| The two hero clones | 6,791 B | 1,431 B | 8.5 % |

### What deleting them would cost, and whether it is safe

**Safe — safer than the issue feared.** The `deleteNode`-recurses hazard is real in
general but does not bite here: the recursion would remove 13 nodes per section, and
**all 26 are already unreachable**. Nothing that renders can be affected, because
nothing that renders references them.

**But you probably cannot do it in the besigner.** These nodes are absent from their
parent's child list, which is what the layer tree is built from — so they will not
appear in the tree and cannot be selected. This needs a data fix, not a canvas edit.

### Recommendation — one line

**Delete them, with a script, and take all 61 while you are there** — 20.8 % of the
node payload for zero rendered pixels. Snapshot first with the tool that already
exists for this:

```
node tools/scripts/backup-host-nodes.mjs --host=DXnRbPH4CQ --out=pre-prune.json
```

Then prune anything unreachable from `_@_` via child lists, and revalidate
`/product`. Restore is a single dry-run-by-default command if anything looks wrong.
Low risk, ~30 minutes. If you would rather not touch data at all, leaving them costs
1.4 KB gzipped per page and nothing else — this is a hygiene call, not a defect.

---

## 4 · Stale Figma layer names — already done, with one gap

**This item was completed on 2026-08-09** (see the comment on AGL-1244): 18 renames
across the five detail frames, enumerated mechanically rather than from the issue's
list — which is why Forms turned up **five** stale names where the issue said three.

**Verified still clean.** Re-read the Marketing frame `637:1218`: all six cards now
carry their own headings — `Card Email campaigns`, `Card Audience lists`,
`Card Announcement bars`, `Card Popups`, `Card A/B testing`,
`Card Scheduled & measured`. The rename held.

### The gap

The sweep enumerated **`Card *` frames only**. Other layer classes were never
checked, and at least one is stale in the very first frame I re-read:

> **`637:1390` is named `Link Plugins`** but contains the text *"Analytics"* and
> *"Privacy-first traffic, top pages, and store revenue."*

That is in the "Explore the platform" grid, which is cloned across all nine detail
pages — so it is likely repeated nine times, though I confirmed it in one frame only
and did not count the rest.

### Recommendation — one line

**Re-run the same mechanical sweep with the name pattern widened** from `Card *` to
every named container that holds a heading (`Link *`, `step`, `f`, `b`, …). The
method is already proven and the fix is renames only. Scope: one Figma session,
same as last time. Still Figma-side cleanup, still not urgent — its only cost is
misleading the next person who diffs by layer name, which is exactly what the
original item was about.

---

## 5 · The mobile gutter

### What is actually true today

Measured on the live site at 375 px, after forcing a layout pass:

**Every container is 16 px, and they already agree.** All 10 `MuiContainer` elements
on `/product/besigner` — the nav, all eight sections, and the footer — compute
`padding-left: 16px; padding-right: 16px`. The histogram is a single bucket:
`{"16px/16px": 10}`. The footer text and the `h1` both start at exactly `x = 16`;
the logo starts at `x = 16`; `document.scrollWidth` equals the viewport, so nothing
overflows.

This is MUI's `Container` default, inherited because no surface overrides it.

**So the misalignment the issue worried about does not exist on the live site.** It
exists only in Figma, where the page frames use 20 and the footer frame uses 24 —
i.e. **the design is inconsistent with itself**, and the build is uniform.

That inverts the framing. The risk is not "changing one surface would misalign it";
it is that **changing anything at all would break a currently-consistent 16**, since
every surface would have to move together to stay aligned.

### Options

| | Change | Cost | Risk |
| - | - | - | - |
| **A** | Update Figma to 16 | One Figma pass, ~20 frames | **None** — no code, no canvas, no deploy |
| **B** | Move live to 20 | Override `Container` padding on every marketing surface + reconcile the footer frame's 24 | Must land on all 10 at once or you introduce the misalignment that does not currently exist |
| **C** | Move live to 24 | As B, plus it is the largest departure from the MUI default | As B |

### Recommendation — one line

**Option A — make Figma match the build at 16 px.** The live value is the MUI
default, it is uniform across every surface, and 16 is a perfectly conventional
mobile gutter. Nothing about the rendered site is wrong, so the cheapest correct
move is to fix the drawing, not the site.

Take B or C only if you actively want more breathing room on mobile — that is a
taste call, and it is the one part of this item that is yours. If you do, it must be
a single change across all 10 containers, ideally by setting the gutter once on the
theme rather than per surface.

---

## 6 · Mockup dimensions — stale, strike it

**AGL-1234 has been overtaken and this item is resolved.** It sits **In Review**
(moved 2026-08-09) with a full binding matrix; the artwork blocker was cleared in
Figma on 2026-08-08 and every page was re-bound and revalidated.

**Verified against the live assets** — the true source dimensions of the mockups
now served on `/product/*`:

| Asset | Natural size | Ratio |
| - | - | - |
| `CXOu4pQyGf` (besigner hero) | **1840 × 1160** | 1.586 |
| `RbaNYC-BZE` (besigner deep-dive) | **1840 × 1160** | 1.586 |
| `Bd2wVVhZfU` (console hero) | **1840 × 1160** | 1.586 |
| `DAMJyCuc2m` (analytics hero) | **1840 × 1160** | 1.586 |

1840 × 1160 is exactly **920 × 580 at @2x**, and 1.586 is exactly the designed
aspect. AGL-1234's stated defect — "718 × 453 natural where the design calls for
920 × 580" — is no longer true of anything on the site. The crop decision that
issue was blocked on has been made and shipped.

Every page also now carries its own distinct mockups with factual alt text; the
"every product page ships the same two mockups" defect is gone.

**Recommendation:** strike item 6 from AGL-1244 and let AGL-1234 close on its own
review. No decision required.

---

## What to do next

**Decide in one line each:**

- **2** — "Label sections by their heading, not the frame name." (I would do it.)
- **3** — "Prune the unreachable nodes with a script, snapshot first." (I would.)
- **5** — "Figma moves to 16." (I would.)
- **6** — Strike it.
- **4** — "Re-sweep with a wider name pattern." (Not urgent.)
- **1(a)/1(b)** — Nothing to decide; both buckets are already empty.

**Needs your judgement:**

- **1(c)** — the three tile tints. My recommendation is a `tint` palette entry
  (Option A); the no-deploy fallback is `color-mix()` (Option C). Whichever you
  pick, the work is 15 nodes and each one must drop its `@scheme dark` slice at the
  same time.
- The `#161C21` / `#7FD4F5` / `#B7BEC8` on-dark cluster is a smaller version of the
  same question and can follow the same decision.
- **5** only becomes a judgement call if you want a bigger mobile gutter than 16.

---

## Addendum — 1(c) decided, and the count was low

**Decided 2026-08-09: Option A.** `palette.tint` now exists with `primary` /
`secondary` / `tertiary` members, on the 8-file ledger this memo describes
(commit `c97965532`). The dark scheme carries `#143043` / `#3D1443` / `#262B31`
— the exact values the slices hand-wrote — so a repointed tile renders the same
colour in dark as it does today, and the slice can go.

Shape note the memo did not anticipate: `tint` is **not** a `PaletteColor`. It
has no ramp and no `contrastText`, so it is a group of string leaves like
`background` and `text`. That is why it rides `SurfaceColorPath` in the theme
editor rather than `PALETTE_COLOR_FIELDS` (those all write `main`, and
`pickPaletteColor` gates on `main` — routing tints through `colorKeys` would
have dropped them silently, which is the `quaternary` failure one layer down).

### The population is 131 nodes, not 15

The memo counted the **nav component only**. Swept host-wide against production,
the same three literals appear in **18 documents**:

| | |
| - | - |
| Nav component `l3rzTXC4ng` (published + version) | 15 nodes × 2, key `backgroundColor` |
| 16 screen version documents | 101 nodes, key `bgcolor` |
| **Total writes** | **131** |

The screen instances are the `Icon tile` nodes inside the `Card · …` frames of
the Capabilities grids — the same three-way pairing, cloned per product page.

Three measured facts make the repoint mechanical:

- **Not one** of the 131 carries both `bgcolor` and `backgroundColor`. The
  four-node shadowing trap does not intersect this population at all.
- **Every** one carries an `@scheme dark` slice with **exactly one key**, the
  same background key as the base. The whole slice can be deleted rather than
  surgically edited.
- The dark values are uniform across all 131 — no variants, no near-misses.

`tools/scripts/tokenize-tile-tints.mjs` does it, dry run by default, and
**refuses** per node on any deviation from that shape rather than guessing.

⚠️ **The host is a moving target.** Two reads 15 minutes apart differed by six
nodes on `/product` — the orphaned-hero prune of item 3 landing underneath.
Re-run the dry run immediately before `--apply`.

### `quaternary` should NOT exist — the site's own press kit says so

`quaternary.main` is on **11 nodes**, not one: `j3-xhzRxT3` (the nav's 300px
featured panel, `backgroundColor`) plus **ten `<section aria-label="Early
access">` bands**, one per product page, on `bgcolor`.

Their sibling sections alternate `background.paper` / `background.default`, so
the Early-access band wants a third surface step — not a fourth *accent*.
Nothing anywhere on the host uses `quaternary` for an icon, text or border; all
11 uses are backgrounds.

And the answer is already published. `/press` (screen `q3RLZRAhLZ`) renders the
brand table straight out of `console.theme.ts`, and its Surfaces row reads:

> **Surface** | #F8F9FA | Cards & quaternary

So `quaternary` is a **misnamed reference to `surface.main`**, which exists in
both schemes (`#F8F9FA` / `#202934`) and is distinct from paper and default in
dark, where the missing background actually costs something. Repoint all 11 at
`surface.main`; adding a palette key would be making a typo valid.

`surface.main` is currently used **nowhere** on the marketing host, which is
consistent with the slot having been referenced by the wrong name from the start.

### The on-dark cluster is three concepts, not one

Measured, it does not follow the same call — it splits:

| Values | Nodes | What it actually is |
| - | - | - |
| `#161C21` bg → dark `#2a3440` | 10 | An **inverted surface**: dark panel on a light page that lifts in dark. Both values are dark-scheme `background.default`/`paper`; no light-scheme token matches. Wants its own key. |
| `#161c21` text → dark `#e6e9ec` | 9 | Plain `text.primary`. Repoint, no new token. |
| `#161C21` text, **no slice** | 7 | Same, and a latent dark-mode defect today — near-black text that never lifts. |
| `#5A6675` → `#b4bcc5` | 6 | Plain `text.secondary`. |
| `#7FD4F5` (6), `#B7BEC8` (9), `#9BAAB6` (2) | 17 | On-dark ink on the permanently dark nav/footer panels. Correctly slice-less. The only genuine new-token candidate here. |

Only rows 1 and 5 need naming; rows 2–4 are repoints onto tokens that already
exist. Worth a separate decision rather than folding into `tint`.
