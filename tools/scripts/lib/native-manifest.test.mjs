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

/** The native plugin manifest's validation and outputs, driven over synthetic configs. */

import assert from 'node:assert/strict'
import test from 'node:test'

import { mobileManifestRows } from './mobile-manifest.mjs'
import {
  androidPropertiesContent,
  expectedKotlinPackage,
  expectedSwiftModule,
  kotlinManifestContent,
  nativeManifestOutputs,
  nativeManifestRows,
  swiftManifestContent,
  swiftPackageContent,
  swiftPluginLinks,
} from './native-manifest.mjs'

const contributes = { screens: ['site-search.b', 'site-search.a'], widgets: ['site-search.w'] }
const ios = { module: 'AglynSiteSearchPlugin', register: 'registerSiteSearchNative' }
const android = { package: 'com.aglyn.plugins.sitesearch', register: 'registerSiteSearchNative' }
const plugin = (mobile, id = 'site-search') => ({ id, package: `@aglyn/plugins-${id}`, mobile })
const files = new Set([
  'libs/plugins/site-search/src/ios/Package.swift',
  'libs/plugins/site-search/src/android/build.gradle.kts',
])
const exists = (path) => files.has(path)
const rowsOf = (plugins, has = exists) => nativeManifestRows(plugins, { exists: has })

test('names follow the plugin id', () => {
  assert.equal(expectedSwiftModule('redirects'), 'AglynRedirectsPlugin')
  assert.equal(expectedSwiftModule('site-search'), 'AglynSiteSearchPlugin')
  assert.equal(expectedKotlinPackage('site-search'), 'com.aglyn.plugins.sitesearch')
})

test('no native block, no row, and every output is still well formed', () => {
  const rows = rowsOf([plugin({ register: 'registerX', contributes })])
  assert.deepEqual(rows, [])
  const outputs = nativeManifestOutputs(rows)
  assert.equal(outputs.length, 4)
  for (const { content } of outputs) assert.match(content, /GENERATED — do not edit/)
  assert.match(swiftManifestContent(rows), /entries: \[NativePluginManifestEntry\] = \[\n {2}\]/)
  assert.match(kotlinManifestContent(rows), /listOf\(\n {4}\)/)
  assert.deepEqual(swiftPluginLinks(rows), [])
})

test('a declaration becomes a row and the four outputs name it', () => {
  const rows = rowsOf([plugin({ register: 'registerX', contributes, ios, android })])
  assert.deepEqual(rows, [
    {
      id: 'site-search',
      contributes: { screens: ['site-search.a', 'site-search.b'], widgets: ['site-search.w'] },
      ios,
      android,
    },
  ])
  const pkg = swiftPackageContent(rows)
  assert.match(pkg, /^\/\/ swift-tools-version: 5\.9\n/)
  assert.match(pkg, /\.package\(path: "\.\.\/\.\.\/\.\.\/libs\/native\/apple"\)/)
  assert.match(pkg, /\.package\(path: "Plugins\/AglynSiteSearchPlugin"\)/)
  assert.match(pkg, /\.product\(name: "AglynPluginHost", package: "apple"\)/)
  assert.match(pkg, /\.product\(name: "AglynSiteSearchPlugin", package: "AglynSiteSearchPlugin"\)/)
  assert.deepEqual(swiftPluginLinks(rows), [
    {
      file: 'apps/ios/PluginManifest/Plugins/AglynSiteSearchPlugin',
      target: '../../../../libs/plugins/site-search/src/ios',
    },
  ])
  const swift = swiftManifestContent(rows)
  assert.match(swift, /import AglynPluginHost\nimport AglynSiteSearchPlugin\n/)
  assert.match(swift, /contributes: \["screens": \["site-search\.a", "site-search\.b"\], "widgets": \["site-search\.w"\]\]/)
  assert.match(swift, /register: AglynSiteSearchPlugin\.registerSiteSearchNative/)
  assert.equal(
    androidPropertiesContent(rows).split('\n').filter((line) => !line.startsWith('#')).join('\n'),
    'site-search=../../libs/plugins/site-search/src/android\n',
  )
  const kotlin = kotlinManifestContent(rows)
  assert.match(kotlin, /^package com\.aglyn\.plugins\.manifest$/m)
  assert.match(kotlin, /^import com\.aglyn\.plugins\.sitesearch\.registerSiteSearchNative$/m)
  assert.match(kotlin, /register = ::registerSiteSearchNative,/)
  assert.match(kotlin, /mapOf\("screens" to listOf\("site-search\.a", "site-search\.b"\), "widgets" to listOf\("site-search\.w"\)\)/)
})

test('one platform alone is a row for that platform only', () => {
  const rows = rowsOf([plugin({ register: 'registerX', contributes, ios })])
  assert.equal(rows[0].android, undefined)
  assert.doesNotMatch(androidPropertiesContent(rows), /site-search=/)
  assert.doesNotMatch(kotlinManifestContent(rows), /NativePluginManifestEntry\(/)
  assert.match(swiftManifestContent(rows), /NativePluginManifestEntry\(/)
})

test('the mobile manifest accepts ios and android next to its own fields', () => {
  assert.equal(mobileManifestRows([plugin({ register: 'registerX', contributes, ios, android })]).length, 1)
})

test('refusals', () => {
  const refuse = (mobile, pattern, has = exists) => assert.throws(() => rowsOf([plugin(mobile)], has), pattern)
  const base = { register: 'registerX', contributes }
  refuse({ ...base, ios: { ...ios, target: 'x' } }, /target is not a field/)
  refuse({ ...base, android: { ...android, module: 'x' } }, /module is not a field/)
  refuse({ ...base, ios: { ...ios, module: 'SiteSearchPlugin' } }, /must be "AglynSiteSearchPlugin"/)
  refuse({ ...base, android: { ...android, package: 'com.aglyn.plugins.site-search' } }, /must be "com\.aglyn\.plugins\.sitesearch"/)
  refuse({ ...base, ios: { ...ios, register: 'siteSearch' } }, /register<Name>/)
  refuse({ ...base, android: { ...android, register: 'register' } }, /register<Name>/)
  refuse({ ...base, ios: 'AglynSiteSearchPlugin' }, /is an object/)
  refuse({ register: 'registerX', ios }, /needs declared mobile\.contributes/)
  refuse({ ...base, ios, android }, /src\/ios\/Package\.swift does not exist[\s\S]*src\/android\/build\.gradle\.kts does not exist/, () => false)
  assert.throws(() => rowsOf([{ id: 'site-search', ios }]), /belongs inside its mobile block/)
})
