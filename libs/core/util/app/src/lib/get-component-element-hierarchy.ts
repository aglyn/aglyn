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

import {
  type AglynElementHierarchy,
  type AglynElementsDenormalized,
  CANVAS_ROOT_ELEMENT_ID,
  type ElementId,
} from '@aglyn/core-data-foundation'
import isRootElementId from './is-root-element-id'

export function getComponentElementHierarchy<T extends ElementId>(
  $id: T,
  elements: AglynElementsDenormalized,
): AglynElementHierarchy<T> {
  const hierarchy = [CANVAS_ROOT_ELEMENT_ID]

  let currentId: ElementId = $id
  while (currentId && !isRootElementId(currentId)) {
    hierarchy.splice(1, 0, currentId)
    currentId = elements[currentId]?.parentId
  }

  return hierarchy as AglynElementHierarchy<T>
}

export default getComponentElementHierarchy
