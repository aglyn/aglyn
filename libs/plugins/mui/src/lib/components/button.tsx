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
import {
  mdiGestureTapButton,
} from '@aglyn/shared-data-mdi'
import { getMdiIconPath } from '@aglyn/shared-data-mdi'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import Button, { type ButtonProps } from '@mui/material/Button'
import { forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { dropClearedProps } from '../utils/drop-cleared-props'
import {
  FIELD_COLOR,
  FIELD_DISABLED,
  FIELD_FULL_WIDTH,
  FIELD_SIZE,
  FIELD_TEXT_CONTENT,
} from '../constants/field-presets'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; keep the legacy ids.
export const ID: Aglyn.ComponentId = 'muiButton'

export interface LinkableButtonProps extends ButtonProps {
  /** Target screen id; resolved from the routing map (AGL-139). */
  screenId?: string
  /** External URL, used only when no `screenId` is set. */
  href?: string
  /** mdi icon id rendered before the label (AGL-146). */
  startIconId?: string
  /** mdi icon id rendered after the label (AGL-146). */
  endIconId?: string
  /** Resolved SVG path for `startIconId`, stored at author time (AGL-1212). */
  startIconPath?: string
  /** Resolved SVG path for `endIconId`, stored at author time (AGL-1212). */
  endIconPath?: string
}

/**
 * mdi id → icon element; unknown/empty ids render nothing.
 *
 * Prefers the persisted path (AGL-1212) so render surfaces never need the
 * ~2.9 MB catalog, and falls back to the catalog for buttons authored before
 * paths were stored. `getMdiIconPath` rather than `getMdiIconFromId`: the
 * latter substitutes `DEFAULT_ICON`, which has a real path, so a miss used to
 * render a "help" glyph instead of nothing.
 */
function iconFromId(iconId?: string, iconPath?: string) {
  const path = iconPath || getMdiIconPath(iconId)
  return path ? <MdiIcon path={path} fontSize="small" /> : undefined
}

// Only navigable protocols — mirrors ScreenLink's hardening.
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/|#)/i

/**
 * Button with optional link mode (AGL-139): a screen id or external URL
 * renders through AppLink exactly like the Screen Link component —
 * degrading to a plain button in the besigner/preview and when the id
 * doesn't resolve.
 */
const LinkableButton = forwardRef<any, LinkableButtonProps>((props, ref) => {
  const {
    screenId,
    href: externalHref,
    startIconId,
    endIconId,
    startIconPath,
    endIconPath,
    ...spread
  } = props
  // A CLEARED attribute persists as null, and null is not "use the default"
  // in React — `color={null}` reaches MUI, which capitalizes it and throws
  // error #7 during SSR, 500ing the page (AGL-1226).
  const rest = dropClearedProps(spread)
  const iconProps = {
    startIcon: iconFromId(startIconId, startIconPath),
    endIcon: iconFromId(endIconId, endIconPath),
  }
  const { href: resolvedHref, suppressNavigation } =
    Aglyn.useScreenLink(screenId)
  const safeExternalHref =
    externalHref && SAFE_HREF.test(externalHref.trim())
      ? externalHref.trim()
      : undefined
  const href = screenId ? resolvedHref : safeExternalHref

  if (!href || suppressNavigation) {
    return <Button ref={ref} {...iconProps} {...rest} />
  }
  return (
    <AppLink
      ref={ref}
      componentVariant="button"
      href={href}
      {...iconProps}
      {...rest}
    />
  )
})
LinkableButton.displayName = 'LinkableButton'

export const schema: Aglyn.ComponentSchema<LinkableButtonProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Button',
  category: Aglyn.ComponentCategory.INPUT,
  icon: {
    path: mdiGestureTapButton.path,
    sx: { color: '#2196f3' },
  },
  flags: {
    textEditable: Aglyn.FEATURE_FLAG.ENABLED,
  },
  attributes: [
    FIELD_TEXT_CONTENT,
    FIELD_COLOR,
    FIELD_DISABLED,
    FIELD_FULL_WIDTH,
    FIELD_SIZE,
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
    {
      name: 'screenId',
      description:
        'Optional: navigate to this screen when clicked — the address ' +
        'follows the published path like a Screen Link (AGL-139).',
      component: Aglyn.FieldComponentType.SCREEN_SELECT,
      label: 'Link to screen',
    },
    {
      name: 'href',
      description: 'External URL used only when no screen is selected.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'External URL',
    },
    {
      name: 'startIconId',
      description: 'Icon shown before the label.',
      component: Aglyn.FieldComponentType.ICON_PICKER,
      label: 'Start icon',
    },
    {
      name: 'endIconId',
      description: 'Icon shown after the label.',
      component: Aglyn.FieldComponentType.ICON_PICKER,
      label: 'End icon',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Outlined Button',
    icon: {
      path: mdiGestureTapButton.path,
      sx: { color: '#2196f3' },
    },
    category: Aglyn.ComponentCategory.INPUT,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {
        variant: 'outlined',
        children: 'Click Me',
      },
    },
  },
]

export default LinkableButton
