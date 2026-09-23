/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type * as Aglyn from '@aglyn/aglyn'
import {
  isPlacedFormNode,
  mergeNodeSx,
  REUSABLE_INSTANCE_COMPONENT_ID,
  STYLE_OVERRIDES_ROOT_KEY,
} from '@aglyn/aglyn'
import { expandSxAliases } from '@aglyn/shared-data-enums'
import isEqual from 'lodash-es/isEqual.js'
import { action, toJS } from 'mobx'

/**
 * Where the Styles panel's edits land for the selected node (AGL-1306,
 * AGL-1332, AGL-1346).
 *
 * A plain node's edits read and write `node.sx`, exactly as they always
 * have. A reusable-component INSTANCE's edits read and write one slice of
 * `node.styleOverrides` instead — the root slice by default, or the slice
 * keyed by a DEFINITION-internal node id when the author has picked a leaf
 * inside the component. Either way the panel behaves like it does on a
 * fresh plain node (empty until this instance overrides something), and
 * the canvas/Preview/tenant render the override merged over the matching
 * component node via `composeReusableComponentNodes`. Mutating the
 * component itself from a placing document is exactly what this layer
 * exists to avoid — a leaf target styles the instance's copy of that leaf,
 * and never unlocks the component's content, which stays the component's.
 *
 * `sx` is a GETTER so observer components track the underlying MobX state
 * at read time; a snapshot captured when the target was built would go
 * stale after the first write.
 */
export interface NodeStyleTarget {
  /**
   * The sx record edits read from and write to (live view).
   *
   * For a plain node this is the COMPOSED record — `props.sx` with
   * `node.sx` merged over it (AGL-1346) — so what the panel displays is
   * what renders. Writes are split back across the two records by
   * {@link writeComposedNodeSx}.
   */
  readonly sx: Record<string, any> | undefined
  /** True when edits land in one of the instance's override slices. */
  readonly isInstanceOverride: boolean
  /**
   * The `styleOverrides` key being edited — `root`, or a definition-internal
   * node id. Empty string for a plain node, which has no override layer.
   */
  readonly overrideKey: string
  /** True when the target is a leaf inside the component, not its root. */
  readonly isLeafOverride: boolean
  /**
   * True when `sx` above is a COMPOSITION of two stored records rather than
   * one — a plain node that carries both a `props.sx` and a `node.sx`
   * (AGL-3218).
   *
   * The panel needs this to say so. Everything about the split is correct
   * and invisible while you stay in the UI, and misleading the moment you
   * leave it: the stored node does not contain the document the editor
   * shows, and a reader who opens `props.sx` alone — a Raw JSON pane, an
   * export, a script auditing the corpus — sees an edit that looks like it
   * never landed.
   */
  readonly isComposed: boolean
  /**
   * True when edits land in the screen's per-page restyling of one of its
   * shared layout's elements (AGL-3286) — see {@link getLayoutStyleTarget}.
   * Such a target also reports `isInstanceOverride`, because it behaves as
   * one: it starts empty, and empty means "the layout's own look".
   */
  readonly isLayoutOverride?: boolean
  /** Replaces the target sx wholesale (MobX action inside). */
  setSx(next: Record<string, any> | undefined): void
  /**
   * Removes every style change a placement carries, on every part — the
   * "Reset all" of AGL-3288. Does nothing on a plain node, whose sx is its
   * own and has nothing to reset to (MobX action inside).
   */
  clearAll(): void
}

const isPlainRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A node's `props.sx` — the SECOND sx record every node can carry
 * (AGL-1346).
 *
 * `Leaf` composes `mergeSxProps(sx, props.sx, node.sx)` and MUI's array
 * form lets later entries win, so `node.sx` shadows `props.sx` key by key
 * — but only the keys it names. Everything `props.sx` sets and `node.sx`
 * does not is rendering, unshadowed, and until this issue no panel could
 * see it: the Styles panel read `node.sx` alone and reported "Margin:
 * default on all four edges" over a `marginInline: auto` that was
 * genuinely in the layout. Presets authored the record (`props: { sx: … }`)
 * and nothing could unauthor it.
 *
 * Returned as a live read, undefined when the node carries no such record
 * or carries a non-record one (an array/callback sx composes but does not
 * merge).
 */
function nodePropsSx(
  node: Aglyn.NodeSchema<any> | null | undefined,
): Record<string, any> | undefined {
  const value = (node?.props as Record<string, any> | undefined)?.['sx']
  return isPlainRecord(value) ? value : undefined
}

