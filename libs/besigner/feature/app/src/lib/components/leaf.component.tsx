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
import { forwardRef, useEffect, useRef } from 'react'
import useLeafDrag from '../hooks/use-leaf-drag'
import useLeafDrop from '../hooks/use-leaf-drop'

export interface ElementLeafComponentProps extends LeafProps {}

const RawLeafComponent = forwardRef<any, ElementLeafComponentProps>(
  (props, forwardRef) => {
    const { node, ...rest } = props
    const localRef = useRef<HTMLElement>(null)
    const isSelected = Besigner.focus.isNodeSelected(node)
    const $id = node?.$id

    const {
      setNodeRef: setDraggableNodeRef,
      attributes,
      listeners,
      transform,
    } = useLeafDrag(node, Besigner.DragType.CANVAS)
    const { setNodeRef: setDroppableNodeRef } = useLeafDrop(node)

    useEffect(() => {
      Besigner.refs.set($id, {
        node: localRef,
        dragHandle: {
          ...listeners,
          style: transform ? { cursor: 'grab' } : { cursor: 'move' },
        },
      })
      return () => {
        Besigner.refs.delete($id)
      }
    }, [$id, listeners, transform])

    useEffect(() => {
      const el = localRef.current
      if (el) {
        el.addEventListener('mouseover', handleMouseOver)
        el.addEventListener('mousedown', handleMouseDown)

        return () => {
          el.removeEventListener('mouseover', handleMouseOver)
          el.removeEventListener('mousedown', handleMouseDown)
        }
      }
      function handleMouseOver(e: Event) {
        e.preventDefault()
        e.stopPropagation()
        Besigner.focus.setHoveredNode(node)
      }
      function handleMouseDown(e: Event) {
        e.preventDefault()
        e.stopPropagation()
        Besigner.focus.handleNodeSelection(node)
      }
    }, [node])

    return (
      <>
        <Leaf
          ref={useForkedRefs<HTMLElement>(
            forwardRef,
            localRef,
            setDraggableNodeRef,
            setDroppableNodeRef,
          )}
          node={node}
          data-aglyn-selected={isSelected ? 'selected' : undefined}
          style={
            transform && {
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
              cursor: 'grab',
            }
          }
          {...attributes}
          {...rest}
        />
      </>
    )
  },
)
RawLeafComponent.displayName = 'BesignerLeafComponent'
RawLeafComponent.aglyn = true

export const LeafComponent = observer<ElementLeafComponentProps, any>(
  RawLeafComponent,
)
export default LeafComponent
