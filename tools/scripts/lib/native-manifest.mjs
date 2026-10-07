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
 * The native plugin manifest (docs/mobile/native-architecture.md §3): which
 * plugins the Swift and Kotlin apps load, from the `ios` and `android` keys of
 * each plugin's `mobile` block. A native plugin registers the SAME
 * contribution ids its `mobile.contributes` declares, so the rows carry that
 * inventory and the native registries refuse anything it does not name.
 *
 * The outputs are Swift and Kotlin sources plus a Gradle properties file and
 * one symlink per Swift plugin package (see `swiftPluginLinks`). No web
 * generator reads any of it.
 */
import { MOBILE_CONTRIBUTION_KINDS } from './mobile-manifest.mjs'

export const NATIVE_GENERATED_HEADER = 'GENERATED — do not edit. Regenerate with: node tools/scripts/generate-plugin-manifests.mjs'

export const IOS_MANIFEST_DIR = 'apps/ios/PluginManifest'
export const IOS_MANIFEST_PACKAGE = `${IOS_MANIFEST_DIR}/Package.swift`
export const IOS_MANIFEST_SOURCE = `${IOS_MANIFEST_DIR}/Sources/AglynPluginManifest/PluginManifest.generated.swift`
/** Where the generated package links each plugin's Swift package (see `swiftPluginLinks`). */
export const IOS_MANIFEST_PLUGINS_DIR = `${IOS_MANIFEST_DIR}/Plugins`
export const ANDROID_PLUGINS_PROPERTIES = 'apps/android/native-plugins.generated.properties'
export const ANDROID_MANIFEST_SOURCE =
  'apps/android/plugin-manifest/src/commonMain/kotlin/com/aglyn/plugins/manifest/PluginManifest.generated.kt'

/** The Swift package `libs/native/apple` declares, and its plugin-host product. SwiftPM names a path dependency by its directory. */
export const APPLE_KIT_PACKAGE_IDENTITY = 'apple'
export const APPLE_PLUGIN_HOST_PRODUCT = 'AglynPluginHost'
/** The Kotlin package of `libs/native/kotlin/plugin-host`. */
export const KOTLIN_PLUGIN_HOST_PACKAGE = 'com.aglyn.pluginhost'

const IOS_KEYS = ['module', 'register']
const ANDROID_KEYS = ['package', 'register']
const REGISTER = /^register[A-Za-z0-9]+$/

export const pascal = (id) =>
  id
    .split('-')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('')

export const expectedSwiftModule = (id) => `Aglyn${pascal(id)}Plugin`
export const expectedKotlinPackage = (id) => `com.aglyn.plugins.${id.replaceAll('-', '')}`
export const iosPackageDir = (id) => `libs/plugins/${id}/src/ios`
export const androidModuleDir = (id) => `libs/plugins/${id}/src/android`

function nativeBlock(where, block, keys, expected) {
  if (block === null || typeof block !== 'object' || Array.isArray(block)) throw new Error(`${where} is an object`)
  const { $comment: _note, ...fields } = block
  const unknown = Object.keys(fields).filter((key) => !keys.includes(key))
  if (unknown.length) throw new Error(`${where}: ${unknown.join(', ')} is not a field (${keys.join(', ')})`)
  const [nameKey] = keys
  if (fields[nameKey] !== expected) {
    throw new Error(`${where}.${nameKey} is "${fields[nameKey]}", and this plugin's must be "${expected}"`)
  }
  if (typeof fields.register !== 'string' || !REGISTER.test(fields.register)) {
    throw new Error(`${where}.register names the registrar function, register<Name>`)
  }
  return { [nameKey]: fields[nameKey], register: fields.register }
}

/**
 * One row per plugin whose `mobile` block names `ios` and/or `android`.
 * `exists(path)` answers whether a repo-relative file exists; the generator
 * passes the file system, tests pass a set.
 */
