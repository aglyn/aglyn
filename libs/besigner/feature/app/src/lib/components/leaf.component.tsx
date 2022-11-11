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

import { Leaf, type LeafProps } from '@aglyn/aglyn-node-renderer'
import * as Besigner from '@aglyn/besigner'
import { useForkedRefs } from '@aglyn/shared-ui-jsx'
import { observer } from 'mobx-react-lite'
import {
  type ChangeEvent,
  type ForwardedRef,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { useRenderedCanvasElements } from '../contexts/rendered-canvas-elements'
import useLeafDrag from '../hooks/use-leaf-drag'
import useLeafDrop from '../hooks/use-leaf-drop'

export interface ElementLeafComponentProps extends LeafProps {}

function RawLeafComponent(
  props: ElementLeafComponentProps,
  forwardRef: ForwardedRef<any>,
) {
  const { node, ...rest } = props
  const isSelected = Besigner.focus.isNodeSelected(node)

  const [, dragHandle, dragPreview] = useLeafDrag(
    { $id: node?.$id, node },
    Besigner.dnd.DragType.CANVAS,
  )
  const [, dropRef] = useLeafDrop({
    $id: node?.$id,
    node,
    type: Besigner.dnd.DropAreaType.INSIDE,
  })
  const [nodeRef, setNodeRef] = useState<HTMLElement>()
  const { setElementRef, deleteElementRef } = useRenderedCanvasElements()
  const ref = useForkedRefs<HTMLElement>(
    forwardRef,
    dragPreview,
    dropRef,
    setNodeRef,
  )

  /**
   * Update context element ref
   */
  useEffect(() => {
    setElementRef(node?.$id, { $id: node?.$id, node: nodeRef, dragHandle })
    return () => {
      deleteElementRef(node?.$id)
    }
  }, [setElementRef, dragHandle, node, nodeRef, deleteElementRef])
  /**
   * Remove only on unmount
   */
  // useEffect(() => () => deleteElementRef(node?.$id), [deleteElementRef, node])

  const handleOnMouseOver = useCallback(
    (e: ChangeEvent<any>) => {
      e.preventDefault()
      e.stopPropagation()
      Besigner.focus.setHoveredNode(node)
    },
    [node],
  )
  const handleOnMouseDown = useCallback(
    (e: ChangeEvent<any>) => {
      e.preventDefault()
      e.stopPropagation()
      Besigner.focus.handleNodeSelection(node)
    },
    [node],
  )

  // console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~')
  // console.log('element attributes', elementAttributes)

  return (
    <Leaf
      ref={ref}
      node={node}
      onMouseOver={handleOnMouseOver}
      onMouseDown={handleOnMouseDown}
      data-aglyn-node={node?.$id}
      data-aglyn-component={node?.componentId}
      data-aglyn-bundle={node?.componentSchema?.pluginId}
      data-aglyn-status={isSelected ? 'selected' : 'none'}
      {...rest}
    />
  )
}
RawLeafComponent.displayName = 'BesignerLeafComponent'
RawLeafComponent.aglyn = true

const LeafComponent = observer<ElementLeafComponentProps, any>(
  RawLeafComponent,
  { forwardRef: true },
)

export { LeafComponent }
export default LeafComponent
