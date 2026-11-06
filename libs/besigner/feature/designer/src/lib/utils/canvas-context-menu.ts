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

import { observable, runInAction } from 'mobx'

/**
 * Right-click on the canvas opens the element's ⋮ menu (AGL-1405).
 *
 * The hierarchy row can open its own menu directly — the row and the menu are
 * the same component. The canvas cannot: the menu is rendered by
 * `node-quick-actions`, inside the overlay, which only mounts for a node that
 * is already selected or hovered. The right-click happens on the LEAF, in a
 * closed shadow root, and the two never meet.
 *
 * So the leaf asks and the overlay answers. One node id in module-scope
 * observable state, which is also what makes the ordering work: the leaf
 * selects the node and records the request, the overlay mounts BECAUSE of
 * that selection, and reads the request on its first render.
 *
 * A single id rather than a queue — only one context menu can be open, and a
 * second right-click supersedes the first rather than stacking.
 */
/** The Table cell a right-click landed on (AGL-4203). */
export interface CanvasContextMenuTableCell {
  row: number
  column: number
}

const state = observable<{
  nodeId: string | null
  tableCell: CanvasContextMenuTableCell | null
}>({ nodeId: null, tableCell: null })

/**
 * Ask for the menu on this node; supersedes any earlier request. On a Table,
 * `tableCell` says which cell was right-clicked, so the menu can offer rows
 * and columns relative to it.
 */
export function requestCanvasContextMenu(
  nodeId: string | undefined,
  tableCell?: CanvasContextMenuTableCell,
): void {
  runInAction(() => {
    state.nodeId = nodeId ?? null
    state.tableCell = nodeId && tableCell ? { ...tableCell } : null
  })
}

/**
 * The Table cell the open menu was asked for on, or `null` when it was
 * opened from the ⋮ button, the hierarchy, or anywhere but a cell.
 */
export function canvasContextMenuTableCell(
  nodeId: string | undefined,
): CanvasContextMenuTableCell | null {
  if (!nodeId || state.nodeId !== nodeId) return null
  return state.tableCell
}

/** Whether the open menu was asked for on this node. */
export function isCanvasContextMenuRequested(
  nodeId: string | undefined,
): boolean {
  return Boolean(nodeId) && state.nodeId === nodeId
}

/**
 * Withdraw the request.
 *
 * Called when the menu closes, and unconditionally rather than only for the
 * node that asked: a request left standing re-opens the menu the next time
 * that node's overlay mounts, which reads as the menu opening by itself.
 */
export function clearCanvasContextMenu(): void {
  runInAction(() => {
    state.nodeId = null
    state.tableCell = null
  })
}
