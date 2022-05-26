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

import {_isFnT, _isObj} from '@aglyn/shared-util-guards'
import {
  type MutableRefObject,
  type Ref,
  type RefCallback,
  type RefObject,
  useCallback,
  useRef,
} from 'react'


export type CombinedRefsResult<T> = [
  setRef: RefCallback<T>,
  ref: RefObject<T>,
]

export const isRefCallback = <T, >(val: unknown): val is RefCallback<T> => _isFnT(val)
export const isRefObject = <T, >(val: unknown): val is RefObject<T> => _isObj(val)

/**
 * Assign a React ref object, could be a RefCallback or RefObject
 */
export function assignRefValue<T>(ref: Ref<T>, value: T): T {
  if (isRefCallback(ref)) ref(value)
  else if (isRefObject(ref)) (ref as MutableRefObject<T>).current = value
  return value
}

/**
 * Combines multiple RefCallback|RefObject into one.
 */
export function useCombinedRefs<T>(
  ref: Ref<T>,
  ...others: Ref<T>[]
): RefCallback<T> {
  const local = useRef<T>()
  const setRef = useCallback((instance: T) => {
    const all = [local, ref, ...others]
    return all.reduceRight((accumulator, ref) => {
      return assignRefValue(ref, accumulator)
    }, instance)
    // for (const ref of all) {
    //   assignRefValue(ref, instance)
    // }
    // return instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return setRef
}

export default useCombinedRefs
