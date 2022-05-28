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
  useMemo,
} from 'react'


export type CombinedRefsResult<T> = [
  setRef: RefCallback<T>,
  ref: RefObject<T>,
]
export type RefParam<T> = Ref<T> | null | undefined

export const isRefCallback = <T, >(val: unknown): val is RefCallback<T> => _isFnT(val)
export const isRefObject = <T, >(val: unknown): val is RefObject<T> => _isObj(val)

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
export function useRefForked<InstanceA, InstanceB>(
  refB: RefParam<InstanceB>,
): [RefObject<InstanceA>, Ref<InstanceA & InstanceB> | null]
export function useRefForked<InstanceA, InstanceB, InstanceC>(
  refB: RefParam<InstanceB>,
  refC: RefParam<InstanceC>,
): [RefObject<InstanceA>, Ref<InstanceA & InstanceB & InstanceC> | null]
export function useRefForked<InstanceA, InstanceB, InstanceC, InstanceD>(
  refB: RefParam<InstanceB>,
  refC: RefParam<InstanceC>,
  refD: RefParam<InstanceD>,
): [RefObject<InstanceA>, Ref<InstanceA & InstanceB & InstanceC & InstanceD> | null]
export function useRefForked<InstanceA, InstanceB, InstanceC, InstanceD, InstanceE>(
  refB: RefParam<InstanceB>,
  refC: RefParam<InstanceC>,
  refD: RefParam<InstanceD>,
  refE: RefParam<InstanceE>,
): [RefObject<InstanceA>, Ref<InstanceA & InstanceB & InstanceC & InstanceD & InstanceE> | null]
export function useRefForked<InstanceA, InstanceB, InstanceC, InstanceD, InstanceE>(
  refB: RefParam<InstanceB>,
  refC?: RefParam<InstanceC>,
  refD?: RefParam<InstanceD>,
  refE?: RefParam<InstanceE>,
): [RefObject<InstanceA>, Ref<InstanceA & InstanceB & InstanceC & InstanceD & InstanceE> | null] {
  const refA = useRef<InstanceA>()
  const forkedRefs = useForkedRefs(refA, refB, refC, refD, refE)
  return [refA, forkedRefs]
}

export function useForkedRefs<InstanceA, InstanceB>(
  refA: RefParam<InstanceA>,
  refB: RefParam<InstanceB>,
): Ref<InstanceA & InstanceB> | null
export function useForkedRefs<InstanceA, InstanceB, InstanceC>(
  refA: RefParam<InstanceA>,
  refB: RefParam<InstanceB>,
  refC: RefParam<InstanceC>,
): Ref<InstanceA & InstanceB & InstanceC> | null
export function useForkedRefs<InstanceA, InstanceB, InstanceC, InstanceD>(
  refA: RefParam<InstanceA>,
  refB: RefParam<InstanceB>,
  refC: RefParam<InstanceC>,
  refD: RefParam<InstanceD>,
): Ref<InstanceA & InstanceB & InstanceC & InstanceD> | null
export function useForkedRefs<InstanceA, InstanceB, InstanceC, InstanceD, InstanceE>(
  refA: RefParam<InstanceA>,
  refB: RefParam<InstanceB>,
  refC: RefParam<InstanceC>,
  refD: RefParam<InstanceD>,
  refE: RefParam<InstanceE>,
): Ref<InstanceA & InstanceB & InstanceC & InstanceD & InstanceE> | null
export function useForkedRefs<InstanceA, InstanceB, InstanceC, InstanceD, InstanceE>(
  refA: RefParam<InstanceA>,
  refB: RefParam<InstanceB>,
  refC?: RefParam<InstanceC>,
  refD?: RefParam<InstanceD>,
  refE?: RefParam<InstanceE>,
): Ref<InstanceA & InstanceB & InstanceC & InstanceD & InstanceE> | null {
  /**
   * This will create a new function if the ref props change and are defined.
   * This means react will call the old forkRef with `null` and the new forkRef
   * with the ref. Cleanup naturally emerges from this behavior.
   */
  return useMemo(() => {
    if (
      refA == null
      && refB == null
      && refC == null
      && refD == null
      && refE == null
    ) {
      return null
    }
    return (refValue) => {
      assignRef(refA, refValue)
      assignRef(refB, refValue)
      assignRef(refC, refValue)
      assignRef(refD, refValue)
      assignRef(refE, refValue)
    };
  }, [refA, refB, refC, refD, refE]);
}

export default useRefForked
