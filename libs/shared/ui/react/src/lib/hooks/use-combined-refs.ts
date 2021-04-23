/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { useCallback, Ref, RefCallback, MutableRefObject } from 'react'

import { _isFn } from '@aglyn/shared/util/helpers'

/**
 * Assign a React ref object, could be a RefCallback or RefObject
 * @param ref
 * @param value
 */
export function assignRefValue<T>(ref: Ref<T>, value: any) {
  return !ref ? null : _isFn(ref) ? ref(value) : ((ref as MutableRefObject<T>).current = value)
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
    [refs]
  )
}

export default useCombinedRefs
