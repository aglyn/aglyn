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

/** Which changed paths run the native Kotlin and Swift tests (AGL-3704). */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { listedModules, nativeRelevantPaths, usableBase } from './native-ci-changed.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

test('native source, generators and their inputs are relevant', () => {
  const relevant = [
    'apps/android/app/build.gradle.kts',
    'apps/ios/Aglyn/AglynApp.swift',
    'libs/native/kotlin/core/src/commonMain/kotlin/X.kt',
    'libs/native/apple/Package.swift',
    'libs/plugins/commerce/src/ios/Sources/X.swift',
    'libs/plugins/crm/src/android/build.gradle.kts',
    'tools/scripts/native-contracts.json',
    'tools/scripts/mobile-pure-modules.json',
    'tools/scripts/lib/native-contracts.mjs',
    'tools/scripts/lib/native-contracts-values.mjs',
    'tools/scripts/lib/mobile-manifest.mjs',
    'tools/scripts/generate-native-contracts.mjs',
    'tools/scripts/generate-mobile-theme-tokens.mjs',
    'tools/scripts/generate-plugin-manifests.mjs',
    'tools/scripts/native-ci-changed.mjs',
    'plugins.config.json',
    '.github/workflows/native-tests.yml',
  ]
  assert.deepEqual(nativeRelevantPaths(relevant), relevant)
})

test('web-only changes are not relevant', () => {
  assert.deepEqual(
    nativeRelevantPaths([
      'apps/console/src/app/page.tsx',
      'apps/tenant/next-env.d.ts',
      'libs/plugins/commerce/src/lib/orders.ts',
      'libs/plugins/commerce/src/mobile/index.ts',
      'libs/plugins/android-thing/src/lib/x.ts',
      'tools/scripts/check-mobile-isolation.mjs',
      'docs/mobile/console-parity.md',
      '.github/workflows/nx-ci.yml',
      'plugins.config.json.bak',
    ]),
    [],
  )
})

test('a module a native list names is relevant', () => {
  const modules = listedModules({
    contracts: { modules: { 'libs/a/model.ts': { types: ['A'] } } },
    pureModules: { modules: [{ path: 'libs/b/pure.ts', why: '…' }, 'libs/c/plain.ts'] },
  })
  assert.deepEqual([...modules].sort(), ['libs/a/model.ts', 'libs/b/pure.ts', 'libs/c/plain.ts'])
  assert.deepEqual(
    nativeRelevantPaths(['libs/a/model.ts', 'libs/a/other.ts', 'libs/b/pure.ts'], modules),
    ['libs/a/model.ts', 'libs/b/pure.ts'],
  )
})

test('missing or malformed lists name nothing', () => {
  assert.equal(listedModules().size, 0)
  assert.equal(listedModules({ contracts: { modules: null }, pureModules: { modules: {} } }).size, 0)
})

test("the repository's own lists are read", () => {
  const modules = listedModules({
    contracts: JSON.parse(readFileSync(join(repoRoot, 'tools/scripts/native-contracts.json'), 'utf8')),
    pureModules: JSON.parse(readFileSync(join(repoRoot, 'tools/scripts/mobile-pure-modules.json'), 'utf8')),
  })
  assert.ok(modules.size > 0)
  for (const path of modules) assert.match(path, /^(libs|apps)\//)
})

test('an unknown base is not usable, so everything runs', () => {
  assert.equal(usableBase(''), false)
  assert.equal(usableBase(undefined), false)
  assert.equal(usableBase('0000000000000000000000000000000000000000'), false)
  assert.equal(usableBase('main'), false)
  assert.equal(usableBase('ca01f64bad'), true)
  assert.equal(usableBase('6ca03b96f8e1a2b3c4d5e6f708192a3b4c5d6e7f'), true)
})
