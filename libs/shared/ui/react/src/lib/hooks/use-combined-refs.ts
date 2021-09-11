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

import { _isFnT } from '@aglyn/shared/util/guards'
import { MutableRefObject, Ref, useCallback } from 'react'


/**
 * Assign a React ref object, could be a RefCallback or RefObject
 * @param ref
 * @param value
 */
export function assignRefValue<T>(ref: Ref<T>, value: any) {
  return !ref ? null : _isFnT(ref) ? ref(value) : ((ref as MutableRefObject<T>).current = value)
}

/**
 * Combines many refs into one. Useful for combining many ref hooks
 * @param refs
 */
export function useCombinedRefs<T>(...refs: Ref<T>[]): Ref<T> {
  return useCallback(
    (element: T) => {
      refs.forEach((ref) => assignRefValue(ref, element))
      return element
    },
    [refs],
  )
}

export default useCombinedRefs
