---
description: "STALE 2026-08-04 handoff — canvas-scripting note corrected (production IS scriptable via window.Aglyn). AGL-1256 and AGL-677 are still open. Use /handoff."
---

> ⚠️ **CORRECTED 2026-08-14 (AGL-1704).** A dated 2026-08-04 session handoff. For
> the current promotion flow and working agreements read
> `.claude/commands/handoff.md`; where it disagrees, it wins. Fixed below: the
> claim that the production console is not scriptable is wrong — only the
> `AglynModule` *alias* is dev-gated, while `window.Aglyn` is assigned in every
> environment, and neither has a `canvas` property. Thread 1 is **not** spent:
> **AGL-1256** (local drafts) and **AGL-677** (co-editing) are both still open.

Two threads. **Thread 1 is what Zach asked for and it is the one that pays
for itself** — it is a crash net for work that is currently held only in
memory, and this session lost a 71-node page proving it. Thread 2 is the
marketing site, which is now mostly a queue of ordinary page builds.

Coordinates: org `aglyn-org` (`jWmGooWE3L`) · host `aglyn-marketing`
(`DXnRbPH4CQ`) · live `https://aglyn-marketing.aglyn.app` · Figma
`UsUolmsFgfymhaKMLBZvzo`. Console dev server on **4200** (another session may
own it — reuse theirs rather than starting a second).

Linear: In Progress on start, In Review when it lands, Done once verified in
production. One conventional commit per AGL-###, `git commit --only <paths>`,
**never `git add -A`** — a concurrent session auto-stages files, and a `git
push` after a failed commit publishes THEIRS too. Never `git stash`.

---

# Thread 1 — local drafts, then co-editing

## AGL-1256 — keep a local draft so a crash can't lose unsaved work

> "We need to make sure we are saving drafts locally in the storage to avoid
> issues when the browser crashes etc and have to option to restore the draft
> upon reloading in case this happens." — Zach, 2026-08-04

Read AGL-1256; it has the full shape. The short version: unsaved besigner
work lives only in the `CanvasManager` singleton, in memory, in one tab.
Anything that unmounts the app takes it all, silently.

**This is measured, not theoretical.** Building `/demo` this session, a
concurrent editor's in-progress change to
`apps/console/components/service-worker-registrar.component.tsx` — it added
`useSnackbar()`, and `app/layout.tsx` renders `<ServiceWorkerRegistrar />`
with no `SnackbarProvider` above it — threw during render and 500'd **every
console route** for ~13 minutes. A built-but-unsaved 71-node page vanished
the instant the app unmounted. It survived only because it had been staged
into `localStorage` by hand first.

### Extend what exists — there are already two of the three pieces

- **`apps/console/constants/preview-state.ts`** already snapshots canvas
  nodes to `localStorage` keyed by `previewStateKey({hostId, kind, docId,
  versionId})`, with `writePreviewState` / `readPreviewState`. Same shape a
  draft needs. Its `setItem` has **no quota handling** — fix that here.
- **`useBesignerDocument`** (`libs/besigner/feature/designer/src/lib/hooks/`)
  already owns every input the restore decision needs: `documentKey`
  (`${hostId}:${docId}:${versionId}`), `saveAvailable`, `baseStampRef`,
  `remoteChanged`, and `markOwnWrite`. The draft hook belongs **here**, not
  per page — five editors adopt this hook (screen, layout, component,
  template, email) and all five should get it for free.

### The four decisions that matter

1. Debounce the write. Serialising the whole node map per keystroke is
   exactly what crashed the tab in AGL-567.
2. Store the `baseStamp` the draft was taken against, or the restore prompt
   cannot be honest.
3. **Prompt, never auto-apply.** Silently replacing a document with a stale
   draft is worse than the bug being fixed.
4. Reconcile with AGL-674: if the document's stamp moved while the draft was
   stranded, say so, and let the save still go through the conflict guard.

Quota is the trap — ~5 MB per origin, `/product` is 222 nodes, base64 adds
~33%. Catch `QuotaExceededError` and evict other documents' drafts
oldest-first. A draft system that bricks the editor when full is a net loss.

## AGL-677 — real-time co-editing (the architecture decision)

Only after AGL-1256. Its own description is good and still accurate; read it
rather than re-deriving. **Do not start by writing code.** Three constraints
decide the shape: the node map is one opaque msgpack blob (Firestore cannot
merge what has no fields), there is no server (Vercel serverless), and undo
is whole-document snapshots that a remote edit would erase.

Related and already true: AGL-674 (conflict detection) is Done and now
exposes `markOwnWrite`. AGL-675 (presence) is merged but **NOT working** —
the dev log shows `auth/firebase-app-check-token-is-invalid` from
`use-presence.ts:165` on every editor load, so the RTDB channel AGL-677
wants to reuse is not actually proven yet. Fix or re-scope AGL-675 before
leaning on it.

---

# Thread 2 — finish the marketing site (AGL-1245)

`/` (Home C, all 7 sections), `/pricing`, `/product` and `/demo` are built
and live. Everything below is still blank chrome.

## Next, in order

1. **`/legal/*`** — `/legal`, `/legal/privacy`, `/legal/terms`. Linked from
   every page's footer. AGL-1245 records that the copy exists verbatim in
   Drive, so this is transcription, not design.
2. `/contact-sales` (screen `ZrJJCE4-TF` / `Ws4-z9eRkD`) — the CTA on the
   new `/demo` closer and the footer both point at it. Mirror `/demo`: it
   should be a **real form**, not a mock.
