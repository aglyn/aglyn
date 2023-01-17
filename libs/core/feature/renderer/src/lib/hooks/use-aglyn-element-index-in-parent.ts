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

import type { NodeId } from '@aglyn/core-data-foundation'
import { useMemo } from 'react'
import { useAglynElementData } from './use-aglyn-element-data'

export type useAglynElementParentPosition = {
  index: number
  isFirst: boolean
  isLast: boolean
  parentId: NodeId
  elements: NodeId[]
}

export function useAglynElementIndexInParent(
  $id: NodeId,
): useAglynElementParentPosition {
  const parentId = useAglynElementData($id, 'parentId')
  const _elements = useAglynElementData(parentId, 'nodes')
  const elements = useMemo(() => _elements || [], [_elements])
  const length = elements.length
  const index = useMemo(() => elements.indexOf($id), [$id, elements])
  const isFirst = useMemo(() => index === 0, [index])
  const isLast = useMemo(() => length === index + 1, [index, length])
  return useMemo(
    () => ({
      index,
      isFirst,
      isLast,
      parentId,
      elements,
    }),
    [index, isFirst, isLast, parentId, elements],
  )
}
export default useAglynElementData
