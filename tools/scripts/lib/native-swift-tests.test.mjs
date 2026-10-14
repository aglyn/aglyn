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

/** The umbrella package `native swift` builds every Swift test from (AGL-3783). */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  contentMtime,
  libraryProducts,
  packageName,
  planUmbrella,
  platforms,
  renderUmbrella,
  testTargets,
  toolsVersion,
} from './native-swift-tests.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const plugin = (name, extra = '') => `// swift-tools-version: 5.10
import PackageDescription

let package = Package(
  name: "${name}",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "${name}", targets: ["${name}"]),
  ],
  dependencies: [.package(path: kit)],
  targets: [
    .target(name: "${name}", dependencies: [.product(name: "AglynCore", package: "apple")]),
    ${extra || `.testTarget(name: "${name}Tests", dependencies: ["${name}"]),`}
  ]
)
`

test('a manifest is read for its tools version, name, products and platforms', () => {
  const manifest = plugin('AglynCrmPlugin')
  assert.deepEqual(toolsVersion(manifest), [5, 10])
  assert.equal(packageName(manifest), 'AglynCrmPlugin')
  assert.deepEqual(libraryProducts(manifest), ['AglynCrmPlugin'])
  assert.deepEqual(platforms(manifest), { iOS: [17, 0], macOS: [14, 0] })
  assert.deepEqual(platforms('platforms: [.macOS(.v13), .macOS(.v14_2)]'), { macOS: [14, 2] })
})

test('only the plain test target shape is translated', () => {
  assert.deepEqual(testTargets(plugin('A')), [{ name: 'ATests', dependencies: ['A'] }])
  assert.deepEqual(testTargets('.testTarget(name: "BTests")'), [{ name: 'BTests', dependencies: [] }])
  assert.deepEqual(testTargets('.testTarget(\n  name: "CTests",\n  dependencies: ["C", "D"]\n)'), [
    { name: 'CTests', dependencies: ['C', 'D'] },
  ])
  const withResources = testTargets('.testTarget(name: "ETests", dependencies: ["E"], resources: [.copy("x")])')
  assert.equal(withResources[0].name, 'ETests')
  assert.match(withResources[0].unsupported, /not name \+ string dependencies/)
  const withProduct = testTargets('.testTarget(name: "FTests", dependencies: [.product(name: "F", package: "f")])')
  assert.match(withProduct[0].unsupported, /not a plain string/)
})

const pkg = (dir, manifest, testDirs, reach = `/abs/${dir}`) => ({ dir, manifest, testDirs, reach })

test('plain packages join the umbrella; anything else is tested on its own', () => {
  const plan = planUmbrella([
    pkg('libs/plugins/a/src/ios', plugin('APlugin'), ['APluginTests'], '/r/apps/ios/PluginManifest/Plugins/APlugin'),
    pkg(
      'libs/plugins/b/src/ios',
      plugin('BPlugin', '.testTarget(name: "BPluginTests", dependencies: ["BPlugin"], resources: [.process("R")]),'),
      ['BPluginTests'],
    ),
    pkg('libs/plugins/c/src/ios', plugin('CPlugin').replace('5.10', '6.0'), ['CPluginTests']),
    pkg('libs/plugins/d/src/ios', plugin('DPlugin'), ['DPluginTests', 'Fixtures']),
    pkg('libs/plugins/e/src/ios', plugin('EPlugin', '.testTarget(name: "EPluginTests", dependencies: ["Helper"]),'), [
      'EPluginTests',
    ]),
    pkg('libs/plugins/f/src/ios', plugin('APlugin'), ['APluginTests']),
  ])
  assert.deepEqual(
    plan.umbrella.map((entry) => [entry.dir, entry.identity]),
    [['libs/plugins/a/src/ios', 'APlugin']],
  )
  assert.deepEqual(plan.umbrella[0].tests, [{ name: 'APluginTests', products: ['APlugin'] }])
  const why = Object.fromEntries(plan.standalone.map((entry) => [entry.dir.split('/')[2], entry.why]))
  assert.match(why.b, /not name \+ string dependencies/)
  assert.match(why.c, /swift-tools-version 6\.0/)
  assert.match(why.d, /Tests\/Fixtures is not a declared test target/)
  assert.match(why.e, /Helper, which is not a library product/)
  assert.match(why.f, /another package has a test target of that name/)
})

test('the umbrella names each test by its real path through the repo link', () => {
  const plan = planUmbrella([
    pkg('libs/native/apple', plugin('AglynKit', '.testTarget(name: "AglynKitTests", dependencies: ["AglynKit"]),'), ['AglynKitTests'], '/r/libs/native/apple'),
    pkg('libs/plugins/a/src/ios', plugin('APlugin'), ['APluginTests'], '/r/apps/ios/PluginManifest/Plugins/APlugin'),
  ])
  const text = renderUmbrella(plan, {
    manifestPackage: { reach: '/r/apps/ios/PluginManifest', product: 'AglynPluginManifest' },
  })
  assert.match(text, /^\/\/ swift-tools-version: 5\.10\n/)
  assert.match(text, /platforms: \[\.iOS\(\.v17\), \.macOS\(\.v14\)\]/)
  assert.match(text, /\.package\(path: "\/r\/libs\/native\/apple"\)/)
  assert.match(text, /\.package\(path: "\/r\/apps\/ios\/PluginManifest"\)/)
  assert.match(
    text,
    /\.product\(name: "AglynPluginManifest", package: "PluginManifest"\)/,
  )
  assert.match(
    text,
    /\.testTarget\(name: "APluginTests", dependencies: \[\.product\(name: "APlugin", package: "APlugin"\)\], path: "repo\/libs\/plugins\/a\/src\/ios\/Tests\/APluginTests"\)/,
  )
  assert.match(text, /\.product\(name: "AglynKit", package: "apple"\)\], path: "repo\/libs\/native\/apple\/Tests\/AglynKitTests"/)
})

test("every one of the repository's Swift packages fits the umbrella today", () => {
  const manifests = execFileSync('git', ['ls-files', 'libs/native/apple/Package.swift', 'libs/plugins/*/src/ios/Package.swift'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
  const tracked = execFileSync('git', ['ls-files', 'libs/native/apple/Tests', 'libs/plugins/*/src/ios/Tests/*'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
  const packages = manifests
    .map((file) => {
      const dir = dirname(file)
      const prefix = `${dir}/Tests/`
      const testDirs = [...new Set(tracked.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length).split('/')[0]))]
      return pkg(dir, readFileSync(join(repoRoot, file), 'utf8'), testDirs)
    })
    .filter((entry) => entry.testDirs.length > 0)
  assert.ok(packages.length > 1)
  const plan = planUmbrella(packages)
  // A package that stops fitting still gets tested (on its own, slower); this
  // says so here rather than in a slow CI run.
  assert.deepEqual(plan.standalone, [])
  assert.ok(plan.umbrella.some((entry) => entry.dir === 'libs/native/apple'))
})

test('content stamps are stable, distinct and in the past', () => {
  const a = contentMtime('5849d4bb7b22893d69fddd871d07c45a87deb05f')
  assert.equal(a, contentMtime('5849d4bb7b22893d69fddd871d07c45a87deb05f'))
  assert.notEqual(a, contentMtime('5849d4bc7b22893d69fddd871d07c45a87deb05f'))
  for (const oid of ['0'.repeat(40), 'f'.repeat(40), 'f'.repeat(64)]) {
    const time = contentMtime(oid)
    assert.ok(time >= Date.UTC(1980, 0, 1) / 1000 && time < Date.UTC(1998, 0, 1) / 1000, oid)
  }
})