export function nativeManifestRows(plugins, { exists }) {
  const rows = []
  const missing = []
  for (const plugin of plugins) {
    for (const key of ['ios', 'android']) {
      if (plugin[key] !== undefined) {
        throw new Error(`plugins.config.json: "${plugin.id}" ${key} belongs inside its mobile block, next to mobile.contributes`)
      }
    }
    const mobile = plugin.mobile
    if (mobile === undefined || (mobile.ios === undefined && mobile.android === undefined)) continue
    const where = `plugins.config.json: "${plugin.id}" mobile`
    const contributes = {}
    for (const kind of MOBILE_CONTRIBUTION_KINDS) {
      const ids = mobile.contributes?.[kind]
      if (Array.isArray(ids) && ids.length) contributes[kind] = [...ids].sort()
    }
    if (!Object.keys(contributes).length) throw new Error(`${where}: a native registrar needs declared mobile.contributes`)
    const row = { id: plugin.id, contributes }
    if (mobile.ios !== undefined) {
      row.ios = nativeBlock(`${where}.ios`, mobile.ios, IOS_KEYS, expectedSwiftModule(plugin.id))
      const manifest = `${iosPackageDir(plugin.id)}/Package.swift`
      if (!exists(manifest)) missing.push(`${where}.ios: ${manifest} does not exist`)
    }
    if (mobile.android !== undefined) {
      row.android = nativeBlock(`${where}.android`, mobile.android, ANDROID_KEYS, expectedKotlinPackage(plugin.id))
      const build = `${androidModuleDir(plugin.id)}/build.gradle.kts`
      if (!exists(build)) missing.push(`${where}.android: ${build} does not exist`)
    }
    rows.push(row)
  }
  if (missing.length) {
    throw new Error(
      `${missing.join('\n')}\nA plugin names its native registrar only once its Swift package / Kotlin module is on the branch.`,
    )
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id))
}

const swiftString = (value) => JSON.stringify(value)

/**
 * SwiftPM names a path dependency by its last directory, so every plugin's
 * `src/ios` would be the same package "ios" and two of them collide. The
 * manifest package therefore reaches each through a generated symlink named
 * after the module: `Plugins/AglynRedirectsPlugin` → the plugin's `src/ios`.
 * SwiftPM resolves the link, so the plugin's own relative dependencies hold.
 */
export function swiftPluginLinks(rows) {
  return rows
    .filter((row) => row.ios)
    .map((row) => ({
      file: `${IOS_MANIFEST_PLUGINS_DIR}/${row.ios.module}`,
      target: `../../../../${iosPackageDir(row.id)}`,
    }))
}

export function swiftPackageContent(rows) {
  const ios = rows.filter((row) => row.ios)
  const deps = [
    `    .package(path: "../../../libs/native/apple"),`,
    ...ios.map((row) => `    .package(path: "Plugins/${row.ios.module}"),`),
  ]
  const products = [
    `        .product(name: "${APPLE_PLUGIN_HOST_PRODUCT}", package: "${APPLE_KIT_PACKAGE_IDENTITY}"),`,
    ...ios.map((row) => `        .product(name: "${row.ios.module}", package: "${row.ios.module}"),`),
  ]
  return (
    `// swift-tools-version: 5.9\n` +
    `// ${NATIVE_GENERATED_HEADER}\n` +
    `//\n` +
    `// The native plugin manifest package: the app targets depend on it and on\n` +
    `// AglynKit, never on a plugin. Source of truth: plugins.config.json.\n\n` +
    `import PackageDescription\n\n` +
    `let package = Package(\n` +
    `  name: "AglynPluginManifest",\n` +
    `  platforms: [.iOS(.v17), .macOS(.v14)],\n` +
    `  products: [.library(name: "AglynPluginManifest", targets: ["AglynPluginManifest"])],\n` +
    `  dependencies: [\n${deps.join('\n')}\n  ],\n` +
    `  targets: [\n` +
    `    .target(\n` +
    `      name: "AglynPluginManifest",\n` +
    `      dependencies: [\n${products.join('\n')}\n      ]\n` +
    `    ),\n` +
    `  ]\n` +
    `)\n`
  )
}

