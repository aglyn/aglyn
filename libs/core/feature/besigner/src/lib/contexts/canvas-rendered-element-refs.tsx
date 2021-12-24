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

import {type ElementId} from '@aglyn/core-data-framework'
import {createContext, ReactNode, RefObject, useContext, useRef, useState} from 'react'


export interface CanvasRenderedElementRefs {
  // elementRefs: RefObject<{ [$id: ElementId]: RefObject<Element> }>
  getElementRef: ($id: ElementId) => RefObject<Element>
  setElementRef: ($id: ElementId, ref: RefObject<Element>) => void
  deleteElementRef: ($id: ElementId) => void
}

export const CanvasRenderedElementRefsContext = createContext<CanvasRenderedElementRefs>({
  // elementRefs: {current: {}},
  getElementRef() {
    return {current: null}
  },
  setElementRef() {},
  deleteElementRef() {},
})
CanvasRenderedElementRefsContext.displayName = 'CanvasRenderedElementRefsContext'

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
  const elementRefs = useRef<{[$id: ElementId]: RefObject<Element>}>({})
  const [context] = useState<CanvasRenderedElementRefs>(() => ({
    getElementRef: ($id: ElementId): RefObject<Element> => {
      return elementRefs.current[$id]
    },
    deleteElementRef: ($id: ElementId): void => {
      delete elementRefs.current[$id]
    },
    setElementRef: ($id: ElementId, ref: RefObject<Element>): void => {
      elementRefs.current[$id] = ref
    },
  }))

  // useDndMonitor({
  //   onDragStart(event) {},
  //   onDragMove(event) {},
  //   onDragOver(event) {
  //     setOver({...event, canDrop: confirmValidLinealRelationship({item: {...event.active},
  // parent: {...event.over}})}) console.log('event on drag over', event) }, onDragEnd(event) {
  // setOver(null) }, onDragCancel(event) {}, })

  // console.log('selectedOptions selectedOpen', selectedOptions, selectedOpen, hoveredOpen)

  return (
    <CanvasRenderedElementRefsProvider value={context}>
      {children}
    </CanvasRenderedElementRefsProvider>
  )
}

CanvasRenderedElementRefsComponent.displayName = 'CanvasRenderedElementRefsComponent'
CanvasRenderedElementRefsComponent.defaultProps = {}

export {CanvasRenderedElementRefsComponent}
export default CanvasRenderedElementRefsComponent
