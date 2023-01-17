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
import arraySafe from '@aglyn/shared-util-tools/array/array-safe'
import { useDroppable } from '@dnd-kit/core'
import isEqual from 'lodash-es/isEqual'
import { useDrop } from 'react-dnd'
import type { NodeDragItem } from './use-leaf-drag'

export type DropCollected = {
  canDrop?: boolean
  isOver?: boolean
  isOverSelf?: boolean
  isOverChildren?: boolean
  isOverSameDrag?: boolean
  isOverChildOfSameDrag?: boolean
  isDragging?: boolean
}

export type NodeDropArea = {
  node?: Aglyn.NodeSchema<any>
}

const acceptAll = Object.values(Besigner.DragType)

export function useLeafDrop(
  node: Aglyn.NodeSchema<any>,
  accept: Besigner.DragType[] = acceptAll,
): ReturnType<typeof useDroppable> {
  return useDroppable({
    id: `drop:${node?.$id}:${accept}`,
    data: {
      accept,
      node,
    },
  })

  return useDrop<NodeDragItem, NodeDropArea, DropCollected>(
    {
      accept: accept,
      options: {
        arePropsEqual: (props, otherProps) => {
          alert('are props equal')
          console.warn('are props equal props, otherProps', props, otherProps)
          return isEqual(props, otherProps)
        },
      },
      drop: (drag, monitor) => {
        if (monitor.didDrop() || !node) {
          Besigner.dnd.clearDndStatus()
          return
        }

        const dropSchema = node?.componentSchema
        const dropBreadcrumb = node?.breadcrumbPath
        const validRelationship = Besigner.dnd.state.isValidLinealRelationship

        const isOverDragItem = dropBreadcrumb?.indexOf(drag?.node?.$id) >= 0
        const isOverSelf = monitor.isOver({ shallow: true })
        Besigner.focus.clearFocusStatus()

        if (!isOverSelf || isOverDragItem) {
          Besigner.dnd.clearDndStatus()
          return
        }

        const dropAllowed = Aglyn.isFeatureEnabled(dropSchema?.flags?.dropping)

        if (!dropAllowed || !validRelationship) {
          Besigner.dnd.clearDndStatus()
          return
        }

        const dragType = monitor.getItemType()

        if (dragType === Besigner.DragType.PRESET) {
          const dragNode = drag?.node as Aglyn.PresetSchema<any>
          const newNode = Aglyn.canvas.addNodeFromPreset(dragNode, node, NaN)
          Besigner.focus.setSelectedNode(newNode)
        } else {
          const dragNode = drag?.node as Aglyn.NodeSchema<any>
          Aglyn.canvas.reparentNode(dragNode, node, NaN)
          Besigner.focus.setSelectedNode(dragNode)
        }

        return undefined
      },
      hover: (dragItem, monitor) => {
        // Make sure not to bubble up for parents
        if (monitor.isOver({ shallow: true })) {
          Besigner.focus.setHoveredNode(node)
          Besigner.dnd.setDropNode(node)
        }
      },
      collect: (monitor) => {
        const canDrop = monitor.canDrop()
        const dragItem = monitor.getItem()
        const dragNode = dragItem?.node
        const isOver = monitor.isOver({ shallow: false })
        const isOverSelf = monitor.isOver({ shallow: true })
        const isOverChildren = isOver && !isOverSelf
        const isOverDragItem = Besigner.dnd.isDraggingOverDropNode(dragNode)

        return {
          canDrop,
          isOver,
          isOverSelf,
          isOverChildren,
          isOverDragItem,
        }
      },
    },
    arraySafe(accept),
  )
}
export default useLeafDrop
