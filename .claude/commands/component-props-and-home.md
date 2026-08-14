---
description: "STALE 2026-08-04 session handoff — its canvas-scripting recipes are wrong (no AglynModule.canvas) and its 'done this session' list has moved. AGL-1247 is still open. Use /handoff."
---

> ⚠️ **CORRECTED 2026-08-14 (AGL-1704).** This is a point-in-time session handoff
> written 2026-08-04. For the current promotion flow and working agreements, read
> `.claude/commands/handoff.md`. Two corrections:
>
> - **There is no `window.AglynModule.canvas`.** `apps/console/constants/app-setup.tsx`
>   sets `window.Aglyn` to an `IBesignerAppController` and aliases `AglynModule` to
>   that **same object** in non-production only. That interface has **no `canvas`
>   property**, so the transfer recipe below cannot work as written. Use
>   `const c = window.Aglyn.getBesignerController()`.
> - **The "Done this session" list has moved.** Verified 2026-08-14: AGL-1243 and
>   AGL-1235 are Done; AGL-1246 and AGL-1245 are In Review. **AGL-1247**
>   (parameterised reusable components — Thread 1) is **still open**, so Thread 1's
>   argument still holds; re-read the issue rather than this file.

Two threads, in this order. **Thread 1 is the one Zach asked for and it is
the more valuable of the two** — it removes the reason Thread 2 is expensive.

Coordinates: org `aglyn-org` (`jWmGooWE3L`) · host `aglyn-marketing`
(`DXnRbPH4CQ`) · live `https://aglyn-marketing.aglyn.app` · Figma
`UsUolmsFgfymhaKMLBZvzo`. Console dev server on **4200** (another session may
own it — reuse theirs rather than starting a second).

Linear: In Progress on start, In Review when it lands, Done once verified in
production. One conventional commit per AGL-###, `git commit --only <paths>`,
**never `git add -A`** — a concurrent session auto-stages files, and a `git
push` after a failed commit publishes THEIRS too. Never `git stash`.

---

# Thread 1 — parameterised reusable components (Zach's ask, 2026-08-04)

> "We have this hero section on numerous pages but we are recreating it every
> single time only because the image and text changes. What if we support
> variables that use attributes from the attribute panels and placeholders in
> the component — so when we place it on the screen it shows the placeholder
> from the component, and in the attribute panel it will have the text and the
> image for that instance. That way when we update the hero (font size, say)
> it is adopted across all pages that use the component, and we don't have to
> fix so many pages one by one."

**The problem is real and measured.** Today the ten `/product*` pages plus
`/pricing` each carry their own *copy* of the hero and CTA subtrees. Changing
one shared value means editing eleven documents. This session hit exactly that:
the CTA band on all eleven pages carries copy from an **archived** Home D
concept, and correcting it is now eleven manual edits.

## Start by answering the load-bearing question

**Does placing a reusable component COPY its subtree into the screen, or does
the screen hold a reference that resolves at render?** Everything else follows
from this and it was NOT resolved before context ran out.

Evidence gathered so far, none of it conclusive:

- `canvas.addNodeFromPreset` → `addNodeFromNested` → `createDuplicateNode`,
  which regenerates ids. So *presets* are unambiguously copies.
- `grep` for `componentRef|componentInstance|COMPONENT_INSTANCE|
  isComponentInstance|sourceComponentId|componentVersionId` across
  `libs/aglyn/src` and `libs/besigner` returned **nothing** — which points at
  copy semantics, but absence of those names is not proof.
