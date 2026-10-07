#!/usr/bin/env node
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

/**
 * The native apps' theme tokens, compiled from the console's own MUI theme
 * (AGL-3620, AGL-3651).
 *
 *   node tools/scripts/generate-mobile-theme-tokens.mjs           # write
 *   node tools/scripts/generate-mobile-theme-tokens.mjs --check   # drift guard
 *
 * The Swift and Kotlin apps cannot import the web theme, and hand-typing the
 * colors again would let the two drift the first time the palette moves. So
 * this reads the RESOLVED console theme — the same `getConsoleTheme(mode)`
 * the console renders with, light and dark — and writes its palette, type
 * scale, shape and spacing as Swift and Kotlin source (./lib/native-theme.mjs).
 * The web theme is unchanged and the web bundles gain nothing. `--check` runs
 * in the guard sweep, so a palette change that skips this script is red
 * before it ships.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  KOTLIN_TOKENS_FILE,
  kotlinTokensContent,
  nativeThemeData,
  SWIFT_TOKENS_FILE,
  swiftTokensContent,
} from './lib/native-theme.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const THEME_SOURCE = 'libs/shared/ui/theme/src/lib/console.theme.ts'

async function main() {
  const { createJiti } = createRequire(join(ROOT, 'package.json'))('jiti')
  const jiti = createJiti(join(ROOT, 'package.json'), { interopDefault: true, fsCache: false })
  const theme = await jiti.import(join(ROOT, THEME_SOURCE))
  const light = theme.getConsoleTheme('light')
  const dark = theme.getConsoleTheme('dark')
  // The native apps' Swift and Kotlin tokens (docs/mobile/native-architecture.md §7), from the same resolved theme.
  const native = nativeThemeData(light, dark)
  const outputs = [
    { file: SWIFT_TOKENS_FILE, content: swiftTokensContent(native) },
    { file: KOTLIN_TOKENS_FILE, content: kotlinTokensContent(native) },
  ]
  if (process.argv.includes('--check')) {
    const drifted = outputs.filter(({ file, content }) => {
      try {
        return readFileSync(join(ROOT, file), 'utf8') !== content
      } catch {
        return true // Absent is drift.
      }
    })
    if (drifted.length) {
      console.error(
        `${drifted.map(({ file }) => file).join('\n')}\nno longer match the console theme.\n` +
          'They are generated. Run: node tools/scripts/generate-mobile-theme-tokens.mjs',
      )
      process.exit(1)
    }
    for (const { file } of outputs) console.log(`ok ${file}`)
    return
  }
  for (const { file, content } of outputs) {
    mkdirSync(dirname(join(ROOT, file)), { recursive: true })
    writeFileSync(join(ROOT, file), content)
    console.log(`wrote ${file}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
