/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import { useEffect, useRef } from 'react'
import { _isFn } from '@aglyn/shared/util/helpers'

export function useInterval(callback: TimerHandler, delay: number, count?: number, ...args: any[]): void {
  const savedCallback = useRef(null)
  const runCount = useRef(0)

  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  useEffect(() => {
    let interval = undefined

    const handler = (...handlerArgs) => {
      if (_isFn(savedCallback.current)) {
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
  }, [delay, count])
}

export default useInterval
