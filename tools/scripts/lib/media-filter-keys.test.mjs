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

// npm run test:media-filter-keys
//
// The script-side media filter keys answer the same fixtures the library's
// media-metadata.spec.ts answers (AGL-3327).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { mediaFilterKeys, mediaKindOf, mediaOrientationOf } from './media-filter-keys.mjs'

const fixtures = JSON.parse(
  readFileSync(new URL('./media-filter-keys.fixtures.json', import.meta.url), 'utf8'),
)

test('each content type files under the family the fixtures name', () => {
  for (const { contentType, kind } of fixtures.kinds) {
    assert.equal(mediaKindOf(contentType), kind)
  }
})

test('orientation matches the fixtures', () => {
  for (const { media, orientation } of fixtures.orientations) {
    assert.equal(mediaOrientationOf(media), orientation)
  }
})

test('every key matches the fixtures', () => {
  for (const { media, keys } of fixtures.keys) {
    assert.deepEqual(mediaFilterKeys(media), keys)
  }
})

test('THE CONTROL: the fixtures are not empty', () => {
  assert.ok(fixtures.kinds.length && fixtures.orientations.length && fixtures.keys.length)
})
