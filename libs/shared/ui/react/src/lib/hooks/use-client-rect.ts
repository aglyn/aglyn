/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { RefObject, useRef, useState, useCallback } from 'react'

export function useDynamicClientRect(): [() => ClientRect, RefObject<any>] {
  const ref = useRef(null)

  const getClientRect = useCallback(() => {
    const node = ref.current
    const clientRect = node?.getBoundingClientRect && node.getBoundingClientRect()
    return clientRect?.toJSON ? clientRect?.toJSON() : clientRect
  }, [])

  return [getClientRect, ref]
}

export type UseClientRectCallback = (args: { clientRect: ClientRect; node: Node }) => void

export function useClientRect(callback?: UseClientRectCallback, initialRect: ClientRect = null) {
  const [clientRect, setRect] = useState(initialRect)
  const nodeRef = useRef()

  const ref = useCallback(
    (node) => {
      nodeRef.current = node
      if (node) {
        const clientRect = node.getBoundingClientRect && node.getBoundingClientRect()
        const newRect = clientRect?.toJSON ? clientRect.toJSON() : clientRect
        setRect(newRect)
        callback && callback({ clientRect: newRect, node })
      }
    },
    [callback]
  )

  return [clientRect, ref, nodeRef]
}

export default useClientRect
