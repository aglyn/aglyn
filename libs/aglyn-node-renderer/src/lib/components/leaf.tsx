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
import { styled } from '@aglyn/shared-ui-theme'
import mergeSxProps from '@aglyn/shared-ui-theme/util/merge-sx-props'
import { observer } from 'mobx-react-lite'
import { HTMLAttributes, type MutableRefObject, useMemo } from 'react'
import { isValidElementType } from 'react-is'

const DefaultComponent = styled('div')({})

export interface LeafProps extends HTMLAttributes<any> {
  children?: any
  node: Aglyn.NodeSchema
  sx?: JSX.SxProps
}

function LeafRaw(props: LeafProps, ref: MutableRefObject<any>) {
  const { children, node, sx, ...rest } = props

  const componentSchema = node?.componentSchema
  const resolveProps = componentSchema?.resolveProps
  const Factory = Aglyn.components.getFactory(componentSchema?.$id)

  const Component = useMemo(() => {
    return isValidElementType(Factory) ? Factory : DefaultComponent
  }, [Factory])

  const resolved = useMemo(() => {
    const resolved = resolveProps && resolveProps(node)
    return resolved || node.props
  }, [resolveProps, node])

  const merged = useMemo(() => {
    return { ...resolved, sx: mergeSxProps(sx, node?.sx) }
  }, [resolved, sx, node])

  return (
    <Component
      key={node?.$id}
      ref={ref}
      data-aglyn={`leaf:${node?.$id}`}
      {...rest}
      {...merged}
    >
      {children}
      {merged?.['children']}
    </Component>
  )
}
LeafRaw.displayName = 'Leaf'
LeafRaw.aglyn = true

const Leaf = observer<LeafProps, any>(LeafRaw, { forwardRef: true })
export default Leaf
