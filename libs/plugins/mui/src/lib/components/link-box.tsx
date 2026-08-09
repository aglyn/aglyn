/**
 * @license
 * Copyright 2026 Aglyn LLC
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
import { mdiLinkBoxOutline } from '@aglyn/shared-data-mdi'
import { AppLink } from '@aglyn/shared-ui-jsx'
import MuiBox from '@mui/material/Box'
import type { SxProps } from '@mui/material/styles'
import { forwardRef, type ReactNode } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'muiLinkBox'

export interface LinkBoxProps {
  /** Target screen id, resolved from the host routing map at render time. */
  screenId?: string
  /** External URL escape hatch, used only when no `screenId` is set. */
  href?: string
  /** Opens in a new tab. External destinations only. */
  newTab?: boolean
  /**
   * Authored node styles, handed over by the renderer rather than typed into
   * an attribute. Declared because the merge below reads it: undeclared, no
   * typed caller could style a tile (AGL-1323).
   */
  sx?: SxProps
  children?: ReactNode
}

/**
 * A container that IS the link — icon, heading and description inside one
 * anchor, instead of a tile whose only clickable part is its title.
 *
 * Every other linking element in the plugin is a leaf: Screen Link and
 * Button both render their `children` as inline text, so `nodeAcceptsChildren`
 * reports false and the canvas will not let anything be dropped inside them.
 * That left no way to author a card, a mega-menu tile, or a linked logo —
 * the shapes where the whole box is meant to be one target (AGL-1231).
 *
 * Nothing interactive may be nested inside: an `<a>` inside an `<a>` is
 * invalid HTML and browsers unnest it, which silently moves half the tile
 * back out of the link. Convert an inner Screen Link to plain Text when you
 * wrap it in one of these.
 */
const LinkBox = forwardRef<HTMLElement, LinkBoxProps>((props, ref) => {
  const { screenId, href: externalHref, newTab, children, sx, ...rest } = props
  // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
  // Spreading `rest` with `sx` still inside it would REPLACE the baseline
  // below rather than merge with it, so every styled tile would quietly lose
  // `textDecoration: none` and get the browser's underlined-blue anchor.
  const nodeSx = Array.isArray(sx) ? sx : sx ? [sx] : []
  // Shared resolution (AGL-1335): screen id first, `javascript:`/`data:`
  // hrefs refused, `screen:`-prefixed prop values understood in either slot.
  // "External" means it leaves the site, not merely "typed by hand": a
  // site-relative `/pricing` in the href field must stay in the tab, or the
  // visitor loses their history for nothing.
  const {
    href,
    suppressNavigation,
    leavesSite: external,
  } = Aglyn.useLinkTarget(screenId, externalHref)

  // The unresolved and suppressed cases keep the same ELEMENT, not just the
  // same box (AGL-1268): this used to render a `<div>` here and an `<a>` when
  // the screen resolved, so the node's element type depended on the screens
  // map — a screen published or unpublished between renders changed the DOM
  // shape. An `<a>` without `href` is HTML's placeholder link: identical
  // element, non-interactive, and the canvas stays inert exactly as before.
  // The style floor matches the active branch so the two render identically.
  if (!href || suppressNavigation) {
    return (
      <MuiBox
        ref={ref}
        component="a"
        {...rest}
        sx={[
          { display: 'block', color: 'inherit', textDecoration: 'none' },
          ...nodeSx,
        ]}
      >
        {children}
      </MuiBox>
    )
  }
  return (
    <AppLink
      ref={ref}
      // NOT `componentVariant="naked"`: that branch renders a bare NextLink,
      // which does not process `sx` — it lands on the DOM as a literal `sx=""`
      // attribute and every style is silently dropped. The default branch is
      // MUI's Link, which does. The anchor chrome it brings is neutralised by
      // the baseline below.
      href={href}
      {...(newTab && external
        ? { target: '_blank', rel: 'noopener noreferrer' }
        : {})}
      {...rest}
      // `display: block` so the anchor takes the tile's box, and no anchor
      // chrome — authors then style it exactly as they would a Box. This is
      // only the floor: node styles come after it and win.
      sx={[
        { display: 'block', color: 'inherit', textDecoration: 'none' },
        ...nodeSx,
      ]}
    >
      {children}
    </AppLink>
  )
})
LinkBox.displayName = 'AglynLinkBox'

export const schema: Aglyn.ComponentSchema<LinkBoxProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Link Container',
  description:
    'Container that is itself a link — put an icon, a heading and a ' +
    'description inside and the whole box becomes one target.',
  category: Aglyn.ComponentCategory.NAVIGATION,
  icon: { path: mdiLinkBoxOutline.path, sx: { color: '#2196f3' } },
  attributes: [
    {
      name: 'screenId',
      description:
        'Screen this box navigates to. The address is generated from the ' +
        'published path at render time, so it keeps working when the ' +
        "screen's slug or parent changes.",
      component: Aglyn.FieldComponentType.SCREEN_SELECT,
      label: 'Screen',
    },
    {
      name: 'href',
      description: 'External URL used only when no screen is selected above.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'External URL',
    },
    {
      name: 'newTab',
      description:
        'Open in a new tab. Applies to external URLs only — a link to one ' +
        'of your own screens stays in the tab so the visitor keeps their ' +
        'history.',
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Open in a new tab',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Link Container',
    pluginId: BUNDLE_ID,
    description: 'A whole box that links somewhere',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: schema.icon,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      // Ships with padding and a hover tint: an empty, zero-height anchor
      // dropped on the canvas looks like nothing happened.
      props: {
        sx: {
          display: 'block',
          p: 2,
          borderRadius: 1,
          '&:hover': { backgroundColor: 'action.hover' },
        },
      },
    },
  },
]

export default LinkBox
