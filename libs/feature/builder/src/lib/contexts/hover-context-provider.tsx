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
import { ElementType, Fragment, ReactNode, RefObject, useRef } from 'react'
import { HoverComponent, HoverComponentProps } from '../components/hover.component'
import {
  CanvasRenderedElementRefs,
  CanvasRenderedElementRefsProvider,
} from './canvas-rendered-element-refs'
import { HoveredOptions } from './hover-context'


export interface HoverContextProviderProps {
  defaultOptions?: Partial<HoveredOptions>
  children?: ReactNode
  component: ElementType<HoverComponentProps>
}

type ResolveReject<T = any> = [] | [
  resolve: (value: T | PromiseLike<T>) => void,
  reject: (reason?: any) => void
]

function HoverContextProviderRaw(props: HoverContextProviderProps) {
  const {children} = props
  const elementRefs = useRef<CanvasRenderedElementRefs>({
    elements: {},
    getElement($id: ElementId) {
      return elementRefs.current.elements[$id]
    },
    deleteElement($id: ElementId): void {
      delete elementRefs.current.elements[$id]
    },
    setElement($id: ElementId, ref: RefObject<Element>): void {
      elementRefs.current.elements[$id] = ref
    },
  })

  // useDndMonitor({
  //   onDragStart(event) {},
  //   onDragMove(event) {},
  //   onDragOver(event) {
  //     setOver({...event, canDrop: confirmValidLinealRelationship({item: {...event.active},
  // parent: {...event.over}})}) console.log('event on drag over', event) }, onDragEnd(event) {
  // setOver(null) }, onDragCancel(event) {}, })

  // console.log('selectedOptions selectedOpen', selectedOptions, selectedOpen, hoveredOpen)

  return (
    <Fragment>
      <CanvasRenderedElementRefsProvider value={elementRefs.current}>
        {children}
      </CanvasRenderedElementRefsProvider>
    </Fragment>
  )
}

HoverContextProviderRaw.displayName = 'HoverContextProvider'
HoverContextProviderRaw.defaultProps = {
  component: HoverComponent,
  defaultOptions: {},
}

export const HoverContextProvider = HoverContextProviderRaw
export default HoverContextProvider
