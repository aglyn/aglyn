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

import {
  DELIVERY_TOKEN_CLOCK_SKEW_MS,
  DELIVERY_TOKEN_MAX_TTL_MS,
  type DeliveryTokenClaims,
  mintDeliveryToken,
  verifyDeliveryToken,
} from './delivery-token'

/**
 * The one token format the platform mints and the Worker verifies
 * (AGL-2824). Every refusal the Worker relies on is asserted from a token the
 * minter really produced, then altered, so a verifier that accepted anything
 * shaped like a token would fail here.
 */

const SECRET = 'd'.repeat(64)
const OTHER_SECRET = 'e'.repeat(64)
const NOW = Date.parse('2026-09-18T12:00:00.000Z')
const KEY = 'hosts/host-1/med-film/0123456789abcdef/master/0123456789abcdef'

function claims(overrides: Partial<DeliveryTokenClaims> = {}): DeliveryTokenClaims {
  return {
    key: KEY,
    expiresAtMs: NOW + 15 * 60 * 1000,
    orgId: 'org-acme',
    hostId: 'host-1',
    mediaId: 'med-film',
    scope: 'host-1',
    ...overrides,
  }
}

/** The token with one character of its payload changed, signature kept. */
function withPayloadChanged(token: string): string {
  const [payload, signature] = token.split('.') as [string, string]
  const last = payload[payload.length - 1] === 'A' ? 'B' : 'A'
  return `${payload.slice(0, -1)}${last}.${signature}`
}

describe('delivery tokens (AGL-2824)', () => {
  it('round-trips: a minted token verifies for its key and carries its ids', async () => {
    const token = await mintDeliveryToken(claims(), SECRET, NOW)
    const verdict = await verifyDeliveryToken(token, SECRET, { key: KEY, nowMs: NOW })
    expect(verdict).toEqual({ ok: true, claims: claims() })
    // URL-safe as it stands: it rides in a query string unescaped.
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  })

  it('carries an unknown org as null rather than inventing one', async () => {
    const token = await mintDeliveryToken(
      claims({ orgId: null, hostId: null, scope: null }),
      SECRET,
      NOW,
    )
    const verdict = await verifyDeliveryToken(token, SECRET, { key: KEY, nowMs: NOW })
    expect(verdict.ok && verdict.claims).toMatchObject({
      orgId: null,
      hostId: null,
      scope: null,
      mediaId: 'med-film',
    })
  })

  it('refuses an expired token, at the instant of expiry and after', async () => {
    const expiresAtMs = NOW + 60_000
    const token = await mintDeliveryToken(claims({ expiresAtMs }), SECRET, NOW)
    expect(
      (await verifyDeliveryToken(token, SECRET, { key: KEY, nowMs: expiresAtMs - 1 })).ok,
    ).toBe(true)
    expect(await verifyDeliveryToken(token, SECRET, { key: KEY, nowMs: expiresAtMs })).toEqual({
      ok: false,
      refusal: 'expired',
    })
    expect(
      await verifyDeliveryToken(token, SECRET, { key: KEY, nowMs: expiresAtMs + 3_600_000 }),
    ).toEqual({ ok: false, refusal: 'expired' })
  })

  it('refuses a tampered token: a changed payload, and a changed signature', async () => {
    const token = await mintDeliveryToken(claims(), SECRET, NOW)
    expect(
      await verifyDeliveryToken(withPayloadChanged(token), SECRET, { key: KEY, nowMs: NOW }),
    ).toEqual({ ok: false, refusal: 'signature' })
    const [payload, signature] = token.split('.') as [string, string]
    const flipped = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`
    expect(
      await verifyDeliveryToken(`${payload}.${flipped}`, SECRET, { key: KEY, nowMs: NOW }),
    ).toEqual({ ok: false, refusal: 'signature' })
  })

  it('refuses a payload re-signed to name a longer life or another key without the secret', async () => {
    // Swapping in the payload of a DIFFERENT genuine token keeps a valid-looking
    // signature from the first one: still a signature mismatch.
    const short = await mintDeliveryToken(claims(), SECRET, NOW)
    const other = await mintDeliveryToken(
      claims({ key: 'hosts/host-1/med-other/0123456789abcdef/master/0123456789abcdef' }),
      SECRET,
      NOW,
    )
    const spliced = `${other.split('.')[0]}.${short.split('.')[1]}`
    expect(
      (await verifyDeliveryToken(spliced, SECRET, { key: KEY, nowMs: NOW })).ok,
    ).toBe(false)
  })

  it('refuses a genuine token presented for a different key, as its own refusal', async () => {
    const token = await mintDeliveryToken(claims(), SECRET, NOW)
    expect(
      await verifyDeliveryToken(token, SECRET, {
        key: 'hosts/host-1/med-other/0123456789abcdef/master/0123456789abcdef',
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, refusal: 'key' })
  })

  it('refuses a token signed with another secret', async () => {
    const token = await mintDeliveryToken(claims(), OTHER_SECRET, NOW)
    expect(await verifyDeliveryToken(token, SECRET, { key: KEY, nowMs: NOW })).toEqual({
      ok: false,
      refusal: 'signature',
    })
  })

  it('refuses a missing or short secret on both sides', async () => {
    await expect(mintDeliveryToken(claims(), 'short', NOW)).rejects.toThrow(/secret/)
    const token = await mintDeliveryToken(claims(), SECRET, NOW)
    expect(await verifyDeliveryToken(token, '', { key: KEY, nowMs: NOW })).toEqual({
      ok: false,
      refusal: 'secret',
    })
    expect(await verifyDeliveryToken(token, undefined, { key: KEY, nowMs: NOW })).toEqual({
      ok: false,
      refusal: 'secret',
    })
  })

  it('refuses garbage without throwing', async () => {
    for (const garbage of ['', 'abc', 'a.b.c', '!!!.???', `${'x'.repeat(5000)}.y`, null, 42]) {
      const verdict = await verifyDeliveryToken(garbage, SECRET, { key: KEY, nowMs: NOW })
      expect(verdict.ok).toBe(false)
    }
  })

  it('will not mint a lifetime the verifier would refuse', async () => {
    await expect(
      mintDeliveryToken(claims({ expiresAtMs: NOW + DELIVERY_TOKEN_MAX_TTL_MS + 1 }), SECRET, NOW),
    ).rejects.toThrow(RangeError)
    await expect(
      mintDeliveryToken(claims({ expiresAtMs: NOW }), SECRET, NOW),
    ).rejects.toThrow(RangeError)
    // The longest lifetime a minter issues verifies.
    const longest = await mintDeliveryToken(
      claims({ expiresAtMs: NOW + DELIVERY_TOKEN_MAX_TTL_MS }),
      SECRET,
      NOW,
    )
    expect((await verifyDeliveryToken(longest, SECRET, { key: KEY, nowMs: NOW })).ok).toBe(true)
  })

  it('refuses a genuine token that claims a lifetime no minter issues', async () => {
    // Minted at a clock far ahead, verified now: a lifetime longer than the
    // maximum plus the skew allowance.
    const farFuture = NOW + DELIVERY_TOKEN_MAX_TTL_MS + DELIVERY_TOKEN_CLOCK_SKEW_MS + 60_000
    const token = await mintDeliveryToken(
      claims({ expiresAtMs: farFuture + 60_000 }),
      SECRET,
      farFuture,
    )
    expect(await verifyDeliveryToken(token, SECRET, { key: KEY, nowMs: NOW })).toEqual({
      ok: false,
      refusal: 'too-long',
    })
  })
})