- AGL-1218 ("layout chrome renders reusable components as placeholders on the
  besigner canvas") implies there IS some by-reference rendering path for
  components inside layout chrome. Read that issue and the code it touches
  first — it is the closest thing to a reference model that exists.
- `reusableComponents` is a **plan entitlement**
  (`libs/aglyn/src/lib/app-utils/plan-entitlements.ts:85` etc.), so the feature
  is already gated and priced. Free is `false`; every paid tier is `true`.

If instances are copies, Thread 1 is a genuine new capability, not a tweak.

## The machinery that already exists — extend it, do not rebuild it

Per the standing rule (grep `libs/` first, widen the shared util):

- **A binding/token system.** `Aglyn.hasBindings(value)`,
  `Aglyn.resolveBindings(value, variables, functions)`, and
  `Aglyn.displayBindingTokens(...)` are already used by `NodeLeaf`
  (`libs/besigner/feature/designer/src/lib/components/node-leaf.tsx`) to
  resolve tokens live on a *rendered copy* while selection and dnd keep the
  original node. Bound nodes get `data-aglyn-bound`. There is a
  `resolveBindings` besigner flag that toggles between resolved values and
  friendly token text — that toggle is precisely the "show the placeholder"
  behaviour Zach describes.
- **`BindingPickerContext`** supplies `{variables, functions}` to that
  resolution. A component's declared props would become another scope feeding
  the same context.
- **The Attributes panel** — `element-props-form.component.tsx`. Instance
  overrides should surface here, which is exactly where Zach expects them.
- **Component storage** — `components/{id}/versions/{versionId}` (msgpack).

## Suggested shape (validate before building)

1. A component version gains a **declared prop schema**: name, type
   (`text` | `richText` | `image` | `href` | `number` | `boolean`), a
   **placeholder/default**, and the node+prop path(s) it drives.
2. Inside the component, authors bind a node prop to a declared prop with the
   existing token syntax rather than a new one.
3. Placing the component yields an instance node holding `{componentId,
   componentVersionId, props: {...overrides}}` — **no copied subtree**.
4. `NodeLeaf` resolves the instance by rendering the component's subtree with
   the declared props as an extra binding scope, reusing the existing
   `resolveBindings` path. Unset props fall back to the placeholder, so the
   canvas shows the component's own placeholder exactly as Zach asked.
5. The Attributes panel renders one field per declared prop (image props open
   the DAM picker).
6. Updating and republishing the component propagates to every instance.

**Migration matters more than the feature.** Existing pages hold copies. There
needs to be a path from "eleven copied heroes" to "eleven instances", or the
feature ships without fixing the problem that motivated it. Consider a
"convert this subtree to a component instance" action that diffs a subtree
against a component version and lifts the differences into props.

### Hazards that will bite

- **A component SAVE is not a publish.** Save writes
  `components/{id}/versions/{versionId}`; the tenant reads the **parent** doc.
  Only **FILE ▸ Publish again** copies onto it. A screen save republishes
  itself; a component save does not.
- `updateNodeProps` **replaces** the props object — it does not merge, which is
  how AGL-1227 stripped every heading's `component`. Assign onto the observable
  (`node.props.children = …`) instead.
- `canvas.deleteNode` deletes the whole **subtree**, and saves history itself.
- `window.AglynModule` is a **dev-only alias** (gated on `!IS_PRODUCTION`) of
  `window.Aglyn`, which is set in every environment. Neither has a `canvas` —
  reach it with `window.Aglyn.getBesignerController()`. `canvas.nodes` is a MobX
  `ObservableMap`, and a `for...in` over props misses nested observables — use
  `node.toJSON()`.

Related: AGL-1218, AGL-1235 (needs an inline-text container — `muiTypography`
is `textEditable`, therefore a leaf, so no span fits inside it).

---

# Thread 2 — AGL-1245, the blank marketing site

**Rule from Zach: always reference the design, and NOTHING on the 🗄 Archive
page is a valid reference.** The Figma MCP only enumerates two pages (Archive,
UI Kit) out of thirteen, so frame ids must come from Zach or from the current
selection — `get_metadata` prepends a "Currently selected nodes" block.

## Done this session

- **`/pricing` built and LIVE** (screen `v0clP6xQl-`/`9O5RKr4P9g`, 1 → 128
  nodes) against frame `77:38`: hero, four plan cards (Free $0 / Starter $25 /
  Pro $56 dark+POPULAR / Business $139) with the frame's exact six feature rows
  each, and a CTA. Verified past ISR: 3 sections, 238 KB → 328 KB.
- **`/` demo storefront REPLACED** (screen `AGSSMcO-Xc`/`iwP-3G8PTb`, 41
  nodes, saved) with the first three **Home C — Editorial Bento** (`36:844`)
  sections: Hero (`36:867`), How it works (`38:37`), CTA (`39:45`).
- **AGL-1246 shipped** — an empty screen inside a layout now gets a real drop
  target (`41746efc0`).

## Next, in order

1. **Confirm `/` actually publishes.** Its version reads `INITIAL VERSION`
   with `UNPUBLISH` greyed out, so the save may not have reached the tenant the
   way `/pricing` did. Verify with `curl` + `?cb=` — and read it **twice**, the
   first read after a save is reliably stale.
2. **Finish Home C**: Statement (`37:37`), **Bento** (`37:39` — the only
   genuinely new construction: an 800px tile plus two stat tiles, then a
   three-tile row), Included (`38:57`), Quote (`39:37`).
3. **Fix the archived-Home-D CTA on eleven pages.** `/product`, the nine
   `/product/*` details and `/pricing` all read *"Your next site starts on a
   blank canvas."* / *"Design it in Besigner, publish in a click…"* — that is
   Home D, which is archived. Home C's CTA is *"Start with a blank canvas."*
   with eyebrow `THE VISUAL WEB PLATFORM` and lede *"Design, ship, and run your
   entire web presence from one place — free to start."* `/` is already
   correct. **If Thread 1 lands first, this is one edit instead of eleven** —
   which is the argument for doing Thread 1 first.
4. `/demo` (an active CTA on all ten product pages points at it), `/legal/*`
   (content exists verbatim in Drive), then solutions/use-cases/blog/company.
5. `Home G — Dark Open Source` is the source for `/developers-home`, NOT the
   archived `Home F`.

## The technique that made `/pricing` cheap — reuse it

Transfer whole subtrees between screens without pulling JSON through context:

```js
// on the SOURCE screen's besigner
// CORRECTED 2026-08-14: was `window.AglynModule.canvas`, which does not exist.
const c = window.Aglyn.getBesignerController()
localStorage.setItem('__xfer', JSON.stringify(
  JSON.parse(JSON.stringify(c.makeNested(c.getNode(SECTION_ID))))))
// then navigate to the TARGET screen's besigner
c.addNodeFromNested(JSON.parse(localStorage.getItem('__xfer')), c.getNode('_@_'))
```

`addNodeFromNested`'s own docstring says the source "can be anything — an
element preset, the besigner clipboard, or a subtree copied out of a different
document altogether", and it regenerates ids. This inherits the already
design-corrected treatment **and** the AGL-1243 responsive type ramp for free.

Gotchas met while doing it: `sx` is a **sibling** of `props`, not inside it;
two `/product` plan cards carry an **empty spacer row** as their first feature
row (it threw a naive pour partway); and a cloned CTA shell arrives with the
gradient `backgroundImage` and `common.white` type, which is invisible on a
light page.

Besigner URLs need the version: `/screens/{screenId}/versions/{versionId}/
besigner`. The version id is on the screens-list link if you do not have it.
