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

import {_isFnT} from '@aglyn/shared-util-guards'
import {MutableRefObject, Ref, RefCallback, useCallback} from 'react'


function isRefCallback<T>(val): val is RefCallback<T> {
  return _isFnT(val)
}

/**
 * Assign a React ref object, could be a RefCallback or RefObject
 * @param {React.Ref<T>} ref- RefCallback or RefObject or null, to assign value
 * @param {T} value - new ref value
 * @returns {Ref<T>} - the same passed ref
 */
function assignRefValue<T>(ref: Ref<T>, value: T): Ref<T> {
  if (!ref) return null
  if (isRefCallback(ref)) {
    ref(value)
  }
  else {
    (ref as MutableRefObject<T>).current = value
  }
  return ref
}

function handleMultipleRefs<T>(...refs: Ref<T>[]): (element: T) => T {
  return (element: T) => {
    refs.forEach((ref) => assignRefValue(ref, element))
    return element
  }
}

/**
 * Combines multiple RefCallback|RefObject into one.
 * @param {React.Ref<T>} refs - 1 or more refs to be assigned
 * @returns {React.RefCallback<T>} - callback to pass to elem ref prop
 */
export function useCombinedRefs<T>(...refs: Ref<T>[]): (element: T) => T {
  return useCallback((element: T) => {
    return handleMultipleRefs(...refs)(element)
  }, [refs])
}

export default useCombinedRefs
