/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { EffectCallback, DependencyList, useEffect, useRef } from 'react'
import { _isFn } from '@aglyn/shared/util'

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
