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
 * Proves the AGL-1491 scanner can FAIL, which is the only thing that makes its
 * green worth reading.
 *
 * Every red/green case here is driven through SYNTHETIC needles: the fixtures
 * are made-up addresses, hashed at test time, so this file never holds the real
 * value and never needs to. The final test is the one exception in spirit — it
 * reconstructs the real POSTCODE by brute force from its own digest, which is
 * tractable because a postcode is five digits, and asserts the shipped digest
 * really is a postcode rather than a stale or mistyped hash.
 */

import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fnv1a32,
  PROXIMITY_TOKENS,
  RESIDENTIAL_NEEDLES,
  scanText,
  tokenize,
} from './residential-address.mjs'

const sha256 = (v) => createHash('sha256').update(v).digest('hex')

/** A wholly invented address, and the needle set that detects it. */
const FAKE_STREET = '4821 Nowhere Boulevard'
const FAKE_CITY = 'Fauxville'
const FAKE_POSTCODE = '99991'

const FAKE_NEEDLES = {
  street: {
    tokens: 3,
    sha256: sha256('4821 nowhere boulevard'),
    label: 'fake street',
  },
  city: { tokens: 1, sha256: sha256('fauxville'), label: 'fake city' },
  postcode: { tokens: 1, sha256: sha256('99991'), label: 'fake postcode' },
}

const scan = (text) => scanText(text, FAKE_NEEDLES)

test('tokenize flattens punctuation, quoting and case to one stream', () => {
  assert.deepEqual(tokenize(`  line1: '4821 Nowhere BOULEVARD',`), [
    'line1',
    '4821',
    'nowhere',
    'boulevard',
  ])
})

test('RED: the street line in a JS fixture', () => {
  const hits = scan(`const a = { line1: '${FAKE_STREET}', state: 'TX' }`)
  assert.deepEqual(hits, ['fake street'])
})

test('RED: the street line in JSON, in Markdown prose, and in a table row', () => {
  for (const text of [
    `{"line1":"${FAKE_STREET}","country":"US"}`,
    `The old address was ${FAKE_STREET}, which we have now left.`,
    `| Support address | ${FAKE_STREET} | 5900 Balcones Dr |`,
  ]) {
    assert.deepEqual(scan(text), ['fake street'], text)
  }
})

test('RED: city and postcode separated by a serialiser field — the real shape', () => {
  // This is exactly how all three 2026-08-24 findings were written, and the
  // reason the rule is PROXIMITY and not adjacency.
  const hits = scan(
    `customerAddress: { country: 'US', state: 'TX', city: '${FAKE_CITY}', postalCode: '${FAKE_POSTCODE}' }`,
  )
  assert.deepEqual(hits, [
    'the pre-move residential city and postcode together',
  ])
})

test('RED: street AND the pair together report both violations', () => {
  const hits = scan(
    `{ line1: '${FAKE_STREET}', city: '${FAKE_CITY}', postalCode: '${FAKE_POSTCODE}' }`,
  )
  assert.deepEqual(hits, [
    'fake street',
    'the pre-move residential city and postcode together',
  ])
})

test('GREEN: the city ALONE is not a violation — three tracked files say it in prose', () => {
  assert.deepEqual(
    scan(
      `Williamson entered from the former ${FAKE_CITY} residential address.`,
    ),
    [],
  )
})

test('GREEN: the postcode alone is not a violation', () => {
  assert.deepEqual(scan(`postalCode: '${FAKE_POSTCODE}'`), [])
})

test('GREEN: city and postcode FAR apart do not pair', () => {
  const filler = Array.from(
    { length: PROXIMITY_TOKENS + 4 },
    (_, i) => `w${i}`,
  ).join(' ')
  assert.deepEqual(scan(`${FAKE_CITY} ${filler} ${FAKE_POSTCODE}`), [])
})

test('RED: the boundary — exactly PROXIMITY_TOKENS apart still pairs', () => {
  const filler = Array.from(
    { length: PROXIMITY_TOKENS - 1 },
    (_, i) => `w${i}`,
  ).join(' ')
  assert.deepEqual(scan(`${FAKE_CITY} ${filler} ${FAKE_POSTCODE}`), [
    'the pre-move residential city and postcode together',
  ])
})

test('GREEN: a near-miss street — right number, wrong street type', () => {
  assert.deepEqual(scan(`line1: '4821 Nowhere Avenue'`), [])
})

