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
  MouseSensor,
  PointerSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { getEventCoordinates } from '@dnd-kit/utilities'
import type { BackendFactory } from 'dnd-core'
import { DndProvider } from 'react-dnd'
// import {TouchBackend} from 'react-dnd-touch-backend'
import { HTML5Backend } from 'react-dnd-html5-backend'

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
    useSensor(MouseSensor),
    useSensor(PointerSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor),
  )

  return (
    <DndProvider backend={HTML5Backend} options={opts} {...rest} debugMode>
      <DndContext
        sensors={sensors}
        modifiers={[snapDraggingToCursor]}
        collisionDetection={pointerWithin}
        measuring={{
          droppable: {
            strategy: MeasuringStrategy.Always,
          },
        }}
      >
        {children}
      </DndContext>
    </DndProvider>
  )
}
BesignerDndContext.displayName = 'BesignerDndContext'
BesignerDndContext.aglyn = true

export default BesignerDndContext
