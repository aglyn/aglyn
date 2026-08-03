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
 * AGL-1210. Domain verification is the only thing standing between self-serve
 * SSO and an account-takeover vector: a domain in `sso.domains` has its
 * sign-ins routed to that org's IdP, so "verified" has to mean a DNS lookup
 * actually saw our token and nothing weaker.
 *
 * Every case here is written so it FAILS if the check is loosened. A test that
 * only asserts the happy path would still pass if `verified` were hardcoded
 * true, which is precisely the bug worth catching.
 */

let txtAnswer: string[][] = []
let txtError: (Error & { code?: string }) | null = null
const setServers = jest.fn()

jest.mock('dns', () => ({
  promises: {
    resolveTxt: jest.fn(async () => {
      if (txtError) throw txtError
      return txtAnswer
    }),
  },
  Resolver: jest.fn().mockImplementation(() => ({
    setServers,
    resolveTxt: (
      _host: string,
      callback: (error: Error | null, records?: string[][]) => void,
    ) => (txtError ? callback(txtError) : callback(null, txtAnswer)),
  })),
}))

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ auth: () => ({}), firestore: () => ({}) }) },
}))

import {
  challengeValue,
  normalizeSsoDomain,
  poolDisplayName,
  recordsProveOwnership,
  resolveChallengeTxt,
  SSO_CHALLENGE_PREFIX,
  validateSsoDomain,
} from './sso-provisioning'

beforeEach(() => {
  txtAnswer = []
  txtError = null
  setServers.mockClear()
})

describe('domain normalisation', () => {
  it('accepts an address or a bare domain, and strips the trailing dot', () => {
    expect(normalizeSsoDomain('  Person@Acme.COM ')).toBe('acme.com')
    expect(normalizeSsoDomain('ACME.com.')).toBe('acme.com')
    expect(normalizeSsoDomain('@acme.com')).toBe('acme.com')
  })
})

describe('domain validation', () => {
  it('rejects things that are not domains', () => {
    for (const input of ['', 'acme', 'acme .com', 'http://acme.com', '-acme.com']) {
      expect(validateSsoDomain(input).domain).toBeNull()
    }
  })

  it('rejects public mailbox domains however they are spelled', () => {
    // Proving control of gmail.com is possible for exactly one party, and that
    // party still must not govern every Gmail user's sign-in.
    for (const input of ['gmail.com', 'GMAIL.COM', 'someone@outlook.com', 'icloud.com']) {
      const result = validateSsoDomain(input)
      expect(result.domain).toBeNull()
      expect(result.error).toMatch(/public email domains/i)
    }
  })

  it('accepts a real corporate domain', () => {
    expect(validateSsoDomain('acme.co.uk')).toEqual({
      domain: 'acme.co.uk',
      error: null,
    })
  })
})

describe('challenge TXT resolution', () => {
  it('pins public resolvers rather than trusting the runtime default', async () => {
    await resolveChallengeTxt('acme.com')
    expect(setServers).toHaveBeenCalledWith(['1.1.1.1', '8.8.8.8'])
  })

  it('joins the chunks DNS splits a long record into', async () => {
    // A TXT record over 255 bytes arrives as several strings. Comparing the
    // chunks individually would never match a long token.
    txtAnswer = [['aglyn-domain-verification=', 'abc123']]
    expect(await resolveChallengeTxt('acme.com')).toEqual([
      'aglyn-domain-verification=abc123',
    ])
  })

  it('reports no records when the name genuinely has none', async () => {
    txtError = Object.assign(new Error('nope'), { code: 'ENOTFOUND' })
    expect(await resolveChallengeTxt('acme.com')).toEqual([])
  })

  it('falls back to the default resolver only when the pinned ones are unreachable', async () => {
    // ESERVFAIL is "could not ask", not "asked and the answer is no" — the
    // narrow case the fallback exists for.
    txtError = Object.assign(new Error('unreachable'), { code: 'ESERVFAIL' })
    const dns = jest.requireMock('dns')
    dns.promises.resolveTxt.mockResolvedValueOnce([['fallback-value']])
    expect(await resolveChallengeTxt('acme.com')).toEqual(['fallback-value'])
  })
})

describe('the token is what proves ownership', () => {
  it('namespaces the value so an unrelated TXT record cannot pass', () => {
    expect(challengeValue('abc')).toBe('aglyn-domain-verification=abc')
  })

  it('puts the record on a dedicated host, not the apex', () => {
    // The apex commonly carries SPF/DMARC/vendor records; a match there would
    // be far easier to arrange by accident.
    expect(SSO_CHALLENGE_PREFIX).toBe('_aglyn-challenge')
  })

  it('does not accept a record carrying a DIFFERENT org’s token', () => {
    // Two orgs claiming one domain get different tokens, so publishing one
    // must not satisfy the other — otherwise the first org to claim a popular
    // domain hands every later claimant a free pass.
    const records = [
      challengeValue('token-for-org-a'),
      'v=spf1 include:_spf.google.com ~all',
    ]
    expect(recordsProveOwnership(records, 'token-for-org-b')).toBe(false)
    expect(recordsProveOwnership(records, 'token-for-org-a')).toBe(true)
  })

  it('does not accept a record that merely CONTAINS the token', () => {
    // Guards against the check ever being loosened to a substring or prefix
    // test, either of which a neighbouring record could satisfy.
    expect(recordsProveOwnership([`${challengeValue('abc')}-extra`], 'abc')).toBe(false)
    expect(recordsProveOwnership([`prefix-${challengeValue('abc')}`], 'abc')).toBe(false)
  })

  it('accepts nothing at all when the claim has no token', () => {
    // An empty token must never be provable — otherwise a claim document
    // missing its token would verify against any zone, including an empty one.
    expect(recordsProveOwnership([challengeValue('')], '')).toBe(false)
    expect(recordsProveOwnership([], '')).toBe(false)
  })

  it('rejects an empty zone outright', () => {
    expect(recordsProveOwnership([], 'abc')).toBe(false)
  })
})

describe('GCIP pool display names', () => {
  it('satisfies the 4–20 char, letter-initial, alphanumeric-hyphen constraint', () => {
    // A rejected display name surfaces as an opaque provisioning failure, so
    // every one of these has to come out valid rather than pass through.
    for (const [slug, id] of [
      ['ACME Corp!', 'org1'],
      ['9-numbers-first', 'org2'],
      ['a', 'org3'],
      ['a-very-long-organization-slug-indeed', 'org4'],
      ['', 'org5'],
      ['---', 'org6'],
    ]) {
      const name = poolDisplayName(slug, id)
      expect(name).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(name.length).toBeGreaterThanOrEqual(4)
      expect(name.length).toBeLessThanOrEqual(20)
    }
  })
})
