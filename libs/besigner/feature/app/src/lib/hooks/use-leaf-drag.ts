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
import * as Besigner from '@aglyn/besigner'
import {
  type ConnectDragPreview,
  type ConnectDragSource,
  useDrag,
} from 'react-dnd'
import { type NodeDropArea } from './use-leaf-drop'

export type DragCollected = {
  isDragging: boolean
}

export type NodeDragItem<
  T extends Besigner.DragType = Besigner.DragType.CANVAS,
> = {
  $id: Aglyn.NodeId
  node?: T extends Besigner.DragType.TEMPLATE
    ? Aglyn.PresetSchema<any>
    : Aglyn.NodeSchema<any>
}

export function useLeafDrag(
  dragObject?: NodeDragItem<typeof type>,
  type: Besigner.DragType = Besigner.DragType.CANVAS,
): [DragCollected, ConnectDragSource, ConnectDragPreview] {
  const deps = [dragObject, type]

  // console.log('dragItem item canDrag', dragItem, $id, type, canDrag, flags)

  return useDrag<NodeDragItem<typeof type>, NodeDropArea, DragCollected>(
    /*() => */ {
      type: type,
      item: () => {
        // Besigner.focus.setHoveredNode(Aglyn.screen.getNode(dropObject?.$id))
        Besigner.dnd.setDragNode(dragObject?.node)
        return dragObject
      },
      canDrag: () => {
        if (type !== Besigner.DragType.TEMPLATE) {
          const node = dragObject?.node as Aglyn.NodeSchema<any>
          const isRootNode = Aglyn.screen.isRootNodeId(dragObject?.$id)
          const dragEnabled = Aglyn.components.isFeatureEnabled(
            node?.componentSchema?.flags?.dragging,
          )

          return !isRootNode && dragEnabled
        }
        return true
      },
      options: {
        dropEffect: 'move',
      },
      previewOptions: {
        offsetY: -1,
      },
      isDragging: (monitor) => {
        return Boolean(
          dragObject?.$id && dragObject?.$id === monitor.getItem()?.$id,
        )
      },
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
    },
    deps,
  )
}
export default useLeafDrag
