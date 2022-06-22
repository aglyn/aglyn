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

import { _isFnT, _isObj } from '@aglyn/shared-util-guards'
import {
  type MutableRefObject,
  type Ref,
  type RefCallback,
  type RefObject,
  useMemo,
  useRef,
} from 'react'

export type RefParam<T> = Ref<T> | null | undefined

export const isRefCallback = <T>(val: unknown): val is RefCallback<T> =>
  _isFnT(val)
export const isRefObject = <T>(val: unknown): val is RefObject<T> => _isObj(val)

/**
 * Assign a React ref object, could be a RefCallback or RefObject
 */
export function assignRef<T>(ref: Ref<T>, value: T): T {
  if (isRefCallback(ref)) ref(value)
  else if (isRefObject(ref)) (ref as MutableRefObject<T>).current = value
  return value
}

/**
 * Combines multiple RefCallback|RefObject into one.
 */
export function useRefForked<Instance>(
  refB: RefParam<Instance>,
): [RefCallback<Instance>, RefObject<Instance>]
export function useRefForked<Instance>(
  refB: RefParam<Instance>,
  refC: RefParam<Instance>,
): [RefCallback<Instance>, RefObject<Instance>]
export function useRefForked<Instance>(
  refB: RefParam<Instance>,
  refC: RefParam<Instance>,
  refD: RefParam<Instance>,
): [RefCallback<Instance>, RefObject<Instance>]
export function useRefForked<Instance>(
  refB: RefParam<Instance>,
  refC: RefParam<Instance>,
  refD: RefParam<Instance>,
  refE: RefParam<Instance>,
): [RefCallback<Instance>, RefObject<Instance>]
export function useRefForked<Instance>(
  refB: RefParam<Instance>,
  refC?: RefParam<Instance>,
  refD?: RefParam<Instance>,
  refE?: RefParam<Instance>,
): [RefCallback<Instance>, RefObject<Instance>] {
  const refObject = useRef<Instance>()
  const refCallback = useForkedRefs(refObject, refB, refC, refD, refE)
  return [refCallback, refObject]
}

export function useForkedRefs<Instance>(
  refA: RefParam<Instance>,
  refB: RefParam<Instance>,
): RefCallback<Instance> | null
export function useForkedRefs<Instance>(
  refA: RefParam<Instance>,
  refB: RefParam<Instance>,
  refC: RefParam<Instance>,
): RefCallback<Instance> | null
export function useForkedRefs<Instance>(
  refA: RefParam<Instance>,
  refB: RefParam<Instance>,
  refC: RefParam<Instance>,
  refD: RefParam<Instance>,
): RefCallback<Instance> | null
export function useForkedRefs<Instance>(
  refA: RefParam<Instance>,
  refB: RefParam<Instance>,
  refC: RefParam<Instance>,
  refD: RefParam<Instance>,
  refE: RefParam<Instance>,
): RefCallback<Instance> | null
export function useForkedRefs<Instance>(
  refA: RefParam<Instance>,
  refB: RefParam<Instance>,
  refC?: RefParam<Instance>,
  refD?: RefParam<Instance>,
  refE?: RefParam<Instance>,
): RefCallback<Instance> | null {
  /**
   * This will create a new function if the ref props change and are defined.
   * This means react will call the old forkRef with `null` and the new forkRef
   * with the ref. Cleanup naturally emerges from this behavior.
   */
  return useMemo(() => {
    if (
      refA == null &&
      refB == null &&
      refC == null &&
      refD == null &&
      refE == null
    ) {
      return null
    }
    return (refValue) => {
      assignRef(refA, refValue)
      assignRef(refB, refValue)
      assignRef(refC, refValue)
      assignRef(refD, refValue)
      assignRef(refE, refValue)
    }
  }, [refA, refB, refC, refD, refE])
}

export default useRefForked
