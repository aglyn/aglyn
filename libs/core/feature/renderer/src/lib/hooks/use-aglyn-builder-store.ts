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

import { BuilderContextStores, getBuilderStore } from '@aglyn/core-data-framework'
import { Conditional } from '@aglyn/shared-data-types'
import { useStoreMap } from 'effector-react'
import { useAglynAppContext } from '../contexts/aglyn-app-context'

export function useAglynBuilderStore<K1 extends keyof BuilderContextStores>(
  store: K1
): BuilderContextStores[K1]
export function useAglynBuilderStore<
  K1 extends keyof BuilderContextStores,
  K2 extends keyof BuilderContextStores[K1] = null
>(store: K1, key: K2): BuilderContextStores[K1][K2]
export function useAglynBuilderStore<
  K1 extends keyof BuilderContextStores,
  K2 extends keyof BuilderContextStores[K1] = null
>(
  storeName: K1,
  key?: K2
): Conditional<
  K2,
  keyof BuilderContextStores[K1],
  BuilderContextStores[K1][K2],
  keyof BuilderContextStores[K1]
> {
  const { getApp } = useAglynAppContext()
  const app = getApp()
  const store = getBuilderStore(app, { store: storeName })
  return useStoreMap({
    store,
    keys: [storeName, key],
    fn: (store, [_, key]) => {
      if (key) {
        return store?.[key]
      }
      return store
    },
  }) as Conditional<
    K2,
    keyof BuilderContextStores[K1],
    BuilderContextStores[K1][K2],
    keyof BuilderContextStores[K1]
  >
}
export default useAglynBuilderStore
