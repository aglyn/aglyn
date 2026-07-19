/**
 * @license
 * Copyright 2024 Aglyn LLC
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
import { observable, runInAction } from 'mobx'
import { computedFn } from 'mobx-utils'

export type HoveredNode = Aglyn.NodeSchema<any> | null
export type SelectedNodes = Aglyn.NodeSchema<any>[]
export type ExpandedNodes = Aglyn.NodeSchema<any>[]
export type LastSelectedNode = Aglyn.NodeSchema<any> | undefined

interface FocusState {
  /**
   * The current hovered node
   */
  hovered?: HoveredNode
  /**
   * The current selected node
   */
  selected: SelectedNodes
  /**
   * Nodes the user has manually expanded via the tree toggle
   */
  expanded: ExpandedNodes
  /**
   * Node IDs that the user has explicitly collapsed, overriding auto-expansion
   * from selection. Cleared for a node's ancestors whenever a new node is selected.
   */
  manuallyCollapsed: Aglyn.NodeId[]
  allExpanded: ExpandedNodes & SelectedNodes
  /**
   * The computed last selected node
   */
  readonly lastSelected: LastSelectedNode
  /** Number of currently selected nodes (AGL-5). */
  readonly selectionCount: number
  /** True when more than one node is selected (AGL-5). */
  readonly hasMultipleSelected: boolean

  readonly isNodeSelected: (node: Aglyn.NodeSchema) => boolean
  /**
   * Whether the current selection lives inside this node's subtree — the
   * node itself or any of its descendants is selected. Canvas chrome uses
   * this to expand collapsed containers (menus, drawers) only while they
   * are being authored (AGL-571).
   */
  readonly isNodeOrDescendantSelected: (node: Aglyn.NodeSchema) => boolean
  readonly isNodeHovered: (node: Aglyn.NodeSchema) => boolean
  readonly isNodeExpanded: (node: Aglyn.NodeSchema) => boolean
  /**
   * Whether a node is currently visually open in the tree — either because the
   * user manually expanded it, or because it is an auto-expanded ancestor of a
   * selected node that has not been manually collapsed.
   */
  readonly isNodeEffectivelyExpanded: (node: Aglyn.NodeSchema) => boolean
}

const state = observable<FocusState>({
  hovered: null,
  selected: [],
  expanded: [],
  manuallyCollapsed: [],

  get allExpanded(): Aglyn.NodeSchema<any>[] {
    return [...this.expanded, ...this.selected]
  },
  get lastSelected(): Aglyn.NodeSchema<any> | undefined {
    return this.selected[this.selected.length - 1]
  },
  get selectionCount(): number {
    return this.selected.length
  },
  get hasMultipleSelected(): boolean {
    return this.selected.length > 1
  },

  isNodeSelected: computedFn((node: Aglyn.NodeSchema<any>): boolean => {
    if (!node) return false
    return state.selected.some((i) => i?.$id === node?.$id)
  }),
  isNodeOrDescendantSelected: computedFn(
    (node: Aglyn.NodeSchema<any>): boolean => {
      if (!node) return false
      // A node's breadcrumbPath is [root, ...ancestors, self], so a
      // selected node whose path contains this id makes this node the
      // selection itself or one of its ancestors — i.e. the selection is
      // within this node's subtree.
      return state.selected.some(
        (selectedNode) =>
          selectedNode?.$id === node.$id ||
          selectedNode?.breadcrumbPath?.includes(node.$id),
      )
    },
  ),
  isNodeHovered: computedFn((node: Aglyn.NodeSchema<any>): boolean => {
    if (!node) return false
    return state.hovered?.$id === node?.$id
  }),
  isNodeExpanded: computedFn((node: Aglyn.NodeSchema<any>): boolean => {
    if (!node) return false
    return state.expanded.some((i) => i?.$id === node?.$id)
  }),
  isNodeEffectivelyExpanded: computedFn((node: Aglyn.NodeSchema<any>): boolean => {
    if (!node) return false
    // Manually expanded always wins
    if (state.expanded.some((i) => i?.$id === node?.$id)) return true
    // If the user explicitly collapsed this node, treat it as collapsed
    if (state.manuallyCollapsed.includes(node.$id)) return false
    // Auto-expanded: this node is an ancestor of a manually expanded node
    // (mirrors the view's allExpanded breadcrumb-path logic exactly)
    if (state.expanded.some((n) => n?.breadcrumbPath?.includes(node.$id))) return true
    // Auto-expanded: this node is an ancestor of a selected node
    return state.selected.some((selectedNode) =>
      selectedNode?.breadcrumbPath?.includes(node.$id),
    )
  }),
})

