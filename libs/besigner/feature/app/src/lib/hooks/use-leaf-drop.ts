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
import isEqual from 'lodash-es/isEqual'
import { type ConnectDropTarget, useDrop } from 'react-dnd'
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

export function useLeafDrop(
  dropObject: NodeDropArea,
  accept: Besigner.DragType[] = Object.values(Besigner.DragType),
): [DropCollected, ConnectDropTarget] {
  const deps = [...(Array.isArray(accept) ? accept : [accept])]

  return useDrop<NodeDragItem, NodeDropArea, DropCollected>(
    {
      accept: accept,
      options: {
        arePropsEqual: (props, otherProps) => {
          return isEqual(props, otherProps)
        },
      },
      drop: (dragObject, monitor) => {
        if (monitor.didDrop()) {
          Besigner.dnd.clearDndStatus()
          return
        }
        if (!dropObject) {
          Besigner.dnd.clearDndStatus()
          return
        }
        const dropNode = dropObject?.node as Aglyn.NodeSchema<any>
        const dropSchema = dropNode?.componentSchema
        const dropBreadcrumbs = dropNode?.breadcrumbPath
        const validRelationship = Besigner.dnd.state.isValidLinealRelationship

        const dragType = monitor.getItemType()

        const isOverDragItem = dropBreadcrumbs?.indexOf(dropNode?.$id) >= 0
        const isOverSelf = monitor.isOver({ shallow: true })

        Besigner.focus.clearFocusStatus()

        if (!isOverSelf || isOverDragItem) {
          Besigner.dnd.clearDndStatus()
          return
        }

        const dropAllowed = Aglyn.components.isFeatureEnabled(
          dropSchema?.flags?.dropping,
        )

        if (!dropAllowed || !validRelationship) {
          Besigner.dnd.clearDndStatus()
          return
        }

        if (dragType === Besigner.DragType.TEMPLATE) {
          const dragNode = dragObject?.node as Aglyn.PresetSchema<any>
          const parent = dropNode || Aglyn.screen.getNode(Aglyn.NODE_ROOT_ID)
          const $id = Aglyn.createNodeId()
          Aglyn.screen.setNodes(
            Aglyn.screen.processNodesToDenormalized({
              ...dragNode?.data,
              $id,
              parentId: parent?.$id,
            }),
          )

          const node = Aglyn.screen.getNode($id)
          Aglyn.screen.addNodeToParent(node, parent, NaN)
          Besigner.focus.setSelectedNode(node)
        } else {
          const dragNode = dragObject?.node as Aglyn.NodeSchema<any>
          Aglyn.screen.reparentNode(dragNode, dragNode?.parent, dropNode, NaN)
          Besigner.focus.setSelectedNode(dragNode)
        }

        return undefined
      },
      hover: (dragItem, monitor) => {
        // Make sure not to bubble up for parents
        if (!monitor.isOver({ shallow: true })) return
        const dropNode = dropObject?.node
        Besigner.focus.setHoveredNode(dropNode)
        Besigner.dnd.setDropNode(dropNode)
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
    deps,
  )
}
export default useLeafDrop
