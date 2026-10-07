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
 * The brand typeface in the native apps (docs/mobile/native-architecture.md
 * §7). The console's type stack asks for Roboto Flex first; the native apps
 * bundle it, with its SIL Open Font License beside every copy.
 *
 *   node tools/scripts/vendor-native-fonts.mjs --from <dir>   # copy in
 *   node tools/scripts/vendor-native-fonts.mjs --check        # verify
 *
 * The source is Google's google/fonts repository, `ofl/robotoflex/`:
 * `RobotoFlex[GRAD,XOPQ,XTRA,YOPQ,YTAS,YTDE,YTFI,YTLC,YTUC,opsz,slnt,wdth,wght].ttf`
 * and `OFL.txt`. `--from` reads those two files from a local directory and
 * downloads nothing. Every copy is pinned by sha256, so `--check` fails on a
 * changed, missing or unlicensed copy; a font upgrade changes the pins here.
 */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const FONT_SOURCES = {
  font: {
    name: 'RobotoFlex[GRAD,XOPQ,XTRA,YOPQ,YTAS,YTDE,YTFI,YTLC,YTUC,opsz,slnt,wdth,wght].ttf',
    sha256: '9b523f7d82593df0107173849ebb8c817471a1df4b4fb2c3cbf40cfd810c8281',
  },
  license: {
    name: 'OFL.txt',
    sha256: '9cbaed04b20c853f99840efe5dc96956f6f6120ed83a0ade35f9281a2b63e5d0',
  },
}

/** Where each copy lives. Compose resource names are lowercase with underscores. */
export const FONT_COPIES = [
  { source: 'font', file: 'libs/native/apple/Sources/AglynUI/Resources/Fonts/RobotoFlex-Variable.ttf' },
  { source: 'license', file: 'libs/native/apple/Sources/AglynUI/Resources/Fonts/OFL.txt' },
  { source: 'font', file: 'libs/native/kotlin/ui/src/commonMain/composeResources/font/robotoflex_variable.ttf' },
  { source: 'license', file: 'libs/native/kotlin/ui/src/commonMain/composeResources/files/RobotoFlex-OFL.txt' },
]

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

function main() {
  const fromIndex = process.argv.indexOf('--from')
  if (fromIndex !== -1) {
    const from = process.argv[fromIndex + 1]
    if (!from) throw new Error('--from takes the directory holding the two google/fonts files')
    for (const [key, { name, sha256: pinned }] of Object.entries(FONT_SOURCES)) {
      const actual = sha256(join(from, name))
      if (actual !== pinned) throw new Error(`${name} (${key}) has sha256 ${actual}; the pinned one is ${pinned}`)
    }
    for (const { source, file } of FONT_COPIES) {
      mkdirSync(dirname(join(ROOT, file)), { recursive: true })
      copyFileSync(join(from, FONT_SOURCES[source].name), join(ROOT, file))
      console.log(`copied ${file}`)
    }
    return
  }
  if (!process.argv.includes('--check')) {
    console.error('usage: vendor-native-fonts.mjs --from <dir> | --check')
    process.exit(2)
  }
  const bad = FONT_COPIES.filter(({ source, file }) => {
    const path = join(ROOT, file)
    return !existsSync(path) || sha256(path) !== FONT_SOURCES[source].sha256
  })
  if (bad.length) {
    console.error(
      `${bad.map(({ file }) => file).join('\n')}\nis missing or is not the pinned Roboto Flex release.\n` +
        'Copy the google/fonts ofl/robotoflex files in with: node tools/scripts/vendor-native-fonts.mjs --from <dir>',
    )
    process.exit(1)
  }
  for (const { file } of FONT_COPIES) console.log(`ok ${file}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
