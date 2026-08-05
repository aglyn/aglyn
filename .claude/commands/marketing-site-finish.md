Finish the **Marketing site on Aglyn** project. Two threads, and Thread 1 comes
first because doing it later means redoing Thread 2's work.

Coordinates: org `aglyn-org` (`jWmGooWE3L`) · host `aglyn-marketing`
(`DXnRbPH4CQ`) · live `https://aglyn-marketing.aglyn.app` · Figma
`UsUolmsFgfymhaKMLBZvzo`. Console dev server on **4200** (another session may
own it — reuse theirs rather than starting a second).

Linear: In Progress on start, In Review when it lands, Done once verified in
production. One conventional commit per AGL-###, `git commit --only <paths>`,
**never `git add -A`** — a concurrent session auto-stages files. Never
`git stash`. Building pages needs no commit at all: it is Firestore data.

**Master issue is AGL-1245.** Also In Progress: **AGL-1162** (foundation —
layouts and core components) and **AGL-1202** (copy/paste; only *Cut* is
left). **AGL-1099 is postponed** — do not pick it up.

---

# Measured state — re-measure before trusting this

Every route on the live site, cache-busted, `<section>` count:

| built | | blank (0 sections) |
| -- | -- | -- |
| `/` | 7 | `/legal` `/legal/privacy` `/legal/terms` |
| `/product` | 10 | `/contact-sales` `/solutions` `/use-cases` |
| `/pricing` | 3 | `/blog` `/about` `/changelog` `/newsroom` |
| `/demo` | 3 | `/press` `/careers` `/contact` `/developers-home` |

Plus the nine `/product/*` detail pages, which are real. **14 routes still
render nav straight into footer**, and 23 of the 30 internal footer links lead
to one of them.

```bash
CB=$(date +%s%N); for p in "" pricing product demo legal contact-sales solutions; do
  printf "%-16s %s\n" "/$p" "$(curl -s "https://aglyn-marketing.aglyn.app/$p?cb=$CB" | grep -c '<section')"
done
```

---

# Thread 1 — retrofit the built pages onto parameterised components

**Asked for by Zach 2026-08-04:** go back through the sections already built
and convert the ones that repeat — hero, CTA, and the rest — into *dynamic*
reusable components rather than copies.

This is not cleanup. Every page Thread 2 adds is another copy of the same hero
and CTA, so the cost of not doing it first grows with each page.

## The capability shipped — it is in production

**AGL-1247 component properties** (`7ddbb8332`) and **AGL-1251 instances render
their content on canvas** (`c90b3eb86`) are both live. From the docs:

1. Open the component → **File ▸ Properties…**
2. **Add property**, name it (`headline`), pick a type (text, long text, image,
   link, number, yes/no), give it a **default**.
3. Inside the component use the token — `{{prop.headline}}`.
4. **Save properties**, then **publish the component**.

Then each instance gets a field per property in Attributes. An empty field
falls back to the component's default, so **a blank can never collapse a
section**. Property names are letters/numbers/underscores, and instance values
are stored *against the name* — renaming one silently reverts every page that
set it to the default.

**Save is not publish.** A component save writes the version doc; live pages
read the parent. FILE ▸ Publish again, or nothing changes on the site.

## Start with the CTA — the evidence is already in AGL-1245

`/`'s CTA (`VbGSO0v12z`) and `/product`'s were dumped node-for-node and found
**structurally identical**: 8 nodes each, same components, same button targets,
byte-identical `sx` on the section, the `h2` and the lede. **They differed in
copy only.** That is the exact shape properties exist for, and it is the
cheapest possible first conversion — two props (`headline`, `lede`) and the
existing structure.

Then the hero, which repeats across `/`, `/product`, `/pricing`, `/demo` and
the nine detail pages with the same eyebrow/h1/lede skeleton.

## How to do the swap safely

`canvas.addNodeFromNested` mints fresh ids, and **AGL-1202 copy/paste now
carries a subtree between documents** (Cmd/Ctrl+C, navigate, Cmd/Ctrl+V — the
clipboard survives the navigation via `localStorage`). Append the instance
first, verify it renders, *then* delete the old section — append-then-delete
preserves root order when the section is last.

`canvas.deleteNode` deletes the whole subtree and saves history itself.

## Done when

No page duplicates hero or CTA markup; changing the component's font size once
changes every page; each page still reads exactly as it does now. **Prove the
last one** — a retrofit that quietly rewords a live page is worse than the
duplication.

---

# Thread 2 — the 14 blank routes, in this order

1. **`/legal/*`** — `/legal`, `/legal/privacy`, `/legal/terms`. Linked from
   every footer, and **AGL-935** says sign-up consent links 404 today, so this
   is the one with a real user hitting it. Copy exists verbatim in Drive:
   transcription, not design. AGL-935 has no commit yet.
2. **`/contact-sales`** (`ZrJJCE4-TF` / `Ws4-z9eRkD`) — the `/demo` closer and
   the footer both point here. Mirror `/demo`: a **real form**, not a mock.
3. **Solutions** listing (`163:90`) + 6 details, then use-cases ×6.
4. **Blog**, company pages, changelog/newsroom/press.
5. The four unbuilt `/pricing` sections: `scale-strip` (`570:1218`),
   `Compare features` (`87:56`, a 2507px table), `Usage pricing` (`89:56`),
   `FAQ` (`90:30`).

Once Thread 1 lands, each of these is chrome + a hero instance + its own body.

---

# Figma: there is no MCP bug