/**
 * What the panel SHOWS for a plain node: `props.sx` with `node.sx` merged
 * over it — the same precedence the renderer applies, so the displayed
 * value is the effective one (AGL-1346).
 *
 * `mergeNodeSx` is the house merge (AGL-1306): responsive breakpoint
 * objects cascade mobile-first, `@scheme dark` and nested selector blocks
 * merge key by key, plain properties replace. Reusing it is what keeps the
 * panel's reading of a shadowed value identical to the graft's.
 *
 * A node with no `props.sx` — every node but the ones presets touched —
 * gets `node.sx` back BY IDENTITY, so nothing downstream re-renders or
 * re-computes because this function exists.
 */
function composedNodeSx(
  node: Aglyn.NodeSchema<any> | null | undefined,
): Record<string, any> | undefined {
  const nodeSx = node?.sx as Record<string, any> | undefined
  const propsSx = nodePropsSx(node)
  if (!propsSx) return nodeSx
  if (nodeSx !== undefined && !isPlainRecord(nodeSx)) return nodeSx
  return mergeNodeSx(toJS(propsSx), toJS(nodeSx)) as Record<string, any>
}

/**
 * Splits the panel's write back across the two records (AGL-1346).
 *
 * The panel hands us the whole intended sx — it always builds `next` from
 * `target.sx`, which is now the COMPOSED record — so a naive
 * `node.sx = next` would copy every `props.sx` key up into `node.sx` on the
 * first unrelated edit. That is the migration this issue explicitly does
 * NOT want: the mega-menu panels keep their entire positioning
 * (`position: absolute`, `top: 100%`, `zIndex: 1300`, `bgcolor`, `p`,
 * `marginInline`) in `props.sx`, and re-emitting those declarations from a
 * later slot changes shorthand/longhand resolution order. So the write is a
 * DIFF against the composed baseline:
 *
 * - a key already in `node.sx` keeps its position there and takes the new
 *   value (or goes, if the author cleared it);
 * - a key whose new value is what `props.sx` already says is NOT copied up
 *   — nothing changed, so nothing is written;
 * - a key the author genuinely changed is appended to `node.sx`, where it
 *   wins exactly as the Styles panel's output has always won;
 * - a key the author CLEARED is deleted from `props.sx` as well, which is
 *   the half that makes the panel able to unauthor what a preset wrote.
 *
 * That last rule is why this edits `props.sx` in place rather than writing
 * a neutralising override: there is no value that reliably means "no
 * declaration" across sx keys — `unset`/`revert` are cascade keywords with
 * their own meaning, and system props (`p`, `bgcolor`, `zIndex`) run
 * through theme transforms first. Deleting the key is exact, and it is the
 * only record involved when nothing shadows it.
 *
 * The invariant that makes this safe on 8,000 authored nodes: writing back
 * an UNCHANGED composed record leaves both stored records byte-identical,
 * key order included. Only a key the author actually touched moves.
 */
function writeComposedNodeSx(
  node: Aglyn.NodeSchema<any>,
  next: Record<string, any> | undefined,
): void {
  const propsSx = nodePropsSx(node)
  const current = node.sx as Record<string, any> | undefined
  if (!propsSx || (current !== undefined && !isPlainRecord(current))) {
    // No second record to reconcile (or an sx form that composes rather
    // than merges): the write is what it always was.
    node.sx = (next ?? {}) as any
    return
  }
  const nextSx = (next ?? {}) as Record<string, any>
  // Both stored records are read in the panel's spelling (AGL-2207). The
  // composed baseline the panel edits comes through `mergeNodeSx`, which
  // canonicalizes MUI's system-prop aliases, so diffing against the RAW
  // records would read every `p`/`bgcolor` as a key the author had just
  // cleared and migrate the positioning on the first unrelated edit — the
  // exact thing this function exists to prevent. Expanded, the byte-
  // identical invariant holds; `props.sx` is only ever REWRITTEN below,
  // when the author genuinely cleared one of its values.
  const currentSx = expandSxAliases(
    isPlainRecord(current) ? toJS(current) : {},
    { deep: true },
  )
  const propsRecord = expandSxAliases(toJS(propsSx), { deep: true })

  const sx: Record<string, any> = {}
  for (const key of Object.keys(currentSx)) {
    if (key in nextSx) sx[key] = nextSx[key]
  }
  for (const [key, value] of Object.entries(nextSx)) {
    if (key in sx) continue
    if (key in propsRecord && isEqual(propsRecord[key], value)) continue
    sx[key] = value
  }
  node.sx = sx as any

  const cleared = Object.keys(propsRecord).filter((key) => !(key in nextSx))
  if (!cleared.length) return
  const remaining = { ...propsRecord }
  for (const key of cleared) delete remaining[key]
  // Assigned as a fresh props object rather than mutated in place: the
  // Attributes form reads `node.props` as its initial values, and a
  // replaced reference is the signal it re-reads on (`updateNodeProps`
  // replaces it too, for the same reason). Not routed through
  // `updateNodeProps`, though — that records its own history entry, and
  // this write is already inside the panel's coalesced `transact` step.
  const props = { ...(toJS(node.props) as Record<string, any>) }
  if (Object.keys(remaining).length) props['sx'] = remaining
  else delete props['sx']
  node.props = props as any
}

