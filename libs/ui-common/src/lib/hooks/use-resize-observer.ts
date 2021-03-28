import { useRef, useCallback } from 'react'
import ResizeObserver from 'resize-observer-polyfill'


export function useResizeObserver (
  callback: ResizeObserverCallback,
): [ResizeObserver['observe'], ResizeObserver['unobserve'], ResizeObserver['disconnect']] {

  const ref = useRef<ResizeObserver>(null)


  // This avoids creating an expensive object until it’s truly needed for the
  // first time. If you use Flow or TypeScript, you can also give getObserver()
  // a non-nullable type for convenience.
  const getObserver = () => {
    if (ref.current === null) {
      ref.current = new ResizeObserver(callback)
    }
    return ref.current
  }

  const observe = useCallback((target: Element) => {
    const observer = getObserver()
    if (observer) observer.observe(target)
  }, [ref])

  const unobserve = useCallback((target: Element) => {
    const observer = getObserver()
    if (observer) observer.unobserve(target)
  }, [ref])

  const disconnect = useCallback(() => {
    const observer = getObserver()
    if (observer) observer.disconnect()
  }, [ref])

  return [observe, unobserve, disconnect]
}

export default useResizeObserver
