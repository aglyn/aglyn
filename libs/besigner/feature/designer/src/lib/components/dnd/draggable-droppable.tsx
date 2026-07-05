/**
 * @license
 * Copyright 2023 Aglyn LLC
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
import { mergeRefs, useId } from '@aglyn/shared-ui-jsx'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS as css } from '@dnd-kit/utilities'
import { mergeProps } from '@react-aria/utils'
import { observer } from 'mobx-react-lite'
import { Children, cloneElement, CSSProperties, useEffect, useRef } from 'react'

export interface DraggableDroppableProps<T extends Aglyn.NodeSchema<any>> {
  children: JSX.Element
  node: T
  type: Besigner.DragType
  accept: Besigner.DragType[]
  disableDragging?: boolean
  disableDropping?: boolean
  idSuffix?: string
}

export const DraggableDroppable = observer(
  <T extends Aglyn.NodeSchema<any>>(props: DraggableDroppableProps<T>) => {
    const {
      node,
      type,
      disableDragging,
      disableDropping,
      accept,
      children,
      idSuffix,
    } = props
    const id = useId(node?.$id)

    const draggable = useDraggable({
      id: `${id}:${type}${idSuffix || ''}`,
      data: { type, node },
      disabled: disableDragging,
    })

    const droppable = useDroppable({
      id: `${id}:${type}${idSuffix || ''}`,
      data: { type, node, accept },
      disabled: disableDropping,
    })

    const transform = draggable.transform
    const isTransforming = Boolean(draggable.transform)
    const child = Children.only(children)
    const style: CSSProperties = {
      ...child.props.style,
      // cursor: 'move',
      outlineWidth: 2,
      outlineOffset: -1,
      outlineColor: 'grey',
      outlineStyle: 'dotted',
      // transform: css.Transform.toString(transform),
      // scale: css.Scale.toString(transform),
      translate: css.Translate.toString(transform),

      ...(isTransforming
        ? {
            // transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
            // cursor: 'grab',
          }
        : {}),
      ...(droppable.isOver
        ? {
            outlineColor: 'lime',
            outlineStyle: 'solid',
            outlineOffset: '3',
          }
        : {}),
      ...(draggable.isDragging
        ? {
            outlineColor: 'grey',
            outlineStyle: 'double',
            outlineOffset: -1 as any,
            opacity: 0.5,
            cursor: 'move',
          }
        : {}),
    }

    const ref = useRef<HTMLElement>(null)

    useEffect(() => {
      Besigner.refs.set(node.$id, ref)
      return () => {
        Besigner.refs.delete(node.$id)
      }
    }, [node?.$id])

    useEffect(() => {
      Besigner.handles.set(node.$id, {
        ...draggable.listeners,
        style: isTransforming ? { cursor: 'grab' } : { cursor: 'move' },
      })
      return () => {
        Besigner.handles.delete(node.$id)
      }
    }, [node.$id, draggable.listeners, isTransforming])

    useEffect(() => {
      const el = ref.current
      if (el) {
        el.addEventListener('mouseover', handleMouseOver)
        el.addEventListener('pointerover', handleMouseOver)
        el.addEventListener('mousedown', handleMouseDown)
        el.addEventListener('pointerdown', handleMouseDown)

        return () => {
          el.removeEventListener('mouseover', handleMouseOver)
          el.removeEventListener('pointerover', handleMouseOver)
          el.removeEventListener('mousedown', handleMouseDown)
          el.removeEventListener('pointerdown', handleMouseDown)
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

    return cloneElement(
      child,
      mergeProps(child.props, draggable.attributes, {
        ref: mergeRefs(
          ref,
          child.props.ref,
          draggable.setNodeRef,
          droppable.setNodeRef,
        ),
        style,
        sx: {
          '&, &:hover, &:focus': {
            cursor: draggable.isDragging ? 'move' : 'initial',
          },
        },
      }),
    )
  },
)

DraggableDroppable.displayName = 'DraggableDroppable'

export default DraggableDroppable
