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

import { BesignerContextStores, getBesignerStore } from '@aglyn/core-data-framework'
import { Conditional } from '@aglyn/shared-data-types'
import { useStoreMap } from 'effector-react'
import { useAglynAppContext } from '@aglyn/core-feature-renderer'


export function useAglynBesignerStoreState<K1 extends keyof BesignerContextStores>(
  store: K1,
): BesignerContextStores[K1]

export function useAglynBesignerStoreState<K1 extends keyof BesignerContextStores, K2 extends keyof BesignerContextStores[K1] = null>(
  store: K1,
  key: K2
): BesignerContextStores[K1][K2]

export function useAglynBesignerStoreState<K1 extends keyof BesignerContextStores,
  K2 extends keyof BesignerContextStores[K1] = null>(
  storeName: K1,
  key?: K2,
): Conditional<K2,
  keyof BesignerContextStores[K1],
  BesignerContextStores[K1][K2],
  keyof BesignerContextStores[K1]> {

  const {getApp} = useAglynAppContext()
  const app = getApp()
  const store = getBesignerStore(app, {store: storeName})
  return useStoreMap({
    store,
    keys: [storeName, key],
    fn: (store, [_, key]) => {
      if (key) {
        return store?.[key]
      }
      return store
    },
  }) as Conditional<K2,
    keyof BesignerContextStores[K1],
    BesignerContextStores[K1][K2],
    keyof BesignerContextStores[K1]>
}
export default useAglynBesignerStoreState
