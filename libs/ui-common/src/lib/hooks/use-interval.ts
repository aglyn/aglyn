import { useEffect, useRef } from 'react'
import { _isFn } from '@aglyn/tools'


export function useInterval(
  callback: TimerHandler, delay: number, count?: number, ...args: any[]
): void {

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
