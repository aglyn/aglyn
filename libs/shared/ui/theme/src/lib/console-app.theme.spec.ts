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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { consoleAppThemeDark, consoleAppThemeLight } from './console-app.theme'
import { consoleThemeDark, consoleThemeLight } from './console.theme'

const CHROME = ['MuiAlert', 'MuiDialog', 'MuiTablePagination'] as const

describe('the console app theme', () => {
  it.each([
    ['light', consoleAppThemeLight],
    ['dark', consoleAppThemeDark],
  ])('carries the phone chrome (%s)', (_scheme, theme) => {
    for (const name of CHROME) {
      expect(theme.components?.[name]?.styleOverrides).toBeDefined()
    }
  })

  it('keeps the palette of the console theme it extends', () => {
    expect(consoleAppThemeLight.palette.primary.main).toBe(
      consoleThemeLight.palette.primary.main,
    )
    expect(consoleAppThemeDark.palette.mode).toBe('dark')
  })

  // Brand sites render with `consoleThemeLight`/`Dark`; the chrome is the
  // console's own and must not reach them.
  it.each([
    ['light', consoleThemeLight],
    ['dark', consoleThemeDark],
  ])('leaves the shared console theme without it (%s)', (_scheme, theme) => {
    expect(theme.components?.MuiTablePagination).toBeUndefined()
    expect(theme.components?.MuiDialog?.styleOverrides?.paper).toBeUndefined()
  })

  // A published page walks the package barrel, so a re-export there would put
  // these bytes on every page view.
  it('is not re-exported from the package barrel', () => {
    const barrel = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')
    expect(barrel).not.toMatch(/console-app\.theme/)
  })
})
