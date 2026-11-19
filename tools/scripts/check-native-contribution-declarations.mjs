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
 * Every id a native plugin registers is declared in its plugins.config.json
 * `mobile.contributes` (AGL-3671).
 *
 *   node tools/scripts/check-native-contribution-declarations.mjs            # errors fail, warnings print
 *   node tools/scripts/check-native-contribution-declarations.mjs --verbose  # also the registrations it could not read
 *
 * The Swift and Kotlin plugin loaders unload a WHOLE plugin when its registrar
 * registers an id its declaration does not name, so one undeclared widget
 * takes that plugin out of the apps. The rules and their reasons are in
 * tools/scripts/lib/native-contribution-declarations.mjs.
 *
 * The file list comes from git (tracked and not-yet-tracked, ignored files
 * excluded), never a filesystem walk, so a build output is never read.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { evaluateNativeDeclarations } from './lib/native-contribution-declarations.mjs'
import { nativeManifestRows } from './lib/native-manifest.mjs'

const root = join(fileURLToPath(import.meta.url), '..', '..', '..')
const verbose = process.argv.includes('--verbose')
const started = Date.now()

const files = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'libs/plugins/*/src/ios/*', 'libs/plugins/*/src/android/*'],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
)
  .split('\0')
  .filter(Boolean)
  .filter((file) => existsSync(join(root, file)))

const read = (path) => readFileSync(join(root, path), 'utf8')
const { plugins } = JSON.parse(read('plugins.config.json'))
const rows = nativeManifestRows(plugins, { exists: (path) => existsSync(join(root, path)) })
const result = evaluateNativeDeclarations(rows, files, read)

// A sweep that read nothing must not pass: the trees moving would otherwise gate nothing.
if (!rows.length || result.count === 0) {
  console.error(
    `check-native-contribution-declarations: FAIL, read ${rows.length} native plugin(s) and ${result.count} registration(s); ` +
      'the plugin trees or plugins.config.json moved, and this guard must follow them.',
  )
  process.exit(1)
}

for (const warning of result.warnings) console.warn(`warning: ${warning.message}`)
if (verbose) {
  for (const one of result.dynamic) {
    console.log(`dynamic: ${one.plugin} (${one.platform}) ${one.at}: ${one.method}(${one.name}) is not read statically`)
  }
  for (const one of result.unproven) {
    console.log(`unproven: ${one.plugin} (${one.platform}) ${one.kind} "${one.id}" may be one of the dynamic registrations`)
  }
}

const summary =
  `${rows.length} native plugin(s), ${result.platforms} registrar(s), ${result.count} registration(s) read, ` +
  `${result.dynamic.length} dynamic, ${result.warnings.length} warning(s), ${Date.now() - started} ms`

if (result.errors.length) {
  console.error(
    `check-native-contribution-declarations: ${result.errors.length} registration(s) the native loaders refuse:\n\n` +
      result.errors.map((error) => `  ${error.message}`).join('\n') +
      `\n\nEach one unloads that whole plugin from the apps. (${summary})`,
  )
  process.exit(1)
}

console.log(`check-native-contribution-declarations: ok. ${summary}`)
