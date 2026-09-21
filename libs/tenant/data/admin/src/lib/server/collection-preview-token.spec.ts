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
 * THE SCOPE IS THE SECURITY (AGL-3205).
 *
 * A preview token reveals a post the public site withholds. The signature
 * proves it came from us; the SCOPE is what keeps one link from becoming a
 * skeleton key, and every part of that scope is inside the signed payload
 * precisely so nobody can edit it in a URL bar.
 *
 * So the cases below are not "does the happy path verify" — they are the four
 * substitutions someone holding one valid link would actually try: move it to
 * another site, another collection, another post, or hold it until tomorrow.
 * Each is asserted against a token that is otherwise entirely genuine.
 */

import { createHmac } from 'crypto'
import {
  COLLECTION_PREVIEW_MAX_TTL_MS,
  COLLECTION_PREVIEW_TTL_MS,
  mintCollectionPreviewToken,
  verifyCollectionPreviewToken,
} from './collection-preview-token'

const SECRET = 'test-token-signing-secret'
const SCOPE = {
  hostId: 'host-1',
  collectionSlug: 'blog',
  entrySlug: 'shipping-the-export',
}

const originalSecret = process.env['TOKEN_SIGNING_SECRET']
beforeEach(() => {
  process.env['TOKEN_SIGNING_SECRET'] = SECRET
})
afterAll(() => {
  if (originalSecret === undefined) delete process.env['TOKEN_SIGNING_SECRET']
  else process.env['TOKEN_SIGNING_SECRET'] = originalSecret
})

/**
 * A token we sign OURSELVES with the real secret, so the payload can carry
 * anything. This is the only way to test the verifier's own rules — an `exp`
 * past the ceiling, a scope the minter would never produce — separately from
 * the signature check, which the minter would always satisfy.
 */
function forge(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString(
    'base64url',
  )
  const sig = createHmac('sha256', SECRET)
    .update(`collection-preview:${payload}`)
    .digest('base64url')
  return `aglyn-entry-preview-v1.${payload}.${sig}`
}

describe('a preview token verifies for exactly what it was minted for', () => {
  it('verifies for its own scope', () => {
    const { token } = mintCollectionPreviewToken(SCOPE)
    expect(verifyCollectionPreviewToken(token, SCOPE)).toBe(true)
  })

  it('reports the expiry it actually signed', () => {
    const now = 1_700_000_000_000
    const { token, expiresAtMs } = mintCollectionPreviewToken(SCOPE, now)
    expect(expiresAtMs).toBe(now + COLLECTION_PREVIEW_TTL_MS)
    // One millisecond before it lapses, and one after.
    expect(verifyCollectionPreviewToken(token, SCOPE, expiresAtMs - 1)).toBe(true)
    expect(verifyCollectionPreviewToken(token, SCOPE, expiresAtMs)).toBe(false)
    expect(verifyCollectionPreviewToken(token, SCOPE, expiresAtMs + 1)).toBe(false)
  })

  it('refuses the same token on another host', () => {
    const { token } = mintCollectionPreviewToken(SCOPE)
    expect(
      verifyCollectionPreviewToken(token, { ...SCOPE, hostId: 'host-2' }),
    ).toBe(false)
  })

  it('refuses the same token in another collection', () => {
    const { token } = mintCollectionPreviewToken(SCOPE)
    expect(
      verifyCollectionPreviewToken(token, { ...SCOPE, collectionSlug: 'news' }),
    ).toBe(false)
  })

  it('refuses the same token on another entry', () => {
    const { token } = mintCollectionPreviewToken(SCOPE)
    expect(
      verifyCollectionPreviewToken(token, {
        ...SCOPE,
        entrySlug: 'the-other-post',
      }),
    ).toBe(false)
  })

  it('does not leak one post through another post’s token', () => {
    // Both minted honestly. Neither may answer for the other, in either
    // direction — a one-directional check would pass a verifier that only
    // compared lengths.
    const a = mintCollectionPreviewToken({ ...SCOPE, entrySlug: 'post-a' })
    const b = mintCollectionPreviewToken({ ...SCOPE, entrySlug: 'post-b' })
    expect(
      verifyCollectionPreviewToken(a.token, { ...SCOPE, entrySlug: 'post-b' }),
    ).toBe(false)
    expect(
      verifyCollectionPreviewToken(b.token, { ...SCOPE, entrySlug: 'post-a' }),
    ).toBe(false)
  })
})

