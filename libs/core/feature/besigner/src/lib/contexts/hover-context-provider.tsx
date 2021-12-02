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

import { ElementId } from '@aglyn/core-data-framework'
// import { useDndMonitor } from '@dnd-kit/core'
// import { DragOverEvent } from '@dnd-kit/core/dist/types'
import { ReactNode, RefObject, useRef, useState } from 'react'
import {
  CanvasRenderedElementRefs,
  CanvasRenderedElementRefsProvider,
} from './canvas-rendered-element-refs'

export interface HoverContextProviderProps {
  children?: ReactNode
}

function HoverContextProviderRaw(props: HoverContextProviderProps) {
  const { children } = props
  const elementRefs = useRef<{ [$id: ElementId]: RefObject<Element> }>({})
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

HoverContextProviderRaw.displayName = 'HoverContextProvider'
HoverContextProviderRaw.defaultProps = {}

export const HoverContextProvider = HoverContextProviderRaw
export default HoverContextProvider
