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

import type { ElementId } from '@aglyn/core-data-framework'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/core-data-framework'
import { useMemo } from 'react'
import { useAglynElementData } from './use-aglyn-element-data'

export function useAglynElementParentPosition($id: ElementId): {
  index: number
  parentId: ElementId
  parentElements: ElementId[]
} {
  const parentId = useAglynElementData($id, 'parentId') || null
  const parentElements = useAglynElementData(parentId || CANVAS_ROOT_ELEMENT_ID, 'elements') || []

  return useMemo(
    () => ({
      index: (parentElements || []).indexOf($id),
      parentId: parentId,
      parentElements: parentElements,
    }),
    [parentElements, parentId, $id]
  )
}
export default useAglynElementData
