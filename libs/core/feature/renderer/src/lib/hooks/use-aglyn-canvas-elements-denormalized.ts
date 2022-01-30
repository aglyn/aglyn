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

import {
  type AglynElementsById,
  getCanvasDenormalizedElementsStore,
} from '@aglyn/core-data-framework'
import {_isFnT} from '@aglyn/shared-util-guards'
import {useStoreMap} from 'effector-react'
import {useAglynAppContext} from '../contexts/aglyn-app-context'


export function useAglynCanvasElementsDenormalized(): AglynElementsById
export function useAglynCanvasElementsDenormalized<Result>(
  callbackFn: (state: AglynElementsById) => Result,
): Result
export function useAglynCanvasElementsDenormalized<Result>(
  callbackFn?: (state: AglynElementsById) => Result,
): Result | AglynElementsById {
  const {getApp} = useAglynAppContext()
  const app = getApp()
  const store = getCanvasDenormalizedElementsStore(app)
  return useStoreMap({
    store,
    keys: [callbackFn],
    fn: (state: AglynElementsById, [callbackFn]) => {
      return _isFnT(callbackFn) ? (callbackFn(state) as Result) : state
    },
  }) as Result | AglynElementsById
}
export default useAglynCanvasElementsDenormalized
