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
    const { children, node, sx, className, style, ...rest } = props

    // Pull sx/className/style out of the node's props so the spreads below
    // can never clobber the merged values composed explicitly afterwards
    // (AGL-569: `props.sx` used to overwrite the node-level sx entirely).
    const {
      sx: propsSx,
      className: propsClassName,
      style: propsStyle,
      ...resolvedProps
    } = (node?.resolvedProps ?? node?.props ?? {}) as Record<string, any>
    const Factory = Aglyn.components.getFactory(node?.componentId)
    const Component = isValidElementType(Factory) ? Factory : DefaultComponent

    const textContent = resolvedProps?.['children']

    const mergedClassName =
      [propsClassName, node?.className, className].filter(Boolean).join(' ') ||
      undefined
    const mergedStyle =
      propsStyle || style ? { ...propsStyle, ...style } : undefined

    return (
      <Component
        ref={ref}
        data-aglyn={`leaf:${node?.$id}`}
        {...resolvedProps}
        {...rest}
        className={mergedClassName}
        style={mergedStyle}
        // MUI array composition: later entries win on key conflicts, so the
        // node-level sx (Styles panel output) overrides props.sx.
        sx={mergeSxProps(sx as any, propsSx as any, node?.sx as any)}
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
