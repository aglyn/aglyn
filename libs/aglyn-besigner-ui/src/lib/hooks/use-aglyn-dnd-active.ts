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

import type {
  BesignerDndState,
  BesignerDraggableItem,
} from '@aglyn/besigner-data-app'
import { setBesignerDndItem } from '@aglyn/besigner-data-app'
import { useSubscribable } from '@aglyn/shared-ui-jsx'
import { _isFnT } from '@aglyn/shared-util-tools'
import { useCallback } from 'react'
import useBesignerAppContext from './use-besigner-app-context'

export function useAglynDndActive(): [
  value: BesignerDraggableItem | undefined,
  setValue: (
    value:
      | BesignerDraggableItem
      | ((
          prev: BesignerDraggableItem,
          dnd: BesignerDndState,
        ) => BesignerDraggableItem),
  ) => void,
] {
  const app = useBesignerAppContext()
  const value = useSubscribable<BesignerDraggableItem>(
    app.interface?.dnd,
    undefined,
    (dnd) => dnd?.active,
    [app],
  )
  const setDndActive = useAglynDndSetActive()

  return [value, setDndActive]
}

export default useAglynDndActive

export function useAglynDndSetActive(): (
  value:
    | BesignerDraggableItem
    | ((
        prev: BesignerDraggableItem,
        dnd: BesignerDndState,
      ) => BesignerDraggableItem),
) => void {
  const app = useBesignerAppContext()
  return useCallback(
    (
      value:
        | BesignerDraggableItem
        | ((
            prev: BesignerDraggableItem,
            dnd: BesignerDndState,
          ) => BesignerDraggableItem),
    ) => {
      setBesignerDndItem(app, {
        item: 'active',
        value: (prev, dnd) => (_isFnT(value) ? value(prev, dnd) : value),
      })
    },
    [app],
  )
}
