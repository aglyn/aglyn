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

import type {
  AglynNodesById,
  AglynNodesList,
  CanvasAddElementPayload,
  CanvasContext,
  CanvasDeleteElementPayload,
  CanvasDuplicateElementPayload,
  CanvasMoveElementPayload,
  CanvasSetElementPayload,
  CanvasSetElementsPayload,
  CanvasUpdateElementPayload,
  NodeId,
} from '@aglyn/core-data-foundation'
import {
  CANVAS_ROOT_ELEMENT_ID,
  DEFAULT_ROOT_ELEMENT,
} from '@aglyn/core-data-foundation'
import { _hasOwnProperty } from '@aglyn/shared-util-tools'
import {
  arrayMoveAtIndex,
  arrayPushAtIndex,
  arrayRemoveItem,
  copyShallow,
} from '@aglyn/shared-util-tools'
import { createComponentElementDataCopy } from './create-component-element-data-copy'
import { getComponentElementHierarchy } from './get-component-element-hierarchy'
import { handleStateModificationHistoryChange } from './handle-state-modification-history-change'
import { nodeDataNormalize } from './node-data-normalize'

type CanvasApiEventHandler<S extends CanvasContext, P> = (
  state: CanvasContext['present'],
  payload: P,
) => CanvasContext['present']

export const handleCanvasApiChangeEvent =
  <S extends CanvasContext, P>(fn: CanvasApiEventHandler<S, P>) =>
  (state: S, payload: P) => {
    return handleStateModificationHistoryChange(
      state,
      fn(state.present, payload),
    )
  }

export const handleCanvasSetElements = (
  state: AglynNodesById,
  payload: CanvasSetElementsPayload,
): AglynNodesById => {
  const { elements, type } = payload || {}

  if (type === 'denormal' && Array.isArray(elements)) {
    const newState = nodeDataNormalize(
      elements as unknown as AglynNodesList,
      CANVAS_ROOT_ELEMENT_ID,
    )
    console.log('newState normal', payload, newState)
    return newState
  }
  console.log('newState denormal', payload, elements)

  return (elements || {
    [DEFAULT_ROOT_ELEMENT.$id]: { ...DEFAULT_ROOT_ELEMENT },
  }) as AglynNodesById
}
export const handleCanvasAddElement = (
  state: AglynNodesById,
  payload: CanvasAddElementPayload,
): AglynNodesById => {
  const { index, element } = payload
  let parentId: NodeId = null
  if (_hasOwnProperty(payload.parentId, state)) {
    parentId = payload.parentId
  } else {
    console.error('Element must have a valid parent, falling back to root')
    parentId = CANVAS_ROOT_ELEMENT_ID
  }
  console.log('handleCanvasAddElement', payload, state)

  const { [parentId]: _, ...newElements } = nodeDataNormalize(
    element,
    parentId,
    {
      [parentId]: {
        $id: parentId,
        componentId: state[parentId]?.$id,
        nodes: [],
      },
    },
  )

  // Add all if the descendent nodes to the state
  for (const [$id, element] of Object.entries(newElements)) {
    state[$id] = element
  }
  // Add the new element to the parents' nodes property
  arrayPushAtIndex((state[parentId].nodes ||= []), index, element.$id)
  return state
}

export const handleCanvasUpdateElement = (
  state: AglynNodesById,
  payload: CanvasUpdateElementPayload,
): AglynNodesById => {
  state[payload.$id] = payload.update(state[payload.$id])
  return state
}

export const handleCanvasSetElement = (
  state: AglynNodesById,
  payload: CanvasSetElementPayload,
): AglynNodesById => {
  state[payload.element?.$id] = payload.element
  return state
}

export const handleCanvasMoveElement = (
  state: AglynNodesById,
  payload: CanvasMoveElementPayload,
): AglynNodesById => {
  const element = state[payload.$id]
  if (!element || element.$id === CANVAS_ROOT_ELEMENT_ID) {
    console.error('Failed duplicating. Non-existent or forbidden move.')
    return state
  }

  let parentId: NodeId = null
  if (_hasOwnProperty(payload.parentId, state)) parentId = payload.parentId
  else {
    console.error('Element must have a valid parent, falling back to root')
    parentId = CANVAS_ROOT_ELEMENT_ID
  }

  // const parentHierarchy = getComponentElementHierarchy(parentId, state)
  if (getComponentElementHierarchy(parentId, state).indexOf(payload.$id) >= 0)
    throw new Error('New parent is same or a child of the element')

  const currentParentId = copyShallow(state[payload.$id].parentId)

  if (parentId === currentParentId && state[parentId]) {
    console.log('reordering')
    const parentElements = (state[parentId].nodes ||= [])
    // Move current index
    arrayMoveAtIndex(
      parentElements,
      parentElements.indexOf(payload.$id),
      payload.index,
    )
  } else {
    console.log('moving')
    // Update element parentId property
    state[payload.$id].parentId = parentId
    // Remove from current parent
    arrayRemoveItem(state[currentParentId]?.nodes || [], payload.$id)
    // Add to new parent
    arrayPushAtIndex(state[parentId]?.nodes || [], payload.index, payload.$id)
  }

  return state
}

export const handleCanvasDuplicateElement = (
  state: AglynNodesById,
  payload: CanvasDuplicateElementPayload,
): AglynNodesById => {
  const element = state[payload.$id]
  if (!element || element.$id === CANVAS_ROOT_ELEMENT_ID) {
    throw new Error(
      'Failed duplicating. Non-existent or forbidden duplication.',
    )
  }
  const parent = state[element.parentId]
  return handleCanvasAddElement(state, {
    element: createComponentElementDataCopy(element.$id, state),
    parentId: parent?.$id,
    index: (parent?.nodes || []).indexOf(element.$id) + 1,
  })
}

export const handleCanvasDeleteElement = (
  state: AglynNodesById,
  payload: CanvasDeleteElementPayload,
): AglynNodesById => {
  const element = state[payload.$id]
  if (!element || element.$id === CANVAS_ROOT_ELEMENT_ID) {
    throw new Error('Failed deleting. Non-existent or forbidden deletion.')
  }
  // Remove all child nodes first
  for (const childId in (element.nodes ||= [])) {
    handleCanvasDeleteElement(state, { $id: childId })
  }
  // Secondly remove the element from the parent
  if (element.parentId && state[element.parentId]) {
    arrayRemoveItem((state[element.parentId].nodes ||= []), element.$id)
  }
  // Lastly remove the element
  delete state[element.$id]

  return state
}
