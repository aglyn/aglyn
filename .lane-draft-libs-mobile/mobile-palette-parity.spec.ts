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

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { consoleThemeDark, consoleThemeLight } from './console.theme'

/**
 * The native apps' colors ARE the console's (AGL-3618).
 *
 * `libs/mobile/ui` cannot import this theme: it is MUI, and mobile code never
 * reaches web code (the mobile isolation rule). So the mobile palette is a
 * JSON file that mirrors a subset of the console palette, and this spec is
 * what keeps it a mirror rather than a second set of hand-typed colors. It
 * READS the file rather than importing it, so the theme library takes no
 * dependency on mobile code either.
 *
 * A palette change here turns this red. Regenerate the file, never edit it:
 *
 *     UPDATE_MOBILE_PALETTE=1 npx jest -c libs/shared/ui/theme/jest.config.ts mobile-palette-parity
 */
const FILE = join(__dirname, '../../../../../mobile/ui/src/lib/console-palette.json')

function subset(palette: any) {
  const pair = (entry: any, keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, entry[key]]))
  return {
    primary: pair(palette.primary, ['main', 'dark', 'contrastText']),
    secondary: pair(palette.secondary, ['main', 'dark', 'contrastText']),
    tertiary: pair(palette.tertiary, ['main', 'contrastText']),
    info: pair(palette.info, ['main', 'contrastText']),
    error: pair(palette.error, ['main', 'contrastText']),
    success: pair(palette.success, ['main', 'contrastText']),
    warning: pair(palette.warning, ['main', 'contrastText']),
    background: pair(palette.background, ['default', 'paper']),
    tint: pair(palette.tint, ['primary', 'secondary', 'tertiary']),
    text: pair(palette.text, ['primary', 'secondary', 'disabled']),
    divider: palette.divider,
    inputOutline: palette.inputOutline,
  }
}

describe('mobile palette parity', () => {
  const expected = {
    light: subset(consoleThemeLight.palette),
    dark: subset(consoleThemeDark.palette),
  }

  it('mirrors the console palette exactly', () => {
    if (process.env['UPDATE_MOBILE_PALETTE'] === '1') {
      writeFileSync(FILE, `${JSON.stringify(expected, null, 2)}\n`)
    }
    expect(JSON.parse(readFileSync(FILE, 'utf8'))).toEqual(expected)
  })
})
