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

/** The native contribution-declaration guard (AGL-3671), over small Swift, Kotlin and spec fixtures. */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  blankComments,
  evaluateNativeDeclarations,
  evaluatePlatform,
  readString,
  registrationsIn,
  specContributions,
} from './native-contribution-declarations.mjs'

const row = (contributes, id = 'gallery') => ({
  id,
  contributes,
  ios: { module: 'AglynGalleryPlugin', register: 'registerGalleryNative' },
  android: { package: 'com.aglyn.plugins.gallery', register: 'registerGalleryNative' },
})
const SWIFT = 'libs/plugins/gallery/src/ios/Sources/AglynGalleryPlugin/Register.swift'
const KOTLIN = 'libs/plugins/gallery/src/android/src/commonMain/kotlin/com/aglyn/plugins/gallery/Register.kt'

const swiftRegistrar = (body) =>
  ['import AglynPluginHost', '', '@MainActor', 'public func registerGalleryNative(_ r: NativePluginRegistrar) {', body, '}'].join('\n')
const kotlinRegistrar = (body) =>
  ['package com.aglyn.plugins.gallery', '', 'fun registerGalleryNative(r: NativePluginRegistrar) {', body, '}'].join('\n')

describe('a declared registration', () => {
  it('passes on Swift', () => {
    const source = swiftRegistrar('  r.widget("gallery.shelf", title: "Shelf", order: 10, slot: "hostShelf") { Shelf(context: $0) }')
    const result = evaluatePlatform(row({ widgets: ['gallery.shelf'] }), 'ios', [{ path: SWIFT, text: source }], [])
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.warnings, [])
    assert.equal(result.count, 1)
  })

  it('passes on Kotlin, through a constant and a named id argument', () => {
    const source = [
      'const val GALLERY_SCREEN = "gallery.list"',
      kotlinRegistrar('  r.screen(GALLERY_SCREEN, title = "Gallery") { context, _ -> List(context) }\n  r.deepLink(id = "gallery.page", path = "/gallery", screen = GALLERY_SCREEN)'),
    ].join('\n')
    const result = evaluatePlatform(row({ screens: ['gallery.list'], deepLinks: ['gallery.page'] }), 'android', [{ path: KOTLIN, text: source }], [])
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.warnings, [])
    assert.equal(result.count, 2)
  })
})

describe('an undeclared registration (the #2703 shape)', () => {
  it('fails, naming the plugin, file:line and the missing id', () => {
    const source = swiftRegistrar(
      [
        '  r.widget("gallery.shelf", title: "Shelf", order: 10) { Shelf(context: $0) }',
        '  r.widget("gallery.template-gallery", title: "Templates", order: 10, slot: TemplateZone.slot) {',
        '    Templates(context: $0)',
        '  }',
      ].join('\n'),
    )
    const result = evaluatePlatform(row({ widgets: ['gallery.shelf'] }), 'ios', [{ path: SWIFT, text: source }], [])
    assert.equal(result.errors.length, 1)
    const [error] = result.errors
    assert.equal(error.plugin, 'gallery')
    assert.equal(error.id, 'gallery.template-gallery')
    assert.equal(error.at, `${SWIFT}:6`)
    assert.match(error.message, /^gallery \(Apple\) /)
    assert.ok(error.message.includes(`${SWIFT}:6`))
    assert.ok(error.message.includes('"gallery.template-gallery"'))
    assert.ok(error.message.includes('mobile.contributes.widgets does not declare'))
  })

  it('fails on Kotlin through a constant, and says which constant', () => {
    const source = ['private const val STATUS_WIDGET = "gallery.install-status"', kotlinRegistrar('  r.widget(STATUS_WIDGET, title = "Status", order = 10) { _ -> }')].join('\n')
    const [error] = evaluatePlatform(row({ screens: ['gallery.list'] }), 'android', [{ path: KOTLIN, text: source }], []).errors
    assert.equal(error.at, `${KOTLIN}:5`)
    assert.ok(error.message.includes('"gallery.install-status" (through STATUS_WIDGET)'))
  })

  it('fails an id that is not the plugin’s own', () => {
    const source = swiftRegistrar('  r.quickAction("other.open", title: "Open", icon: "x", order: 1, screen: "gallery.list")')
    const [error] = evaluatePlatform(row({ quickActions: ['gallery.open'] }), 'ios', [{ path: SWIFT, text: source }], []).errors
    assert.ok(error.message.includes('which is not "gallery.<name>"'))
  })

  it('ignores a registration that is commented out', () => {
    const source = swiftRegistrar('  // r.widget("gallery.old", title: "Old", order: 1) { _ in EmptyView() }\n  /* r.widget("gallery.older", title: "x", order: 1) { _ in EmptyView() } */')
    assert.deepEqual(evaluatePlatform(row({ widgets: ['gallery.shelf'] }), 'ios', [{ path: SWIFT, text: source }], []).errors, [])
  })

  it('reads only calls on a NativePluginRegistrar', () => {
    const source = ['func path(_ paths: Paths) -> String { paths.screen("gallery.not-a-registration") }', swiftRegistrar('')].join('\n')
    assert.deepEqual(registrationsIn(source).calls, [])
  })
})

