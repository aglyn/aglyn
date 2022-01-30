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

import {_isArr} from '@aglyn/shared-util-guards'
import {
  type AglynElementNormalized,
  type AglynElementsById,
  type AglynElementsList,
  type ElementId,
} from '../types/aglyn-elements.types'


const denormalizeData = (
  element: AglynElementNormalized,
  parentId: ElementId,
  flatMap: AglynElementsById = {},
): AglynElementsById => {
  const {elements, ...rest} = element
  flatMap[rest.$id] = {...rest, parentId, elements: []}
  flatMap[parentId] = {
    ...flatMap[parentId],
    elements: (flatMap[parentId]?.elements || []).concat(rest.$id),
  }
  elements?.forEach((child) => {
    denormalizeData(child, rest.$id, flatMap)
  })
  return flatMap
}

export function denormalizeComponentElementData(
  element: AglynElementNormalized,
  parentId?: ElementId,
): AglynElementsById
export function denormalizeComponentElementData(
  elements: AglynElementsList,
  parentId?: ElementId,
): AglynElementsById
export function denormalizeComponentElementData(
  elements: AglynElementNormalized | AglynElementsList,
  parentId?: ElementId,
): AglynElementsById {
  let elemData

  (_isArr(elements) ? elements : [elements]).forEach((element) => {
    elemData = denormalizeData(element, parentId, elemData)
  })

  return elemData
}
export default denormalizeComponentElementData
