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

/** Persisted component id of the layout content outlet (plugins-mui). */
export const LAYOUT_SLOT_COMPONENT_ID = 'layoutSlot'

/**
 * Prefix applied to layout node ids during composition so they can never
 * collide with screen node ids (layout ids repeat across every bound
 * screen).
 */
export const LAYOUT_NODE_ID_PREFIX = 'layout__'

/**
 * How many layouts deep a chain may nest (AGL-703).
 *
 * A layout can render inside another layout, so the chain is walked rather
 * than read once. This bounds it: a cycle is already refused at both write
 * time and resolution time, and this is the belt to that pair of braces —
 * a hand-edited document must not be able to hang a render.
 */
export const MAX_LAYOUT_CHAIN_DEPTH = 5

/**
 * Namespace for one level of the layout chain (AGL-703).
 *
 * Depth 1 — the layout a screen names directly — keeps the original
 * `layout__` exactly. Every interaction authored before nesting existed
 * stores raw canvas ids that {@link normalizeLeafId} matches against this
 * prefix, so changing it would silently break them. Outer levels take
 * `layout2__`, `layout3__`, … which is what keeps a grandparent layout's
 * node ids from colliding with its child's: without a per-level namespace,
 * two layouts in one chain sharing a node id would collapse into one node.
 */
export function layoutNodeIdPrefix(depth = 1): string {
  return depth <= 1 ? LAYOUT_NODE_ID_PREFIX : `layout${depth}__`
}

/** Every namespace a composed tree can carry, outermost depth first. */
export const LAYOUT_NODE_ID_PREFIXES = Array.from(
  { length: MAX_LAYOUT_CHAIN_DEPTH },
  (_unused, index) => layoutNodeIdPrefix(index + 1),
)

type NormalizedNodes<N extends AglynNodeSchema> = Record<NodeId, N>

function prefixLayoutId(id: NodeId, prefix: string): NodeId {
  return id === NODE_ROOT_ID ? id : `${prefix}${id}`
}

function prefixChildIds(nodes: AglynNodeSchema['nodes'], prefix: string) {
  if (!Array.isArray(nodes)) return nodes
  return (nodes as NodeId[]).map((id) =>
    typeof id === 'string' ? prefixLayoutId(id, prefix) : id,
  )
}

/**
 * Grafts a screen's nodes into its layout's LayoutSlot, producing one
 * normalized node map rooted at the layout root.
 *
 * - Layout node ids are namespaced with {@link LAYOUT_NODE_ID_PREFIX} (the
 *   root id excepted) to avoid collisions with screen ids.
 * - The screen root's children are appended to the slot's own children and
 *   repointed at the slot. Slot children shouldn't normally exist, but
 *   designers do land chrome inside the slot — rendering it above the
 *   screen content preserves their intent instead of silently dropping it.
 * - Inputs are never mutated. Without layout nodes — or when the layout has
 *   no slot — the screen nodes are returned unchanged so a stale or broken
 *   layout can't take a published screen down.
 */
export function composeLayoutAndScreenNodes<
  N extends AglynNodeSchema = AglynNodeSchema,
>(
  layoutNodes: NormalizedNodes<N> | undefined,
  screenNodes: NormalizedNodes<N>,
  /** Position in the layout chain; 1 = the layout the screen names. */
  depth = 1,
): NormalizedNodes<N> {
  if (!layoutNodes || !layoutNodes[NODE_ROOT_ID]) return screenNodes

  const slotEntry = Object.entries(layoutNodes).find(
    ([, node]) => node?.componentId === LAYOUT_SLOT_COMPONENT_ID,
  )
  if (!slotEntry) return screenNodes

  const prefix = layoutNodeIdPrefix(depth)
  const composed: NormalizedNodes<N> = {}

  for (const [id, node] of Object.entries(layoutNodes)) {
    const nextId = prefixLayoutId(id, prefix)
    composed[nextId] = {
      ...node,
      // Early seeds stored roots without $id or componentId, letting the
      // canvas assign fallbacks — trust the map key so root identity stays
      // canonical, and pin the root to a plain container so production
      // renderers (which have no canvas defaults) can resolve it.
      $id:
        id === NODE_ROOT_ID
          ? NODE_ROOT_ID
          : prefixLayoutId(node.$id ?? id, prefix),
      ...(id === NODE_ROOT_ID &&
        !node.componentId && { componentId: 'div' as N['componentId'] }),
      ...(node.parentId != null && {
        parentId: prefixLayoutId(node.parentId, prefix),
      }),
      ...(node.nodes != null && { nodes: prefixChildIds(node.nodes, prefix) }),
    }
  }

  const slotId = prefixLayoutId(slotEntry[0], prefix)
  const screenRoot = screenNodes[NODE_ROOT_ID]
  const screenRootChildIds = Array.isArray(screenRoot?.nodes)
    ? ([...screenRoot.nodes] as NodeId[])
    : []
  const slotChildIds = Array.isArray(composed[slotId]?.nodes)
    ? (composed[slotId].nodes as NodeId[])
    : []

  composed[slotId] = {
    ...composed[slotId],
    nodes: [...slotChildIds, ...screenRootChildIds],
  }

  for (const [id, node] of Object.entries(screenNodes)) {
    if (id === NODE_ROOT_ID) continue
    const isTopLevel = node?.parentId === NODE_ROOT_ID
    composed[id] = isTopLevel ? { ...node, parentId: slotId } : node
  }
  // Top-level screen nodes may rely on child arrays alone (no parentId).
  for (const childId of screenRootChildIds) {
    const node = composed[childId]
    if (node && node.parentId !== slotId) {
      composed[childId] = { ...node, parentId: slotId }
    }
  }

  return composed
}

