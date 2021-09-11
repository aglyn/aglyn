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

import { Theme } from '../../vendor/mui'
import { createResponsiveTheme } from '../util/create-responsive-theme'
import consoleOptions, { consoleOptionsDark } from './console.options'


export const consoleTheme: Theme = createResponsiveTheme({
  themeOptions: {...consoleOptions},
})
export const consoleThemeDark: Theme = createResponsiveTheme({
  themeOptions: {...consoleOptionsDark},
})
export const getConsoleTheme = (mode: 'light' | 'dark' = 'light') => {
  const theme = {
    light: consoleTheme,
    dark: consoleThemeDark,
  }
  return theme[mode]
}
export const getConsoleMetaThemeColor = (mode: 'light' | 'dark' = 'light') => {
  const themeColor = {
    light: consoleTheme.palette.secondary.main,
    dark: consoleThemeDark.palette.primary.main,
  }
  return themeColor[mode]
}
export default consoleTheme
