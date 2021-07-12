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

import { useRef, useCallback } from 'react'
import ResizeObserver from 'resize-observer-polyfill'

export function useResizeObserver(
  callback: ResizeObserverCallback
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

  const observe = useCallback(
    (target: Element) => {
      const observer = getObserver()
      if (observer) observer.observe(target)
    },
    [ref]
  )

  const unobserve = useCallback(
    (target: Element) => {
      const observer = getObserver()
      if (observer) observer.unobserve(target)
    },
    [ref]
  )

  const disconnect = useCallback(() => {
    const observer = getObserver()
    if (observer) observer.disconnect()
  }, [ref])

  return [observe, unobserve, disconnect]
}

export default useResizeObserver
