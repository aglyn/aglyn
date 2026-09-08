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
 * The attribution is only worth quoting if the arithmetic is pinned, so these
 * are byte counts over hand-written maps rather than a snapshot of a build.
 *
 *   npm run test:chunk-attribution
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  attributeChunk,
  decodeVlq,
  packageOf,
  summarize,
} from './chunk-attribution.mjs'

/** Base64 VLQ for one signed integer. Small values only — enough for fixtures. */
const vlq = (value) => {
  const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let bits = value < 0 ? ((-value) << 1) | 1 : value << 1
  let out = ''
  do {
    let digit = bits & 0b011111
    bits >>>= 5
    if (bits > 0) digit |= 0b100000
    out += BASE64[digit]
  } while (bits > 0)
  return out
}
const segment = (...fields) => fields.map(vlq).join('')

describe('decodeVlq', () => {
  it('reads the signed integers back out of a run', () => {
    assert.deepEqual(decodeVlq(segment(0, 0, 0, 0)), [0, 0, 0, 0])
    assert.deepEqual(decodeVlq(segment(5, 1, 0, 0)), [5, 1, 0, 0])
    assert.deepEqual(decodeVlq(segment(-3)), [-3])
  })

  it('handles values past one base64 digit', () => {
    assert.deepEqual(decodeVlq(segment(1000)), [1000])
  })

  it('skips characters that are not base64 rather than throwing', () => {
    assert.deepEqual(decodeVlq(`${segment(4)}!`), [4])
  })
})

describe('attributeChunk', () => {
  // One generated line of 10 characters, split at column 5 between two
  // sources. Each therefore owns exactly 5 bytes, and the second runs to the
  // end of the line because nothing follows it.
  const code = '0123456789'
  const map = {
    sources: ['a.ts', 'b.ts'],
    mappings: [segment(0, 0, 0, 0), segment(5, 1, 0, 0)].join(','),
  }

  it('splits a line at the segment boundaries', () => {
    assert.deepEqual(attributeChunk(code, map).bytes, { 'a.ts': 5, 'b.ts': 5 })
  })

  it('accounts for every byte it did not attribute', () => {
    const result = attributeChunk(code, map)
    assert.equal(result.attributed, 10)
    assert.equal(result.unattributed, 0)
  })

  it('carries the source index across generated lines', () => {
    // Line 2 opens with a segment whose source delta is -1, which is only
    // correct if the index was NOT reset at the newline.
    const twoLines = '0123456789\nabcdefghij'
    const mappings = [
      [segment(0, 0, 0, 0), segment(5, 1, 0, 0)].join(','),
      segment(0, -1, 0, 0),
    ].join(';')
    assert.deepEqual(
      attributeChunk(twoLines, { sources: ['a.ts', 'b.ts'], mappings }).bytes,
      { 'a.ts': 15, 'b.ts': 5 },
    )
  })

  it('lets an unmapped segment close the span before it', () => {
    // A one-field segment is real emitted text with no source — bundler
    // runtime, usually. It must end `a.ts`'s span at column 5 without
    // claiming the remainder for anyone.
    const mappings = [segment(0, 0, 0, 0), segment(5)].join(',')
    const result = attributeChunk(code, { sources: ['a.ts'], mappings })
    assert.deepEqual(result.bytes, { 'a.ts': 5 })
    assert.equal(result.unattributed, 5)
  })

  it('reports the whole chunk as unattributed when the map is empty', () => {
    const result = attributeChunk(code, { sources: [], mappings: '' })
    assert.deepEqual(result.bytes, {})
    assert.equal(result.unattributed, 10)
  })
})

describe('packageOf', () => {
  it('names the package a mapped source belongs to', () => {
    assert.equal(packageOf('turbopack:///[project]/node_modules/mitt/index.mjs'), 'mitt')
  })

  it('keeps both halves of a scoped name', () => {
    assert.equal(
      packageOf('turbopack:///[project]/node_modules/@mui/material/Button/Button.mjs'),
      '@mui/material',
    )
  })

  it('returns null for first-party code', () => {
    assert.equal(packageOf('turbopack:///[project]/libs/aglyn/src/index.ts'), null)
  })
})

describe('summarize', () => {
  const perChunk = {
    'one.js': { 'node_modules/@mui/material/Button.mjs': 100, 'libs/a.ts': 40 },
    'two.js': { 'node_modules/@mui/material/Button.mjs': 90, 'libs/b.ts': 10 },
    'three.js': { 'node_modules/@mui/material/Button.mjs': 80 },
  }

  it('charges the excess over the largest copy, not the whole of it', () => {
    const { duplicates, redundantBytes } = summarize(perChunk)
    assert.equal(duplicates.length, 1)
    assert.equal(duplicates[0].copies, 3)
    assert.equal(duplicates[0].bytes, 270)
    // 270 emitted, 100 of it unavoidable.
    assert.equal(duplicates[0].redundant, 170)
    assert.equal(redundantBytes, 170)
  })

  it('groups first-party modules under one bucket and leaves them clean', () => {
    const firstParty = summarize(perChunk).packages.find(
      (one) => one.name === '(first-party)',
    )
    assert.equal(firstParty.bytes, 50)
    assert.equal(firstParty.modules, 2)
    assert.equal(firstParty.redundant, 0)
  })

  it('orders packages by emitted weight', () => {
    assert.deepEqual(
      summarize(perChunk).packages.map((one) => one.name),
      ['@mui/material', '(first-party)'],
    )
  })

  it('reports nothing redundant when every module has one home', () => {
    const clean = summarize({ 'one.js': { 'libs/a.ts': 10 }, 'two.js': { 'libs/b.ts': 10 } })
    assert.equal(clean.redundantBytes, 0)
    assert.deepEqual(clean.duplicates, [])
  })
})
