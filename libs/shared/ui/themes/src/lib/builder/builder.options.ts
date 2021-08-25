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

import { ThemeOptions } from '../types'
import { consoleOptions } from '../console/console.options'
import { builderPalette } from './builder.palette'
import { builderTypography } from './builder.typography'
import { builderProps } from './builder.props'
import { builderOverrides } from './builder.overrides'
import '../mui-overrides'


export const builderOptions: ThemeOptions = {
  ...consoleOptions,
  palette: builderPalette,
  typography: builderTypography,
  props: builderProps,
  overrides: builderOverrides,
}
export default builderOptions
