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

export function useInterval(
  callback: TimerHandler,
  delay: number,
  count?: number,
  ...args: any[]
): void {
  const savedCallback = useRef(null)
  const runCount = useRef(0)

  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> = undefined

    const handler = (...handlerArgs: unknown[]) => {
      if (_isFnT(savedCallback.current)) {
        if (runCount.current < count || !count) {
          runCount.current = runCount.current + 1
          savedCallback.current(...handlerArgs)
        }

        // Make sure to clear the interval if on last run
        if (count && interval && runCount.current >= count) {
          clearInterval(interval)
        }
      }
    }

    if (delay !== null) {
      interval = setInterval(handler, delay, ...args)
      return () => clearInterval(interval)
    }
    return undefined
    // args is a rest param (new array each render) — omit from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay, count])
}

export default useInterval
