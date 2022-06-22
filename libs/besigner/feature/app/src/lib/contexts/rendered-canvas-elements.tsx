/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import type { ElementId } from '@aglyn/foundation-data-core'
import {
  createContext,
  type MutableRefObject,
  type ReactNode,
  useContext,
  useRef,
  useState,
} from 'react'
import type { DragElementWrapper, DragSourceOptions } from 'react-dnd'

export type ElementDragHandle = DragElementWrapper<DragSourceOptions>
export type ElementCanvasRefObject = {
  $id: ElementId
  element: MutableRefObject<Element>
  dragHandle: ElementDragHandle
}

export type RenderedCanvasElements = [
  setElementRef: ($id: ElementId, ref: ElementCanvasRefObject) => void,
  deleteElementRef: ($id: ElementId) => void,
  getElementRef: ($id: ElementId) => ElementCanvasRefObject,
]

export const RenderedCanvasElementsContext =
  createContext<RenderedCanvasElements>([
    (() => {}) as any,
    (() => {}) as any,
    (() => {}) as any,
  ])
RenderedCanvasElementsContext.displayName = 'RenderedCanvasElementsContext'
RenderedCanvasElementsContext.aglyn = true

export const useRenderedCanvasElements = () => {
  return useContext(RenderedCanvasElementsContext)
}

export interface RenderedCanvasElementsProps {
  children?: ReactNode
}

function RenderedCanvasElementsProvider(props: RenderedCanvasElementsProps) {
  const { children } = props
  const elementRefs = useRef<Record<ElementId, ElementCanvasRefObject>>({})
  const [context] = useState<RenderedCanvasElements>(() => [
    ($id, ref): void => {
      elementRefs.current[$id] = ref
    },
    ($id): void => {
      delete elementRefs.current[$id]
    },
    ($id) => {
      return elementRefs.current[$id]
    },
  ])

  return (
    <RenderedCanvasElementsContext.Provider value={context}>
      {children}
    </RenderedCanvasElementsContext.Provider>
  )
}

RenderedCanvasElementsProvider.displayName = 'RenderedCanvasElementsProvider'
RenderedCanvasElementsProvider.aglyn = true
RenderedCanvasElementsProvider.defaultProps = {}

export { RenderedCanvasElementsProvider }
export default RenderedCanvasElementsProvider
