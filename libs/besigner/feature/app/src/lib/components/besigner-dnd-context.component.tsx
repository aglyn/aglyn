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

import * as Besigner from '@aglyn/besigner'
import {
  DndContext,
  type DragCancelEvent,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import type { BackendFactory } from 'dnd-core'
import { useCallback, useMemo } from 'react'
import { DndProvider } from 'react-dnd'
// import {TouchBackend} from 'react-dnd-touch-backend'
import { HTML5Backend } from 'react-dnd-html5-backend'

export interface BesignerDndContextProps<BackendContext, BackendOptions> {
  children?: JSX.Children
  backend?: BackendFactory
  context?: BackendContext
  options?: BackendOptions
  debugMode?: boolean
}

/**
 * Sort collisions in descending order (from greatest to smallest value)
 */
export function sortCollisionsDesc(
  { data: { value: a } },
  { data: { value: b } },
) {
  return b - a
}

function getCircleIntersection(entry, target) {
  // Abstracted the logic to calculate the radius for simplicity
  const circle1 = { radius: 20, x: entry.offsetLeft, y: entry.offsetTop }
  const circle2 = { radius: 12, x: target.offsetLeft, y: target.offsetTop }

  const dx = circle1.x - circle2.x
  const dy = circle1.y - circle2.y
  const distance = Math.sqrt(dx * dx + dy * dy)

  if (distance < circle1.radius + circle2.radius) {
    return distance
  }

  return 0
}

/**
 * Returns the circle that has the greatest intersection area
 */
const circleIntersection = ({
  collisionRect,
  droppableRects,
  droppableContainers,
}) => {
  const collisions = []

  for (const droppableContainer of droppableContainers) {
    const { id } = droppableContainer
    const rect = droppableRects.get(id)

    if (rect) {
      const intersectionRatio = getCircleIntersection(rect, collisionRect)

      if (intersectionRatio > 0) {
        collisions.push({
          id,
          data: { droppableContainer, value: intersectionRatio },
        })
      }
    }
  }

  return collisions.sort(sortCollisionsDesc)
}

function BesignerDndContext<T, U>(props: BesignerDndContextProps<T, U>) {
  const { children, options, ...rest } = props
  const opts = useMemo(
    () => ({
      enableTouchEvents: true,
      enableMouseEvents: true,
      enableKeyboardEvents: true,
      delay: 0,
      delayTouchStart: 0,
      delayMouseStart: 0,
      touchSlop: 0,
      ...options,
    }),
    [options],
  )

  const handleDragStart = useCallback((e: DragStartEvent) => {
    const node = e.active?.data.current.node
    console.log('handleDragStart', node)
    Besigner.dnd.setDragNode(node)
  }, [])
  const handleDragMove = useCallback((e: DragMoveEvent) => {
    e.activatorEvent.stopPropagation()
    const node = e.over?.data.current.node
    console.log('handleDragOver', node)
    Besigner.dnd.setDragNode(node)
  }, [])
  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const dropNode = e.over?.data.current.node
    const dragNode = e.active?.data.current.node
    console.log('handleDragEnd dropNode', dropNode)
    console.log('handleDragEnd dragNode', dragNode)
    console.log('handleDragEnd dragNode', e.collisions)
    Besigner.dnd.clearDndStatus()
  }, [])
  const handleDragCancel = useCallback((e: DragCancelEvent) => {
    console.log('handleDragCancel')
    Besigner.dnd.clearDndStatus()
  }, [])

  return (
    <DndProvider backend={HTML5Backend} options={opts} {...rest} debugMode>
      <DndContext
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        collisionDetection={circleIntersection}
      >
        {children}
      </DndContext>
    </DndProvider>
  )
}
BesignerDndContext.displayName = 'BesignerDndContext'
BesignerDndContext.aglyn = true

export { BesignerDndContext }
export default BesignerDndContext
