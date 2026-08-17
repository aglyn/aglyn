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
  EDIT_HINT_BOUNCE_TTL_MS,
  EDIT_HINT_COOKIE_TTL_MS,
  mintEditHintToken,
  verifyEditHintToken,
} from './edit-hint-token'

const UID = 'uid-northwind-editor'
const NOW = 1_800_000_000_000

describe('edit-hint tokens (AGL-1842 cross-site auto-arm)', () => {
  const original = process.env['TOKEN_SIGNING_SECRET']
  beforeEach(() => {
    process.env['TOKEN_SIGNING_SECRET'] = 'test-secret'
  })
  afterAll(() => {
    if (original === undefined) delete process.env['TOKEN_SIGNING_SECRET']
    else process.env['TOKEN_SIGNING_SECRET'] = original
  })

  it('round-trips a bounce hint within its short TTL', () => {
    const minted = mintEditHintToken('bounce', UID, NOW)
    expect(minted.expiresAtMs).toBe(NOW + EDIT_HINT_BOUNCE_TTL_MS)
    const claims = verifyEditHintToken('bounce', minted.token, NOW + 1_000)
    expect(claims).toEqual({ uid: UID, exp: minted.expiresAtMs })
  })

  it('round-trips a cookie hint within its week TTL', () => {
    const minted = mintEditHintToken('cookie', UID, NOW)
    expect(minted.expiresAtMs).toBe(NOW + EDIT_HINT_COOKIE_TTL_MS)
    const claims = verifyEditHintToken(
      'cookie',
      minted.token,
      NOW + 6 * 24 * 60 * 60 * 1000,
    )
    expect(claims?.uid).toBe(UID)
  })

  it('REFUSES a kind swap in both directions — the replay wall', () => {
    // A leaked 60s bounce URL must never become a week-long cookie, and a
    // stolen cookie value must never re-enter through the bounce endpoint.
    const bounce = mintEditHintToken('bounce', UID, NOW)
    const cookie = mintEditHintToken('cookie', UID, NOW)
    expect(verifyEditHintToken('cookie', bounce.token, NOW)).toBeNull()
    expect(verifyEditHintToken('bounce', cookie.token, NOW)).toBeNull()
    // Sanity: both verify as themselves at the same instant, so the refusal
    // above is the kind check, not an accident of expiry.
    expect(verifyEditHintToken('bounce', bounce.token, NOW)).not.toBeNull()
    expect(verifyEditHintToken('cookie', cookie.token, NOW)).not.toBeNull()
  })

  it('refuses an expired hint', () => {
    const minted = mintEditHintToken('bounce', UID, NOW)
    expect(
      verifyEditHintToken('bounce', minted.token, minted.expiresAtMs + 1),
    ).toBeNull()
  })

  it('refuses a tampered payload', () => {
    const minted = mintEditHintToken('cookie', UID, NOW)
    const [prefix, payload, sig] = minted.token.split('.')
    const forged = Buffer.from(
      JSON.stringify({ uid: 'uid-attacker', exp: NOW + EDIT_HINT_COOKIE_TTL_MS }),
      'utf8',
    ).toString('base64url')
    expect(
      verifyEditHintToken('cookie', `${prefix}.${forged}.${sig}`, NOW),
    ).toBeNull()
    expect(verifyEditHintToken('cookie', `${prefix}.${payload}.AAAA`, NOW)).toBeNull()
  })

  it('refuses garbage shapes without throwing', () => {
    for (const junk of [null, undefined, 42, '', 'a.b', 'x'.repeat(5000)]) {
      expect(verifyEditHintToken('cookie', junk, NOW)).toBeNull()
    }
  })

  it('fails CLOSED when the signing secret is missing', () => {
    const minted = mintEditHintToken('cookie', UID, NOW)
    delete process.env['TOKEN_SIGNING_SECRET']
    expect(verifyEditHintToken('cookie', minted.token, NOW)).toBeNull()
  })
})
