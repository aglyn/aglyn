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
import { mdiTranslate } from '@aglyn/shared-data-mdi'
import { AppLink } from '@aglyn/shared-ui-jsx'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import { forwardRef, useContext } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'languageSwitcher'

export interface LanguageSwitcherProps {
  /** 'text' shows locale codes; 'buttons' renders outlined buttons. */
  variant?: 'text' | 'buttons'
  /** Uppercase the locale codes (EN / ES). */
  uppercase?: boolean
}

/**
 * Language switcher (AGL-164): renders one link per translation of the
 * CURRENT screen, resolved from ScreenLinkContext (`localeVariants` +
 * routing map), so it works inside shared layouts. Shows a placeholder in
 * the editor when the screen has no variants; renders nothing on the live
 * site in that case.
 */
const LanguageSwitcher = forwardRef<HTMLElement, LanguageSwitcherProps>(
  (props, ref) => {
    const { variant, uppercase, ...rest } = props
    const { screens, localeVariants, currentLocale, suppressNavigation } =
      useContext(Aglyn.ScreenLinkContext)
    const entries = Object.entries(localeVariants ?? {}).filter(
      ([, screenId]) => screens?.[screenId] != null,
    )
    const format = (locale: string) =>
      uppercase === false ? locale : locale.toUpperCase()

    if (!entries.length) {
      // Editor-only placeholder; invisible on the live site.
      if (!suppressNavigation) return null
      return (
        <Stack
          ref={ref as any}
          direction="row"
          spacing={1}
          {...rest}
          sx={{
            alignItems: 'center',
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: 1,
            px: 1.5,
            py: 0.5,
            color: 'text.secondary',
            fontSize: 12,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {'Language switcher — set screen translations'}
        </Stack>
      )
    }

    return (
      <Stack
        ref={ref as any}
        direction="row"
        spacing={0.5}
        {...rest}
        sx={{ alignItems: 'center' }}
      >
        {currentLocale ? (
          <Button size="small" variant="text" disabled>
            {format(currentLocale)}
          </Button>
        ) : null}
        {entries.map(([locale, screenId]) => {
          const path = screens?.[screenId]
          const href =
            path != null ? Aglyn.screenRoutePathToUrl(path) : undefined
          if (!href || suppressNavigation) {
            return (
              <Button key={locale} size="small" variant="text">
                {format(locale)}
              </Button>
            )
          }
          return (
            <AppLink
              key={locale}
              componentVariant="button"
              href={href}
              size="small"
              variant={variant === 'buttons' ? 'outlined' : 'text'}
            >
              {format(locale)}
            </AppLink>
          )
        })}
      </Stack>
    )
  },
)
LanguageSwitcher.displayName = 'LanguageSwitcher'

export const schema: Aglyn.ComponentSchema<LanguageSwitcherProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Language Switcher',
  category: Aglyn.ComponentCategory.NAVIGATION,
  icon: {
    path: mdiTranslate.path,
    sx: { color: '#2196f3' },
  },
  flags: {
    selfClosing: Aglyn.FEATURE_FLAG.ENABLED,
  },
  attributes: [
    {
      name: 'variant',
      description: 'How the language links render.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Style',
      options: [
        { value: '', label: 'Text (default)' },
        { value: 'buttons', label: 'Outlined buttons' },
      ],
    },
    {
      name: 'uppercase',
      description: 'Show locale codes uppercased (EN, ES).',
      component: Aglyn.FieldComponentType.CHECKBOX,
      label: 'Uppercase',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Language Switcher',
    pluginId: BUNDLE_ID,
    description: 'Links between this screen’s translations',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: {
      path: mdiTranslate.path,
      sx: { color: '#2196f3' },
    },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
]

export default LanguageSwitcher
