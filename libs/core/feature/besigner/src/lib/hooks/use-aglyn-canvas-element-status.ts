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


import {getBesignerStore} from '@aglyn/core-data-besigner'
import {
  type ElementId,
  getCanvasDenormalizedElementsStore,
  getComponentElementHierarchy,
} from '@aglyn/core-data-framework'
import {useAglynAppContext} from '@aglyn/core-feature-renderer'
import {type Conditional} from '@aglyn/shared-data-types'
import {useStoreMap} from 'effector-react'


type ElementSelfStatus = {
  isSelfHovered: boolean
  isSelfSelected: boolean
}
type ElementChildStatus = {
  isChildHovered?: boolean
  isChildSelected?: boolean
}

export type AglynCanvasElementStatus<T> =
  Conditional<T, true, ElementSelfStatus & ElementChildStatus, ElementSelfStatus>

export function useAglynCanvasElementStatus<T extends boolean = false>(
  $id: ElementId,
  includeChildStatus: T = false as T,
): AglynCanvasElementStatus<T> {
  const {getApp} = useAglynAppContext()
  const canvasStore = getBesignerStore(getApp(), {store: 'canvas'})

  return useStoreMap({
    store: canvasStore,
    keys: [$id, includeChildStatus, getApp],
    fn: (store, [$id, includeChildStatus, getApp]) => {
      const response: AglynCanvasElementStatus<T> = {
        isSelfHovered: Boolean($id && store.hovered?.$id === $id),
        isSelfSelected: Boolean($id && store.selected?.$id === $id),
      }
      if (!includeChildStatus) return response

      const elements = getCanvasDenormalizedElementsStore(getApp()).getState()
      const selectedHierarchy = getComponentElementHierarchy(store?.selected?.$id, elements)
      const hoverHierarchy = getComponentElementHierarchy(store?.hovered?.$id, elements)
      response['isChildSelected'] = Boolean($id && checkHierarchy(selectedHierarchy, $id))
      response['isChildHovered'] = Boolean($id && checkHierarchy(hoverHierarchy, $id))

      return response
    },
  })

  function checkHierarchy(v: string[], $id: ElementId) {
    return (v || [])?.some((id, i, a) => id === $id && i !== a.length - 1)
  }
}

export default useAglynCanvasElementStatus
