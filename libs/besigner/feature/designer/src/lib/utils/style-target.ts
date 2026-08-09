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

import * as Aglyn from '@aglyn/aglyn'
import isEqual from 'lodash-es/isEqual'
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
  /** Replaces the target sx wholesale (MobX action inside). */
  setSx(next: Record<string, any> | undefined): void
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
  return Aglyn.mergeNodeSx(toJS(propsSx), toJS(nodeSx)) as Record<string, any>
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
  const currentSx = isPlainRecord(current) ? toJS(current) : {}
  const propsRecord = toJS(propsSx)

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
 * The style target for a selected node — see {@link NodeStyleTarget}.
 *
 * `overrideKey` selects WHICH slice of an instance's overrides is edited;
 * it is ignored for a plain node. A falsy key falls back to the root, so a
 * caller that has not resolved a definition yet still edits something real
 * rather than writing an `undefined`-keyed slice no renderer reads.
 */
export function getNodeStyleTarget(
  node: Aglyn.NodeSchema<any> | null | undefined,
  overrideKey?: string | null,
): NodeStyleTarget {
  const isInstance =
    node?.componentId === Aglyn.REUSABLE_INSTANCE_COMPONENT_ID
  if (!node || !isInstance) {
    return {
      isInstanceOverride: false,
      overrideKey: '',
      isLeafOverride: false,
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
    }
  }
  // An instance's target is deliberately NOT composed with anything
  // (AGL-1346): an override slice starts empty and empty MEANS "whatever
  // the component does" (AGL-1338) — merging a base into the reading is
  // exactly the distinction the override badge and the Background Fill
  // control exist to keep. A `props.sx` on a definition node is shown and
  // cleared where it lives, by selecting that node inside the component.
  const key = overrideKey || Aglyn.STYLE_OVERRIDES_ROOT_KEY
  return {
    isInstanceOverride: true,
    overrideKey: key,
    isLeafOverride: key !== Aglyn.STYLE_OVERRIDES_ROOT_KEY,
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
  }
}

export default getNodeStyleTarget
