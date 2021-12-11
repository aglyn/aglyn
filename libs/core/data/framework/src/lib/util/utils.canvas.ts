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

import { handleStateModificationHistoryChange } from '@aglyn/core-data-framework'
import { _isArrEmpty } from '@aglyn/shared-util-guards'
import { arrayAddAtIndex } from '@aglyn/shared-util-tools'
import { objectDeepMerge } from '@aglyn/shared-util-vendor'
import type {
  CanvasAddElementPayload,
  CanvasDeleteElementPayload,
  CanvasDuplicateElementPayload,
  CanvasMoveElementPayload,
  CanvasSetElementsPayload,
  CanvasUpdateElementPayload,
} from '../constants/emitter'
import type { ElementsDataStore } from '../controllers/aglyn-canvas.controller'
import type { AglynComponentElementDataNormalizedMap } from '../types'
import { createComponentElementDataCopy } from './create-component-element-data-copy'
import { deleteComponentElement } from './delete-component-element'
import { handleStateModificationHistoryRedo } from './handle-state-modification-history-redo'
import { handleStateModificationHistoryUndo } from './handle-state-modification-history-undo'
import { normalizeComponentElementData } from './normalize-component-element-data'

type CanvasApiEventHandler<S extends ElementsDataStore, P> = (
  state: ElementsDataStore['present'],
  payload: P
) => ElementsDataStore['present']
export const handleCanvasApiEvent = <S extends ElementsDataStore, P>(
  fn: CanvasApiEventHandler<S, P>
) => (
  state: S, payload: P
) => {
  return handleStateModificationHistoryChange(state, fn(state.present, payload))
}


export const handleCanvasUndo = (state: ElementsDataStore) => {
  if (!_isArrEmpty(state.past)) {
    return handleStateModificationHistoryUndo(state)
  }
  return undefined
}
export const handleCanvasRedo = (state: ElementsDataStore) => {
  if (!_isArrEmpty(state.future)) {
    return handleStateModificationHistoryRedo(state)
  }
  return undefined
}


export const handleCanvasSetElements = (
  state: AglynComponentElementDataNormalizedMap,
  payload: CanvasSetElementsPayload
) => {

  const {elements} = payload
  return elements
}
export const handleCanvasAddElement = (
  state: AglynComponentElementDataNormalizedMap,
  payload: CanvasAddElementPayload
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


export const handleCanvasUpdateElement = (
  state: AglynComponentElementDataNormalizedMap,
  payload: CanvasUpdateElementPayload
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
  payload: CanvasMoveElementPayload
) => {

  const {$id, index, parentId} = payload
  const current = state[$id]
  return {
    ...state,
    [$id]: {
      ...state[$id],
      parentId: parentId,
    },
    [parentId]: {
      ...state[parentId],
      elements: arrayAddAtIndex(
        index,
        state[parentId].elements || [],
        $id,
        {copy: true},
      ).items,
    },
    [current.parentId]: {
      ...state[current.parentId],
      elements: (state[current.parentId].elements || []).filter(i => i !== $id),
    },
  }
}


export const handleCanvasDuplicateElement = (
  state: AglynComponentElementDataNormalizedMap,
  payload: CanvasDuplicateElementPayload
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
  payload: CanvasDeleteElementPayload
) => {

  const {$id} = payload
  return deleteComponentElement($id, state)
}
