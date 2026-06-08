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
import useCallbackParamRef from './use-callback-param-ref'

// Create an observer instance linked to the callback function
// const Observer = new MutationObserver(callback)

// const observerCtx = createContext(observer)

export function useObserverIntersection(
  ctorCallback: IntersectionObserverCallback,
  options?: IntersectionObserverInit,
): [
  observe: IntersectionObserver['observe'],
  unobserve: IntersectionObserver['unobserve'],
  disconnect: IntersectionObserver['disconnect'],
  takeRecords: IntersectionObserver['takeRecords'],
  getObserver: () => IntersectionObserver,
] {
  const callback = useCallbackParamRef(ctorCallback)
  const ref = useRef<IntersectionObserver>(null)

  // This avoids creating an expensive object until it’s truly needed for the first time.
  const getObserver = useCallback((): IntersectionObserver => {
    return (ref.current ??= new IntersectionObserver(callback.current, options))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options])

  const observe = useCallback(
    (...args: Parameters<IntersectionObserver['observe']>) =>
      getObserver()?.observe(...args),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const unobserve = useCallback(
    (...args: Parameters<IntersectionObserver['unobserve']>) =>
      getObserver()?.unobserve(...args),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const disconnect = useCallback(
    (...args: Parameters<IntersectionObserver['disconnect']>) =>
      getObserver()?.disconnect(...args),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const takeRecords = useCallback(
    (...args: Parameters<IntersectionObserver['takeRecords']>) =>
      getObserver()?.takeRecords(...args),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return [observe, unobserve, disconnect, takeRecords, getObserver]
}

export default useObserverIntersection
