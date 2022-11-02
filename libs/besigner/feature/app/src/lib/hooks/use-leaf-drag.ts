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
  type BesignerDraggableItem,
  type BesignerDroppableItem,
} from '@aglyn/besigner-data-app'
import {
  type ConnectDragPreview,
  type ConnectDragSource,
  useDrag,
} from 'react-dnd'

export type DragCollected = {
  isDragging: boolean
}

export function useLeafDrag<T extends BesignerDraggableItem>(
  dragObject?: T,
  type: Besigner.dnd.DragType = Besigner.dnd.DragType.CANVAS,
): [DragCollected, ConnectDragSource, ConnectDragPreview] {
  const isRootNode = Aglyn.screen.isRootNodeId(dragObject?.$id)
  const schema = Aglyn.components.getSchema(dragObject?.componentId)
  const dragEnabled = Aglyn.components.isFeatureEnabled(schema?.flags?.dragging)
  const canDrag = !isRootNode && dragEnabled

  const deps = [dragObject, canDrag, type]

  // console.log('dragItem item canDrag', dragItem, $id, type, canDrag, flags)

  return useDrag<T, BesignerDroppableItem, DragCollected>(
    /*() => */ {
      type: type,
      item: () => {
        // Besigner.focus.setHoveredNode(Aglyn.screen.getNode(dropObject?.$id))
        Besigner.dnd.setDragNode(Aglyn.screen.getNode(dragObject?.$id))
        return dragObject
      },
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
