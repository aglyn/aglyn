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
  type BesignerDndElementActive,
  type BesignerDndElementOver,
  DndDragSourceTypeFlag,
  DndDropLinealTypeFlag,
  setBesignerDnd,
} from '@aglyn/core-data-besigner'
import {type ElementId, isRootElementId, moveCanvasElement} from '@aglyn/core-data-framework'
import {
  useAglynAppContext,
  useAglynCanvasElementHierarchy,
  useAglynComponentSchema,
  useAglynElementData,
} from '@aglyn/core-feature-renderer'
import {useCallback, useEffect} from 'react'
import {
  type DragElementWrapper,
  type DragPreviewOptions,
  type DragSourceOptions,
  type DropTargetMonitor,
  useDrag,
  useDrop,
} from 'react-dnd'
import {useAglynCanvasSetHovered} from './use-aglyn-canvas-hovered'
import {useAglynCanvasSetSelected} from './use-aglyn-canvas-selected'
import {useAglynDndSetActive} from './use-aglyn-dnd-active'
import {useAglynDndSetOver} from './use-aglyn-dnd-over'


export type DropCollected = {
  isOver?: boolean
  isOverSelf?: boolean
  isOverChildren?: boolean
  isOverSameDrag?: boolean
  isOverChildOfSameDrag?: boolean
  isDragging?: boolean
}
export type DragCollected = {
  isDragging?: boolean,
  active?: BesignerDndElementActive
  over?: BesignerDndElementOver,
}
export declare type DragHandleRef = DragElementWrapper<DragSourceOptions>;
export declare type DragPreviewRef = DragElementWrapper<DragPreviewOptions>
export declare type DropRef = DragElementWrapper<any>;
export type UseLeafDnd = [
  dragHandleRef: DragHandleRef,
  dragPreviewRef: DragPreviewRef,
  dropRef: DropRef,
]

export type UseLeafDndOptions = {
  dragType?: DndDragSourceTypeFlag
  dropType?: DndDropLinealTypeFlag
}

export function useLeafDnd(
  $id: ElementId,
  options?: UseLeafDndOptions,
): UseLeafDnd {

  const dragType = options?.dragType ?? DndDragSourceTypeFlag.CANVAS_ELEMENT
  const dropType = options?.dropType ?? DndDropLinealTypeFlag.ACTIVITY_ELEMENT_INSIDE

  const app = useAglynAppContext()
  const setHovered = useAglynCanvasSetHovered()
  const setSelected = useAglynCanvasSetSelected()
  const setDndActive = useAglynDndSetActive()
  const setDndOver = useAglynDndSetOver()
  const componentId = useAglynElementData($id, 'componentId')
  const bundleId = useAglynElementData($id, 'bundleId')
  const componentSchema = useAglynComponentSchema(componentId, bundleId)
  const hierarchy = componentSchema?.hierarchy


  const handleDragStart = useCallback((active: BesignerDndElementActive) => {
    console.log('handleDragStart', $id, active)
    setSelected({$id})
    setDndActive(active)
  }, [$id, setDndActive, setSelected])
  const handleDragOver = useCallback((over?: BesignerDndElementOver) => {
    setHovered({$id})
    setDndOver(over)
  }, [$id, setDndOver, setHovered])
  const handleDragEnd = useCallback((
    active: BesignerDndElementActive,
    over?: BesignerDndElementOver,
    monitor?: DropTargetMonitor,
  ) => {
    console.log('handleDragEnd', active, over)
    setDndActive(undefined)
    setDndOver(undefined)
    setBesignerDnd(app, {dnd: () => ({})})
    if (over?.$id && active?.$id !== over.$id) {
      moveCanvasElement(app, {$id: active.$id, parentId: over?.$id, index: -1})
    }
  }, [app, setDndActive, setDndOver])


  const draggable = useDrag<BesignerDndElementActive, BesignerDndElementOver, DragCollected>(() => ({
    type: dragType,
    item: () => {
      const dragItem = ({
        $id,
        type: dragType,
        componentId,
        bundleId,
        hierarchy,
      })
      console.log('draggable item', dragItem)
      handleDragStart(dragItem)
      return dragItem
    },
    isDragging: (monitor) => monitor?.getItem()?.$id === $id,
    canDrag: !isRootElementId($id),
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
      // dropItem: monitor.getDropResult(),
      // active: monitor.getItem(),
    }),
  }), [$id, dragType, bundleId, componentId, hierarchy])

  const [{isDragging}, dragHandleRef, dragPreviewRef] = draggable
  const trail = useAglynCanvasElementHierarchy($id)
  const dropCollector = useCallback((monitor: DropTargetMonitor) => {
    const active = monitor.getItem<BesignerDndElementActive>()
    const isOverDrop = trail.some((i) => i === $id)
    const isInSame = isOverDrop && active && active.$id && trail.some((i) => i === active.$id)
    const isOver = monitor.isOver({shallow: false})
    const isOverSelf = monitor.isOver({shallow: true})
    const isOverChildren = isOver && !isOverSelf
    const isOverSameDrag = isOver && isDragging
    const isOverChildOfSameDrag = isInSame && !isOverSameDrag
    return {
      isOver,
      isOverSelf,
      isOverChildren,
      isOverSameDrag,
      isOverChildOfSameDrag,
      isDragging,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [$id, isDragging, trail])


  const droppable = useDrop<BesignerDndElementActive, BesignerDndElementOver, DropCollected>(() => ({
    accept: [
      DndDragSourceTypeFlag.CANVAS_ELEMENT,
      DndDragSourceTypeFlag.COMPONENT_TEMPLATE,
      DndDragSourceTypeFlag.TREE_ELEMENT,
    ],
    drop: (active, monitor) => {
      const dropItem: BesignerDndElementOver = ({
        $id,
        type: dropType,
        componentId,
        bundleId,
        hierarchy,
      })
      if (monitor.didDrop()) return undefined
      if (monitor.isOver({shallow: true})) {
        console.log('drop collection', active, dropItem)
        handleDragEnd(active, dropItem, monitor)
      }
      return dropItem
    },
    collect: dropCollector,
  }), [$id, dropType, bundleId, componentId, hierarchy])

  const [{isOverSelf}, dropRef] = droppable

  useEffect(() => {
    const dropItem: BesignerDndElementOver = ({
      $id,
      type: dropType,
      componentId,
      bundleId,
      hierarchy,
    })
    isOverSelf && handleDragOver(dropItem)
  }, [
    $id,
    bundleId,
    componentId,
    dropType,
    handleDragOver,
    hierarchy,
    isOverSelf,
  ])

  return [dragHandleRef, dragPreviewRef, dropRef]
}
export default useLeafDnd
