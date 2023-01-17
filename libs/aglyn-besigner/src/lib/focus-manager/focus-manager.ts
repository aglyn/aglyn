/**
 * @license
 * Copyright 2022 Aglyn LLC
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
   * The current expanded node in tree views
   */
  expanded: ExpandedNodes
  allExpanded: ExpandedNodes & SelectedNodes
  /**
   * The computed last selected node
   */
  readonly lastSelected: LastSelectedNode

  readonly isNodeSelected: (node: Aglyn.NodeSchema) => boolean
  readonly isNodeHovered: (node: Aglyn.NodeSchema) => boolean
  readonly isNodeExpanded: (node: Aglyn.NodeSchema) => boolean
}

export const state = observable<FocusState>({
  hovered: null,
  selected: [],
  expanded: [],

  get allExpanded(): Aglyn.NodeSchema<any>[] {
    const res = []
    this.expanded.forEach((i) => {
      res.push(i)
    })
    this.selected.forEach((i) => {
      res.push(i)
    })
    return res
  },
  get lastSelected(): Aglyn.NodeSchema<any> | undefined {
    return this.selected[this.selected.length - 1]
  },

  isNodeSelected: computedFn((node: Aglyn.NodeSchema<any>): boolean => {
    if (!node) return false
    return state.selected.some((i) => i?.$id === node?.$id)
  }),
  isNodeHovered: computedFn((node: Aglyn.NodeSchema<any>): boolean => {
    if (!node) return false
    return state.hovered?.$id === node?.$id
  }),
  isNodeExpanded: computedFn((node: Aglyn.NodeSchema<any>): boolean => {
    if (!node) return false
    return state.expanded.some((i) => i?.$id === node?.$id)
  }),
})

export function isNodeSelected(node: Aglyn.NodeSchema<any>) {
  return state.isNodeSelected(node)
}

export function isNodeHovered(node: Aglyn.NodeSchema<any>) {
  return state.isNodeHovered(node)
}

export function isNodeExpanded(node: Aglyn.NodeSchema<any>) {
  return state.isNodeExpanded(node)
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
    state.expanded.push(node)
  })
}

export function collapseNode(node: Aglyn.NodeSchema<any>) {
  if (!node) return
  runInAction(() => {
    const index = state.expanded.findIndex((i) => i?.$id === node?.$id)
    state.expanded.splice(index, 1)
  })
}

export function toggleNodeExpansion(node: Aglyn.NodeSchema<any>) {
  if (!node) return
  if (isNodeExpanded(node)) return collapseNode(node)
  expandNode(node)
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
