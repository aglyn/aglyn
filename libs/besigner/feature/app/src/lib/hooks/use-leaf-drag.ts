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

import {
  type BesignerDraggableItem,
  type BesignerDroppableItem,
  DndDragType,
} from '@aglyn/besigner-data-app'
import { moveCanvasElement } from '@aglyn/core-data-app'
import type { ElementId } from '@aglyn/core-data-foundation'
import { FEATURE_FLAG } from '@aglyn/core-data-foundation'
import {
  useAglynAppContext,
  useAglynElementComponentSchema,
} from '@aglyn/core-feature-renderer'
import { isRootElementId } from '@aglyn/core-util-app'
import { useMemo } from 'react'
import {
  type ConnectDragPreview,
  type ConnectDragSource,
  useDrag,
} from 'react-dnd'
import { useAglynCanvasSetSelected } from './use-aglyn-canvas-selected'
import { useAglynDndSetActive } from './use-aglyn-dnd-active'
import { useAglynDndSetOver } from './use-aglyn-dnd-over'

export type DragCollected = {
  isDragging: boolean
}

export const useLeafDrag = (
  $id: ElementId,
  dragType?: DndDragType,
): [DragCollected, ConnectDragSource, ConnectDragPreview] => {
  const type = dragType ?? DndDragType.CANVAS
  const app = useAglynAppContext()
  const setSelected = useAglynCanvasSetSelected()
  const setDndActive = useAglynDndSetActive()
  const setDndOver = useAglynDndSetOver()
  const schema = useAglynElementComponentSchema($id)
  const componentId = schema?.componentId
  const bundleId = schema?.bundleId
  const hierarchy = schema?.hierarchy
  const flags = schema?.flags

  const canDrag: boolean = useMemo(() => {
    if (isRootElementId($id)) return false
    if (flags?.dragging === FEATURE_FLAG.DISABLED) return false
    return true
  }, [$id, flags])
  const dragItem: BesignerDraggableItem = useMemo(
    () => ({
      $id,
      type,
      componentId,
      bundleId,
      hierarchy,
    }),
    [$id, type, componentId, bundleId, hierarchy],
  )

  // console.log('dragItem item canDrag', dragItem, $id, type, canDrag, flags)

  return useDrag<BesignerDraggableItem, BesignerDroppableItem, DragCollected>(
    () => ({
      options: {
        dropEffect: 'move',
      },
      type: dragItem.type,
      canDrag: canDrag,
      item: () => {
        console.log('draggable item', dragItem)
        setSelected({ $id: dragItem.$id })
        setDndActive(dragItem)
        return dragItem
      },
      isDragging: (monitor) => {
        console.log(
          'monitor?.getItem()?.$id',
          monitor?.getItem()?.$id,
          dragItem?.$id,
          canDrag,
        )
        return monitor?.getItem()?.$id === dragItem?.$id
      },
      end: (dragItem, monitor) => {
        setDndActive(undefined)
        setDndOver(undefined)
        if (!monitor.didDrop()) return
        const dropItem = monitor.getDropResult()
        if (!dropItem) return
        console.log('end drag ', dragItem, dropItem)
        moveCanvasElement(app, {
          $id: dragItem.$id,
          parentId: dropItem?.$id,
          index: NaN,
        })
      },
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
    }),
    [canDrag, dragItem, app, dragType, setSelected, setDndActive],
  )
}
export default useLeafDrag