A previous command claimed the MCP "only enumerates two pages out of thirteen".
**That premise was wrong and cost real time.** The file genuinely has two pages:
`56:37` 🗄 Archive and `0:1` 🎨 UI Kit & Tokens. `0:1` is **40632 × 11828px** —
not a UI kit, one enormous canvas holding the page designs as **frames**. The
"13 pages" were frames all along.

So: `get_metadata` on the **page** id and read the frame index. Do not ask Zach
for ids. `0:1`'s full metadata is very large. If Zach has a frame selected in
the desktop app, `get_metadata` prepends a "Currently selected nodes" block —
the cheapest lookup there is. **Nothing on 🗄 Archive is a valid reference.**

Known frames: Home C `36:844` (Hero `36:867`, How it works `38:37`, Statement
`37:37`, Bento `37:39`, Included `38:57`, Quote `39:37`, CTA `39:45`) · Pricing
`77:38` · Demo `174:165` · Solutions listing `163:90`.

---

# Build technique

Compose the section as one nested JSON, stage it to `localStorage`, then
`canvas.addNodeFromNested(JSON.parse(...), canvas.getNode('_@_'))` and
`canvas.reorderNode(node, index)` to position it.

**Unsaved work now has a crash net** (AGL-1256, shipped): the besigner
snapshots the canvas to `localStorage` on a debounce and offers it back after a
crash or reload. Staging by hand is still good practice for a big pour — it is
free, and it is what saved the `/demo` build — but losing an afternoon to a
crash is no longer the default.

**Two sessions on one document now co-edit** (AGL-677, shipped). Changes sync
live per node, and the avatar stack shows who else is in the room. An orange
badge means *you* have it open somewhere else — two tabs are two
`CanvasManager`s and the second save wins, silently, because the conflict guard
sees your own write.

Section conventions, measured off the live document:

- `section` node `{element:'section', ariaLabel:'…'}`, then `muiContainer`
  `{maxWidth:false}` with `sx.maxWidth:'1328px'`.
- Card: `bgcolor background.paper`, `1px solid divider`, radius `8px`, `p:3.5`,
  gap `1.75`, shadow
  `0px 4px 12px -2px rgba(0,0,0,0.08), 0px 1px 2px 0px rgba(0,0,0,0.06)`.
- Icon chips are **44px, radius 8px** (Zach's call — the frames say 11px; site
  consistency wins). Tints follow the frame.
- Headings ride the AGL-1243 responsive ramp, and **letter-spacing scales with
  `fontSize`** — do not leave it pinned at the desktop value.

### Two-tone text is NOT blocked by AGL-1235

AGL-1235 blocks a *nested* span. Sibling inline spans work and are proven three
times (Statement, Quote, Bento): a `section` node with `element:'div'` holding
one `muiTypography` per run, each `props.component:'span'` and
`sx.display:'inline'`. They flow and wrap as one paragraph. Put the shared type
on **every** run — siblings inherit nothing.

### Icons need their path

An `icon` node is `{iconId, size, iconPath}`. Without `iconPath` it renders the
DEFAULT_ICON help glyph on every surface (AGL-1212). Lift both from an existing
node rather than inventing: `/product` has 59 icon nodes, `/pricing` has the
`check`. Already used: `view-grid-outline`, `shopping-outline`,
`text-box-outline`, `sitemap-outline`, `check`, `laptop`, `flash-outline`.

### Forms must be real

`form` + `formField` exist and every attribute is optional — `formName` alone
routes submissions to the Inbox, no dataset required. `formField` takes
`{fieldName, label, fieldType, options, required}` with `fieldType` ∈ email ·
textarea · select · radio · checkbox · rating. `/demo` uses this. **Never ship
a mocked-up form on a live page** — the frames draw static input boxes because
they are pictures; a real "Book my demo" button that does nothing is worse than
no page.

### Verifying

A screen Save republishes itself, but ISR means **the first read after a save
is reliably stale**. Read 2–3 times with `?cb=$(date +%s%N)` and only trust
agreement between reads 2 and 3. Emotion dedupes identical style objects, so
counting CSS rules undercounts elements — compare like for like.

---

# Standing hazards

- **The canvas has no `leaf:` attribute and lives in shadow roots.**
  `nodeElementSelector` / `[data-aglyn="leaf:<id>"]` is the *site renderer's*.
  `document.querySelectorAll` returns 0 and `document.body.innerText` misses
  canvas text **while the canvas is rendering perfectly**. Trust
  `window.AglynModule.canvas.toJSON()` for state and a screenshot for what
  painted.
- **`updateNodeProps` REPLACES the props object.** Assign onto the observable
  instead (`node.props.children = …`, `node.sx.borderRadius = '8px'`), then
  confirm the canvas re-rendered — a write to a detached copy still reads back
  correctly from `toJSON()`.
- **A converter runs on PARTIAL writes.** Fixed for version docs in AGL-1250,
  but the shape recurs: `toFirestore` runs on merge payloads too, and any field
  it defaults gets written. Read the ref's converter before a field-only write.
- The permission classifier intermittently blocks `canvas.*` mutations from the
  page — roughly half were denied in one session, non-deterministically. A
  retry usually clears it. If it denies repeatedly, stop and ask rather than
  routing around it through the UI.
- `window.AglynModule` is dev-only (`NODE_ENV !== 'production'`), so the
  production console is **not** scriptable.
- **Turbopack cache runaway** hard-404s deep editor routes and fakes an
  org-switcher bug. If a known-good screen 404s, `rm -rf apps/console/.next/dev`
  and restart — check the lock owner is dead first, and never delete another
  session's.