/**
 * Grafts a screen through a CHAIN of layouts, innermost first (AGL-703).
 *
 * `layoutNodesChain[0]` is the layout the screen names, `[1]` is that
 * layout's own layout, and so on outward. Each step drops the previous
 * result into the next layout's slot, so the outermost layout ends up as
 * the root — the same relationship a screen has always had with its layout,
 * applied one more time.
 *
 * A layout with no slot is skipped rather than fatal, and skipping it does
 * not strand the layouts outside it: the accumulated tree simply passes
 * through. That matches the single-layout behaviour, where a broken layout
 * degrades to the bare screen instead of taking a published page down.
 *
 * Cycles are refused before this point (see `resolveLayoutChainIds`), and
 * the chain is capped at {@link MAX_LAYOUT_CHAIN_DEPTH} regardless.
 */
export function composeLayoutChainAndScreenNodes<
  N extends AglynNodeSchema = AglynNodeSchema,
>(
  layoutNodesChain: Array<NormalizedNodes<N> | undefined>,
  screenNodes: NormalizedNodes<N>,
): NormalizedNodes<N> {
  let composed = screenNodes
  const chain = layoutNodesChain.slice(0, MAX_LAYOUT_CHAIN_DEPTH)
  for (const [index, layoutNodes] of chain.entries()) {
    composed = composeLayoutAndScreenNodes(layoutNodes, composed, index + 1)
  }
  return composed
}

/**
 * Walks a layout's ancestry into a flat chain, innermost first (AGL-703).
 *
 * `parentOf` returns the layout a given layout renders inside, or undefined
 * at the top. The walk stops on:
 *
 * - **self-reference** — a layout naming itself, which is the case worth
 *   naming out loud because it is the easy mistake to make;
 * - **any repeat** — A → B → A would otherwise recurse forever, and a
 *   guard that only catches self-reference would miss it;
 * - **depth** — {@link MAX_LAYOUT_CHAIN_DEPTH}.
 *
 * Stopping (rather than throwing) is deliberate: a cycle in stored data
 * should render the layouts up to the repeat, not blank the site.
 */
export function resolveLayoutChainIds(
  layoutId: string | undefined | null,
  parentOf: (layoutId: string) => string | undefined | null,
): string[] {
  const chain: string[] = []
  const seen = new Set<string>()
  let current = layoutId ? String(layoutId) : undefined
  while (current && !seen.has(current) && chain.length < MAX_LAYOUT_CHAIN_DEPTH) {
    chain.push(current)
    seen.add(current)
    const parent = parentOf(current)
    current = parent ? String(parent) : undefined
  }
  return chain
}

/**
 * Whether `candidateParentId` may be set as `layoutId`'s parent layout.
 *
 * Refuses self-reference and any candidate that already has this layout
 * somewhere above it — picking one would close a loop. This is the
 * write-time half; `resolveLayoutChainIds` stays defensive anyway, because
 * a document can be edited by something that never called this.
 */
export function canNestLayout(
  layoutId: string,
  candidateParentId: string,
  parentOf: (layoutId: string) => string | undefined | null,
): boolean {
  if (!layoutId || !candidateParentId) return false
  if (layoutId === candidateParentId) return false
  return !resolveLayoutChainIds(candidateParentId, parentOf).includes(layoutId)
}

export default composeLayoutAndScreenNodes
