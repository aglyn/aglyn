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
  AglynElementDenormalized,
  AglynElementNormalized,
  AglynElementsDenormalized,
  AglynElementsNormalized,
  ElementId,
} from '@aglyn/core-data-foundation'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/core-data-foundation'
import { arraySafe, copy } from '@aglyn/shared-util-tools'

const normalizeData = (
  element: AglynElementDenormalized,
  denormalized: AglynElementsDenormalized = {},
  accumulator: AglynElementsNormalized = [],
): AglynElementsNormalized => {
  if (element?.$id) {
    const _element = element as unknown as AglynElementNormalized
    const childIds: ElementId[] = [...arraySafe(element.elements)]
    _element.elements = []
    for (const $id of childIds) {
      if (!$id || !denormalized[$id]) continue
      const child = denormalized[$id]
      normalizeData(child, denormalized, _element.elements)
    }
    accumulator.push(_element)
  }
  return accumulator
}

export function normalizeComponentElementData(
  element: AglynElementDenormalized,
): AglynElementsNormalized
export function normalizeComponentElementData(
  elements: AglynElementsDenormalized,
  parentId?: ElementId,
): AglynElementsNormalized
export function normalizeComponentElementData(
  data: AglynElementDenormalized | AglynElementsDenormalized,
  parentId: ElementId = CANVAS_ROOT_ELEMENT_ID,
): AglynElementsNormalized {
  const normalized: AglynElementsNormalized = []
  if (!data) return normalized
  const state = copy(data)

  try {
    let denormalized: AglynElementsDenormalized
    // If received a denormalized element
    if (state.$id) {
      const _element = state as AglynElementDenormalized
      denormalized = { [_element.$id]: _element }
      return normalizeData(_element, denormalized, normalized)
    }

    // If received a denormalized map of elements by id
    denormalized = state as AglynElementsDenormalized
    const parent = (denormalized[parentId] ||= {
      $id: parentId,
    } as AglynElementDenormalized)
    for (const $id of (parent.elements ||= [])) {
      normalizeData(denormalized[$id], denormalized, normalized)
    }
  } catch (error) {
    console.error(error)
  }

  return normalized
}
export default normalizeComponentElementData