/**
 * Options for {@link getNodeStyleTarget} and {@link getNodeAttrTarget}.
 */
export interface PlacementTargetOptions {
  /**
   * True when the selected node is a placed form whose form design RESOLVES
   * — the graft will replace its fields with the form's own, so the page
   * styles them through override slices (AGL-3285).
   *
   * Asked of the caller because only it holds the form designs. A placed
   * form whose design is missing or unpublished renders the fields drawn on
   * the page, exactly as authored, and an override slice there would save
   * and never render; such a form stays a plain node. Ignored for a
   * reusable-component instance, which has no other layer to write.
   */
  placedFormResolves?: boolean
}

/**
 * Whether the selected node's style/attribute edits land in its override
 * slices — an instance always, a placed form only when its design resolves
 * (see {@link PlacementTargetOptions}).
 */
export function isOverridePlacement(
  node: Aglyn.NodeSchema<any> | null | undefined,
  options?: PlacementTargetOptions,
): boolean {
  if (node?.componentId === REUSABLE_INSTANCE_COMPONENT_ID) return true
  return Boolean(options?.placedFormResolves) && isPlacedFormNode(node)
}

/**
 * The style target for a selected node — see {@link NodeStyleTarget}.
 *
 * `overrideKey` selects WHICH slice of a placement's overrides is edited;
 * it is ignored for a plain node. A falsy key falls back to the root, so a
 * caller that has not resolved a definition yet still edits something real
 * rather than writing an `undefined`-keyed slice no renderer reads.
 *
 * A placed form is a placement exactly like an instance (AGL-3285), once the
 * caller says its design resolves — see {@link PlacementTargetOptions}.
 */
export function getNodeStyleTarget(
  node: Aglyn.NodeSchema<any> | null | undefined,
  overrideKey?: string | null,
  options?: PlacementTargetOptions,
): NodeStyleTarget {
  if (!node || !isOverridePlacement(node, options)) {
    return {
      isInstanceOverride: false,
      overrideKey: '',
      isLeafOverride: false,
      get isComposed() {
        return nodePropsSx(node) !== undefined
      },
      get sx() {
        // The COMPOSED record, not `node.sx` alone (AGL-1346) — see
        // `composedNodeSx`. Identity is preserved when the node has no
        // `props.sx`, which is every node but the handful presets touched.
        return composedNodeSx(node)
      },
      setSx: action((next: Record<string, any> | undefined) => {
        if (!node) return
        writeComposedNodeSx(node, next)
      }),
      clearAll: () => undefined,
    }
  }
  // An instance's target is deliberately NOT composed with anything
  // (AGL-1346): an override slice starts empty and empty MEANS "whatever
  // the component does" (AGL-1338) — merging a base into the reading is
  // exactly the distinction the override badge and the Background Fill
  // control exist to keep. A `props.sx` on a definition node is shown and
  // cleared where it lives, by selecting that node inside the component.
  const key = overrideKey || STYLE_OVERRIDES_ROOT_KEY
  return {
    isInstanceOverride: true,
    overrideKey: key,
    isLeafOverride: key !== STYLE_OVERRIDES_ROOT_KEY,
    // An override slice is read uncomposed (see below), so what the editor
    // shows IS the stored record and there is nothing to disclose.
    isComposed: false,
    get sx() {
      return (node.styleOverrides as Record<string, any> | undefined)?.[key]
    },
    setSx: action((next: Record<string, any> | undefined) => {
      const overrides: Record<string, any> = {
        ...toJS(node.styleOverrides ?? {}),
      }
      if (next && Object.keys(next).length > 0) {
        overrides[key] = next
      } else {
        // An emptied override is REMOVED, not stored as `{}`: the panel's
        // override badge and the graft's "has an override" check must both
        // read a cleared instance as clean. Only THIS slice goes — the
        // instance's other targets keep theirs.
        delete overrides[key]
      }
      node.styleOverrides =
        Object.keys(overrides).length > 0 ? overrides : undefined
    }),
    clearAll: action(() => {
      if (node.styleOverrides !== undefined) node.styleOverrides = undefined
    }),
  }
}

