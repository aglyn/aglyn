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

import type { AglynComponentElementDataNormalized, ElementId } from '@aglyn/core-data-framework'
import { getCanvasNormalizedElementsStore } from '@aglyn/core-data-framework'
import type { AnyProps, Conditional, EmptyObj } from '@aglyn/shared-data-types'
import { useStoreMap } from 'effector-react'
import { useAglynAppContext } from '../contexts/aglyn-app-context'

export type UseAglynElementData<
  P = AnyProps,
  K extends keyof AglynComponentElementDataNormalized<P> = null
> = Conditional<
  K,
  keyof AglynComponentElementDataNormalized<P>,
  AglynComponentElementDataNormalized<P>[K],
  AglynComponentElementDataNormalized<P>
>

export function useAglynElementData<P = EmptyObj>(
  $id: ElementId
): AglynComponentElementDataNormalized<P>

export function useAglynElementData<
  P = EmptyObj,
  K extends keyof AglynComponentElementDataNormalized<P> = null,
>($id: ElementId, key: K): AglynComponentElementDataNormalized<P>[K]

export function useAglynElementData<
  P = EmptyObj,
  K extends keyof AglynComponentElementDataNormalized<P> = null
>($id: ElementId, key?: K)/*: UseAglynElementData<P, K>*/ {
  const { getApp } = useAglynAppContext()
  const store = getCanvasNormalizedElementsStore(getApp())

  return useStoreMap({
    store,
    keys: [$id, key],
    fn: (store, [$id, key]) => {
      if (!key) {
        return store[$id]
      }
      return store[$id]?.[key]
    },
  }) //as UseAglynElementData<P, K>
}
export default useAglynElementData
