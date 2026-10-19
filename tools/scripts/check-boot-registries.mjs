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
// Refuses a registry the boot fills that lives at module scope (AGL-3947).
//
//   npm run check:boot-registries
//   npm run check:boot-registries -- --list   # every register… name the boot reaches
//
// `instrumentation.ts` is compiled apart from the routes, so a module-scoped
// registry it fills is empty where a route reads it. Keep it on `globalThis`
// under `Symbol.for`; tools/scripts/lib/boot-registries.mjs says what the boot
// reaches and what counts as a registry.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findBootRegistries } from './lib/boot-registries.mjs'

const root = join(fileURLToPath(import.meta.url), '..', '..', '..')

const tracked = execFileSync('git', ['ls-files', '-z', '--', 'apps', 'libs'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\0')
  .filter((path) => /\.(ts|tsx)$/.test(path))

const files = new Map()
for (const path of tracked) {
  try {
    files.set(path, readFileSync(join(root, path), 'utf8'))
  } catch {
    // Deleted in the working tree but still in the index: nothing to read.
  }
}

const findings = findBootRegistries(files)

if (process.argv.includes('--list')) {
  for (const finding of findings) console.log(`${finding.file}:${finding.line} ${finding.name}`)
}

if (findings.length) {
  console.error(
    `check:boot-registries: ${findings.length} registr${findings.length === 1 ? 'y' : 'ies'} ` +
      'the boot fills live at module scope. instrumentation.ts is compiled apart from the ' +
      'routes, so each is empty where a route reads it (AGL-3412, AGL-3868, AGL-3947).\n',
  )
  for (const { file, line, name, via } of findings) {
    console.error(`  ${file}:${line}  ${name}  (written by ${via})`)
  }
  console.error(
    '\nKeep it on globalThis under a Symbol.for key, as plugin-services.ts does. A ' +
      'registry that is per copy on purpose says so above its declaration:\n' +
      '  // boot-registry: per copy — <reason>',
  )
  process.exit(1)
}
console.log(`check:boot-registries: every registry the boot fills is on globalThis (${files.size} files)`)
