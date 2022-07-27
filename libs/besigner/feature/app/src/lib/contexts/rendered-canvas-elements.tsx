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

import type { NodeId } from '@aglyn/core-data-foundation'
import type { Dictionary } from '@aglyn/shared-data-types'
import {
  createContext,
  type RefObject,
  useContext,
  useMemo,
  useRef,
} from 'react'
import type { DragElementWrapper, DragSourceOptions } from 'react-dnd'

export type ElementDragHandle = DragElementWrapper<DragSourceOptions>
export type ElementCanvasRefObject = Dictionary & {
  $id: NodeId
  node: Element
  dragHandle: ElementDragHandle
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

function RenderedCanvasElementsProvider(props: RenderedCanvasElementsProps) {
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
