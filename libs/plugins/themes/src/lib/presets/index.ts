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

import type { ConsoleThemePreset } from '@aglyn/aglyn'
import { BUNDLE_ID } from '../constants/bundle-common'
import { ANT_DESIGN_THEME } from './ant-design'
import { BOOTSTRAP_THEME } from './bootstrap'
import { CARBON_THEME } from './carbon'
import { CUPERTINO_THEME } from './cupertino'
import { FLUENT_THEME } from './fluent'
import { MATERIAL3_THEME } from './material3'
import { MINIMAL_THEME } from './minimal'

export {
  ANT_DESIGN_THEME,
  BOOTSTRAP_THEME,
  CARBON_THEME,
  CUPERTINO_THEME,
  FLUENT_THEME,
  MATERIAL3_THEME,
  MINIMAL_THEME,
}

/**
 * The built-in themes, in the order the picker lists them (AGL-3405,
 * AGL-3411).
 *
 * Ids are persisted in every site that picks one, so they are namespaced by
 * this plugin and never renamed.
 */
export const THEME_PRESETS: readonly ConsoleThemePreset[] = [
  {
    id: `${BUNDLE_ID}.bootstrap`,
    name: 'Bootstrap',
    description: 'Bootstrap 5’s blue, system fonts, flat bordered cards and focus rings',
    theme: BOOTSTRAP_THEME,
  },
  {
    id: `${BUNDLE_ID}.minimal`,
    name: 'Minimal',
    description: 'Neutral zinc, Inter, hairline borders and no elevation — shadcn/ui style',
    theme: MINIMAL_THEME,
  },
  {
    id: `${BUNDLE_ID}.material3`,
    name: 'Material 3',
    description: 'Material Design 3: tonal surfaces, pill buttons and rounder corners',
    theme: MATERIAL3_THEME,
  },
  {
    id: `${BUNDLE_ID}.ant-design`,
    name: 'Ant Design',
    description: 'Ant Design 5’s blue, 14px type, 32px controls and hairline default buttons',
    theme: ANT_DESIGN_THEME,
  },
  {
    id: `${BUNDLE_ID}.fluent`,
    name: 'Fluent',
    description: 'Microsoft Fluent 2: Segoe UI, SemiBold labels, underlined inputs and soft depth',
    theme: FLUENT_THEME,
  },
  {
    id: `${BUNDLE_ID}.carbon`,
    name: 'Carbon',
    description: 'IBM Carbon: Plex Sans, light display type, square corners and filled fields',
    theme: CARBON_THEME,
  },
  {
    id: `${BUNDLE_ID}.cupertino`,
    name: 'Cupertino',
    description: 'In the style of iOS: system type, capsule buttons, segmented tabs and green switches',
    theme: CUPERTINO_THEME,
  },
]