const swiftContributes = (contributes) => {
  const pairs = Object.entries(contributes).map(([kind, ids]) => `${swiftString(kind)}: [${ids.map(swiftString).join(', ')}]`)
  return `[${pairs.join(', ')}]`
}

export function swiftManifestContent(rows) {
  const ios = rows.filter((row) => row.ios)
  const imports = [APPLE_PLUGIN_HOST_PRODUCT, ...ios.map((row) => row.ios.module)].map((name) => `import ${name}`)
  const entries = ios.map(
    (row) =>
      `    NativePluginManifestEntry(\n` +
      `      id: ${swiftString(row.id)},\n` +
      `      contributes: ${swiftContributes(row.contributes)},\n` +
      `      register: ${row.ios.module}.${row.ios.register}\n` +
      `    ),`,
  )
  return (
    `// ${NATIVE_GENERATED_HEADER}\n` +
    `//\n` +
    `// Each native plugin's declared contributions and registrar, from its mobile\n` +
    `// block in plugins.config.json.\n\n` +
    `${imports.join('\n')}\n\n` +
    `public enum NativePluginManifest {\n` +
    `  public static let entries: [NativePluginManifestEntry] = [\n` +
    `${entries.join('\n')}${entries.length ? '\n' : ''}` +
    `  ]\n` +
    `}\n`
  )
}

export function androidPropertiesContent(rows) {
  const lines = rows.filter((row) => row.android).map((row) => `${row.id}=../../${androidModuleDir(row.id)}`)
  return (
    `# ${NATIVE_GENERATED_HEADER}\n` +
    `# Native plugin id = its Kotlin module directory, relative to apps/android.\n` +
    `# settings.gradle.kts includes each; plugin-manifest depends on each.\n` +
    `${lines.join('\n')}${lines.length ? '\n' : ''}`
  )
}

const kotlinContributes = (contributes) => {
  const pairs = Object.entries(contributes).map(
    ([kind, ids]) => `${swiftString(kind)} to listOf(${ids.map(swiftString).join(', ')})`,
  )
  return pairs.length ? `mapOf(${pairs.join(', ')})` : 'emptyMap()'
}

export function kotlinManifestContent(rows) {
  const android = rows.filter((row) => row.android)
  const imports = [
    `${KOTLIN_PLUGIN_HOST_PACKAGE}.NativePluginManifestEntry`,
    ...android.map((row) => `${row.android.package}.${row.android.register}`),
  ]
    .sort()
    .map((name) => `import ${name}`)
  const entries = android.map(
    (row) =>
      `        NativePluginManifestEntry(\n` +
      `            id = ${swiftString(row.id)},\n` +
      `            contributes = ${kotlinContributes(row.contributes)},\n` +
      `            register = ::${row.android.register},\n` +
      `        ),`,
  )
  return (
    `// ${NATIVE_GENERATED_HEADER}\n` +
    `//\n` +
    `// Each native plugin's declared contributions and registrar, from its mobile\n` +
    `// block in plugins.config.json.\n\n` +
    `package com.aglyn.plugins.manifest\n\n` +
    `${imports.join('\n')}\n\n` +
    `object NativePluginManifest {\n` +
    `    val entries: List<NativePluginManifestEntry> = listOf(\n` +
    `${entries.join('\n')}${entries.length ? '\n' : ''}` +
    `    )\n` +
    `}\n`
  )
}

/** Every generated native output but the symlinks, as `{ file, content }`. */
export function nativeManifestOutputs(rows) {
  return [
    { file: IOS_MANIFEST_PACKAGE, content: swiftPackageContent(rows) },
    { file: IOS_MANIFEST_SOURCE, content: swiftManifestContent(rows) },
    { file: ANDROID_PLUGINS_PROPERTIES, content: androidPropertiesContent(rows) },
    { file: ANDROID_MANIFEST_SOURCE, content: kotlinManifestContent(rows) },
  ]
}
