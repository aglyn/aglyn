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
 *
 * @jest-environment node
 */

import {
  mintQuoteLinkToken,
  parseQuoteLinkToken,
  quotePayLinkUrl,
  verifyQuoteLinkToken,
} from './quote-link-token'
import { mintOrderStatusToken } from './order-status-token'

/**
 * A quote's pay link token (AGL-4094): `<version>.<signature>`, signed over
 * the site, the quote and the link version, with no expiry.
 */

const SECRET = process.env.TOKEN_SIGNING_SECRET

beforeEach(() => {
  process.env.TOKEN_SIGNING_SECRET = 'quote-link-spec-secret'
})

afterAll(() => {
  if (SECRET === undefined) delete process.env.TOKEN_SIGNING_SECRET
  else process.env.TOKEN_SIGNING_SECRET = SECRET
})

describe('the pay link token', () => {
  it('carries its version and a 32-character signature, the same every time', () => {
    const token = mintQuoteLinkToken('site1', 'q-1', 1)
    expect(token).toMatch(/^1\.[0-9a-f]{32}$/)
    expect(mintQuoteLinkToken('site1', 'q-1', 1)).toBe(token)
    expect(parseQuoteLinkToken(String(token))).toEqual({ version: 1, signature: String(token).slice(2) })
  })

  it('verifies to the version it was signed for, old or current', () => {
    expect(verifyQuoteLinkToken('site1', 'q-1', String(mintQuoteLinkToken('site1', 'q-1', 1)))).toBe(1)
    expect(verifyQuoteLinkToken('site1', 'q-1', String(mintQuoteLinkToken('site1', 'q-1', 4)))).toBe(4)
  })

  it('is bound to its site, its quote and its version', () => {
    const token = String(mintQuoteLinkToken('site1', 'q-1', 2))
    expect(verifyQuoteLinkToken('site2', 'q-1', token)).toBeNull()
    expect(verifyQuoteLinkToken('site1', 'q-2', token)).toBeNull()
    // A signature lifted onto another version is not that version's.
    expect(verifyQuoteLinkToken('site1', 'q-1', `3.${token.split('.')[1]}`)).toBeNull()
  })

  it('refuses a malformed, empty or foreign token, and another link’s signature', () => {
    for (const token of ['', 'abc', '1.', '0.0123456789abcdef0123456789abcdef', '1.0123456789ABCDEF0123456789ABCDEF', '01.x']) {
      expect(verifyQuoteLinkToken('site1', 'q-1', token)).toBeNull()
    }
    // The order-status link signs another payload under the same secret.
    const orderStatus = String(mintOrderStatusToken('site1', 'q-1'))
    expect(verifyQuoteLinkToken('site1', 'q-1', `1.${orderStatus}`)).toBeNull()
  })

  it('answers nothing without a signing secret, and mints nothing', () => {
    const token = String(mintQuoteLinkToken('site1', 'q-1', 1))
    delete process.env.TOKEN_SIGNING_SECRET
    expect(mintQuoteLinkToken('site1', 'q-1', 1)).toBeNull()
    expect(verifyQuoteLinkToken('site1', 'q-1', token)).toBeNull()
  })

  it('mints no token for a version that is not a positive whole number', () => {
    expect(mintQuoteLinkToken('site1', 'q-1', 0)).toBeNull()
    expect(mintQuoteLinkToken('site1', 'q-1', 1.5)).toBeNull()
    expect(mintQuoteLinkToken('', 'q-1', 1)).toBeNull()
  })
})

describe('the pay link', () => {
  it('opens /pay-quote on the site’s own domain, else its Aglyn address', () => {
    const token = String(mintQuoteLinkToken('site1', 'q-1', 2))
    expect(quotePayLinkUrl({ cname: 'shop.example.com', subdomain: 'acme' }, 'site1', 'q-1', 2)).toBe(
      `https://shop.example.com/pay-quote?q=q-1&t=${encodeURIComponent(token)}`,
    )
    expect(quotePayLinkUrl({ subdomain: 'acme' }, 'site1', 'q-1', 2)).toMatch(
      /^https:\/\/acme\.[a-z.]+\/pay-quote\?q=q-1&t=2\.[0-9a-f]{32}$/,
    )
  })

  it('is null for a site with no address', () => {
    expect(quotePayLinkUrl({}, 'site1', 'q-1', 1)).toBeNull()
  })
})

describe('an order’s invoice link (AGL-4099)', () => {
  it('signs any order the same way, so a quote’s links already sent keep verifying unchanged', () => {
    // The signature is over the order id, whatever its channel: a quote's
    // token of before is byte-for-byte the token of now.
    const quoteToken = String(mintQuoteLinkToken('site1', 'q-1', 3))
    expect(quoteToken).toBe(String(mintQuoteLinkToken('site1', 'q-1', 3)))
    expect(verifyQuoteLinkToken('site1', 'q-1', quoteToken)).toBe(3)
    const draftToken = String(mintQuoteLinkToken('site1', 'draft-1', 1))
    expect(verifyQuoteLinkToken('site1', 'draft-1', draftToken)).toBe(1)
    // …and one order's link never opens another.
    expect(verifyQuoteLinkToken('site1', 'q-1', draftToken)).toBeNull()
    expect(quotePayLinkUrl({ subdomain: 'acme' }, 'site1', 'draft-1', 1)).toMatch(
      /^https:\/\/acme\.[a-z.]+\/pay-quote\?q=draft-1&t=1\.[0-9a-f]{32}$/,
    )
  })
})
