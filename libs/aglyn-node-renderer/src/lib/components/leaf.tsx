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
import { forwardRef, type HTMLAttributes, useContext } from 'react'
import { isValidElementType } from 'react-is'
import { LeafSxTransformContext } from '../contexts/leaf-sx-transform'

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

    // Self-closing components (AGL-579): a component whose schema flags it
    // selfClosing renders a void DOM element (e.g. Image -> <img>), and React
    // throws during SSR when ANY children value reaches one — even the empty
    // `[undefined, false]` the JSX below always produces. Rendering the whole
    // page 500s off one image node (blog covers, AGL-579), so honor the flag
    // here: no JSX children, and strip a stray `children` prop too.
    const schema = Aglyn.components.getSchema(node?.componentId)
    const selfClosing = Boolean(
      (schema?.flags?.selfClosing ?? 0) & Aglyn.FEATURE_FLAG.ENABLED,
    )
    if (selfClosing) delete resolvedProps['children']

    const textContent = selfClosing ? null : resolvedProps?.['children']

    const mergedClassName =
      [propsClassName, node?.className, className].filter(Boolean).join(' ') ||
      undefined
    const mergedStyle =
      propsStyle || style ? { ...propsStyle, ...style } : undefined

    // Canvas-only hook (AGL-581): the besigner provides a transform that
    // re-targets viewport media queries at the artboard device width.
    // Undefined everywhere else, keeping the tenant path unchanged.
    const transformSx = useContext(LeafSxTransformContext)
    // MUI array composition: later entries win on key conflicts, so the
    // node-level sx (Styles panel output) overrides props.sx.
    const mergedSx = mergeSxProps(sx as any, propsSx as any, node?.sx as any)

    // Shared leaf attributes; self-closing components must receive NO
    // children at all (AGL-579) — a separate element expression keeps the
    // childless case genuinely childless instead of `[undefined, false]`.
    const leafProps = {
      ref,
      'data-aglyn': `leaf:${node?.$id}`,
      ...resolvedProps,
      ...rest,
      className: mergedClassName,
      style: mergedStyle,
      sx: transformSx ? (transformSx(mergedSx) as typeof mergedSx) : mergedSx,
    }

    if (selfClosing) return <Component {...leafProps} />

    return (
      <Component {...leafProps}>
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
