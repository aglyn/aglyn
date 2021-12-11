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
  AglynComponentElementDataNormalizedMap,
  getCanvasNormalizedElementsStore,
} from '@aglyn/core-data-framework'
import { _isFnT } from '@aglyn/shared-util-guards'
import { useStoreMap } from 'effector-react'
import { useAglynAppContext } from '../contexts/aglyn-app-context'

export function useAglynCanvasElementsNormalized(): AglynComponentElementDataNormalizedMap
export function useAglynCanvasElementsNormalized<Result>(
  callbackFn: (state: AglynComponentElementDataNormalizedMap) => Result
): Result
export function useAglynCanvasElementsNormalized<Result>(
  callbackFn?: (state: AglynComponentElementDataNormalizedMap) => Result
): Result | AglynComponentElementDataNormalizedMap {
  const { getApp } = useAglynAppContext()
  const app = getApp()
  const store = getCanvasNormalizedElementsStore(app)
  return useStoreMap({
    store,
    keys: [callbackFn],
    fn: (state, [callbackFn]) => {
      return _isFnT(callbackFn) ? (callbackFn(state) as Result) : state
    },
  })
}
export default useAglynCanvasElementsNormalized
