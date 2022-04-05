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

import {type ElementId} from '@aglyn/core-data-framework'
import {
  createContext,
  type MutableRefObject,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
} from 'react'
import {type DragElementWrapper, type DragSourceOptions} from 'react-dnd'


export type ElementDragHandle<T = any> = DragElementWrapper<DragSourceOptions>
export type CanvasElementRefEntry = {
  $id: ElementId
  element: MutableRefObject<Element>
  dragHandle: ElementDragHandle<any>
}

export type CanvasRenderedElementRefs = [
  setElementRef: ($id: ElementId, ref: CanvasElementRefEntry) => void,
  deleteElementRef: ($id: ElementId) => void,
  getElementRef: ($id: ElementId) => CanvasElementRefEntry,
]

export const CanvasRenderedElementRefsContext = createContext<CanvasRenderedElementRefs>([
  (() => {}) as any,
  (() => {}) as any,
  (() => {}) as any,
])
CanvasRenderedElementRefsContext.displayName = 'CanvasRenderedElementRefsContext'
CanvasRenderedElementRefsContext.aglyn = true

export const {
  displayName,
  Provider: CanvasRenderedElementRefsProvider,
  Consumer: CanvasRenderedElementRefsConsumer,
} = CanvasRenderedElementRefsContext

export const useCanvasRenderedElementRefs = () => {
  return useContext(CanvasRenderedElementRefsContext)
}


export interface CanvasRenderedElementRefsComponentProps {
  children?: ReactNode
}

function CanvasRenderedElementRefsComponent(props: CanvasRenderedElementRefsComponentProps) {
  const {children} = props
  const elementRefs = useRef<Record<ElementId, CanvasElementRefEntry>>({})
  const context = useMemo<CanvasRenderedElementRefs>(() => ([
    ($id, ref): void => {
      elementRefs.current[$id] = ref
    },
    ($id): void => {
      delete elementRefs.current[$id]
    },
    ($id) => {
      return elementRefs.current[$id]
    },
  ]), [elementRefs])

  return (
    <CanvasRenderedElementRefsProvider value={context}>
      {children}
    </CanvasRenderedElementRefsProvider>
  )
}

CanvasRenderedElementRefsComponent.displayName = 'CanvasRenderedElementRefsComponent'
CanvasRenderedElementRefsComponent.aglyn = true
CanvasRenderedElementRefsComponent.defaultProps = {}

export {CanvasRenderedElementRefsComponent}
export default CanvasRenderedElementRefsComponent
