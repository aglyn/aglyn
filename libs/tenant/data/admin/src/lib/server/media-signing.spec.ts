/**
 * @jest-environment node
 */

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
  GATED_VIDEO_SESSION_TTL_MS,
  MEDIA_SIGNATURE_MAX_TTL_MS,
  MEDIA_SIGNATURE_TTL_MS,
  mintMediaSignature,
  signMediaAccess,
  verifyMediaAccess,
} from './media-signing'

const SCOPE = 'org:agency'
const OTHER_SCOPE = 'org:rival'
const MEDIA = 'm-contract'
const NOW = 1_800_000_000_000

describe('private media signatures (AGL-1051)', () => {
  const original = process.env['TOKEN_SIGNING_SECRET']
  beforeEach(() => {
    process.env['TOKEN_SIGNING_SECRET'] = 'test-secret'
  })
  afterAll(() => {
    if (original === undefined) delete process.env['TOKEN_SIGNING_SECRET']
    else process.env['TOKEN_SIGNING_SECRET'] = original
  })

  it('accepts a freshly minted signature', () => {
    const signature = mintMediaSignature(SCOPE, MEDIA, NOW)
    expect(verifyMediaAccess(SCOPE, MEDIA, signature, NOW)).toBe(true)
  })

  it('expires — the only revocation this scheme has', () => {
    const signature = mintMediaSignature(SCOPE, MEDIA, NOW)
    expect(
      verifyMediaAccess(SCOPE, MEDIA, signature, NOW + MEDIA_SIGNATURE_TTL_MS),
    ).toBe(false)
    expect(
      verifyMediaAccess(
        SCOPE,
        MEDIA,
        signature,
        NOW + MEDIA_SIGNATURE_TTL_MS - 1,
      ),
    ).toBe(true)
  })

  it('does not carry across scopes', () => {
    // The scope is INSIDE the payload. Two libraries share an id space, so
    // without it a signature for one org's asset would verify against
    // another's asset of the same id.
    const signature = mintMediaSignature(SCOPE, MEDIA, NOW)
    expect(verifyMediaAccess(OTHER_SCOPE, MEDIA, signature, NOW)).toBe(false)
  })

  it('does not carry across assets', () => {
    const signature = mintMediaSignature(SCOPE, MEDIA, NOW)
    expect(verifyMediaAccess(SCOPE, 'm-other', signature, NOW)).toBe(false)
  })

  it('rejects an extended expiry — the forger picks `exp`, so it is signed', () => {
    // The attack a short TTL alone does not stop: take a valid link and
    // push `exp` out. It only fails because `exp` is part of the payload.
    const signature = mintMediaSignature(SCOPE, MEDIA, NOW)
    expect(
      verifyMediaAccess(
        SCOPE,
        MEDIA,
        { exp: NOW + 10 * MEDIA_SIGNATURE_TTL_MS, sig: signature.sig },
        NOW,
      ),
    ).toBe(false)
  })

  it('rejects missing, empty and malformed signatures without throwing', () => {
    // `timingSafeEqual` throws on a length mismatch and the caller controls
    // that length — an exception here would be a 500 where a 404 belongs.
    for (const presented of [
      undefined,
      {},
      { exp: NOW + 1000 },
      { exp: NOW + 1000, sig: '' },
      { exp: NOW + 1000, sig: 'short' },
      { exp: NOW + 1000, sig: 'x'.repeat(4096) },
      { exp: Number.NaN, sig: 'whatever' },
      { exp: Number.POSITIVE_INFINITY, sig: 'whatever' },
    ]) {
      expect(() =>
        verifyMediaAccess(SCOPE, MEDIA, presented as never, NOW),
      ).not.toThrow()
      expect(verifyMediaAccess(SCOPE, MEDIA, presented as never, NOW)).toBe(
        false,
      )
    }
  })

  it('is namespaced so a stream or download token cannot be replayed here', () => {
    // Every commerce token shares this secret. The `media:` prefix is what
    // keeps one payload from validating as another.
    const media = signMediaAccess(SCOPE, MEDIA, NOW)
    const { createHmac } = require('crypto') as typeof import('crypto')
    const streamShaped = createHmac('sha256', 'test-secret')
      .update(`stream:${SCOPE}:${MEDIA}:${NOW}`)
      .digest('hex')
      .slice(0, 32)
    expect(media).not.toBe(streamShaped)
  })

  describe('a gated-video session (AGL-2814)', () => {
    it('lasts exactly its window and not a millisecond more', () => {
      const signature = mintMediaSignature(
        SCOPE,
        MEDIA,
        NOW,
        GATED_VIDEO_SESSION_TTL_MS,
      )
      expect(signature.exp).toBe(NOW + GATED_VIDEO_SESSION_TTL_MS)
      expect(
        verifyMediaAccess(
          SCOPE,
          MEDIA,
          signature,
          NOW + GATED_VIDEO_SESSION_TTL_MS - 1,
        ),
      ).toBe(true)
      expect(
        verifyMediaAccess(SCOPE, MEDIA, signature, NOW + GATED_VIDEO_SESSION_TTL_MS),
      ).toBe(false)
    })

    it('is measured in hours, not days', () => {
      expect(GATED_VIDEO_SESSION_TTL_MS).toBeGreaterThanOrEqual(60 * 60 * 1000)
      expect(GATED_VIDEO_SESSION_TTL_MS).toBeLessThan(24 * 60 * 60 * 1000)
    })

    it('⛔ refuses a correctly signed link whose lifetime no minter issues', () => {
      // Signed with the real secret, so only the lifetime bound can refuse it.
      const exp = NOW + MEDIA_SIGNATURE_MAX_TTL_MS + 2 * 60 * 1000
      const sig = signMediaAccess(SCOPE, MEDIA, exp)
      expect(verifyMediaAccess(SCOPE, MEDIA, { exp, sig }, NOW)).toBe(false)
      // The same link is honored once its remaining life is within the bound.
      expect(
        verifyMediaAccess(
          SCOPE,
          MEDIA,
          { exp, sig },
          exp - MEDIA_SIGNATURE_MAX_TTL_MS,
        ),
      ).toBe(true)
    })

    it('⛔ refuses to mint a lifetime the verifier would refuse', () => {
      expect(() =>
        mintMediaSignature(SCOPE, MEDIA, NOW, MEDIA_SIGNATURE_MAX_TTL_MS + 1),
      ).toThrow(RangeError)
      expect(() => mintMediaSignature(SCOPE, MEDIA, NOW, 0)).toThrow(RangeError)
    })
  })

  it('fails closed when the secret is missing, rather than serving bytes', () => {
    delete process.env['TOKEN_SIGNING_SECRET']
    // Minting throws — a missing secret must be loud where it is a config
    // error somebody can fix...
    expect(() => mintMediaSignature(SCOPE, MEDIA, NOW)).toThrow(
      /TOKEN_SIGNING_SECRET/,
    )
    // ...but verifying must NOT throw, or an unset secret turns every
    // private-asset request into a 500 instead of a denial.
    expect(
      verifyMediaAccess(SCOPE, MEDIA, { exp: NOW + 1000, sig: 'x' }, NOW),
    ).toBe(false)
  })
})
