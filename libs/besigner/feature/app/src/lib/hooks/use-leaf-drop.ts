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
import { type NodeDragItem } from './use-leaf-drag'

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
  $id: Aglyn.NodeId
  type?: Besigner.DropAreaType
  node?: Aglyn.NodeSchema<any>
}

export function useLeafDrop(
  dropObject: NodeDropArea,
  accept: Besigner.DragType[] = Object.values(Besigner.DragType),
): [DropCollected, ConnectDropTarget] {
  const deps = [dropObject, ...(Array.isArray(accept) ? accept : [accept])]

  return useDrop<NodeDragItem<Besigner.DragType>, NodeDropArea, DropCollected>(
    {
      accept: accept,
      options: {
        arePropsEqual: (props, otherProps) => {
          console.log('arePropsEqual', props, otherProps)
          return isEqual(props, otherProps)
        },
      },
      drop: (dragObject, monitor) => {
        if (monitor.didDrop()) return
        if (!dropObject) return
        const dragType = monitor.getItemType()
        const breadcrumbs = dropObject?.node?.breadcrumbPath
        const isOverDragItem = breadcrumbs?.indexOf(dragObject?.$id) >= 0
        const isOverSelf = monitor.isOver({ shallow: true })

        Besigner.dnd.clearDndStatus()
        Besigner.focus.clearFocusStatus()
        console.log('end drag ', dragObject, dragObject, dropObject)

        if (!isOverSelf || isOverDragItem) return

        const dropSchema = Aglyn.components.getSchema(
          dropObject?.node?.componentId,
        )
        const dropAllowed = Aglyn.components.isFeatureEnabled(
          dropSchema?.flags?.dropping,
        )
        const validRelationship = Besigner.dnd.state.isValidLinealRelationship

        if (!dropAllowed || !validRelationship) return

        if (dragType === Besigner.DragType.TEMPLATE) {
          const dragNode = dragObject?.node as Aglyn.PresetSchema<any>
          const dropNode = dropObject?.node as Aglyn.NodeSchema<any>
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
          const dropNode = dropObject?.node as Aglyn.NodeSchema<any>
          Aglyn.screen.reparentNode(dragNode, dragNode?.parent, dropNode, NaN)
          Besigner.focus.setSelectedNode(dragNode)
        }

        /**
         * If already handled return
         */
        // if (monitor.didDrop()) return undefined
        return undefined
      },
      hover: (dragItem, monitor) => {
        // Make sure not to bubble up for parents
        if (!monitor.isOver({ shallow: true })) return
        Besigner.focus.setHoveredNode(dropObject?.node)
        Besigner.dnd.setDropNode(dropObject?.node)
      },
      collect: (monitor) => {
        const canDrop = monitor.canDrop()
        const dragItem = monitor.getItem()
        const isOver = monitor.isOver({ shallow: false })
        const isOverSelf = monitor.isOver({ shallow: true })
        const isOverChildren = isOver && !isOverSelf
        const isOverDragItem = Besigner.dnd.isDraggingOverDropNode(dragItem)

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
