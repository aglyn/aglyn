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
import { mdiLinkVariant } from '@aglyn/shared-data-mdi'
import { AppLink } from '@aglyn/shared-ui-jsx'
import Button, { type ButtonProps } from '@mui/material/Button'
import Link from '@mui/material/Link'
import { forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  FIELD_COLOR,
  FIELD_FULL_WIDTH,
  FIELD_SIZE,
  FIELD_TEXT_CONTENT,
} from '../constants/field-presets'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'muiScreenLink'

export interface ScreenLinkProps extends ButtonProps {
  /**
   * Target screen id. The href is resolved from the host routing map at
   * render time (see `ScreenLinkContext`), so slug renames and re-parenting
   * never break the link — which is what makes navigation inside a shared
   * layout viable.
   */
  screenId?: string
  /** External URL escape hatch, used only when no `screenId` is set. */
  href?: string
  /**
   * Whether this reads as a button or as text (AGL-1195). Persisted in
   * screen documents; never rename, and `undefined` must keep meaning
   * `'button'` — every link authored before this existed is one.
   */
  renderAs?: 'button' | 'link'
}

/**
 * Link that targets a screen by id, never a hardcoded path. Degrades to a
 * plain button when the id doesn't resolve (unpublished/deleted screen) and
 * when navigation is suppressed (besigner canvas, preview).
 *
 * `renderAs="link"` renders MUI's `Link` instead of `Button` (AGL-1195).
 * Footer and inline navigation are *text*: as buttons they inherit button
 * typography, uppercase transforms and the wrong role for assistive tech.
 * The button-only props are dropped in that mode rather than passed through
 * — `variant` means the typography variant on a `Link`, so forwarding
 * `"contained"` would silently produce an unstyled element.
 */
// Only navigable protocols: javascript:/data: URLs in a stored href would
// execute in visitors' browsers (content-hardening review, 2026-07-07).
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/|#)/i

const ScreenLink = forwardRef<any, ScreenLinkProps>((props, ref) => {
  const {
    screenId,
    href: externalHref,
    renderAs,
    variant,
    size,
    fullWidth,
    ...rest
  } = props
  const { href: resolvedHref, suppressNavigation } = Aglyn.useScreenLink(screenId)
  const safeExternalHref =
    externalHref && SAFE_HREF.test(externalHref.trim())
      ? externalHref.trim()
      : undefined
  const href = screenId ? resolvedHref : safeExternalHref
  const asLink = renderAs === 'link'

  if (!href || suppressNavigation) {
    // The canvas must not lie about which element the page will ship, so
    // the unresolved/suppressed case mirrors the same two shapes.
    return asLink ? (
      <Link ref={ref} component="span" underline="hover" {...rest} />
    ) : (
      <Button
        ref={ref}
        variant={variant}
        size={size}
        fullWidth={fullWidth}
        {...rest}
      />
    )
  }
  return asLink ? (
    <AppLink ref={ref} underline="hover" href={href} {...rest} />
  ) : (
    <AppLink
      ref={ref}
      componentVariant="button"
      href={href}
      variant={variant}
      size={size}
      fullWidth={fullWidth}
      {...rest}
    />
  )
})
ScreenLink.displayName = 'ScreenLink'

export const schema: Aglyn.ComponentSchema<ScreenLinkProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Screen Link',
  category: Aglyn.ComponentCategory.NAVIGATION,
  icon: {
    path: mdiLinkVariant.path,
    sx: { color: '#2196f3' },
  },
  flags: {
    textEditable: Aglyn.FEATURE_FLAG.ENABLED,
  },
  attributes: [
    FIELD_TEXT_CONTENT,
    {
      name: 'screenId',
      description:
        'Screen this link navigates to. The address is generated from the ' +
        'published path at render time, so it keeps working when the ' +
        "screen's slug or parent changes.",
      component: Aglyn.FieldComponentType.SCREEN_SELECT,
      label: 'Screen',
    },
    {
      name: 'href',
      description:
        'External URL used only when no screen is selected above.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'External URL',
    },
    {
      name: 'renderAs',
      description:
        'Buttons for calls to action; text for navigation — a footer or ' +
        'inline link rendered as a button gets button typography and reads ' +
        'as a button to screen readers.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Render as',
      options: [
        { value: '', label: 'Button' },
        { value: 'link', label: 'Text link' },
      ],
    },
    FIELD_COLOR,
    FIELD_SIZE,
    FIELD_FULL_WIDTH,
    {
      name: 'variant',
      description: 'The variant to use.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Variant',
      options: [
        { value: '', label: 'Default' },
        { value: 'text', label: 'Text' },
        { value: 'outlined', label: 'Outlined' },
        { value: 'contained', label: 'Contained' },
      ],
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Screen Link',
    icon: {
      path: mdiLinkVariant.path,
      sx: { color: '#2196f3' },
    },
    category: Aglyn.ComponentCategory.NAVIGATION,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {
        children: 'Screen Link',
        // Same visible-on-any-surface defaults as the button preset; the
        // default text color disappears against a same-hue appbar.
        variant: 'outlined',
        color: 'inherit',
      },
    },
  },
]

export default ScreenLink
