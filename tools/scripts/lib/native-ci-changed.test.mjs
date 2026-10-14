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

import {
  listedModules,
  nativePathsByPlatform,
  nativeRelevantPaths,
  platformsOf,
  usableBase,
} from './native-ci-changed.mjs'

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
    'tools/scripts/native-swift-tests.mjs',
    'tools/scripts/lib/native-swift-tests.mjs',
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

test('each side runs for its own tree only (AGL-3783)', () => {
  const swiftOnly = { kotlin: false, swift: true }
  const kotlinOnly = { kotlin: true, swift: false }
  assert.deepEqual(platformsOf('apps/ios/Aglyn/AglynApp.swift'), swiftOnly)
  assert.deepEqual(platformsOf('libs/native/apple/Sources/AglynCore/Auth.swift'), swiftOnly)
  assert.deepEqual(platformsOf('libs/plugins/commerce/src/ios/Sources/X.swift'), swiftOnly)
  assert.deepEqual(platformsOf('apps/android/app/build.gradle.kts'), kotlinOnly)
  assert.deepEqual(platformsOf('libs/native/kotlin/core/src/commonMain/kotlin/X.kt'), kotlinOnly)
  assert.deepEqual(platformsOf('libs/plugins/crm/src/android/build.gradle.kts'), kotlinOnly)
})

test('shared inputs run both sides', () => {
  const both = { kotlin: true, swift: true }
  for (const path of [
    'libs/native/contracts/contracts.generated.json',
    'libs/native/screens/site.screens.json',
    'libs/plugins/ai/src/ios/Sources/AglynAiPlugin/Resources/ai.screens.json',
    'libs/plugins/ai/src/android/screens/ai.screens.json',
    'tools/scripts/native-contracts.json',
    'tools/scripts/generate-plugin-manifests.mjs',
    'plugins.config.json',
    '.github/workflows/native-tests.yml',
    'libs/a/model.ts',
  ]) {
    assert.deepEqual(platformsOf(path), both, path)
  }
})

test("a file the other side links to runs that side too", () => {
  const links = [
    { path: 'libs/plugins/x/src/android/res/strings.json', target: 'libs/plugins/x/src/ios/Sources/X/strings.json' },
    { path: 'apps/ios/Linked', target: 'libs/native/kotlin/assets' },
    // Same side: changes nothing.
    { path: 'apps/ios/PluginManifest/Plugins/X', target: 'libs/plugins/x/src/ios' },
  ]
  const both = { kotlin: true, swift: true }
  assert.deepEqual(platformsOf('libs/plugins/x/src/ios/Sources/X/strings.json', links), both)
  assert.deepEqual(platformsOf('libs/native/kotlin/assets/logo.svg', links), both)
  assert.deepEqual(platformsOf('libs/native/kotlin/assetsX/logo.svg', links), { kotlin: true, swift: false })
  assert.deepEqual(platformsOf('libs/plugins/x/src/ios/Sources/X/Other.swift', links), {
    kotlin: false,
    swift: true,
  })
})

test('paths are split by the side that needs them', () => {
  const modules = new Set(['libs/a/model.ts'])
  assert.deepEqual(
    nativePathsByPlatform(
      [
        'apps/console/src/app/page.tsx',
        'apps/ios/Aglyn/AglynApp.swift',
        'apps/android/app/build.gradle.kts',
        'libs/a/model.ts',
      ],
      modules,
    ),
    {
      kotlin: ['apps/android/app/build.gradle.kts', 'libs/a/model.ts'],
      swift: ['apps/ios/Aglyn/AglynApp.swift', 'libs/a/model.ts'],
    },
  )
  assert.deepEqual(nativePathsByPlatform(['apps/console/src/app/page.tsx']), { kotlin: [], swift: [] })
})
