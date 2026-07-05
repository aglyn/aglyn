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
import { useDroppable } from '@dnd-kit/core'
import { mergeProps } from '@react-aria/utils'
import { observer } from 'mobx-react-lite'
import {
  Children,
  cloneElement,
  CSSProperties,
  forwardRef,
  MutableRefObject,
} from 'react'

export interface DroppableChildProps<T extends { $id: string }>
  extends Omit<DroppableProps<T>, 'children'> {
  droppable: ReturnType<typeof useDroppable>
  style: CSSProperties
  forwardRef: MutableRefObject<any>
}
export type DroppableChild<T extends { $id: string }> = (
  props: DroppableChildProps<T>,
) => JSX.Element

export interface DroppableProps<T extends { $id: string }> {
  children: JSX.Element | DroppableChild<T>
  node: T
  type: Besigner.DragType
  accept: Besigner.DragType[]
  disabled?: boolean
  idSuffix?: string
}

export const Droppable = observer(
  forwardRef(<T extends { $id: string }>(props: DroppableProps<T>, ref) => {
    const { children, ...rest } = props
    const { node, type, disabled, accept, idSuffix } = rest
    const id = useId(node?.$id)

    const droppable = useDroppable({
      id: `${id}:${type}${idSuffix || ''}`,
      data: { type, node, accept },
      disabled,
    })

    const style: CSSProperties = {
      outlineWidth: '2',
      outlineOffset: '-1',
      outlineColor: 'grey',
      outlineStyle: 'dotted',
      ...(droppable.isOver
        ? {
            outlineColor: 'lime',
            outlineStyle: 'solid',
            outlineOffset: '3',
          }
        : {}),
    }

    if (typeof children === 'function') {
      return children({
        ...rest,
        style,
        droppable,
        forwardRef: ref,
      })
    }

    const child = Children.only(children)
    return cloneElement(
      child,
      mergeProps(child.props, {
        ref: mergeRefs(ref, child.props.ref, droppable.setNodeRef),
      }),
    )
  }),
)

Droppable.displayName = 'Droppable'

export default Droppable
