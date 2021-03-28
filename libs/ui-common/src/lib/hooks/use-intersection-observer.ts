import React from 'react'


// Create an observer instance linked to the callback function
// const Observer = new MutationObserver(callback)

// const observerCtx = React.createContext(observer)

export function useIntersectionObserver (
  callback: IntersectionObserverCallback, options?: IntersectionObserverInit,
): [IntersectionObserver['observe'], IntersectionObserver['unobserve'], IntersectionObserver['disconnect'], IntersectionObserver['takeRecords']] {
  const ref = React.useRef<IntersectionObserver>(null)

  // This avoids creating an expensive object until it’s truly needed for the first time.
  function getObserver (): IntersectionObserver {
    if (ref.current === null) {
      ref.current = new IntersectionObserver(callback, options)
    }

    return ref.current
  }

  const observe = React.useCallback((target: Element) => {
    const observer = getObserver()
    if (observer) observer.observe(target)
  }, [ref])

  const unobserve = React.useCallback((target: Element) => {
    const observer = getObserver()
    if (observer) observer.unobserve(target)
  }, [ref])

  const disconnect = React.useCallback(() => {
    const observer = getObserver()
    if (observer) observer.disconnect()
  }, [ref])

  const takeRecords = React.useCallback(() => {
    const observer = getObserver()
    if (observer) {
      return observer.takeRecords()
    }
  }, [ref])

  return [observe, unobserve, disconnect, takeRecords]
}

export default useIntersectionObserver
