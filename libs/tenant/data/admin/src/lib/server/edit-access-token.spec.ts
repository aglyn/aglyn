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
  EDIT_ACCESS_TOKEN_TTL_MS,
  mintEditAccessToken,
  verifyEditAccessToken,
} from './edit-access-token'

const HOST = 'host-abc123'
const UID = 'uid-7AVEM'
const NOW = 1_800_000_000_000

describe('edit-access tokens (admin edit bar, AGL-1302 follow-on)', () => {
  const original = process.env['TOKEN_SIGNING_SECRET']
  beforeEach(() => {
    process.env['TOKEN_SIGNING_SECRET'] = 'test-secret'
  })
  afterAll(() => {
    if (original === undefined) delete process.env['TOKEN_SIGNING_SECRET']
    else process.env['TOKEN_SIGNING_SECRET'] = original
  })

  it('round-trips a freshly minted token', () => {
    const minted = mintEditAccessToken(HOST, UID, NOW)
    expect(minted.expiresAtMs).toBe(NOW + EDIT_ACCESS_TOKEN_TTL_MS)
    const claims = verifyEditAccessToken(minted.token, NOW)
    expect(claims).toEqual({
      hostId: HOST,
      uid: UID,
      exp: NOW + EDIT_ACCESS_TOKEN_TTL_MS,
    })
  })

  it('expires — the TTL plus the flag are the only revocation', () => {
    const { token } = mintEditAccessToken(HOST, UID, NOW)
    expect(
      verifyEditAccessToken(token, NOW + EDIT_ACCESS_TOKEN_TTL_MS - 1),
    ).not.toBeNull()
    expect(
      verifyEditAccessToken(token, NOW + EDIT_ACCESS_TOKEN_TTL_MS),
    ).toBeNull()
  })

  it('stays scoped to the host it was minted for', () => {
    const { token } = mintEditAccessToken(HOST, UID, NOW)
    const claims = verifyEditAccessToken(token, NOW)
    // The verifier hands back the SIGNED hostId; a caller comparing it
    // against another host must get a mismatch, never a forged match.
    expect(claims?.hostId).toBe(HOST)
    expect(claims?.hostId).not.toBe('host-other')
  })

  it('rejects a tampered payload', () => {
    const { token } = mintEditAccessToken(HOST, UID, NOW)
    const [prefix, , sig] = token.split('.')
    const forged = Buffer.from(
      JSON.stringify({
        hostId: 'host-other',
        uid: UID,
        exp: NOW + EDIT_ACCESS_TOKEN_TTL_MS,
      }),
      'utf8',
    ).toString('base64url')
    expect(verifyEditAccessToken(`${prefix}.${forged}.${sig}`, NOW)).toBeNull()
  })

  it('rejects a tampered signature', () => {
    const { token } = mintEditAccessToken(HOST, UID, NOW)
    const [prefix, payload, sig] = token.split('.')
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)
    expect(
      verifyEditAccessToken(`${prefix}.${payload}.${flipped}`, NOW),
    ).toBeNull()
    // A wrong-LENGTH signature must be a refusal, not a crash —
    // timingSafeEqual throws on mismatched lengths.
    expect(
      verifyEditAccessToken(`${prefix}.${payload}.${sig}ff`, NOW),
    ).toBeNull()
  })

  it('rejects a token signed under a different secret', () => {
    const { token } = mintEditAccessToken(HOST, UID, NOW)
    process.env['TOKEN_SIGNING_SECRET'] = 'rotated-secret'
    expect(verifyEditAccessToken(token, NOW)).toBeNull()
  })

  it('fails closed when the secret is missing', () => {
    delete process.env['TOKEN_SIGNING_SECRET']
    expect(() => mintEditAccessToken(HOST, UID, NOW)).toThrow()
    // A verify with no secret must refuse, not throw — it sits on a public
    // API route where an exception would be a 500.
    const forged = `aglyn-edit-bar-v1.${Buffer.from(
      JSON.stringify({ hostId: HOST, uid: UID, exp: NOW + 1000 }),
    ).toString('base64url')}.deadbeef`
    expect(verifyEditAccessToken(forged, NOW)).toBeNull()
  })

  it('rejects garbage input without throwing', () => {
    for (const junk of [
      undefined,
      null,
      42,
      '',
      'aglyn-edit-bar-v1',
      'aglyn-edit-bar-v1..',
      'not-a-token.at.all',
      'aglyn-edit-bar-v0.abc.def',
      `aglyn-edit-bar-v1.${'x'.repeat(5000)}.sig`,
    ]) {
      expect(verifyEditAccessToken(junk, NOW)).toBeNull()
    }
  })
})