test('GREEN: the registered-agent address must never red', () => {
  assert.deepEqual(
    scan(
      `c/o Northwest Registered Agent, LLC., 5900 Balcones Drive STE 100, Austin, TX 78731`,
    ),
    [],
  )
})

test('the SHIPPED needles are wired in and well formed', () => {
  assert.equal(RESIDENTIAL_NEEDLES.street.tokens, 3)
  assert.equal(RESIDENTIAL_NEEDLES.city.tokens, 1)
  assert.equal(RESIDENTIAL_NEEDLES.postcode.tokens, 1)
  for (const needle of Object.values(RESIDENTIAL_NEEDLES)) {
    assert.match(needle.sha256, /^[0-9a-f]{64}$/)
  }
  // Three distinct values, so a copy-paste slip between them would be caught.
  const digests = new Set(
    Object.values(RESIDENTIAL_NEEDLES).map((n) => n.sha256),
  )
  assert.equal(digests.size, 3)
})

test('the SHIPPED postcode digest really is a five-digit postcode', () => {
  // Brute-forces the whole postcode space (10^5) against the shipped digest.
  // If somebody pastes a stale hash, or hashes the un-normalised value, this
  // fails — a digest nobody can resolve guards nothing.
  let resolved = null
  for (let n = 0; n < 100000; n += 1) {
    const candidate = String(n).padStart(5, '0')
    if (sha256(candidate) === RESIDENTIAL_NEEDLES.postcode.sha256) {
      resolved = candidate
      break
    }
  }
  assert.ok(
    resolved !== null,
    'the shipped postcode digest does not resolve to any 5-digit string',
  )
  // The fixture placeholder the offending specs were rewritten to must not be
  // the guarded value, or every rewritten file would red on its own fix.
  assert.notEqual(
    resolved,
    '00000',
    'the fixture placeholder must not be the needle',
  )
  // Stated plainly, because the limit matters: this resolves the POSTCODE
  // only. The city and street digests are NOT reconstructible here, so their
  // correctness is established by the plant-and-prove-red run recorded on
  // AGL-1491, not by this test.
  assert.deepEqual(
    scanText(`postalCode: '${resolved}'`),
    [],
    'the postcode alone must still not red under the SHIPPED needles',
  )

  // THE FALSE-GREEN THIS GUARD IS MOST EXPOSED TO. Each needle stores two
  // independent fingerprints, and the cheap one GATES the authoritative one.
  // If somebody updates `sha256` and forgets `fnv1a`, every window is filtered
  // out before it is ever hashed and the guard goes permanently, silently
  // green. Only the postcode can be reconstructed here, so only the postcode's
  // pair can be proven consistent — but that is the pair most likely to be
  // edited, and a break in the others is caught by the plant run on AGL-1491.
  assert.equal(
    fnv1a32(resolved),
    RESIDENTIAL_NEEDLES.postcode.fnv1a,
    'the postcode prefilter disagrees with its digest — the guard would never fire',
  )
})

test('the prefilter can never change a verdict, only the cost of reaching it', () => {
  // Same needles twice: once gated by a DELIBERATELY WRONG prefilter, once
  // with no prefilter at all. The wrong prefilter must suppress the finding —
  // which is precisely why the consistency assertion above has to exist.
  const text = `{ city: '${FAKE_CITY}', state: 'TX', postalCode: '${FAKE_POSTCODE}' }`
  assert.deepEqual(scan(text), [
    'the pre-move residential city and postcode together',
  ])

  const sabotaged = {
    ...FAKE_NEEDLES,
    city: { ...FAKE_NEEDLES.city, fnv1a: 0xdeadbeef },
  }
  assert.deepEqual(
    scanText(text, sabotaged),
    [],
    'a mismatched prefilter must be shown to blind the scanner',
  )

  // And with the CORRECT prefilter attached, the verdict is unchanged from the
  // ungated run — the gate is transparent when it agrees.
  const gated = {
    street: {
      ...FAKE_NEEDLES.street,
      fnv1a: fnv1a32('4821 nowhere boulevard'),
    },
    city: { ...FAKE_NEEDLES.city, fnv1a: fnv1a32('fauxville') },
    postcode: { ...FAKE_NEEDLES.postcode, fnv1a: fnv1a32('99991') },
  }
  assert.deepEqual(scanText(text, gated), scanText(text, FAKE_NEEDLES))
})
