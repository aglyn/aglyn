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

import { Ref, RefObject, useRef, useState, useCallback } from 'react'

export type UseDynamicClientRect = [() => DOMRect, RefObject<any>]

export function useDynamicClientRect(): UseDynamicClientRect {
  const ref = useRef(null)

  const getClientRect = useCallback(() => {
    const node = ref.current
    const clientRect = node?.getBoundingClientRect && node.getBoundingClientRect()
    return clientRect?.toJSON ? clientRect?.toJSON() : clientRect
  }, [])

  return [getClientRect, ref]
}

export type UseClientRectCallback = (args: { clientRect: DOMRect; node: Node }) => void
export type UseClientRect<T> = [DOMRect, Ref<T>, RefObject<T>]

export function useClientRect<T>(
  callback?: UseClientRectCallback,
  initialRect: DOMRect = null
): UseClientRect<T> {
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
