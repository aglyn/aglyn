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

import {
  type ElementId,
  setBesignerCanvasHovered,
  setBesignerCanvasSelected,
} from '@aglyn/core-data-framework'
import {useAglynAppContext} from '@aglyn/core-feature-renderer'
import {type ChangeEvent, useCallback} from 'react'


export type UseAglynElementStatusManagers = [
  handleHover: (e: ChangeEvent<any>, $id?: ElementId) => void,
  handleSelect: (e: ChangeEvent<any>, $id?: ElementId) => void,
]


export function useAglynElementStatusManagers(
  $id: ElementId = null,
): UseAglynElementStatusManagers {
  const {getApp} = useAglynAppContext()
  const handleHover = useCallback((e, $idOverride: ElementId = null) => {
    e.stopPropagation()
    setBesignerCanvasHovered(getApp(), {
      hovered: (prev) => ({...prev, $id: $idOverride || $id}),
    })
  }, [$id, getApp])
  const handleSelect = useCallback((e, $idOverride: ElementId = null) => {
    e.preventDefault()
    e.stopPropagation()
    setBesignerCanvasSelected(getApp(), {
      selected: (prev) => ({...prev, $id: $idOverride || $id}),
    })
  }, [$id, getApp])

  return [handleHover, handleSelect]
}
export default useAglynElementStatusManagers
