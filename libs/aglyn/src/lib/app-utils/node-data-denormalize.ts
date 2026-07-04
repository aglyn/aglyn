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
import { CANVAS_ROOT_ELEMENT_ID } from '../foundation'
import { arraySafe, cloneDeep } from '@aglyn/shared-util-tools'

const denormalizeData = (
  element: AglynNodeItemNormalized,
  denormalized: AglynNodesById = {},
  accumulator: AglynNodesList = [],
): AglynNodesList => {
  if (element?.$id) {
    const _element = element as unknown as AglynNodeItemDenormalized
    const childIds: NodeId[] = [...arraySafe(element.nodes)]
    _element.nodes = []
    for (const $id of childIds) {
      if (!$id || !denormalized[$id]) continue
      const child = denormalized[$id]
      denormalizeData(child, denormalized, _element.nodes)
    }
    accumulator.push(_element)
  }
  return accumulator
}

export function nodeDataDenormalize(
  element: AglynNodeItemNormalized,
): AglynNodesList
export function nodeDataDenormalize(
  elements: AglynNodesById,
  parentId?: NodeId,
): AglynNodesList
export function nodeDataDenormalize(
  data: AglynNodeItemNormalized | AglynNodesById,
  parentId: NodeId = CANVAS_ROOT_ELEMENT_ID,
): AglynNodesList {
  const denormalized: AglynNodesList = []
  if (!data) return denormalized
  const state = cloneDeep(data)

  try {
    let normalized: AglynNodesById
    // If received a denormalized element
    if (state.$id) {
      const _element = state as AglynNodeItemNormalized
      normalized = { [_element.$id]: _element }
      return denormalizeData(_element, normalized, denormalized)
    }

    // If received a denormalized map of nodes by id
    normalized = state as AglynNodesById
    const parent = (normalized[parentId] ||= {
      $id: parentId,
    } as AglynNodeItemNormalized)
    for (const $id of (parent.nodes ||= [])) {
      denormalizeData(normalized[$id], normalized, denormalized)
    }
  } catch (error) {
    console.error(error)
  }

  return denormalized
}
export default nodeDataDenormalize