/**
 * The style target for one element of the screen's shared LAYOUT (AGL-3286).
 *
 * The layout's elements are locked on a screen — its content belongs to the
 * layout — but a page may restyle them for itself: a transparent nav over
 * this page's hero. The edits land in the screen's `layoutStyleOverrides`,
 * layout id → layout node id → sx, which the editor parks on the screen
 * canvas ROOT (`injectLayoutStyleOverrides`) so an edit is an ordinary,
 * undoable, draft-carried change to the screen. Composition merges the slice
 * over the layout element on every surface.
 *
 * Reported as an instance override because it behaves as one: the slice is
 * read uncomposed, it starts empty, and empty means the layout's own styling
 * — so the per-property override chips and their clear apply unchanged.
 */
export function getLayoutStyleTarget(
  screenRoot: Aglyn.NodeSchema<any> | null | undefined,
  layoutId: string,
  layoutNodeId: string,
): NodeStyleTarget {
  return {
    isInstanceOverride: true,
    isLayoutOverride: true,
    overrideKey: layoutNodeId,
    isLeafOverride: false,
    isComposed: false,
    get sx() {
      return screenRoot?.layoutStyleOverrides?.[layoutId]?.[layoutNodeId] as
        | Record<string, any>
        | undefined
    },
    setSx: action((next: Record<string, any> | undefined) => {
      if (!screenRoot) return
      const all: Record<string, Record<string, Record<string, unknown>>> = {
        ...toJS(screenRoot.layoutStyleOverrides ?? {}),
      }
      const perNode = { ...(all[layoutId] ?? {}) }
      // Emptied slices are REMOVED at both levels, for the reason an
      // instance's are: "no override" must read the same everywhere, and a
      // stored `{}` would keep the screen dirty over nothing.
      if (next && Object.keys(next).length > 0) perNode[layoutNodeId] = next
      else delete perNode[layoutNodeId]
      if (Object.keys(perNode).length > 0) all[layoutId] = perNode
      else delete all[layoutId]
      screenRoot.layoutStyleOverrides =
        Object.keys(all).length > 0 ? all : undefined
    }),
    // "Reset all" (AGL-3288) on a layout element clears every element of
    // THIS layout the page restyles — the same scope the "N changes on this
    // page" line counts ({@link countLayoutStyleChanges}). Other layouts in
    // the chain keep theirs.
    clearAll: action(() => {
      if (!screenRoot?.layoutStyleOverrides?.[layoutId]) return
      const all = { ...toJS(screenRoot.layoutStyleOverrides) }
      delete all[layoutId]
      screenRoot.layoutStyleOverrides =
        Object.keys(all).length > 0 ? all : undefined
    }),
  }
}

/**
 * How many style settings a page changes on one of its shared layout's
 * elements, across every element of that layout (AGL-3286, AGL-3288) — the
 * count behind the layout's "N changes on this page" line, and the scope of
 * its "Reset all".
 */
export function countLayoutStyleChanges(
  screenRoot: { layoutStyleOverrides?: unknown } | null | undefined,
  layoutId: string,
): number {
  const perLayout = screenRoot?.layoutStyleOverrides
  if (!isPlainRecord(perLayout)) return 0
  const perNode = perLayout[layoutId]
  if (!isPlainRecord(perNode)) return 0
  let count = 0
  for (const slice of Object.values(perNode)) {
    if (isPlainRecord(slice)) count += Object.keys(slice).length
  }
  return count
}

/**
 * How many style settings a placement changes across all of its parts — the
 * count the "N changes on this page" line reads (AGL-3288).
 */
export function countStyleChanges(
  node: { styleOverrides?: unknown } | null | undefined,
): number {
  const overrides = node?.styleOverrides
  if (!isPlainRecord(overrides)) return 0
  let count = 0
  for (const slice of Object.values(overrides)) {
    if (isPlainRecord(slice)) count += Object.keys(slice).length
  }
  return count
}

export default getNodeStyleTarget
