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
import { styled, useTheme } from '@aglyn/shared-ui-theme'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import { observer } from 'mobx-react-lite'
import { forwardRef, type HTMLAttributes, useContext } from 'react'
import { isValidElementType } from 'react-is'
import RendererComponents from '../contexts/renderer-components'
import { LeafSxTransformContext } from '../contexts/leaf-sx-transform'
import { resolvePaletteVarsSx, resolveSchemeSx } from '../utils/scheme-sx'

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
    //
    // The visibility directives (AGL-1314) come out here too. The compose
    // step consumes and strips them, so a rendered page never carries one —
    // but the component EDITOR renders definition nodes ungrafted, on
    // purpose (the author has to see and select the part a page will hide),
    // and there the raw `hideIf` would spread onto the element as an
    // unknown `hideif` DOM attribute.
    const {
      sx: propsSx,
      className: propsClassName,
      style: propsStyle,
      [Aglyn.NODE_HIDE_IF_PROP]: _hideIf,
      [Aglyn.NODE_HIDE_UNLESS_PROP]: _hideUnless,
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
    // Scheme-scoped styles (AGL-588): sites swap a single-mode theme for
    // light/dark (tenant HostThemeProvider, canvas useAglynSiteTheme), so
    // '@scheme dark' sx slices resolve here against the ACTIVE theme's
    // palette mode — the one signal that is correct in both places.
    const theme = useTheme() as {
      palette?: { mode?: string } & Record<string, unknown>
    } | null
    const activeScheme = theme?.palette?.mode === 'dark' ? 'dark' : 'light'
    // MUI array composition: later entries win on key conflicts, so the
    // node-level sx (Styles panel output) overrides props.sx.
    //
    // Palette token references (AGL-1331): the Background Fill field
    // persists a token-bound gradient stop as
    // `var(--mui-palette-primary-main, #00B0FF)`, because `backgroundImage`
    // is NOT one of the sx keys MUI resolves against the palette. They are
    // substituted here, against the site theme, so the canvas cannot pick
    // up the console's `--mui-palette-*` and the tenant (whose theme has no
    // CSS variables at all) still tracks palette changes. Values carrying
    // no reference come back by identity.
    // Author CSS (AGL-1725): `node.sx` is the Styles panel's output, and it
    // is free text — `backgroundImage` is a first-class field and the Custom
    // CSS tab is free-solo, so any property and any value can be typed. On a
    // published site that lands in the visitor's document as a real `url()`,
    // which no input validator and no lint rule can see. Scrubbed HERE, at
    // the last point before the merge, so it also catches values already
    // stored; `sx` and `props.sx` are OUR components' own styles and are
    // deliberately left alone. The scrub is scheme-only and returns its
    // input by identity when nothing is refused, so the overwhelmingly
    // common case (no `url()` at all) costs one walk and no new object.
    const authorSx = Aglyn.sanitizeAuthorSx(node?.sx)
    const mergedSx = resolvePaletteVarsSx(
      resolveSchemeSx(
        mergeSxProps(sx as any, propsSx as any, authorSx as any),
        activeScheme,
      ),
      theme?.palette,
    )

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

    // Node identity (AGL-659): components get their node id through a
    // context rather than a prop, so a block can look up the server-seeded
    // slice of `pageData` that belongs to IT — two grids on one page have
    // different queries and must not share a seed. Nothing is added to any
    // component's props, so no unknown attribute reaches the DOM.
    // Positional children (AGL-1237): a component that splits its children
    // by index — MUI's Accordion is `[summary, ...rest]` — must receive one
    // React child per node child. The default single `<Branch>` element reads
    // as ONE child to `Children.toArray`, so the first slot swallowed the
    // whole subtree and every later slot got nothing.
    const positional = Boolean(
      (schema?.flags?.positionalChildren ?? 0) & Aglyn.FEATURE_FLAG.ENABLED,
    )
    const childNodes = positional ? (node?.children ?? []) : null

    const element = selfClosing ? (
      <Component {...leafProps} />
    ) : positional ? (
      <RendererComponents.Consumer>
        {({ StemComponent }) => (
          <Component {...leafProps}>
            {childNodes!.map((child: any, key: number) => (
              <StemComponent key={child?.$id ?? key} node={child} />
            ))}
            {textContent != null && (
              <ShadowDom.AglynText>{textContent as any}</ShadowDom.AglynText>
            )}
          </Component>
        )}
      </RendererComponents.Consumer>
    ) : (
      <Component {...leafProps}>
        {children}

        {textContent != null && (
          <ShadowDom.AglynText>{textContent as any}</ShadowDom.AglynText>
        )}
      </Component>
    )

    return (
      <Aglyn.NodeIdentityContext.Provider value={node?.$id ?? ''}>
        {element}
      </Aglyn.NodeIdentityContext.Provider>
    )
  }),
)
Leaf.displayName = 'Leaf'
Leaf['aglyn'] = true

export default Leaf
