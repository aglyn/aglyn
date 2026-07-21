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
  mdiThemeLightDark,
  mdiWeatherNight,
  mdiWhiteBalanceSunny,
} from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { useThemeMode } from '@aglyn/shared-ui-theme'
import IconButton from '@mui/material/IconButton'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import { forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'themeModeSwitcher'

export interface ThemeModeSwitcherProps {
  /** 'icon' cycles light→dark→system on click; 'toggle' shows all three. */
  variant?: 'icon' | 'toggle'
}

/**
 * Visitor-facing light/dark override (AGL-337): drives the shared
 * cookie-backed theme mode state the HostThemeProvider already resolves,
 * so the choice persists across visits and pages. The icon variant
 * cycles light → dark → device default; the toggle variant shows the
 * three choices explicitly.
 */
const ThemeModeSwitcher = forwardRef<HTMLElement, ThemeModeSwitcherProps>(
  (props, ref) => {
    const { variant, ...rest } = props
    const [, toggleThemeMode, cookieMode] = useThemeMode()

    if (variant === 'toggle') {
      return (
        <ToggleButtonGroup
          ref={ref as any}
          size="small"
          exclusive
          value={cookieMode ?? 'system'}
          onChange={(event, value) =>
            value && toggleThemeMode(event as any, value)
          }
          aria-label="Color theme"
          {...rest}
        >
          <ToggleButton value="light" aria-label="Light">
            <MdiIcon path={mdiWhiteBalanceSunny.path} fontSize="small" />
          </ToggleButton>
          <ToggleButton value="system" aria-label="Device default">
            <MdiIcon path={mdiThemeLightDark.path} fontSize="small" />
          </ToggleButton>
          <ToggleButton value="dark" aria-label="Dark">
            <MdiIcon path={mdiWeatherNight.path} fontSize="small" />
          </ToggleButton>
        </ToggleButtonGroup>
      )
    }

    return (
      <Tooltip title={`Theme: ${cookieMode ?? 'device default'}`}>
        <IconButton
          ref={ref as any}
          onClick={(event) => toggleThemeMode(event)}
          aria-label="Toggle color theme"
          color="inherit"
          {...rest}
        >
          <MdiIcon
            // Key off the visitor's SELECTION, not the resolved mode: with
            // 'device default' chosen, `mode` still resolves to light or dark,
            // so the button showed a sun/moon and the system state was
            // invisible — you couldn't tell it apart from an explicit choice.
            // Same mapping the toggle variant uses.
            path={
              cookieMode === 'dark'
                ? mdiWeatherNight.path
                : cookieMode === 'light'
                ? mdiWhiteBalanceSunny.path
                : mdiThemeLightDark.path
            }
            fontSize="small"
          />
        </IconButton>
      </Tooltip>
    )
  },
)
ThemeModeSwitcher.displayName = 'AglynThemeModeSwitcher'

export const schema: Aglyn.ComponentSchema<ThemeModeSwitcherProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Theme mode switcher',
  description:
    'Lets visitors override the site theme with light, dark, or device default.',
  category: Aglyn.ComponentCategory.INPUT,
  icon: { path: mdiThemeLightDark.path, sx: { color: '#7b1fa2' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'variant',
      label: 'Variant',
      description:
        'Icon button cycles modes on click; toggle shows light / device / dark.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: 'icon', label: 'Icon button' },
        { value: 'toggle', label: 'Toggle group' },
      ],
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Theme mode switcher',
    pluginId: BUNDLE_ID,
    description: 'Visitor light/dark/system override button',
    category: Aglyn.ComponentCategory.INPUT,
    icon: { path: mdiThemeLightDark.path, sx: { color: '#7b1fa2' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { variant: 'icon' },
    },
  },
]

export default ThemeModeSwitcher
