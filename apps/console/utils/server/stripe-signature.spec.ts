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

import { createHmac } from 'crypto'
import {
  STRIPE_REPLAY_TOLERANCE_SECONDS,
  verifyStripeSignature,
} from './stripe-signature'

const SECRET = 'whsec_live_secret'
const OTHER_SECRET = 'whsec_rolled_secret'
const BODY = Buffer.from(
  JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated' }),
)

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

/** The `v1` value Stripe would send for this payload under `secret`. */
function sign(secret: string, timestamp: number, payload = BODY) {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${payload.toString('utf8')}`)
    .digest('hex')
}

/** A signature of the right SHAPE (64 hex chars) that is simply wrong. */
const BOGUS = 'f'.repeat(64)

describe('verifyStripeSignature — the single-signature cases', () => {
  it('accepts a single valid v1', () => {
    const t = nowSeconds()
    expect(
      verifyStripeSignature(BODY, `t=${t},v1=${sign(SECRET, t)}`, SECRET),
    ).toBe(true)
  })

  it('rejects a single invalid v1', () => {
    const t = nowSeconds()
    expect(verifyStripeSignature(BODY, `t=${t},v1=${BOGUS}`, SECRET)).toBe(
      false,
    )
  })

  it('rejects a signature made with a different secret', () => {
    const t = nowSeconds()
    expect(
      verifyStripeSignature(BODY, `t=${t},v1=${sign(OTHER_SECRET, t)}`, SECRET),
    ).toBe(false)
  })

  it('rejects when the payload was tampered with after signing', () => {
    const t = nowSeconds()
    const header = `t=${t},v1=${sign(SECRET, t)}`
    expect(verifyStripeSignature(Buffer.from('{"id":"evt_evil"}'), header, SECRET)).toBe(
      false,
    )
  })

  it('rejects a signature bound to a DIFFERENT timestamp than the header carries', () => {
    // The timestamp is part of the signed string, so re-stamping a captured
    // signature with a fresh `t` to slip past the replay window must fail.
    const t = nowSeconds()
    const captured = sign(SECRET, t - 10_000)
    expect(verifyStripeSignature(BODY, `t=${t},v1=${captured}`, SECRET)).toBe(
      false,
    )
  })
})

/**
 * A secret roll's overlap window is the whole reason this matters: Stripe
 * signs each delivery with BOTH the old and the new secret and sends two
 * `v1=` entries in one header. A parser that keeps only one of them verifies
 * roughly half of all deliveries against the wrong secret — 400ing precisely
 * during the window that exists to make the roll zero-downtime.
 */
describe('verifyStripeSignature — multiple v1 signatures (a secret roll)', () => {
  it('accepts when only the FIRST of two v1 values is valid', () => {
    // The regression: `Object.fromEntries` keeps the LAST value for a
    // repeated key, so the valid first signature was discarded outright.
    const t = nowSeconds()
    const header = `t=${t},v1=${sign(SECRET, t)},v1=${sign(OTHER_SECRET, t)}`
    expect(verifyStripeSignature(BODY, header, SECRET)).toBe(true)
  })

  it('accepts when only the LAST of two v1 values is valid', () => {
    const t = nowSeconds()
    const header = `t=${t},v1=${sign(OTHER_SECRET, t)},v1=${sign(SECRET, t)}`
    expect(verifyStripeSignature(BODY, header, SECRET)).toBe(true)
  })

  it('rejects when NEITHER of two v1 values is valid', () => {
    const t = nowSeconds()
    const header = `t=${t},v1=${BOGUS},v1=${sign(OTHER_SECRET, t)}`
    expect(verifyStripeSignature(BODY, header, SECRET)).toBe(false)
  })

  it('accepts a valid signature buried among several wrong ones', () => {
    const t = nowSeconds()
    const header = [
      `t=${t}`,
      `v1=${BOGUS}`,
      `v1=${sign(OTHER_SECRET, t)}`,
      `v1=${sign(SECRET, t)}`,
      `v1=${BOGUS}`,
    ].join(',')
    expect(verifyStripeSignature(BODY, header, SECRET)).toBe(true)
  })

  it('accepts a valid v1 sitting beside a v0 scheme it must ignore', () => {
    const t = nowSeconds()
    const header = `t=${t},v0=${BOGUS},v1=${sign(SECRET, t)}`
    expect(verifyStripeSignature(BODY, header, SECRET)).toBe(true)
  })

  it('ignores v0 entirely — a valid-looking v0 cannot stand in for v1', () => {
    const t = nowSeconds()
    const header = `t=${t},v0=${sign(SECRET, t)}`
    expect(verifyStripeSignature(BODY, header, SECRET)).toBe(false)
  })
})

describe('verifyStripeSignature — malformed headers reject without throwing', () => {
  const t = nowSeconds()
  const cases: Array<[string, string]> = [
    ['an empty header', ''],
    ['whitespace only', '   '],
    ['garbage with no separators', 'garbage'],
    ['no timestamp', `v1=${BOGUS}`],
    ['no v1', `t=${t}`],
    ['an empty timestamp value', `t=,v1=${BOGUS}`],
    ['an empty v1 value', `t=${t},v1=`],
    ['a non-numeric timestamp', `t=notanumber,v1=${BOGUS}`],
    ['a NaN-shaped timestamp', `t=NaN,v1=${BOGUS}`],
    ['an Infinity timestamp', `t=Infinity,v1=${BOGUS}`],
    ['keys with no "="', 't,v1'],
    ['only commas', ',,,'],
    ['a bare "=" pair', '='],
  ]
  it.each(cases)('rejects %s', (_label, header) => {
    expect(() => verifyStripeSignature(BODY, header, SECRET)).not.toThrow()
    expect(verifyStripeSignature(BODY, header, SECRET)).toBe(false)
  })

  it('rejects a v1 of the wrong LENGTH without throwing (timingSafeEqual would)', () => {
    // timingSafeEqual throws on unequal-length buffers; a one-character `v1`
    // must be a plain rejection, not a 500.
    const now = nowSeconds()
    expect(() => verifyStripeSignature(BODY, `t=${now},v1=a`, SECRET)).not.toThrow()
    expect(verifyStripeSignature(BODY, `t=${now},v1=a`, SECRET)).toBe(false)
    const long = `t=${now},v1=${'a'.repeat(512)}`
    expect(() => verifyStripeSignature(BODY, long, SECRET)).not.toThrow()
    expect(verifyStripeSignature(BODY, long, SECRET)).toBe(false)
  })

  it('a wrong-length v1 does not mask a valid one beside it', () => {
    const now = nowSeconds()
    const header = `t=${now},v1=a,v1=${sign(SECRET, now)}`
    expect(verifyStripeSignature(BODY, header, SECRET)).toBe(true)
  })
})

describe('verifyStripeSignature — whitespace and ordering variations', () => {
  it('accepts entries separated by ", " as well as ","', () => {
    const t = nowSeconds()
    expect(
      verifyStripeSignature(BODY, `t=${t}, v1=${sign(SECRET, t)}`, SECRET),
    ).toBe(true)
  })

  it('accepts the timestamp AFTER the signature', () => {
    const t = nowSeconds()
    expect(
      verifyStripeSignature(BODY, `v1=${sign(SECRET, t)},t=${t}`, SECRET),
    ).toBe(true)
  })

  it('tolerates surrounding whitespace on the whole header', () => {
    const t = nowSeconds()
    expect(
      verifyStripeSignature(BODY, `  t=${t},v1=${sign(SECRET, t)}  `, SECRET),
    ).toBe(true)
  })

  it('uses the FIRST timestamp, so a trailing t cannot override it', () => {
    // Defensive: only one `t` is ever sent. If a second is appended, the one
    // the signature is actually bound to must be the one used — an attacker
    // must not be able to re-stamp a captured header by appending `,t=<now>`.
    const t = nowSeconds()
    const stale = t - 10_000
    const header = `t=${stale},v1=${sign(SECRET, stale)},t=${t}`
    expect(verifyStripeSignature(BODY, header, SECRET)).toBe(false)
  })
})

/**
 * The replay window (AGL-499) is INDEPENDENT of how many signatures the
 * header carries. Accepting multiple `v1` values must not loosen it.
 */
describe('the AGL-499 replay window survives the multi-signature parsing', () => {
  it('is pinned at 300 seconds', () => {
    // Widening this weakens replay protection for every billing consumer at
    // once. Changing the number must mean changing this spec deliberately.
    expect(STRIPE_REPLAY_TOLERANCE_SECONDS).toBe(300)
  })

  it('rejects a perfectly valid signature signed too long ago', () => {
    const t = nowSeconds() - (STRIPE_REPLAY_TOLERANCE_SECONDS + 60)
    expect(
      verifyStripeSignature(BODY, `t=${t},v1=${sign(SECRET, t)}`, SECRET),
    ).toBe(false)
  })

  it('rejects a valid signature dated too far in the FUTURE', () => {
    const t = nowSeconds() + (STRIPE_REPLAY_TOLERANCE_SECONDS + 60)
    expect(
      verifyStripeSignature(BODY, `t=${t},v1=${sign(SECRET, t)}`, SECRET),
    ).toBe(false)
  })

  it('accepts a valid signature just inside the window', () => {
    const t = nowSeconds() - (STRIPE_REPLAY_TOLERANCE_SECONDS - 30)
    expect(
      verifyStripeSignature(BODY, `t=${t},v1=${sign(SECRET, t)}`, SECRET),
    ).toBe(true)
  })

  it('an out-of-window delivery is rejected even with TWO valid signatures', () => {
    const t = nowSeconds() - (STRIPE_REPLAY_TOLERANCE_SECONDS + 60)
    const header = `t=${t},v1=${sign(SECRET, t)},v1=${sign(SECRET, t)}`
    expect(verifyStripeSignature(BODY, header, SECRET)).toBe(false)
  })
})
