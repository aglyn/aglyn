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

import * as Besigner from '@aglyn/besigner'
import { mergeRefs, useId } from '@aglyn/shared-ui-jsx'
import { useDraggable } from '@dnd-kit/core'
import { mergeProps } from '@react-aria/utils'
import { observer } from 'mobx-react-lite'
import {
  Children,
  cloneElement,
  CSSProperties,
  forwardRef,
  MutableRefObject,
} from 'react'

export interface DraggableChildProps<T extends { $id?: string }>
  extends Omit<DraggableProps<T>, 'children'> {
  draggable: ReturnType<typeof useDraggable>
  style: CSSProperties
  forwardRef: MutableRefObject<any>
}
export type DraggableChild<T extends { $id?: string }> = (
  props: DraggableChildProps<T>,
) => JSX.Element

export interface DraggableProps<T extends { $id?: string }> {
  children: JSX.Element | DraggableChild<T>
  node: T
  type: Besigner.DragType
  disabled?: boolean
  idSuffix?: string
}

const Draggable = observer(
  forwardRef(<T extends { $id?: string }>(props: DraggableProps<T>, ref) => {
    const { children, ...rest } = props
    const { node, type, disabled, idSuffix } = rest
    const id = useId(node?.$id)

    const draggable = useDraggable({
      id: `${id}:${type}${idSuffix || ''}`,
      data: { type, node },
      disabled,
    })

    const transform = draggable.transform
    const style: CSSProperties = {
      cursor: 'move',
      ...(draggable.isDragging
        ? {
            outlineColor: 'grey',
            outlineStyle: 'double',
            outlineOffset: '-1px',
            opacity: 0.5,
            cursor: 'move',
          }
        : {}),
      ...(transform
        ? {
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
            cursor: 'grab',
          }
        : {}),
    }

    if (typeof children === 'function') {
      return children({
        ...rest,
        style,
        draggable,
        forwardRef: ref,
      })
    }

    const child = Children.only(children)
    return cloneElement(
      child,
      mergeProps(child.props, {
        ref: mergeRefs(ref, child.props.ref, draggable.setNodeRef),
        style,
        ...draggable.listeners,
        ...draggable.attributes,
      }),
    )
  }),
)
Draggable.displayName = 'Draggable'

export default Draggable
