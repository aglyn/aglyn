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

import {
  type BesignerDndElementActive,
  type BesignerDndElementOver,
  setBesignerDndState,
} from '@aglyn/core-data-framework'
import {useAglynAppContext, useAglynCanvasApiEvents} from '@aglyn/core-feature-renderer'
import {
  DndContext,
  type DndContextProps,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {type ReactNode, useCallback} from 'react'


export interface BesignerDndContextProps extends DndContextProps {
  children?: ReactNode
}

const BesignerDndContext = (props: BesignerDndContextProps) => {
  const {children, ...rest} = props

  const {moveElement} = useAglynCanvasApiEvents()
  const {getApp} = useAglynAppContext()

  const handleDragStart = useCallback((e: DragStartEvent) => {
    console.log('drag start', e)
    if (e.active?.data) {
      const active = e.active as unknown as BesignerDndElementActive
      setBesignerDndState(getApp(), {dnd: () => ({active})})
    }
  }, [getApp])
  const handleDragOver = useCallback((e: DragOverEvent) => {
    console.log('drag over', e)
    const over = e.over as unknown as BesignerDndElementOver
    setBesignerDndState(getApp(), {dnd: (prev) => ({...prev, over})})
  }, [getApp])
  const handleDragEnd = useCallback((e: DragEndEvent) => {
    console.log('drag end', e)
    const active = e.active?.data?.current
    const over = e.over?.data?.current
    setBesignerDndState(getApp(), {dnd: () => ({})})
    if (over?.$id && active?.$id !== over.$id) {
      moveElement({
        $id: active.$id,
        parentId: over.$id,
        index: -1,
      })
    }
  }, [getApp, moveElement])
  const handleDragCancel = useCallback((e: DragCancelEvent) => {
    console.log('drag cancel', e)
    setBesignerDndState(getApp(), {dnd: () => ({})})
  }, [getApp])

  return (
    <DndContext
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      {...rest}
    >
      {children}
    </DndContext>
  )
}
BesignerDndContext.displayName = 'BesignerDndContext'

export {BesignerDndContext}
export default BesignerDndContext
