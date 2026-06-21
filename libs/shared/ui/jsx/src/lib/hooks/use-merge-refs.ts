/**
 * @license
 * Copyright 2023 Aglyn LLC
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
  type ForwardedRef,
  type MutableRefObject,
  type RefCallback,
  useMemo,
} from 'react'

/**
 * Check if value is of type function similar to a ref callback
 */
export function isRefCallback<T>(val: ForwardedRef<T>): val is RefCallback<T> {
  return typeof val === 'function'
}

/**
 * Check if value is of mutable ref object
 */
export function isRefObject<T>(
  val: ForwardedRef<T>,
): val is MutableRefObject<T> {
  return Boolean(val && 'current' in val)
}

/**
 * Assign a React ref object, could be a RefCallback or RefObject
 */
export function assignRef<T>(ref: ForwardedRef<T>, value: T): T {
  if (isRefCallback(ref)) ref(value)
  else if (isRefObject(ref)) ref.current = value
  return value
}

/**
 * Merges multiple refs into one. Works with either callback or object refs.
 */
export function mergeRefs<T>(...refs: ForwardedRef<T>[]): RefCallback<T> {
  if (refs.every((ref) => ref === null)) return null
  return (value: T) => {
    for (const ref of refs) {
      assignRef(ref, value)
    }
  }
}

/**
 * Merges multiple refs into one, by returning a new memoized ref callback
 */
export function useMergeRefs<T>(...refs: ForwardedRef<T>[]): RefCallback<T> {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => mergeRefs(...refs), refs)
}

export default useMergeRefs
