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

import { generateComponentClassKeys } from '@aglyn/shared-ui-theme'
import type { SvgIconProps } from '@mui/material'

/**
 * The class keys every Aglyn wordmark paints through, and the variant prop
 * they all accept.
 *
 * Their own module so a surface that renders ONE mark reaches only that
 * mark's module. A `styled()` call is a top-level side effect the bundler
 * cannot prove away, so a module holding six wordmarks ships all six to
 * anything that names one of them.
 */
export const aglynLogoClassKeys = generateComponentClassKeys('AglynLogo', [
  'compass',
  'boundingBox',
  'textAglyn',
  'textConsole',
])

export interface AglynLogoProps extends SvgIconProps {
  variant?: 'light' | 'dark' | 'black' | 'white'
}
