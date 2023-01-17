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
import { useDroppable } from '@dnd-kit/core'
import { mergeProps } from '@react-aria/utils'
import { Children, cloneElement } from 'react'

export interface DroppableProps<T extends { $id: string }> {
  children: JSX.Element
  node: T
  type: Besigner.DragType
  accept: Besigner.DragType[]
  disabled?: boolean
}

export const Droppable = <T extends { $id: string }>(
  props: DroppableProps<T>,
) => {
  const { node, type, disabled, accept, children } = props
  const id = useId(node?.$id)

  const droppable = useDroppable({
    id: `drop:${id}:${type}`,
    data: { type, node, accept },
    disabled,
  })

  const child = Children.only(children)

  return cloneElement(
    child,
    mergeProps(child.props, {
      ref: mergeRefs(child.props.ref, droppable.setNodeRef),
    }),
  )
}

Droppable.displayName = 'Droppable'

export default Droppable