export function getLastSelected(): LastSelectedNode {
  return state.lastSelected
}

export function selectionCount(): number {
  return state.selectionCount
}

export function hasMultipleSelected(): boolean {
  return state.hasMultipleSelected
}

export function getHovered(): HoveredNode | undefined {
  return state.hovered
}

export function getSelected(): SelectedNodes {
  return state.selected
}

export function getAllExpanded(): ExpandedNodes & SelectedNodes {
  return state.allExpanded
}

export function getManuallyCollapsed(): Aglyn.NodeId[] {
  return state.manuallyCollapsed
}

export function isNodeSelected(node: Aglyn.NodeSchema<any>) {
  return state.isNodeSelected(node)
}

export function isNodeOrDescendantSelected(node: Aglyn.NodeSchema<any>) {
  return state.isNodeOrDescendantSelected(node)
}

export function isNodeHovered(node: Aglyn.NodeSchema<any>) {
  return state.isNodeHovered(node)
}

export function isNodeExpanded(node: Aglyn.NodeSchema<any>) {
  return state.isNodeExpanded(node)
}

export function isNodeEffectivelyExpanded(node: Aglyn.NodeSchema<any>) {
  return state.isNodeEffectivelyExpanded(node)
}

export function clearFocusStatus() {
  runInAction(() => {
    state.selected = []
    state.hovered = null
  })
}

export function clearSelection() {
  runInAction(() => {
    state.selected = []
  })
}

export function clearHover() {
  runInAction(() => {
    state.hovered = null
  })
}

export function expandNode(node: Aglyn.NodeSchema<any>) {
  if (!node) return
  runInAction(() => {
    // Clear any manual-collapse override so the node stays open
    const mcIndex = state.manuallyCollapsed.indexOf(node.$id)
    if (mcIndex !== -1) state.manuallyCollapsed.splice(mcIndex, 1)

    if (!state.expanded.some((i) => i?.$id === node?.$id)) {
      state.expanded.push(node)
    }
  })
}

export function collapseNode(node: Aglyn.NodeSchema<any>) {
  if (!node) return
  runInAction(() => {
    // Remove from manually-expanded if present
    const index = state.expanded.findIndex((i) => i?.$id === node?.$id)
    if (index !== -1) state.expanded.splice(index, 1)

    // After removal, check if the node is still visually open because it is an
    // ancestor of another expanded node or of a selected node. If so, record a
    // manual-collapse override so those auto-expansion sources are suppressed.
    const stillEffectivelyExpanded =
      state.expanded.some((n) => n?.breadcrumbPath?.includes(node.$id)) ||
      state.selected.some((s) => s?.breadcrumbPath?.includes(node.$id))

    if (stillEffectivelyExpanded && !state.manuallyCollapsed.includes(node.$id)) {
      state.manuallyCollapsed.push(node.$id)
    }
  })
}

export function toggleNodeExpansion(node: Aglyn.NodeSchema<any>) {
  if (!node) return
  // Use effective expansion so auto-expanded nodes can also be toggled closed
  if (isNodeEffectivelyExpanded(node)) return collapseNode(node)
  return expandNode(node)
}

