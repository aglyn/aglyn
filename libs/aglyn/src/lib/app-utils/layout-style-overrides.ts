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

import type { AglynNodeSchema, NodeId } from '../foundation'
import { NODE_ROOT_ID } from '../canvas-manager/canvas-manager'
import { mergeNodeSx } from './merge-node-sx'
import {
  REUSABLE_INSTANCE_COMPONENT_ID,
  STYLE_OVERRIDES_ROOT_KEY,
} from './reusable-component-keys'

/**
 * Per-page styling of a shared layout's elements (AGL-3286).
 *
 * A screen framed by a layout may restyle any element of that layout for
 * itself alone — a transparent nav over this page's hero, a different footer
 * background — without touching the layout's content or the other screens
 * that render inside it. It is the layout analogue of a component instance's
 * `styleOverrides` (AGL-1306): an sx-shaped record per element, merged over
 * that element's own sx with `mergeNodeSx`.
 *
 * Shape: layout id → layout node id → sx record. Keyed by layout, as
 * `layoutPropValues` is (AGL-2893), so a screen can restyle an element of any
 * layout in its chain and binding a different layout never hands these
 * records to a node that merely shares an id there.
 *
 * Keyed by the layout's OWN node ids — the ids stored in the layout version,
 * never the `layout__`/`layout2__` ids composition prefixes them with, which
 * depend on where the layout sits in a chain.
 */
export type LayoutStyleOverrides = Record<
  string,
  Record<NodeId, Record<string, unknown>>
>

/**
 * Screen-version key holding the overrides, beside `layoutPropValues`.
 * Persisted in screen version documents — never rename.
 */
export const SCREEN_LAYOUT_STYLE_OVERRIDES_KEY = 'layoutStyleOverrides'

type NormalizedNodes<N extends AglynNodeSchema> = Record<NodeId, N>

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The overrides with every empty or malformed entry dropped, or `undefined`
 * when nothing is left — so "no overrides" has exactly one spelling, and a
 * stored `{}` never reads as a change.
 */
export function normalizeLayoutStyleOverrides(
  value: unknown,
): LayoutStyleOverrides | undefined {
  if (!isPlainRecord(value)) return undefined
  const result: LayoutStyleOverrides = {}
  for (const [layoutId, perNode] of Object.entries(value)) {
    if (!layoutId || !isPlainRecord(perNode)) continue
    const nodes: Record<NodeId, Record<string, unknown>> = {}
    for (const [nodeId, sx] of Object.entries(perNode)) {
      if (!nodeId || !isPlainRecord(sx) || !Object.keys(sx).length) continue
      nodes[nodeId] = sx
    }
    if (Object.keys(nodes).length) result[layoutId] = nodes
  }
  return Object.keys(result).length ? result : undefined
}

/**
 * A screen's overrides for one layout of its chain, or `undefined` where it
 * set none. Anything that is not a map of sx records is read as none.
 */
export function layoutStyleOverridesFor(
  overrides: unknown,
  layoutId: string | null | undefined,
): Record<NodeId, Record<string, unknown>> | undefined {
  if (!layoutId || !isPlainRecord(overrides)) return undefined
  return normalizeLayoutStyleOverrides({ [layoutId]: overrides[layoutId] })?.[
    layoutId
  ]
}

/**
 * A layout's nodes with one screen's style overrides merged in.
 *
 * - A plain element takes the override over its own `sx` (`mergeNodeSx`, so
 *   breakpoint objects cascade and the `@scheme dark` slice merges key by
 *   key).
 * - A reusable-component INSTANCE placed by the layout (the site nav, most
 *   often) takes it over its root override slice instead
 *   (`styleOverrides.root`), because that is the record the component graft
 *   merges onto the element it renders — an instance's own `sx` is not.
 * - A key naming a node the layout no longer has is ignored: a layout edited
 *   after the page was styled degrades to its own styling.
 *
 * Inputs are never mutated; with nothing to apply the nodes come back by
 * identity.
 */
export function applyLayoutStyleOverrides<
  N extends AglynNodeSchema = AglynNodeSchema,
