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
import { addCanvasElement } from '@aglyn/core-data-app'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/core-data-foundation'
import { useAglynAppContext } from '@aglyn/core-feature-renderer'
import {
  confirmValidLinealRelationship,
  createComponentElementData,
} from '@aglyn/core-util-app'
import isEqual from 'lodash-es/isEqual'
import { type ConnectDropTarget, useDrop } from 'react-dnd'
import { useAglynCanvasSetHovered } from './use-aglyn-canvas-hovered'
import { useAglynCanvasSetSelected } from './use-aglyn-canvas-selected'
import { useAglynDndSetActive } from './use-aglyn-dnd-active'
import { useAglynDndSetOver } from './use-aglyn-dnd-over'

export type DropCollected = {
  canDrop?: boolean
  isOver?: boolean
  isOverSelf?: boolean
  isOverChildren?: boolean
  isOverSameDrag?: boolean
  isOverChildOfSameDrag?: boolean
  isDragging?: boolean
}

export function useLeafDrop<T extends BesignerDroppableItem>(
  dropObject: T,
  accept: DndDragType[] = Object.values(DndDragType),
): [DropCollected, ConnectDropTarget] {
  const app = useAglynAppContext()
  const setSelected = useAglynCanvasSetSelected()
  const setHovered = useAglynCanvasSetHovered()
  const setDndActive = useAglynDndSetActive()
  const setDndOver = useAglynDndSetOver()
  const deps = [dropObject, app, ...(Array.isArray(accept) ? accept : [accept])]

  return useDrop<BesignerDraggableItem, T, DropCollected>(
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
        const trail = Array.isArray(dropObject?.trail) ? dropObject?.trail : []
        const isOverDragItem = trail.indexOf(dragObject?.$id) >= 0
        const isOverSelf = monitor.isOver({ shallow: true })

        setDndActive(undefined)
        setDndOver(undefined)
        setSelected({})
        setHovered({})
        console.log('end drag ', dragObject, dragObject, dropObject)

        if (!isOverSelf || isOverDragItem) return

        const dropSchema = Aglyn.components.getSchema(dropObject?.componentId)
        const dropAllowed = Aglyn.isFeatureEnabled(dropSchema?.flags?.dropping)
        const [validRelationship] = confirmValidLinealRelationship({
          item: dragObject,
          parent: dropObject,
        })

        if (!dropAllowed || !validRelationship) return

        if (dragType === DndDragType.TEMPLATE) {
          const parent =
            Aglyn.screen.getNode(dropObject?.$id) ||
            Aglyn.screen.getNode(Aglyn.NODE_ROOT_ID)
          const templateData = {
            ...(dragObject?.data as any),
            $id: Aglyn.createNodeId(),
            parentId: parent?.$id,
          }
          Aglyn.screen.setNodes(
            Aglyn.screen.denormalizeNodes([templateData as any], parent?.$id),
          )
          Aglyn.screen.addNodeToParent(
            Aglyn.screen.getNode(templateData.$id),
            parent,
            NaN,
          )
          const newElement = {
            index: NaN,
            parentId: dropObject?.$id || CANVAS_ROOT_ELEMENT_ID,
            element: createComponentElementData(dragObject as any),
          }
          addCanvasElement(app, newElement)
          setSelected({ $id: newElement.element.$id })
        } else {
          const node = Aglyn.screen.getNode(dragObject?.$id)
          Aglyn.screen.reparentNode(
            node,
            Aglyn.screen.getNode(node?.parentId),
            Aglyn.screen.getNode(dropObject?.$id),
            NaN,
          )
          setSelected({ $id: node?.$id })
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
        setHovered({ $id: dropObject?.$id })
        setDndOver(dropObject)
      },
      collect: (monitor) => {
        const canDrop = monitor.canDrop()
        const dragItem = monitor.getItem()
        const isOver = monitor.isOver({ shallow: false })
        const isOverSelf = monitor.isOver({ shallow: true })
        const trail = Array.isArray(dragItem?.trail) ? dragItem?.trail : []
        const isOverChildren = isOver && !isOverSelf
        const isOverDragItem = trail.indexOf(dragItem?.$id) >= 0

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