describe('a preview token that was tampered with is refused', () => {
  it('refuses a payload edited under the original signature', () => {
    const { token } = mintCollectionPreviewToken(SCOPE)
    const [prefix, , sig] = token.split('.')
    const swapped = Buffer.from(
      JSON.stringify({ ...SCOPE, entrySlug: 'post-b', exp: Date.now() + 1000 }),
      'utf8',
    ).toString('base64url')
    expect(
      verifyCollectionPreviewToken(`${prefix}.${swapped}.${sig}`, {
        ...SCOPE,
        entrySlug: 'post-b',
      }),
    ).toBe(false)
  })

  it('refuses a signature from a different secret', () => {
    const { token } = mintCollectionPreviewToken(SCOPE)
    process.env['TOKEN_SIGNING_SECRET'] = 'some-other-secret'
    expect(verifyCollectionPreviewToken(token, SCOPE)).toBe(false)
  })

  it('refuses another token family replayed as a preview', () => {
    // Same secret, same shape, a different context prefix — which is the
    // whole point of domain separation. A media or edit-hint signature must
    // not be spendable here.
    const payload = Buffer.from(
      JSON.stringify({ ...SCOPE, exp: Date.now() + 60_000 }),
      'utf8',
    ).toString('base64url')
    const sig = createHmac('sha256', SECRET)
      .update(`edit-hint:cookie:${payload}`)
      .digest('base64url')
    expect(
      verifyCollectionPreviewToken(
        `aglyn-entry-preview-v1.${payload}.${sig}`,
        SCOPE,
      ),
    ).toBe(false)
  })

  it('refuses a token of another version', () => {
    const { token } = mintCollectionPreviewToken(SCOPE)
    const [, payload, sig] = token.split('.')
    expect(
      verifyCollectionPreviewToken(
        `aglyn-entry-preview-v2.${payload}.${sig}`,
        SCOPE,
      ),
    ).toBe(false)
  })

  it.each([
    ['not a token at all', 'nonsense'],
    ['an empty string', ''],
    ['too many parts', 'a.b.c.d'],
  ])('refuses %s', (_label, candidate) => {
    expect(verifyCollectionPreviewToken(candidate, SCOPE)).toBe(false)
  })

  it.each([[null], [undefined], [42], [{}]])(
    'refuses the non-string %p without throwing',
    (candidate) => {
      expect(verifyCollectionPreviewToken(candidate, SCOPE)).toBe(false)
    },
  )

  it('refuses an absurdly long candidate before doing any work', () => {
    expect(verifyCollectionPreviewToken('x'.repeat(100_000), SCOPE)).toBe(false)
  })
})

describe('the verifier bounds our own mistakes as well as an attacker’s', () => {
  it('refuses a genuinely signed token claiming a longer life than the ceiling', () => {
    const now = 1_700_000_000_000
    const token = forge({
      ...SCOPE,
      // A day, signed with the real secret — exactly what a minter that one
      // day passed the wrong unit would hand out.
      exp: now + 24 * 60 * 60 * 1000,
    })
    expect(verifyCollectionPreviewToken(token, SCOPE, now)).toBe(false)
  })

  it('still accepts one sitting at the ceiling, with clock skew to spare', () => {
    const now = 1_700_000_000_000
    const token = forge({ ...SCOPE, exp: now + COLLECTION_PREVIEW_MAX_TTL_MS })
    expect(verifyCollectionPreviewToken(token, SCOPE, now)).toBe(true)
    // The minting machine's clock a few seconds ahead of the verifier's.
    expect(verifyCollectionPreviewToken(token, SCOPE, now - 30_000)).toBe(true)
  })

  it('refuses an `exp` that is not a number', () => {
    expect(verifyCollectionPreviewToken(forge({ ...SCOPE, exp: 'soon' }), SCOPE)).toBe(
      false,
    )
    expect(verifyCollectionPreviewToken(forge({ ...SCOPE }), SCOPE)).toBe(false)
  })
})

describe('a deploy with no signing secret fails closed', () => {
  it('refuses every token rather than accepting any', () => {
    const { token } = mintCollectionPreviewToken(SCOPE)
    delete process.env['TOKEN_SIGNING_SECRET']
    expect(verifyCollectionPreviewToken(token, SCOPE)).toBe(false)
  })

  it('refuses to MINT rather than signing with a default key', () => {
    delete process.env['TOKEN_SIGNING_SECRET']
    expect(() => mintCollectionPreviewToken(SCOPE)).toThrow(
      /TOKEN_SIGNING_SECRET/,
    )
  })
})

describe('the minter refuses an unscopeable grant', () => {
  it.each([
    ['no host', { ...SCOPE, hostId: '' }],
    ['no collection', { ...SCOPE, collectionSlug: '' }],
    ['no entry', { ...SCOPE, entrySlug: '' }],
  ])('throws for %s rather than signing a wildcard', (_label, scope) => {
    expect(() => mintCollectionPreviewToken(scope)).toThrow()
  })
})
