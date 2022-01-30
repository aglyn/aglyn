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

import {_isStrT} from '@aglyn/shared-util-guards'
import {
  type AglynElementDenormalized,
  type AglynElementNormalized,
  type AglynElementsById,
  type AglynElementsList,
  type ElementId,
} from '../types/aglyn-elements.types'


const normalizeData = (
  element: AglynElementDenormalized,
  flatMap: AglynElementsById = {},
  elemData: AglynElementsList = [],
): AglynElementNormalized => {
  const {elements, ...rest} = element

  return {
    ...rest,
    elements: (elements || []).map($id => (
      normalizeData(flatMap[$id], flatMap, elemData)
    )),
  }
}

export function normalizeComponentElementData(
  element: AglynElementDenormalized,
  parentId: ElementId,
): AglynElementsList
export function normalizeComponentElementData(
  elements: AglynElementsById,
  parentId: ElementId,
): AglynElementsList
export function normalizeComponentElementData(
  elements: AglynElementDenormalized | AglynElementsById,
  parentId: ElementId,
): AglynElementsList {
  const elemData: AglynElementsList = []
  const elems: AglynElementsById = _isStrT(elements.$id)
    ? {[elements.$id]: {...elements}} as AglynElementsById
    : {...elements} as AglynElementsById

  elemData.push(
    ...(elems[parentId].elements || []).map(($id: any) =>
      normalizeData(elems[$id], elems),
    ),
  )

  return elemData
}
export default normalizeComponentElementData
