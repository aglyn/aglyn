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
  ElementsDataStore,
  ElementsDataStoreApi,
  getContextStore,
  getContextStoreApi,
} from '@aglyn/core-data-framework'
import { useStoreMap } from 'effector-react'
import { useMemo } from 'react'
import { useAglynAppContext } from '../contexts/aglyn-app-context'


export function useAglynElementsStoreWithApi(
  state: 'present' | 'past' | 'future' = 'present',
): { elements: ElementsDataStore[typeof state], api: ElementsDataStoreApi } {
  const {getApp} = useAglynAppContext()
  const store = getContextStore<ElementsDataStore>(getApp(), {storeId: 'elements'})
  const api = getContextStoreApi<ElementsDataStoreApi>(getApp(), {storeId: 'elements:api'})
  const elements = useStoreMap(store, (store) => store[state || ''])
  return useMemo(() => {
    return {elements, api}
  }, [elements, api])
}
export default useAglynElementsStoreWithApi
