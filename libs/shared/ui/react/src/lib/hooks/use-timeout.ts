/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { useEffect, useRef } from 'react'
import { _isFn } from '@aglyn/shared/util'

export function useTimeout(callback: TimerHandler, delay: number, ...args: any[]): void {
  const savedCallback = useRef(null)

  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  useEffect(() => {
    let timeout = undefined

    const handler = (...args) => {
      if (_isFn(savedCallback.current)) {
        savedCallback.current(...args)
      }
    }

    if (delay !== null) {
      timeout = setTimeout(handler, delay, ...args)
      return () => clearTimeout(timeout)
    }
  }, [delay])
}

export default useTimeout
