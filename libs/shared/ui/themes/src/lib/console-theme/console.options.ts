/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import { ThemeOptions } from '../../vendor/mui'
import { consoleOverrides } from './console.overrides'
import { consolePalette } from './console.palette'
import { consoleShape } from './console.shape'
import { consoleSpacing } from './console.spacing'
import { consoleTypography } from './console.typography'


const baseOptions: ThemeOptions = {
  typography: consoleTypography,
  components: consoleOverrides,
  spacing: consoleSpacing,
  shape: consoleShape,
}

export const consoleOptions = {
  palette: consolePalette.LIGHT,
  ...baseOptions,
}
export const consoleOptionsDark: ThemeOptions = {
  palette: consolePalette.DARK,
  ...baseOptions,
}
export default consoleOptions