describe('an interpolated id', () => {
  const kotlin = kotlinRegistrar('  for (section in Section.entries) r.deepLink("gallery.${section.key}-page", path = "/g/${section.key}", screen = section.screen)')

  it('passes when a declared id matches it', () => {
    const result = evaluatePlatform(row({ deepLinks: ['gallery.photos-page'] }), 'android', [{ path: KOTLIN, text: kotlin }], [])
    assert.deepEqual(result.errors, [])
  })

  it('fails when no declared id matches it', () => {
    const [error] = evaluatePlatform(row({ deepLinks: ['gallery.page'] }), 'android', [{ path: KOTLIN, text: kotlin }], []).errors
    assert.ok(error.message.includes('"gallery.…-page"'))
  })

  it('reads a computed property as a pattern (Swift `var x: String { … }`)', () => {
    const source = ['enum Kind: String { case a, b', '  var detailScreen: String { "gallery.\\(rawValue)" }', '}', swiftRegistrar('  for kind in Kind.allCases { r.screen(kind.detailScreen, title: "x") { _, _ in EmptyView() } }')].join('\n')
    const result = evaluatePlatform(row({ screens: ['gallery.a', 'gallery.b'] }), 'ios', [{ path: SWIFT, text: source }], [])
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.dynamic, [])
    assert.deepEqual(result.warnings, [])
  })
})

describe('spec screens', () => {
  const spec = JSON.stringify({ screens: [{ id: 'gallery.settings', title: 'Settings', links: ['/gallery/settings'], cardSlot: 'hostSettings' }] }, null, 2)
  const source = kotlinRegistrar('  SpecScreens.register(GalleryScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, r)')
  const specPath = 'libs/plugins/gallery/src/android/screens/gallery.screens.json'

  it('derives screens, links and cards as ScreenCatalog does', () => {
    assert.deepEqual(
      specContributions(JSON.parse(spec)).map(({ kind, id }) => `${kind}:${id}`),
      ['screens:gallery.settings', 'deepLinks:gallery.settings.link', 'widgets:gallery.settings.card'],
    )
  })

  it('fails a card widget the declaration does not name', () => {
    const result = evaluatePlatform(
      row({ screens: ['gallery.settings'], deepLinks: ['gallery.settings.link'] }),
      'android',
      [{ path: KOTLIN, text: source }],
      [{ path: specPath, text: spec }],
    )
    assert.equal(result.errors.length, 1)
    assert.equal(result.errors[0].id, 'gallery.settings.card')
    assert.equal(result.errors[0].at, `${specPath}:4`)
  })
})

describe('declared but never registered', () => {
  it('warns when every registration of that kind was read', () => {
    const source = swiftRegistrar('  r.widget("gallery.shelf", title: "Shelf", order: 10) { Shelf(context: $0) }')
    const result = evaluatePlatform(row({ widgets: ['gallery.shelf', 'gallery.gone'] }), 'ios', [{ path: SWIFT, text: source }], [])
    assert.deepEqual(result.errors, [])
    assert.equal(result.warnings.length, 1)
    assert.ok(result.warnings[0].message.includes('"gallery.gone"'))
  })

  it('leaves the kind unproven when a registration of it is dynamic', () => {
    const source = swiftRegistrar('  for kind in Kind.allCases { r.widget(kind.cardID, title: "x", order: 1) { _ in EmptyView() } }')
    const result = evaluatePlatform(row({ widgets: ['gallery.gone'] }), 'ios', [{ path: SWIFT, text: source }], [])
    assert.deepEqual(result.warnings, [])
    assert.equal(result.dynamic.length, 1)
    assert.equal(result.unproven.length, 1)
  })
})

describe('evaluateNativeDeclarations', () => {
  it('holds each platform separately and reads no test sources', () => {
    const files = {
      [SWIFT]: swiftRegistrar('  r.widget("gallery.shelf", title: "Shelf", order: 10) { Shelf(context: $0) }'),
      [KOTLIN]: kotlinRegistrar('  r.widget("gallery.shelf", title = "Shelf", order = 10) { _ -> }\n  r.widget("gallery.extra", title = "Extra", order = 10) { _ -> }'),
      'libs/plugins/gallery/src/android/src/commonTest/kotlin/RegisterTest.kt': kotlinRegistrar('  r.widget("gallery.test-only", title = "x", order = 1) { _ -> }'),
    }
    const result = evaluateNativeDeclarations([row({ widgets: ['gallery.shelf'] })], Object.keys(files), (path) => files[path])
    assert.deepEqual(
      result.errors.map((error) => `${error.platform}:${error.id}`),
      ['android:gallery.extra'],
    )
    assert.equal(result.platforms, 2)
  })

  it('fails a platform whose registrar sources are missing', () => {
    const result = evaluateNativeDeclarations([row({ widgets: ['gallery.shelf'] })], [SWIFT], () => swiftRegistrar('  r.widget("gallery.shelf", title: "x", order: 1) { _ in EmptyView() }'))
    assert.equal(result.errors.length, 1)
    assert.match(result.errors[0].message, /^gallery \(Android\)/)
  })
})

describe('the lexer', () => {
  it('keeps a // inside a string and blanks a real comment, preserving lines', () => {
    const text = 'let url = "https://x" // note\n/* a /* nested */ b */ let y = 1'
    const out = blankComments(text)
    assert.equal(out.length, text.length)
    assert.ok(out.includes('"https://x"'))
    assert.ok(!out.includes('note'))
    assert.ok(out.endsWith('let y = 1'))
  })

  it('reads Kotlin $name and ${…} and Swift \\(…) interpolations as holes', () => {
    assert.deepEqual(readString('"a.$b-c"', 0).parts, ['a.', null, '-c'])
    assert.deepEqual(readString('"a.${b.c("x")}"', 0).parts, ['a.', null])
    assert.deepEqual(readString('"a.\\(b(1))z"', 0).parts, ['a.', null, 'z'])
  })
})