>(
  nodes: NormalizedNodes<N> | null | undefined,
  overrides: Record<NodeId, Record<string, unknown>> | null | undefined,
): NormalizedNodes<N> | undefined {
  if (!nodes) return undefined
  if (!overrides) return nodes
  let result: NormalizedNodes<N> | undefined
  for (const [nodeId, sx] of Object.entries(overrides)) {
    const node = nodes[nodeId]
    if (!node || !isPlainRecord(sx) || !Object.keys(sx).length) continue
    result ??= { ...nodes }
    if (node.componentId === REUSABLE_INSTANCE_COMPONENT_ID) {
      const slices = {
        ...((node as { styleOverrides?: Record<string, unknown> })
          .styleOverrides ?? {}),
      }
      slices[STYLE_OVERRIDES_ROOT_KEY] = mergeNodeSx(
        slices[STYLE_OVERRIDES_ROOT_KEY],
        sx,
      )
      result[nodeId] = { ...node, styleOverrides: slices }
    } else {
      result[nodeId] = { ...node, sx: mergeNodeSx(node.sx, sx) as N['sx'] }
    }
  }
  return result ?? nodes
}

/**
 * The screen's node map with its layout style overrides parked on the ROOT
 * node, for the editor.
 *
 * In the besigner the overrides ride on the canvas root rather than in React
 * state beside it, so they are part of the one document the editor already
 * tracks: an edit is an undo step, marks the screen dirty, is carried by the
 * working draft and the co-editing mirror, and is written by the same save —
 * none of which a second store would get for free. `extractLayoutStyleOverrides`
 * lifts them back out before anything is stored, so a saved `nodes` map never
 * carries them.
 */
export function injectLayoutStyleOverrides<T extends Record<string, any>>(
  nodes: T | null | undefined,
  overrides: unknown,
): T | null | undefined {
  const normalized = normalizeLayoutStyleOverrides(overrides)
  const root = nodes?.[NODE_ROOT_ID]
  if (!nodes || !root || !normalized) return nodes
  return {
    ...nodes,
    [NODE_ROOT_ID]: { ...root, layoutStyleOverrides: normalized },
  }
}

/**
 * The inverse of {@link injectLayoutStyleOverrides}: the node map with the
 * root's `layoutStyleOverrides` removed, and the overrides it held
 * (`undefined` when none). The node map comes back by identity when the root
 * carries none.
 */
export function extractLayoutStyleOverrides<T extends Record<string, any>>(
  nodes: T,
): { nodes: T; layoutStyleOverrides: LayoutStyleOverrides | undefined } {
  const root = nodes?.[NODE_ROOT_ID]
  if (!root || !('layoutStyleOverrides' in root)) {
    return { nodes, layoutStyleOverrides: undefined }
  }
  const { layoutStyleOverrides, ...rest } = root
  return {
    nodes: { ...nodes, [NODE_ROOT_ID]: rest },
    layoutStyleOverrides: normalizeLayoutStyleOverrides(layoutStyleOverrides),
  }
}

/**
 * The write that turns a stored map into `next` under a MERGING set.
 *
 * A Firestore `set(…, { merge: true })` merges nested maps key by key, so
 * writing `next` as-is could only ever ADD: an override cleared in the editor
 * would survive in the document. This names every key `previous` has and
 * `next` does not with `remove()` (the caller's `deleteField()`), recursing
 * through records both sides hold, so the merged result is exactly `next`.
 * `undefined` for `next` removes the whole field.
 */
export function replaceUnderMerge(
  previous: unknown,
  next: unknown,
  remove: () => unknown,
): unknown {
  if (next === undefined) return previous === undefined ? undefined : remove()
  if (!isPlainRecord(previous) || !isPlainRecord(next)) return next
  const write: Record<string, unknown> = {}
  for (const key of Object.keys(previous)) {
    if (!(key in next)) write[key] = remove()
  }
  for (const [key, value] of Object.entries(next)) {
    write[key] = replaceUnderMerge(previous[key], value, remove)
  }
  return write
}