export function handleNodeSelection(
  node: Aglyn.NodeSchema<any>,
  multiSelection = false,
) {
  if (isNodeSelected(node)) {
    deselectNode(node, multiSelection)
  } else {
    setSelectedNode(node, multiSelection)
  }
}

export function deselectNode(
  node: Aglyn.NodeSchema<any>,
  multiSelection = false,
) {
  if (!isNodeSelected(node)) return
  runInAction(() => {
    if (multiSelection) {
      const selectIndex = state.selected.indexOf(node)
      state.selected.splice(selectIndex, 1)
    } else {
      state.selected = []
    }
  })
}

export function setSelectedNode(
  node: Aglyn.NodeSchema<any>,
  multiSelection = false,
) {
  if (isNodeSelected(node)) return
  runInAction(() => {
    if (multiSelection) state.selected.push(node)
    else state.selected = [node]

    // Clear manual-collapse overrides for ancestors of the newly selected node
    // so the hierarchy always opens up to reveal it
    const ancestorIds = new Set<Aglyn.NodeId>(node?.breadcrumbPath ?? [])
    state.manuallyCollapsed = state.manuallyCollapsed.filter(
      (id) => !ancestorIds.has(id),
    )
  })
}

/**
 * Flat, depth-first list of the nodes currently visible in the hierarchy —
 * children of collapsed nodes are skipped (AGL-6). Range selection resolves
 * its slice against this order.
 */
export function getVisibleNodeOrder(): Aglyn.NodeSchema<any>[] {
  const result: Aglyn.NodeSchema<any>[] = []
  const root = Aglyn.canvas.rootNode
  if (!root) return result
  const walk = (node: Aglyn.NodeSchema<any>) => {
    result.push(node)
    if (node.$id !== root.$id && !state.isNodeEffectivelyExpanded(node)) return
    for (const id of node.nodes ?? []) {
      const child = Aglyn.canvas.getNode(id)
      if (child) walk(child)
    }
  }
  walk(root)
  return result
}

/**
 * Shift+Click range selection (AGL-7): selects every visible node between
 * the current anchor (`lastSelected`) and the target, in document order.
 * Without an anchor it falls back to single selection.
 */
export function rangeSelectNode(node: Aglyn.NodeSchema<any>) {
  if (!node) return
  const anchor = state.lastSelected
  if (!anchor || anchor.$id === node.$id) return setSelectedNode(node, false)

  const visibleNodes = getVisibleNodeOrder()
  const anchorIndex = visibleNodes.findIndex((n) => n.$id === anchor.$id)
  const targetIndex = visibleNodes.findIndex((n) => n.$id === node.$id)
  if (anchorIndex === -1 || targetIndex === -1) {
    return setSelectedNode(node, false)
  }
  const [from, to] =
    anchorIndex < targetIndex
      ? [anchorIndex, targetIndex]
      : [targetIndex, anchorIndex]
  runInAction(() => {
    state.selected = visibleNodes.slice(from, to + 1)
  })
}

/**
 * Cmd/Ctrl+A helper (AGL-7): selects every visible node at the same tree
 * depth as the current selection anchor (siblings-and-cousins). No-ops
 * without an anchor.
 */
export function selectAllAtDepth() {
  const anchor = state.lastSelected
  if (!anchor) return
  const depth = anchor.breadcrumbPath?.length ?? 0
  const peers = getVisibleNodeOrder().filter(
    (node) => (node.breadcrumbPath?.length ?? 0) === depth,
  )
  if (!peers.length) return
  runInAction(() => {
    state.selected = peers
  })
}

export function setHoveredNode(node: Aglyn.NodeSchema<any>) {
  if (isNodeHovered(node)) return
  runInAction(() => {
    state.hovered = node
  })
}

export function dehoverNode(node: Aglyn.NodeSchema<any>) {
  if (!isNodeHovered(node)) return
  runInAction(() => {
    state.hovered = null
  })
}
