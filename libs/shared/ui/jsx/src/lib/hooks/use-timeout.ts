/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import { _isFnT } from '@aglyn/shared-util-tools'
import { useEffect, useRef } from 'react'

export function useTimeout(
  callback: TimerHandler,
  delay: number,
  ...args: any[]
): void {
  const savedCallback = useRef(null)

  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> = undefined

    const handler = (...args: unknown[]) => {
      if (_isFnT(savedCallback.current)) {
        savedCallback.current(...args)
      }
    }

    if (delay !== null) {
      timeout = setTimeout(handler, delay, ...args)
      return () => clearTimeout(timeout)
    }
    return undefined
    // args is a rest param (new array each render) — omit from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay])
}

export default useTimeout
