import { EffectCallback, DependencyList, useEffect, useRef } from 'react'
import { _isFn } from '@aglyn/tools'


export function useEffectPostMount(callback: EffectCallback, deps?: DependencyList): void {
  const isOnInitialMount = useRef(true)

  useEffect(() => {
    if (!isOnInitialMount.current) {
      return _isFn(callback) && callback()
    }
    isOnInitialMount.current = false
  }, deps)
}

export default useEffectPostMount
