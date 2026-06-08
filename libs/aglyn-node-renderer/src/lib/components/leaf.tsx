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
import { ShadowDom } from '@aglyn/shared-ui-jsx'
import { styled } from '@aglyn/shared-ui-theme'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import { observer } from 'mobx-react-lite'
import { forwardRef, type HTMLAttributes } from 'react'
import { isValidElementType } from 'react-is'

const DefaultComponent = styled('div')({})

export interface LeafProps extends HTMLAttributes<any> {
  children?: any
  node: Aglyn.NodeSchema
  sx?: JSX.SxProps
}

export const Leaf = observer(
  forwardRef<any, LeafProps>((props, ref) => {
    const { children, node, sx, ...rest } = props

    const resolvedProps = node?.resolvedProps
    const Factory = Aglyn.components.getFactory(node?.componentId)
    const Component = isValidElementType(Factory) ? Factory : DefaultComponent

    const textContent = resolvedProps?.['children']

    return (
      <Component
        ref={ref}
        data-aglyn={`leaf:${node?.$id}`}
        sx={mergeSxProps(sx as any, node?.sx as any, resolvedProps?.sx as any)}
        {...resolvedProps}
        {...rest}
      >
        {children}

        {textContent != null && (
          <ShadowDom.AglynText>{textContent as any}</ShadowDom.AglynText>
        )}
      </Component>
    )
  }),
)
Leaf.displayName = 'Leaf'
Leaf['aglyn'] = true

export default Leaf