3. Solutions listing (`163:90`) + 6 details, then use-cases ×6.
4. Blog, company pages, changelog/newsroom/press.
5. The four `/pricing` sections still unbuilt: `scale-strip` (`570:1218`),
   `Compare features` (`87:56`), `Usage pricing` (`89:56`), `FAQ` (`90:30`).

## Figma: there is no MCP bug — stop looking for one

A previous command said the MCP "only enumerates two pages out of thirteen".
**That premise was wrong and cost real time.** Diagnosed 2026-08-04:

- `fileKey` IS honoured (a bogus key returns an access error).
- The file genuinely has **two** pages: `56:37` 🗄 Archive and `0:1`
  🎨 UI Kit & Tokens.
- `0:1` is **40632 × 11828px**. It is not a UI kit — it is one enormous
  canvas holding the page designs as **frames**. The "13 pages" were frames
  all along.

So: to find a design, `get_metadata` on the **page** id and read the frame
index — do not ask Zach for ids. Beware that `0:1`'s full metadata is very
large. If Zach has a frame selected in the desktop app, `get_metadata`
prepends a "Currently selected nodes" block, which is the cheapest lookup of
all. **Nothing on 🗄 Archive is a valid reference.**

Known frame ids: Home C `36:844` (Hero `36:867`, How it works `38:37`,
Statement `37:37`, Bento `37:39`, Included `38:57`, Quote `39:37`, CTA
`39:45`) · Pricing `77:38` · Demo `174:165` · Solutions listing `163:90`.

## Build technique that works

Compose the section as one nested JSON, stage it to `localStorage`, then
`canvas.addNodeFromNested(JSON.parse(...), canvas.getNode('_@_'))` and
`canvas.reorderNode(node, index)` to position it. **Stage before you add** —
that staging is the only reason the `/demo` build survived the crash above,
and it is free.

Section conventions, measured off the live document:

- `section` node `{element:'section', ariaLabel:'…'}`, then `muiContainer`
  `{maxWidth:false}` with `sx.maxWidth:'1328px'`.
- Card: `bgcolor background.paper`, `1px solid divider`, radius `8px`,
  `p:3.5`, gap `1.75`, shadow
  `0px 4px 12px -2px rgba(0,0,0,0.08), 0px 1px 2px 0px rgba(0,0,0,0.06)`.
- Icon chips are **44px, radius 8px** (Zach's call — the frames say 11px;
  site consistency wins). Tints follow the frame.
- Headings ride the AGL-1243 responsive ramp, and **letter-spacing scales
  with `fontSize`** — do not leave it pinned at the desktop value.

### Two-tone text is NOT blocked by AGL-1235

AGL-1235 blocks a *nested* span. Sibling inline spans work and are proven
twice (Statement, Quote): a `section` node with `element:'div'` holding one
`muiTypography` per run, each `props.component:'span'` and
`sx.display:'inline'`. They flow and wrap as one paragraph. Put the shared
type on every run — siblings inherit nothing.

### Icons need their path

An `icon` node is `{iconId, size, iconPath}`. Without `iconPath` it renders
the DEFAULT_ICON help glyph on every surface (AGL-1212). Lift both from an
existing node rather than inventing: `/product` has 59 icon nodes,
`/pricing` has the `check`. Already-used ids: `view-grid-outline`,
`shopping-outline`, `text-box-outline`, `sitemap-outline`, `check`,
`laptop`, `flash-outline`.

### Forms must be real

`form` + `formField` components exist and every attribute is optional —
`formName` alone routes submissions to the Inbox, no dataset required.
`formField` takes `{fieldName, label, fieldType, options, required}` with
`fieldType` ∈ email · textarea · select · radio · checkbox · rating. `/demo`
uses this. **Never ship a mocked-up form on a live page** — the Figma frames
draw static input boxes because they are pictures; a real "Book my demo"
button that does nothing is worse than no page.

### Verifying

A screen Save republishes itself, but ISR means **the first read after a
save is reliably stale**. Read 2-3 times with `?cb=$(date +%s%N)` and only
trust agreement between reads 2 and 3. Emotion dedupes identical style
objects, so counting CSS rules undercounts elements — compare like for like.

---

# Standing hazards

- **A converter runs on PARTIAL writes.** Fixed for version docs in
  AGL-1250, but the shape recurs: `toFirestore` runs on merge payloads too,
  and any field it defaults gets written. Before adding a field-only write,
  read the ref's converter.
- **`updateNodeProps` REPLACES the props object.** Assign onto the
  observable instead (`node.props.children = …`, `node.sx.borderRadius =
  '8px'`), then confirm the canvas actually re-rendered — a write to a
  detached copy still reads back correctly from `toJSON()`.
- **`canvas.deleteNode` deletes the whole subtree** and saves history itself.
- The permission classifier intermittently blocks `canvas.*` mutations from
  the page — roughly half were denied this session, non-deterministically. A
  retry usually clears it. If it denies repeatedly, stop and ask rather than
  routing around it through the UI.
- ~~`window.AglynModule` is dev-only (`NODE_ENV !== 'production'`), so the
  production console on 4700 is **not** scriptable.~~ **Corrected 2026-08-14
  (AGL-1704): only the *alias* is dev-only.** `apps/console/constants/app-setup.tsx`
  assigns `globalThis.Aglyn` in **every** environment and mirrors it to
  `window.AglynModule` only when `!IS_PRODUCTION` — so the production console
  **is** scriptable, via `window.Aglyn`. Both names point at the same
  `IBesignerAppController`, which has **no `canvas` property**; reach the canvas
  with `window.Aglyn.getBesignerController()`.
