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
import { BOOTSTRAP_THEME } from './bootstrap'
import { MATERIAL3_THEME } from './material3'
import { MINIMAL_THEME } from './minimal'

export { BOOTSTRAP_THEME, MATERIAL3_THEME, MINIMAL_THEME }

/**
 * The built-in themes, in the order the picker lists them (AGL-3405).
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
]
