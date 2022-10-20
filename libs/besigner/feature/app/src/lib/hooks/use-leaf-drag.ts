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

import * as Aglyn from '@aglyn/aglyn'
import {
  type BesignerDraggableItem,
  type BesignerDroppableItem,
  DndDragType,
} from '@aglyn/besigner-data-app'
import { useAglynAppContext } from '@aglyn/core-feature-renderer'
import {
  type ConnectDragPreview,
  type ConnectDragSource,
  useDrag,
} from 'react-dnd'
import { useAglynCanvasSetHovered } from './use-aglyn-canvas-hovered'
import { useAglynCanvasSetSelected } from './use-aglyn-canvas-selected'
import { useAglynDndSetActive } from './use-aglyn-dnd-active'
import { useAglynDndSetOver } from './use-aglyn-dnd-over'

export type DragCollected = {
  isDragging: boolean
}

export function useLeafDrag<T extends BesignerDraggableItem>(
  dragObject?: T,
  type: DndDragType = DndDragType.CANVAS,
): [DragCollected, ConnectDragSource, ConnectDragPreview] {
  const app = useAglynAppContext()
  const setSelected = useAglynCanvasSetSelected()
  const setHovered = useAglynCanvasSetHovered()
  const setDndActive = useAglynDndSetActive()
  const setDndOver = useAglynDndSetOver()
  const isRootNode = Aglyn.screen.isRootNodeId(dragObject?.$id)
  const schema = Aglyn.components.getSchema(dragObject?.componentId)
  const canDrag = !isRootNode && Aglyn.isFeatureEnabled(schema?.flags?.dragging)

  const deps = [
    dragObject,
    canDrag,
    app,
    type,
    setDndActive,
    setDndOver,
    setSelected,
    setHovered,
  ]

  // console.log('dragItem item canDrag', dragItem, $id, type, canDrag, flags)

  return useDrag<T, BesignerDroppableItem, DragCollected>(
    /*() => */ {
      type: type,
      item: dragObject,
      canDrag: canDrag,
      options: {
        dropEffect: 'move',
      },
      previewOptions: {
        offsetY: -50,
      },
      isDragging: (monitor) => {
        return dragObject?.$id && dragObject?.$id === monitor.getItem()?.$id
      },
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
    },
    deps,
  )
}
export default useLeafDrag
