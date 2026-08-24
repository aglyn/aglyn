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

// Proves `check:docs-screenshots` can go RED before its green is worth
// reading (AGL-1950). Each failure mode gets both directions: the shape that
// must fail, and the shape that must NOT — a scanner that reds on everything
// is as useless as one that reds on nothing.
//
//   node --test tools/scripts/lib/docs-screenshots.test.mjs

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MIN_BYTES,
  classifyImage,
  findImageReferences,
  isFlatColour,
} from './docs-screenshots.mjs'

const realStats = { channels: [{ stdev: 41.2 }, { stdev: 39.8 }, { stdev: 44.1 }] }
const flatStats = { channels: [{ stdev: 0 }, { stdev: 0 }, { stdev: 0 }] }

test('finds the markdown image syntax the capture plan prescribes', () => {
  const source = [
    '# Orders',
    '',
    '![An order showing Charged back status](/img/commerce/order-charged-back.png)',
  ].join('\n')
  assert.deepEqual(findImageReferences(source), [
    { url: '/img/commerce/order-charged-back.png', line: 3 },
  ])
})

test('finds the raw <img> spelling too, with its line number', () => {
  const source = ['intro', '', '<img src="/img/api/key-shown-once.png" width="640" />'].join(
    '\n',
  )
  assert.deepEqual(findImageReferences(source), [
    { url: '/img/api/key-shown-once.png', line: 3 },
  ])
})

test('ignores what Docusaurus already resolves — remote and relative images', () => {
  // The negative control. A scanner that also claimed these were missing from
  // `static/` would fail every page carrying one, and the fix would be to
  // loosen the check rather than capture a shot.
  const source = [
    '![remote](https://example.com/a.png)',
    '![relative](./diagram.png)',
    '![sibling](../img/other.png)',
    '<img src="https://example.com/b.png" />',
  ].join('\n')
  assert.deepEqual(findImageReferences(source), [])
})

test('reports several references from one page in document order', () => {
  const source = [
    '![one](/img/a/one.png)',
    '<img src="/img/b/two.png" />',
    '![three](/img/c/three.png)',
  ].join('\n')
  assert.deepEqual(
    findImageReferences(source).map((r) => r.url),
    ['/img/a/one.png', '/img/b/two.png', '/img/c/three.png'],
  )
})

test('a real capture passes', () => {
  assert.equal(classifyImage({ size: 54_404, stats: realStats, error: null }), null)
})

test('a MISSING file fails — the uncaptured-shot case', () => {
  const why = classifyImage({ size: null, stats: null, error: null })
  assert.match(String(why), /no such file/)
})

test('a 0-byte file fails — a file-exists check would pass it', () => {
  const why = classifyImage({ size: 0, stats: null, error: null })
  assert.match(String(why), /0 bytes/)
})

test('an ALL-WHITE capture fails — a valid PNG of nothing', () => {
  // The one this guard exists for. Correct dimensions, plausible size, decodes
  // cleanly, and shows no console surface at all.
  const why = classifyImage({ size: 2_377, stats: flatStats, error: null })
  assert.match(String(why), /single flat colour/)
})

test('an undecodable file fails as its own reason, not silently', () => {
  const why = classifyImage({
    size: 40_000,
    stats: null,
    error: 'unsupported image format',
  })
  assert.match(String(why), /will not decode/)
})

test('the byte floor sits below every real capture in the tree', () => {
  // The smallest genuine release-docs capture is ~16 KB
  // (guides/site-members-invite.png). If the floor ever climbs near that, the
  // floor becomes the thing that fails and the flat-colour check stops being
  // what carries the guard.
  assert.ok(MIN_BYTES < 16_000)
  assert.equal(classifyImage({ size: 16_012, stats: realStats, error: null }), null)
})

test('isFlatColour does not call an empty stats object flat', () => {
  // Otherwise a probe that failed to produce stats would read as "blank" and
  // report the wrong reason for the wrong file.
  assert.equal(isFlatColour({ channels: [] }), false)
  assert.equal(isFlatColour(undefined), false)
})
