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
import { useForkedRefs, useIsomorphicLayoutEffect } from '@aglyn/shared-ui-jsx'
import { observer } from 'mobx-react-lite'
import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useRenderedCanvasElements } from '../contexts/rendered-canvas-elements'
import useLeafDrag from '../hooks/use-leaf-drag'
import useLeafDrop from '../hooks/use-leaf-drop'

export interface ElementLeafComponentProps extends LeafProps {}

function RawLeafComponent(
  props: ElementLeafComponentProps,
  forwardRef: MutableRefObject<any>,
) {
  const { node, ...rest } = props

  const [, dragHandle, dragPreview] = useLeafDrag(
    node,
    Besigner.DragType.CANVAS,
  )
  const [, dropRef] = useLeafDrop(node)
  const localRef = useRef<HTMLElement>(null)
  const [nodeRef, setNodeRef] = useState<HTMLElement>()
  const { setElementRef, deleteElementRef } = useRenderedCanvasElements()
  const ref = useForkedRefs<HTMLElement>(
    forwardRef,
    dragPreview,
    dropRef,
    setNodeRef,
    localRef,
  )

  /**
   * Update context element ref
   */
  useEffect(() => {
    setElementRef(node?.$id, { $id: node?.$id, node: nodeRef, dragHandle })
    return () => {
      deleteElementRef(node?.$id)
    }
  })

  const handleOnMouseOver = useCallback(
    (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
      Besigner.focus.setHoveredNode(node)
    },
    [node],
  )
  const handleOnMouseDown = useCallback(
    (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
      Besigner.focus.handleNodeSelection(node)
    },
    [node],
  )
  const isSelected = Besigner.focus.isNodeSelected(node)

  useIsomorphicLayoutEffect(() => {
    const el = localRef.current
    if (el) {
      el.addEventListener('mouseover', handleOnMouseOver)
      el.addEventListener('mousedown', handleOnMouseDown)

      return () => {
        el.removeEventListener('mouseover', handleOnMouseOver)
        el.removeEventListener('mousedown', handleOnMouseDown)
      }
    }
  }, [nodeRef, handleOnMouseOver, handleOnMouseDown])

  // console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~')
  // console.log('element attributes', elementAttributes)

  return (
    <Leaf
      ref={ref}
      node={node}
      data-aglyn-selected={isSelected ? 'selected' : undefined}
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
