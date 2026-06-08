/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { getCanvasNormalizedNodesStore } from '@aglyn/core-data-app'
import type { NodeId } from '@aglyn/core-data-foundation'
import { getComponentElementHierarchy } from '@aglyn/core-util-app'
import { useSubscribable } from '@aglyn/shared-ui-jsx'
import useBesignerAppContext from './use-besigner-app-context'

type ElementSelfStatus = {
  isSelfHovered: boolean
  isSelfSelected: boolean
}
type ElementSelfChildStatus = {
  isSelfHovered: boolean
  isSelfSelected: boolean
  isChildHovered?: boolean
  isChildSelected?: boolean
}

export type AglynCanvasElementStatus<T> = Conditional<
  T,
  true,
  ElementSelfChildStatus,
  ElementSelfStatus
>

export function useAglynCanvasElementStatus<T extends boolean = false>(
  $id: NodeId,
  includeChildStatus: T = false as T,
): AglynCanvasElementStatus<T> {
  const app = useBesignerAppContext()
  const value = useSubscribable<AglynCanvasElementStatus<T>>(
    app.interface?.canvas,
    () => {
      const initialValue: ElementSelfChildStatus = {
        isSelfHovered: false,
        isSelfSelected: false,
      }
      if (includeChildStatus) {
        initialValue.isChildHovered = false
        initialValue.isChildSelected = false
      }
      return initialValue
    },
    (canvas) => {
      const response: ElementSelfChildStatus = {
        isSelfHovered: Boolean($id && canvas?.hovered?.$id === $id),
        isSelfSelected: Boolean($id && canvas?.selected?.$id === $id),
      }
      if (includeChildStatus) {
        const elements = getCanvasNormalizedNodesStore(app).getValue()
        const selectedHierarchy = getComponentElementHierarchy(
          canvas?.selected?.$id,
          elements,
        )
        const hoverHierarchy = getComponentElementHierarchy(
          canvas?.hovered?.$id,
          elements,
        )
        response.isChildSelected = Boolean(
          $id && checkHierarchy(selectedHierarchy, $id),
        )
        response.isChildHovered = Boolean(
          $id && checkHierarchy(hoverHierarchy, $id),
        )
      }
      return response
    },
    [$id, app],
  )

  return value

  function checkHierarchy(v: string[], $id: NodeId) {
    return (v || [])?.some((id, i, a) => id === $id && i !== a.length - 1)
  }
}

export default useAglynCanvasElementStatus
