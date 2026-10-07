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
 * The native apps never cost the web a byte, and never reach web or server
 * code (AGL-3620, AGL-3651).
 *
 *   node tools/scripts/check-mobile-isolation.mjs
 *
 * With the rules and their reasons in tools/scripts/lib/mobile-isolation.mjs:
 *
 *  - every module on tools/scripts/mobile-pure-modules.json, which the native
 *    generators read, proves pure;
 *  - the Swift and Kotlin trees, at the file level: no web file or tsconfig
 *    reaches them, none of their files points outside them or names a
 *    server credential, and no native source lives anywhere else.
 *
 * The file list comes from git (tracked and not-yet-tracked, ignored files
 * excluded), never a filesystem walk, so a build output or a nested
 * node_modules is never read.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  aliasTable,
  evaluateNativeToWeb,
  evaluateWebToNative,
  formatFailures,
  provePureModules,
} from './lib/mobile-isolation.mjs'

const root = join(fileURLToPath(import.meta.url), '..', '..', '..')
const ALLOWLIST = 'tools/scripts/mobile-pure-modules.json'

const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\0')
  .filter(Boolean)
  .filter((file) => {
    try {
      return lstatSync(join(root, file)).isSymbolicLink() || existsSync(join(root, file))
    } catch {
      return false
    }
  })

const read = (path) => readFileSync(join(root, path), 'utf8')
const exists = (path) => {
  try {
    return statSync(join(root, path)).isFile()
  } catch {
    return false
  }
}
const aliases = aliasTable(JSON.parse(read('tsconfig.base.json')).compilerOptions?.paths)
const pure = JSON.parse(read(ALLOWLIST)).modules.map((entry) => entry.path)

const proof = provePureModules({ pure, read, aliases, exists })
const readLink = (path) => {
  try {
    return lstatSync(join(root, path)).isSymbolicLink() ? readlinkSync(join(root, path)) : null
  } catch {
    return null
  }
}
// The Swift and Kotlin apps (docs/mobile/native-architecture.md §9), held at the file level.
const webNative = evaluateWebToNative({ files, read, aliases })
const nativeWeb = evaluateNativeToWeb({ files, read, readLink })
const failures = [...proof, ...webNative, ...nativeWeb]

if (failures.length) {
  console.error(
    `check-mobile-isolation: ${failures.length} edge(s) cross between the web and the native apps:\n\n` +
      formatFailures(failures) +
      '\n\nWeb code never reaches the native trees, and the native trees reach nothing outside\n' +
      `them. The native generators read only the proven-pure modules in ${ALLOWLIST}; to\n` +
      'share one, add it there with its reason. It is admitted only while its own imports are\n' +
      'pure. When a module mixes pure and web code, split the pure part into its own file (the\n' +
      'web side importing exactly what it did before).\n',
  )
  process.exit(1)
}

console.log(
  `check-mobile-isolation: ok. ${pure.length} proven-pure module(s); ` +
    'native trees: 0 web→native, 0 native→web, 0 misplaced.',
)
