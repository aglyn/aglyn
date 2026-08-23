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

import type { NodeId } from '@aglyn/aglyn'
import {
  createContext,
  type RefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react'

export type ElementCanvasRefObject = Dictionary & {
  $id: NodeId
  node: Element
  dragHandle: any
}

export type RenderedCanvasElementsType = {
  elements: RefObject<Record<NodeId, ElementCanvasRefObject>>
  setElementRef($id: NodeId, ref: ElementCanvasRefObject): void
  deleteElementRef($id: NodeId): void
}

export const RenderedCanvasElementsContext =
  createContext<RenderedCanvasElementsType>({
    elements: { current: null } as any,
    setElementRef() {},
    deleteElementRef() {},
  })
RenderedCanvasElementsContext.displayName = 'RenderedCanvasElementsContext'
RenderedCanvasElementsContext.aglyn = true

export const useRenderedCanvasElements = () => {
  return useContext(RenderedCanvasElementsContext)
}

export const useRenderedCanvasElementRef = ({ $id }: { $id: NodeId }) => {
  const { elements } = useRenderedCanvasElements()
  return useMemo(() => elements.current[$id] || null, [elements, $id])
}

export interface RenderedCanvasElementsProps {
  children?: JSX.Children
}

export function RenderedCanvasElementsProvider(
  props: RenderedCanvasElementsProps,
) {
  const { children } = props
  const elements = useRef<Record<NodeId, ElementCanvasRefObject>>({})
  const context = useMemo<RenderedCanvasElementsType>(
    () => ({
      elements,
      setElementRef: ($id, ref): void => {
        elements.current[$id] = ref
      },
      deleteElementRef: ($id): void => {
        delete elements.current[$id]
      },
    }),
    [],
  )

  // The registry, readable from a devtools console (AGL-2486).
  //
  // This map had NO writer for its entire existence and nothing said so:
  // every consumer read `{}`, found nothing, and rendered nothing. Two
  // features were void for months because the only way to discover an empty
  // registry was to read the source of everything that touches it.
  //
  // `window.AglynCanvasElements()` returns the live ids, so "is the canvas
  // registered?" is one line in a console instead of an afternoon. Cheap,
  // dev-only, and it holds no reference the registry does not already hold.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return undefined
    if (typeof window === 'undefined') return undefined
    ;(window as unknown as Record<string, unknown>)['AglynCanvasElements'] =
      () => Object.keys(elements.current ?? {})
    return () => {
      delete (window as unknown as Record<string, unknown>)[
        'AglynCanvasElements'
      ]
    }
  }, [])

  return (
    <RenderedCanvasElementsContext.Provider value={context}>
      {children}
    </RenderedCanvasElementsContext.Provider>
  )
}

RenderedCanvasElementsProvider.displayName = 'RenderedCanvasElementsProvider'
RenderedCanvasElementsProvider.aglyn = true

export default RenderedCanvasElementsProvider
