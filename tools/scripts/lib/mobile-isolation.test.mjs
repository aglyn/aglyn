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
 * `check:mobile-isolation` (AGL-3620, AGL-3651), and its forced reds.
 *
 * Every rule is driven over a synthetic tree, so each red is forced without
 * editing the repository; then the real tree and the real allowlist are run,
 * which is the proof that every listed pure module is pure.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  aliasTable,
  domAccess,
  evaluateNativeToWeb,
  evaluateWebToNative,
  importSpecifiers,
  provePureModules,
} from './mobile-isolation.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const ALIASES = aliasTable({
  '@aglyn/plugins-shop': ['./libs/plugins/shop/src/index.ts'],
  '@aglyn/plugins-shop/*': ['./libs/plugins/shop/src/lib/*'],
  '@aglyn/shared-util-x/*': ['./libs/shared/util/x/src/lib/*'],
})

function tree(sources) {
  const files = Object.keys(sources)
  return {
    files,
    read: (path) => {
      if (!(path in sources)) throw new Error(`no ${path}`)
      return sources[path]
    },
    exists: (path) => path in sources,
    aliases: ALIASES,
  }
}

const CLEAN = {
  'libs/plugins/shop/src/lib/model/price.ts': "import { cents } from '@aglyn/shared-util-x/money'\nimport type { Theme } from '@mui/material'\nexport const p = cents\n",
  'libs/shared/util/x/src/lib/money.ts': 'export const cents = (n: number) => Math.round(n * 100)\n',
}
const PURE = ['libs/plugins/shop/src/lib/model/price.ts', 'libs/shared/util/x/src/lib/money.ts']

test('importSpecifiers reads runtime edges and skips type-only ones', () => {
  const source = [
    "import type { A } from 'a-types'",
    "import { type B, type C } from 'b-types'",
    "import D, { e } from 'd'",
    "export * from './f'",
    "export type { G } from 'g-types'",
    "import 'side-effect'",
    "const h = await import('h')",
    "const i = require('i')",
    "// import { j } from 'j-in-a-comment'",
    "const k = \"import { k } from 'k-in-a-string'\"",
    'export type Shape = { a: number }',
    "import { l } from 'l'",
  ].join('\n')
  assert.deepEqual(importSpecifiers(source).sort(), ['./f', 'd', 'h', 'i', 'l', 'side-effect'])
})

test('domAccess sees code, not strings or comments', () => {
  assert.deepEqual(domAccess("const s = 'document.cookie'\n// document.body\nconst t = `window.document`"), [])
  assert.deepEqual(domAccess('const a = 1\nconst b = document.title'), [2])
  assert.deepEqual(domAccess('window.document.title = x'), [1])
})

test('a clean pure list proves pure', () => {
  assert.deepEqual(provePureModules({ ...tree(CLEAN), pure: PURE }), [])
})

test('forced red: a listed module that does not exist, or touches the DOM, fails its proof', () => {
  const t = tree({ ...CLEAN, 'libs/shared/util/x/src/lib/money.ts': 'export const cents = () => document.title\n' })
  assert.deepEqual(
    provePureModules({ ...t, pure: [...PURE, 'libs/gone.ts'] }).map((failure) => failure.why),
    ['touches the DOM', 'does not exist'],
  )
})

test('forced red: a listed module reaching Node, Next, firebase-admin or a non-neutral package fails its proof', () => {
  const t = tree({
    ...CLEAN,
    'libs/shared/util/x/src/lib/money.ts':
      "import fs from 'node:fs'\nimport Link from 'next/link'\nimport admin from 'firebase-admin'\nimport lodash from 'lodash'\nexport const cents = 1\n",
  })
  assert.deepEqual(provePureModules({ ...t, pure: PURE }).map((failure) => failure.why), [
    'a Node built-in',
    'Next.js',
    'server-only (admin SDK)',
    'lodash is not a platform-neutral package',
  ])
})

test('forced red: an allowlisted module that is not pure fails its proof', () => {
  const t = tree({
    ...CLEAN,
    'libs/shared/util/x/src/lib/money.ts': "import { Box } from '@mui/material'\nimport { y } from './unlisted'\nexport const cents = Box\n",
    'libs/shared/util/x/src/lib/unlisted.ts': 'export const y = 1\n',
  })
  const whys = provePureModules({ ...t, pure: PURE }).map((failure) => failure.why)
  assert.deepEqual(whys.length, 2)
  assert.equal(whys[0], 'MUI (web UI)')
  assert.match(whys[1], /not on the allowlist/)
})

