/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { useCallback, useRef } from 'react'

// Create an observer instance linked to the callback function
// const Observer = new MutationObserver(callback)

// const observerCtx = createContext(observer)

export function useIntersectionObserver(
  callback: IntersectionObserverCallback,
  options?: IntersectionObserverInit,
): [
  observe: IntersectionObserver['observe'],
  unobserve: IntersectionObserver['unobserve'],
  disconnect: IntersectionObserver['disconnect'],
  takeRecords: IntersectionObserver['takeRecords'],
  getObserver: () => IntersectionObserver,
] {
  const ref = useRef<IntersectionObserver>(null)

  // This avoids creating an expensive object until it’s truly needed for the first time.
  const getObserver = useCallback((): IntersectionObserver => {
    return (ref.current ??= new IntersectionObserver(callback, options))
  }, [callback, options])

  const observe = useCallback(
    (target: Element) => getObserver()?.observe(target),
    [getObserver],
  )
  const unobserve = useCallback(
    (target: Element) => getObserver()?.unobserve(target),
    [getObserver],
  )
  const disconnect = useCallback(
    () => getObserver()?.disconnect(),
    [getObserver],
  )
  const takeRecords = useCallback(
    () => getObserver()?.takeRecords(),
    [getObserver],
  )

  return [observe, unobserve, disconnect, takeRecords, getObserver]
}

export default useIntersectionObserver
