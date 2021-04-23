/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
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