test('the real tree passes, and every listed pure module proves pure', () => {
  const out = execFileSync(process.execPath, [join(REPO_ROOT, 'tools/scripts/check-mobile-isolation.mjs')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  assert.match(out, /check-mobile-isolation: ok/)
})

/* The native walk (docs/mobile/native-architecture.md §9), each rule forced red over a synthetic tree. */

const native = (sources, links = {}) => {
  const files = [...Object.keys(sources), ...Object.keys(links)]
  return {
    files,
    read: (path) => {
      if (!(path in sources)) throw new Error(`no ${path}`)
      return sources[path]
    },
    readLink: (path) => links[path] ?? null,
    aliases: ALIASES,
  }
}
const reasons = (failures) => failures.map((f) => `${f.direction} ${f.file} ${f.specifier}`)

test('native walk: web → native imports, URLs, aliases and tsconfig entries are red', () => {
  const t = native({
    'apps/console/a.ts': "import x from '../../libs/native/apple/x'\nconst u = new URL('../../apps/ios/icon.png', import.meta.url)",
    'libs/plugins/shop/src/lib/b.ts': "const k = require('../../src/android/thing')",
    'libs/shared/c.ts': "import y from 'libs/native/contracts/contracts.generated.json'",
    'apps/console/ok.ts': "import { z } from './z'\nconst s = 'libs/native/is just a string here'",
    'apps/console/tsconfig.app.json': '{ // comment\n "include": ["src/**/*.ts", "../../libs/native/kotlin/**/*"], }',
    'tsconfig.native.json': '{ "references": [{ "path": "./apps/android" }] }',
  })
  assert.deepEqual(reasons(evaluateWebToNative(t)).sort(), [
    'web→native apps/console/a.ts ../../apps/ios/icon.png',
    'web→native apps/console/a.ts ../../libs/native/apple/x',
    'web→native apps/console/tsconfig.app.json ../../libs/native/kotlin/**/*',
    'web→native libs/plugins/shop/src/lib/b.ts ../../src/android/thing',
    'web→native libs/shared/c.ts libs/native/contracts/contracts.generated.json',
    'web→native tsconfig.native.json ./apps/android',
  ])
  const aliased = { ...t, aliases: aliasTable({ '@aglyn/native-kit': ['./libs/native/apple/index.ts'] }) }
  assert.ok(reasons(evaluateWebToNative(aliased)).includes('web→native tsconfig.base.json @aglyn/native-kit'))
})

test('native walk: native → web paths, secrets and symlinks are red; native-to-native is not', () => {
  const t = native(
    {
      'apps/android/settings.gradle.kts':
        'project(":core").projectDir = file("../../libs/native/kotlin/core")\ninclude(":web")\nproject(":web").projectDir = file("../../libs/aglyn/src")',
      'apps/android/app/build.gradle.kts': 'kotlin { sourceSets { main { kotlin.srcDir("../../../libs/plugins/shop/src/lib") } } }',
      'apps/ios/PluginManifest/Package.swift': '.package(path: "../../../libs/native/apple"),\n.package(path: "../../console")',
      'libs/plugins/shop/src/ios/Package.swift': '.package(path: "../../../../native/apple")',
      'apps/ios/Aglyn.xcodeproj/project.pbxproj': 'path = ../../libs/native/apple; path = ../../apps/tenant/x;',
      'apps/ios/Config/Emulator.xcconfig': 'STRIPE = sk_live_abcdefghijklmnop',
      'libs/native/kotlin/core/src/x.kt': 'val admin = "firebase-admin"',
      'apps/android/app/google.json': '{ "$schema": "../../../node_modules/x.json", "type": "service_account" }',
      'apps/android/gradle.properties': 'root=../../../..',
      'libs/native/apple/Sources/AglynUI/Resources/Fonts/OFL.txt': 'see ../../apps/console',
    },
    {
      'apps/ios/PluginManifest/Plugins/AglynShopPlugin': '../../../../libs/plugins/shop/src/ios',
      'apps/ios/PluginManifest/Plugins/Bad': '../../../../libs/plugins/shop/src/lib',
    },
  )
  assert.deepEqual(reasons(evaluateNativeToWeb(t)).sort(), [
    'native→web apps/android/app/build.gradle.kts ../../../libs/plugins/shop/src/lib',
    'native→web apps/android/app/google.json "type": "service_account',
    'native→web apps/android/gradle.properties ../../../..',
    'native→web apps/android/settings.gradle.kts ../../libs/aglyn/src',
    'native→web apps/ios/Aglyn.xcodeproj/project.pbxproj ../../apps/tenant/x',
    'native→web apps/ios/Config/Emulator.xcconfig sk_live_abcdefghijklmnop',
    'native→web apps/ios/PluginManifest/Package.swift ../../console',
    'native→web apps/ios/PluginManifest/Plugins/Bad ../../../../libs/plugins/shop/src/lib',
    'native→web libs/native/kotlin/core/src/x.kt firebase-admin',
  ])
})

test('native walk: a Swift or Kotlin file outside the native trees is misplaced', () => {
  const t = native({
    'libs/plugins/shop/src/lib/x.swift': '',
    'tools/y.kt': '',
    'build.gradle.kts': '',
    'libs/plugins/shop/src/android/build.gradle.kts': '',
    'apps/ios/Aglyn/App.swift': '',
  })
  assert.deepEqual(reasons(evaluateNativeToWeb(t)).sort(), [
    'misplaced build.gradle.kts .kts',
    'misplaced libs/plugins/shop/src/lib/x.swift .swift',
    'misplaced tools/y.kt .kt',
  ])
})
