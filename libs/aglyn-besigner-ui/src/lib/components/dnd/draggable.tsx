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

import * as Besigner from '@aglyn/besigner'
import { mergeRefs } from '@aglyn/shared-ui-jsx'
import useId from '@aglyn/shared-ui-jsx/hooks/use-id'
import { useDraggable } from '@dnd-kit/core'
import { mergeProps } from '@react-aria/utils'
import type * as CSS from 'csstype'
import { Children, cloneElement } from 'react'

export interface DraggableProps<T extends { $id: string }> {
  children: JSX.Element
  node: T
  type: Besigner.DragType
  disabled?: boolean
}

const Draggable = <T extends { $id: string }>(props: DraggableProps<T>) => {
  const { node, type, disabled, children } = props
  const id = useId(node?.$id)

  const draggable = useDraggable({
    id: `drag:${id}:${type}`,
    data: { type, node },
    disabled,
  })

  const transform = draggable.transform
  const child = Children.only(children)
  const style: CSS.Properties = { ...child.props.style, cursor: 'move' }

  if (transform) {
    style.transform = `translate3d(${transform.x}px, ${transform.y}px, 0)`
    style.cursor = 'grab'
  }

  return cloneElement(
    child,
    mergeProps(child.props, {
      ref: mergeRefs(child.props.ref, draggable.setNodeRef),
      style,
      ...draggable.listeners,
      ...draggable.attributes,
    }),
  )
}
Draggable.displayName = 'Draggable'

export default Draggable
