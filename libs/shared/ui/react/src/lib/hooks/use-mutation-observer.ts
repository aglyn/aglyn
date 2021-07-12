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

// Options for the observer (which mutations to observe)
const config = { attributes: true, childList: true, subtree: true }

export function useMutationObserver(
  callback: MutationCallback
): [MutationObserver['observe'], MutationObserver['disconnect'], MutationObserver['takeRecords']] {
  const ref = useRef<MutationObserver>(null)

  // This avoids creating an expensive object until it’s truly needed for the
  // first time. If you use Flow or TypeScript, you can also give getObserver()
  // a non-nullable type for convenience.
  function getObserver(): MutationObserver {
    if (ref.current === null) {
      ref.current = new MutationObserver(callback)
    }

    return ref.current
  }

  const observe = useCallback(
    (target: Node, options?: MutationObserverInit) => {
      const observer = getObserver()
      if (observer) observer.observe(target, options)
    },
    [ref]
  )

  const disconnect = useCallback(() => {
    const observer = getObserver()
    if (observer) observer.disconnect()
  }, [ref])

  const takeRecords = useCallback(() => {
    const observer = getObserver()
    if (observer) {
      return observer.takeRecords()
    }
  }, [ref])

  return [observe, disconnect, takeRecords]
}

export default useMutationObserver
