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

import { yes } from '@aglyn/shared-util-tools'
import { CANVAS_ROOT_ELEMENT_ID } from '../constants/canvas'
import {
  AglynComponentElementDataNormalizedMap,
  AglynComponentElementHierarchy,
  ElementId,
} from '../types'


export const getComponentElementHierarchy = (
  $id: ElementId, elements: AglynComponentElementDataNormalizedMap,
): AglynComponentElementHierarchy<typeof $id> => {
  const hierarchy = [CANVAS_ROOT_ELEMENT_ID]

  let currentId: ElementId = $id
  while (yes(currentId) && currentId !== CANVAS_ROOT_ELEMENT_ID) {
    hierarchy.splice(1, 0, currentId)
    currentId = elements[currentId]?.parentId
  }

  return hierarchy as AglynComponentElementHierarchy<typeof $id>
}

export default getComponentElementHierarchy
