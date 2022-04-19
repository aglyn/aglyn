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
} from '@aglyn/core-data-framework'
import {
  setBesignerCanvasHovered,
  setBesignerCanvasSelected,
} from '@aglyn/core-data-besigner'
import {useAglynAppContext} from '@aglyn/core-feature-renderer'
import {useCallback} from 'react'


export type UseAglynCanvasElementStatusManagers = [
  handleHover: ($id?: ElementId) => void,
  handleSelect: ($id?: ElementId) => void,
]


export function useAglynCanvasElementStatusManagers(
  $id: ElementId = null,
): UseAglynCanvasElementStatusManagers {
  const app = useAglynAppContext()
  const handleHover = useCallback(($idOverride: ElementId = null) => {
    setBesignerCanvasHovered(app, {
      hovered: (prev) => ({...prev, $id: $idOverride || $id}),
    })
  }, [$id, app])
  const handleSelect = useCallback(($idOverride: ElementId = null) => {
    setBesignerCanvasSelected(app, {
      selected: (prev) => ({...prev, $id: $idOverride || $id}),
    })
  }, [$id, app])

  return [handleHover, handleSelect]
}
export default useAglynCanvasElementStatusManagers
