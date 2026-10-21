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

import type { Modifier } from '@dnd-kit/core'
import {
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  TouchSensor,
  useDndContext,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { getEventCoordinates } from '@dnd-kit/utilities'
import type { BackendFactory } from 'dnd-core'
import { useEffect } from 'react'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { besignerCollisionDetection } from './dnd/drop-targeting'

export const snapDraggingToCursor: Modifier = ({
  activatorEvent,
  draggingNodeRect,
  transform,
}) => {
  if (draggingNodeRect && activatorEvent) {
    const activatorCoordinates = getEventCoordinates(activatorEvent)
    if (!activatorCoordinates) return transform

    const offsetX = activatorCoordinates.x - draggingNodeRect.left
    const offsetY = activatorCoordinates.y - draggingNodeRect.top

    return {
      ...transform,
      x: transform.x + offsetX + 2,
      y: transform.y + offsetY + 2,
    }
  }

  return transform
}
/**
 * Pointer events cover mouse, pen AND touch, and dnd-kit hands a gesture to
 * whichever sensor's activator claims it first — `pointerdown` always fires
 * before `touchstart`, so a plain PointerSensor would swallow every touch and
 * the TouchSensor's press-and-hold would never run. Declining touch pointers
 * here leaves them to the TouchSensor, which is what lets a finger scroll the
 * palette, the layers tree and the canvas without picking anything up.
 */
class NonTouchPointerSensor extends PointerSensor {
  static activators: typeof PointerSensor.activators =
    PointerSensor.activators.map((activator) => ({
      ...activator,
      handler: (event, options) =>
        event.nativeEvent.pointerType !== 'touch' &&
        activator.handler(event, options),
    }))
}

/**
 * A mouse or pen drag starts after a few pixels of travel, so a click on a
 * drag handle (the overlay's move button, a palette card) stays a click.
 */
const POINTER_ACTIVATION = { distance: 6 }

/**
 * A finger drag starts after a short hold; moving further than the tolerance
 * before then is a scroll, and the drag never starts.
 */
const TOUCH_ACTIVATION = { delay: 250, tolerance: 8 }

/**
 * Re-measures every drop target when anything scrolls mid-drag.
 *
 * dnd-kit keeps its rectangles in step with scrolling only for the scroll
 * containers it finds by walking up from each target, and that walk stops at
 * a shadow root. The canvas lives in one, so scrolling the canvas during a
 * drag — by hand, or near an edge — left every canvas target where it had
 * been, and drops resolved against elements that had scrolled away.
 */
function RemeasureOnScroll() {
  const { active, measureDroppableContainers } = useDndContext()
  const dragging = Boolean(active)
  useEffect(() => {
    if (!dragging) return
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measureDroppableContainers([])
      })
    }
    const options = { capture: true, passive: true }
    document.addEventListener('scroll', onScroll, options)
    return () => {
      document.removeEventListener('scroll', onScroll, options)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [dragging, measureDroppableContainers])
  return null
}

export interface BesignerDndContextProps<BackendContext, BackendOptions> {
  children?: JSX.Children
  backend?: BackendFactory
  context?: BackendContext
  options?: BackendOptions
  debugMode?: boolean
}

export function BesignerDndContext<T, U>(props: BesignerDndContextProps<T, U>) {
  const { children, options, ...rest } = props
  const opts = {
    enableTouchEvents: true,
    enableMouseEvents: true,
    enableKeyboardEvents: true,
    delay: 0,
    delayTouchStart: 0,
    delayMouseStart: 0,
    touchSlop: 0,
    ...options,
  }

  const sensors = useSensors(
    useSensor(NonTouchPointerSensor, {
      activationConstraint: POINTER_ACTIVATION,
    }),
    useSensor(TouchSensor, { activationConstraint: TOUCH_ACTIVATION }),
    useSensor(KeyboardSensor),
  )

  return (
    <DndProvider backend={HTML5Backend} options={opts} {...rest} debugMode>
      <DndContext
        sensors={sensors}
        modifiers={[snapDraggingToCursor]}
        collisionDetection={besignerCollisionDetection}
        measuring={{
          droppable: {
            strategy: MeasuringStrategy.Always,
          },
        }}
      >
        <RemeasureOnScroll />
        {children}
      </DndContext>
    </DndProvider>
  )
}
BesignerDndContext.displayName = 'BesignerDndContext'
BesignerDndContext.aglyn = true

export default BesignerDndContext
