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

import { ElementId, getBesignerStore } from '@aglyn/core-data-framework'
import { useAglynAppContext } from '@aglyn/core-feature-renderer'
import { deepEqual } from '@aglyn/shared-util-vendor'
import { useStoreMap } from 'effector-react'


export interface UseBesignerElementInteractionActivity {
  isSelfSelected: boolean
  isSelfHovered: boolean
  isChildSelected: boolean
  isChildHovered: boolean
}

const checkHierarchy = (v: string[], $id: ElementId) =>
  (v || [])?.some((id, i, a) => id === $id && i !== a.length - 1)

export const useBesignerElementInteractionActivity = (
  $id: ElementId,
): UseBesignerElementInteractionActivity => {
  const {getApp} = useAglynAppContext(),
    store = getBesignerStore(getApp(), {store: 'canvas'})

  return useStoreMap({
    store,
    keys: [$id],
    fn(state, [$id]) {
      const selected = state?.selected,
        hovered = state?.hovered

      const isSelfSelected = $id && selected?.$id === $id,
        isSelfHovered = $id && hovered?.$id === $id,
        isChildSelected = $id && checkHierarchy(selected?.hierarchy, $id),
        isChildHovered = $id && checkHierarchy(hovered?.hierarchy, $id)

      return {
        isSelfSelected: Boolean(isSelfSelected),
        isSelfHovered: Boolean(isSelfHovered),
        isChildSelected: Boolean(isChildSelected),
        isChildHovered: Boolean(isChildHovered),
      }
    },
    updateFilter(newValue, prevValue) {
      return !deepEqual(newValue, prevValue, {strict: true})
    },
  })
}

export default useBesignerElementInteractionActivity
