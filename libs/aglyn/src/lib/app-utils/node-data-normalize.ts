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
  AglynNodeItemDenormalized,
  AglynNodeItemNormalized,
  AglynNodesById,
  AglynNodesList,
  NodeId,
} from '../foundation'
import {
  CANVAS_ROOT_ELEMENT_ID,
  DEFAULT_ROOT_ELEMENT,
} from '../foundation'
import { arraySafe, cloneDeep } from '@aglyn/shared-util-tools'

const normalizeData = (
  element: AglynNodeItemDenormalized,
  parentId: NodeId,
  accumulator: AglynNodesById = {},
): AglynNodesById => {
  if (element?.$id && parentId && accumulator[parentId]) {
    const _element = element as unknown as AglynNodeItemNormalized
    const childElements: AglynNodesList = [...arraySafe(element.nodes)]
    _element.parentId = parentId
    _element.nodes = []
    accumulator[_element.$id] = _element
    ;(accumulator[parentId].nodes ||= []).push(_element.$id)
    for (const child of childElements) {
      if (!child?.$id) continue
      normalizeData(child, _element.$id, accumulator)
    }
  }
  return accumulator
}

export function nodeDataNormalize(
  element: AglynNodeItemDenormalized,
  parentId: NodeId,
  accumulator?: AglynNodesById,
): AglynNodesById
export function nodeDataNormalize(
  elements: AglynNodesList,
  parentId?: NodeId,
): AglynNodesById
export function nodeDataNormalize(
  data: AglynNodeItemDenormalized | AglynNodesList,
  parentId: NodeId = CANVAS_ROOT_ELEMENT_ID,
  accumulator?: AglynNodesById,
): AglynNodesById {
  let normalized: AglynNodesById

  if (accumulator) normalized = accumulator
  else if (parentId === CANVAS_ROOT_ELEMENT_ID) {
    normalized = {
      [DEFAULT_ROOT_ELEMENT.$id]: {
        ...(cloneDeep(DEFAULT_ROOT_ELEMENT) as AglynNodeItemNormalized),
      },
    }
  } else {
    normalized = {
      [parentId]: {
        $id: parentId,
        nodes: [],
        parentId: null,
        componentId: undefined,
      },
    }
  }

  if (!data) return normalized
  const state = cloneDeep(data)

  try {
    for (const element of arraySafe(state, [state])) {
      normalizeData(element, parentId, normalized)
    }
  } catch (error) {
    console.error(error)
  }

  return normalized
}
export default nodeDataNormalize
