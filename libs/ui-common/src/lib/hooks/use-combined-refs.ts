import {useCallback, Ref, RefCallback, MutableRefObject} from 'react'

import {_isFn} from '@aglyn/tools'

/**
 * Assign a React ref object, could be a RefCallback or RefObject
 * @param ref
 * @param value
 */
export function assignRefValue<T>(ref: Ref<T>, value: any) {
  return !ref ? null
    : _isFn(ref) ? ref(value)
      : (ref as MutableRefObject<T>).current = value
}

/**
 * Combines many refs into one. Useful for combining many ref hooks
 * @param refs
 */
export function useCombinedRefs<T>(...refs: Ref<T>[]): Ref<T> {
  return useCallback((element: T) => {
    refs.forEach(ref => assignRefValue(ref, element))
    return element
  }, [refs])
}

export default useCombinedRefs
