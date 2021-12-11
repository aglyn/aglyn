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

import { _isArr } from '@aglyn/shared-util-guards'
import { AglynComponentElementDataDenormalized } from '../controllers/aglyn-components.controller'
import { AglynComponentElementDataNormalizedMap, ElementId } from '../types'


const normalizeData = (
  element: AglynComponentElementDataDenormalized,
  parentId: ElementId,
  flatMap: AglynComponentElementDataNormalizedMap = {},
): AglynComponentElementDataNormalizedMap => {
  const {elements, ...rest} = element
  flatMap[rest.$id] = {...rest, parentId, elements: []}
  flatMap[parentId] = {
    ...flatMap[parentId],
    elements: (flatMap[parentId]?.elements || []).concat(rest.$id),
  }
  elements?.forEach((child) => {
    normalizeData(child, rest.$id, flatMap)
  })
  return flatMap
}

export function normalizeComponentElementData(
  element: AglynComponentElementDataDenormalized,
  parentId?: ElementId,
): AglynComponentElementDataNormalizedMap
export function normalizeComponentElementData(
  elements: AglynComponentElementDataDenormalized[],
  parentId?: ElementId,
): AglynComponentElementDataNormalizedMap
export function normalizeComponentElementData(
  elements: AglynComponentElementDataDenormalized | AglynComponentElementDataDenormalized[],
  parentId?: ElementId,
): AglynComponentElementDataNormalizedMap {
  let elemData

  (_isArr(elements) ? elements : [elements]).forEach((element) => {
    elemData = normalizeData(element, parentId, elemData)
  })

  return elemData
}
export default normalizeComponentElementData
