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

import { _isArr, _isFnT, _isNum, _isNumPos, _isObj } from '@aglyn/shared/util/guards'
import { useCallback, useEffect, useRef, useState } from 'react'


interface Options {
  // The millisecond delay count
  msDelay?: number

  // Args to pass the interval or timeout
  args?: any[]

  // Will use interval instead of timeout
  repeat?: boolean

  // If present and repeat is true will limit the amount of time it may execute
  limit?: number

  // Will be called if limit count has been reached
  onLimitReach?: (params: { startTime: number; endTime: number }) => void

  // If true will run timeout/interval immediately when initializing after mount
  immediate?: boolean
}

type StartTimeout = (options?: Options) => void
type ClearTimeout = () => void
type TimeoutReturn = [StartTimeout, ClearTimeout]

// If Handler return true and repeat is true it will terminate the interval
type Handler = (params: HandlerParams) => boolean | void
type HandlerParams = {
  // The total count of time the callback has been called
  runCount: number

  // The time since the first execution
  startTime: ReturnType<typeof Date.now>

  // Args passed from the timeout/interval
  args?: any[]
}

/**
 * Use a document timeout or an interval handler, you may either define the options with
 * the use call or you can pass the options when starting the timeout
 *
 * Pass repeat within options to use an interval. Defaults to a single run timeout
 *
 * @param {TimerHandler} callback
 * @param {Options} options
 * @return {TimeoutReturn}
 */
export function useTimeoutDelay(callback: Handler, options?: Options): TimeoutReturn {
  const [state] = useState<Options>(() => (_isObj(options) ? options : {}))
  const [mounted, setMounted] = useState(false)
  const savedCallback = useRef(null)
  const ref = useRef({runCount: 0, timeoutRef: null, startTime: null})

  // On mount and callback updates update the ref
  useEffect(() => {
    savedCallback.current = (params: HandlerParams) => {
      if (_isFnT(callback)) {
        return callback(params)
      }
    }
  }, [callback])

  // Clear the interval or timeout
  const clear = useCallback(() => {
    if (ref.current.timeoutRef) {
      console.log('clear-del', ref)

      state.repeat ? clearInterval(ref.current.timeoutRef) : clearTimeout(ref.current.timeoutRef)

      ref.current.timeoutRef = null
    }
  }, [state, ref])

  // Start the interval or timeout
  const start = useCallback(
    (opt?: Options) => {
      if (false) {
        console.error('Can\'t start timeout or interval when unmounted')
        return
      }
      else if (ref.current.timeoutRef) {
        console.warn('Can\'t start timeout or interval when one is already running', ref.current.timeoutRef)
      }

      // Merge param opts with global opts
      const {
        msDelay: optDelay = null,
        args: optArgs = null,
        repeat: optRepeat = false,
        limit: optLimit = null,
        onLimitReach: optOnLimitReach = null,
      } = {
        ...state,
        ...(_isObj(opt) ? opt : {}), // Merge parameter options
      }

      // Args array
      const argArgs = _isArr(optArgs) ? optArgs : []
      // Determine if we're using global delay or parameter delay
      const ms = _isNum(optDelay) ? (_isNum(state.msDelay) ? state.msDelay : 0) : optDelay || 0

      const max = _isNumPos(optLimit) ? optLimit : null

      // If run limit was provide ensure we don't run more than specified
      const handler = (arg: HandlerParams['args']) => {
        let reqCancel = false

        if (!optRepeat || !max || ref.current.runCount < max) {
          ref.current.runCount = ref.current.runCount + 1

          const res = savedCallback.current({
            runCount: Number(ref.current.runCount),
            startTime: Number(ref.current.startTime),
            args: arg,
          })

          // If returned true the user is requesting a cancellation
          if (res) {
            reqCancel = true
          }
        }

        const limitReached = Boolean(optRepeat && max && ref.current.runCount >= max)
        const toCancel = Boolean(optRepeat && reqCancel)

        // Make sure to clear the interval if on last run
        if (limitReached || toCancel) {
          clear()

          // Run limit reach callback
          limitReached &&
          _isFnT(optOnLimitReach) &&
          optOnLimitReach({
            startTime: Number(ref.current.startTime),
            endTime: Number(Date.now()),
          })
        }
      }

      // Set the reference values and start the interval/timeout
      ref.current = {
        runCount: 0,
        startTime: Date.now(),
        timeoutRef: optRepeat ? setInterval(handler, ms, ...argArgs) : setTimeout(handler, ms, ...argArgs),
      }
    },
    [state, ref, clear],
  )

  // When mounted set mounted
  // Otherwise clear the timeout/interval when we unmount
  useEffect(() => {
    setMounted(true)

    if (state.immediate) {
      start()
    }

    return () => {
      clear()
      setMounted(false)
    }
  }, [state.immediate, clear])

  return [start, clear]
}

export default useTimeoutDelay
