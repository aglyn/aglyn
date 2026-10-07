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

/**
 * A layout at least as tall as the window (AGL-3596).
 *
 * A layout is header, page, footer, top to bottom, and on a page shorter than
 * the window the footer used to end wherever the page did — on beta.230 a
 * contact page left its footer floating halfway up the screen with blank page
 * under it. So every layout the AI builds is written as one column at least
 * the window's height, and the part of it that holds the Layout Slot takes
 * the room left over: the footer sits at the bottom of a short page and
 * follows the content of a long one.
 *
 * Written by the platform after the model answers and before the doctrine
 * checks the tree, so the doctrine holds the column like anything else: it is
 * a Stack with a style of its own, which no rule calls an empty wrapper.
 */

/** The id of the column the platform adds, when no node of the tree has it. */
export const AI_LAYOUT_FRAME_ID = 'aiLayoutFrame'

type RawNode = { componentId?: unknown; props?: Record<string, unknown>; sx?: Record<string, unknown>; nodes?: unknown }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const childrenOf = (node: RawNode | undefined): string[] =>
  Array.isArray(node?.nodes) ? (node.nodes as unknown[]).filter((id): id is string => typeof id === 'string') : []

/**
 * The layout with its root's children in a column at least the window's
 * height, and the child that holds the Layout Slot growing into the room
 * left. A tree whose top already sets a minimum height is left as it came,
 * and so is anything that is not a node map or holds no Layout Slot.
 */
export function aiLayoutWithFullHeight(tree: unknown): unknown {
  if (!isRecord(tree) || !isRecord(tree['nodes'])) return tree
  const source = tree['nodes'] as Record<string, RawNode>
  const rootId = typeof tree['rootId'] === 'string' ? tree['rootId'] : null
  if (!rootId || !isRecord(source[rootId])) return tree
  const top = childrenOf(source[rootId]).filter((id) => isRecord(source[id]))
  if (!top.length) return tree
  if (top.length === 1 && source[top[0]].sx?.['minHeight'] !== undefined) return tree

  const holdsSlot = (id: string, seen = new Set<string>()): boolean => {
    if (seen.has(id) || !isRecord(source[id])) return false
    seen.add(id)
    return source[id].componentId === 'layoutSlot' || childrenOf(source[id]).some((child) => holdsSlot(child, seen))
  }
  const grower = top.find((id) => holdsSlot(id))
  if (!grower) return tree

  let frameId = AI_LAYOUT_FRAME_ID
  for (let n = 2; frameId in source; n += 1) frameId = `${AI_LAYOUT_FRAME_ID}${n}`
  const nodes: Record<string, RawNode> = {
    ...source,
    [rootId]: { ...source[rootId], nodes: [frameId] },
    [frameId]: { componentId: 'muiStack', sx: { minHeight: '100vh' }, nodes: top },
    [grower]: { ...source[grower], sx: { ...(source[grower].sx ?? {}), flexGrow: 1 } },
  }
  return { ...tree, nodes }
}
