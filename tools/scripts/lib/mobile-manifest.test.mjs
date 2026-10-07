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

/** A plugin's declared mobile inventory, validated over synthetic configs. */

import assert from 'node:assert/strict'
import test from 'node:test'

import { mobileManifestRows } from './mobile-manifest.mjs'

const plugin = (mobile, id = 'shop') => ({ id, package: `@aglyn/plugins-${id}`, mobile })

test('a plugin without a mobile block contributes nothing', () => {
  assert.deepEqual(mobileManifestRows([{ id: 'x', package: '@aglyn/plugins-x' }]), [])
})

test('a declaration becomes a row of sorted ids', () => {
  const rows = mobileManifestRows([plugin({ $comment: 'x', contributes: { screens: ['shop.b', 'shop.a'] } })])
  assert.deepEqual(rows, [{ id: 'shop', contributes: { screens: ['shop.a', 'shop.b'] } }])
})

test('refusals: unknown fields and kinds, the old React Native registrar, foreign or duplicate ids, an empty block', () => {
  const refuse = (plugins, pattern) => assert.throws(() => mobileManifestRows(plugins), pattern)
  refuse([plugin({ contributes: { screens: ['shop.a'] }, web: 1 })], /web is not a mobile field/)
  refuse([plugin({ register: 'registerShopMobile', contributes: { screens: ['shop.a'] } })], /register is not a mobile field/)
  refuse([plugin({ contributes: { pages: ['shop.a'] } })], /pages is not a mobile contribution/)
  refuse([plugin({ contributes: { screens: ['crm.a'] } })], /is not "shop.<name>"/)
  refuse([plugin({ contributes: { screens: [] } })], /non-empty list/)
  refuse([plugin({ contributes: {} })], /declares nothing/)
  refuse(
    [plugin({ contributes: { screens: ['shop.a'] } }), plugin({ contributes: { screens: ['shop.a'] } })],
    /also declared by "shop"/,
  )
})
