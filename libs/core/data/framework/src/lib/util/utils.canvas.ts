/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import {arrayAddAtIndex, arrayRemoveItem, arrayReorder} from '@aglyn/shared-util-tools'
import {objectDeepMerge} from '@aglyn/shared-util-vendor'
import {
  type CanvasAddElementPayload,
  type CanvasDeleteElementPayload,
  type CanvasDuplicateElementPayload,
  type CanvasGetElementPayload,
  type CanvasMoveElementPayload,
  type CanvasSetElementsPayload,
  type CanvasUpdateElementPayload,
} from '../constants/emitter'
import {type ElementsDataStore} from '../controllers/aglyn-canvas.types'
import {type AglynComponentElementDataNormalizedMap} from '../controllers/aglyn-components.types'
import {createComponentElementDataCopy} from './create-component-element-data-copy'
import {deleteComponentElement} from './delete-component-element'
import {getComponentElementHierarchy} from './get-component-element-hierarchy'
import {handleStateModificationHistoryChange} from './handle-state-modification-history-change'
import {normalizeComponentElementData} from './normalize-component-element-data'


type CanvasApiEventHandler<S extends ElementsDataStore, P> = (
  state: ElementsDataStore['present'],
  payload: P,
) => ElementsDataStore['present']

export const handleCanvasApiChangeEvent = <S extends ElementsDataStore, P>(
  fn: CanvasApiEventHandler<S, P>,
) => (
  state: S, payload: P,
) => {
  return handleStateModificationHistoryChange(state, fn(state.present, payload))
}


export const handleCanvasSetElements = (
  state: AglynComponentElementDataNormalizedMap,
  payload: CanvasSetElementsPayload,
) => {

  const {elements} = payload
  return elements
}
export const handleCanvasAddElement = (
  state: AglynComponentElementDataNormalizedMap,
  payload: CanvasAddElementPayload,
) => {

  const {element, parentId, index} = payload
  const newData = normalizeComponentElementData(element, parentId)
  return {
    ...state,
    ...newData,
    [parentId]: {
      ...state[parentId],
      elements: arrayAddAtIndex(
        index,
        state[parentId]?.elements || [],
        newData[parentId]?.elements || [],
        {copy: true},
      ).items,
    },
  }
}


export const handleCanvasGetElement = (
  state: AglynComponentElementDataNormalizedMap,
  payload: CanvasGetElementPayload,
) => {

  const {$id} = payload
  return state[$id]
}


export const handleCanvasUpdateElement = (
  state: AglynComponentElementDataNormalizedMap,
  payload: CanvasUpdateElementPayload,
) => {

  const {element: {props, ...element}} = payload
  return {
    ...state,
    [element.$id]: {
      ...objectDeepMerge(state[element.$id], element),
      props,
    },
  }
}


export const handleCanvasMoveElement = (
  state: AglynComponentElementDataNormalizedMap,
  payload: CanvasMoveElementPayload,
) => {

  const {$id, index, parentId} = payload
  const parentHierarchy = getComponentElementHierarchy(parentId, state)

  if (parentHierarchy.some((id) => id === $id)) {
    throw new Error('New parent is same or a child of the element')
  }

  const current = {...state[$id]}
  const response = {
    ...state,
    [$id]: {
      ...current,
      parentId: parentId,
    },
  }
  const parentElements = response[parentId].elements || []

  if (parentId === current.parentId) {
    console.log('reordoering')
    response[parentId] = {
      ...response[parentId],
      elements: arrayReorder(
        parentElements,
        parentElements.indexOf($id),
        index === -1 ? parentElements.length - 1 : index,
      ),
    }
  }
  else {
    console.log('moving')
    response[parentId] = {
      ...response[parentId],
      elements: arrayAddAtIndex(
        index === -1 ? parentElements.length - 1 : index,
        parentElements,
        $id,
        {copy: true},
      ).items,
    }
    const currentParentElements = response[current.parentId].elements || []
    response[current.parentId] = {
      ...response[current.parentId],
      elements: arrayRemoveItem($id, currentParentElements),
    }
  }

  return response
}


export const handleCanvasDuplicateElement = (
  state: AglynComponentElementDataNormalizedMap,
  payload: CanvasDuplicateElementPayload,
) => {

  const {$id} = payload
  const element = state[$id]
  const parent = state[element?.parentId]
  const position = (parent?.elements ?? []).indexOf($id)
  const elementCopy = createComponentElementDataCopy($id, state)
  return handleCanvasAddElement(state, {
    element: elementCopy,
    parentId: elementCopy.parentId,
    index: position + 1,
  })
}
export const handleCanvasDeleteElement = (
  state: AglynComponentElementDataNormalizedMap,
  payload: CanvasDeleteElementPayload,
) => {

  const {$id} = payload
  return deleteComponentElement($id, state)
}
