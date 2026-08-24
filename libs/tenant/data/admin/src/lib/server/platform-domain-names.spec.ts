/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
 *
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
 * The blocklist both domain surfaces read (AGL-1430).
 *
 * `console-domains.spec.ts` already pins the console wording and the
 * `PRODUCTION_DOMAINS` walk; this file pins the two properties that are new
 * and that the site custom-domain path depends on:
 *
 *  1. **`TENANT_APEX` is consulted at CALL time, not baked into the list.**
 *     The correspondence being protected is a property of whichever apex this
 *     deployment attaches `{subdomain}.{apex}` redirects to — an env var on a
 *     self-host install. A list that only knew `aglyn.app` would leave every
 *     self-host operator with the exact hole this closes.
 *  2. **The refusal is a refusal, and the acceptance is an acceptance.** Every
 *     block below has a matching control, because a validator that refuses
 *     everything passes every negative test and ships a wizard that can never
 *     connect anything.
 */

export {}

/** Flipped per test, so `TENANT_APEX` is read fresh on every call. */
let apex = 'aglyn.app'

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  get TENANT_APEX() {
    return apex
  },
}))

const {
  BARE_PUBLIC_SUFFIXES,
  isPlatformReservedDomain,
  normalizePlatformDomain,
  RESERVED_DOMAIN_SUFFIXES,
  validatePlatformDomain,
} = require('./platform-domain-names') as typeof import('./platform-domain-names')

const COPY = { invalid: 'INVALID', reserved: 'RESERVED' }
const check = (input: string) => validatePlatformDomain(input, COPY)

beforeEach(() => {
  apex = 'aglyn.app'
})

describe('the platform’s own names are unclaimable', () => {
  it('refuses every reserved suffix, as the name AND as a subdomain of it', () => {
    for (const suffix of RESERVED_DOMAIN_SUFFIXES) {
      expect(isPlatformReservedDomain(suffix)).toBe(true)
      expect(isPlatformReservedDomain(`anything.${suffix}`)).toBe(true)
      expect(isPlatformReservedDomain(`a.b.${suffix}`)).toBe(true)
    }
  })

  it('refuses the exact names that made the site path exploitable', () => {
    // Each of these is a real Vercel project domain on `aglyn-tenant` that no
    // host document holds as a `cname` (AGL-1311 §1.1), and each one attached
    // and went green through `/api/domains/attach` before this existed.
    for (const live of [
      'www.aglyn.com',
      'aglyn.app',
      'www.aglyn.app',
      'aglyn.io',
      // The AGL-1273 subdomain redirect — one per customer on a custom domain.
      'alice.aglyn.app',
    ]) {
      expect(check(live)).toEqual({ domain: null, error: 'RESERVED' })
    }
  })

  it('refuses a hosting suffix nobody can prove they own', () => {
    for (const shared of [
      'aglyn-console-aglyn.vercel.app',
      'acme.pages.dev',
      'acme.github.io',
      'acme.web.app',
      'acme.onrender.com',
    ]) {
      expect(check(shared).domain).toBeNull()
    }
  })

  it('refuses special-use names a public lookup can never settle', () => {
    for (const name of [
      'console.local',
      'box.internal',
      'thing.test',
      'site.example',
      'nope.invalid',
      'hidden.onion',
    ]) {
      expect(check(name).domain).toBeNull()
    }
  })
})

describe('TENANT_APEX is read at call time, not frozen into the list', () => {
  it('refuses a name inside a SELF-HOST apex the static list has never heard of', () => {
    // The property that matters: `upsertSubdomainRedirect` attaches
    // `{subdomain}.{TENANT_APEX}` on whatever apex this deployment runs, so
    // that is the apex the blocklist has to cover. A hardcoded `aglyn.app`
    // protects Aglyn and nobody else.
    apex = 'sites.operator.example.net'
    expect(check('alice.sites.operator.example.net')).toEqual({
      domain: null,
      error: 'RESERVED',
    })
    expect(check('sites.operator.example.net').domain).toBeNull()
  })

  it('and that same name is claimable again once the apex moves', () => {
    // The control for the test above. Without it, a validator that refuses
    // every `.net` — or every name at all — passes it.
    apex = 'aglyn.app'
    expect(check('alice.sites.operator.example.net').domain).toBe(
      'alice.sites.operator.example.net',
    )
  })

  it('does not fall open when the apex is unset', () => {
    // A self-host install with no `NEXT_PUBLIC_TENANT_DOMAIN` must not lose
    // the STATIC half of the blocklist as a side effect.
    apex = ''
    expect(check('www.aglyn.com').domain).toBeNull()
    expect(check('acme.vercel.app').domain).toBeNull()
    expect(check('example.com').domain).toBe('example.com')
  })
})

describe('a public suffix is not a domain, but a name under one is', () => {
  it('refuses a bare multi-label public suffix', () => {
    for (const bare of BARE_PUBLIC_SUFFIXES) {
      expect(check(bare)).toEqual({ domain: null, error: 'RESERVED' })
    }
  })

  it('accepts a real domain under one of them — the control', () => {
    for (const real of ['acme.co.uk', 'acme.com.au', 'acme.co.jp']) {
      expect(check(real).domain).toBe(real)
    }
  })

  it('refuses a single label and a bare TLD', () => {
    for (const bare of ['com', 'acme', 'localhost']) {
      expect(check(bare).domain).toBeNull()
    }
  })
})

describe('shape and normalisation', () => {
  it('refuses malformed labels and a name longer than DNS allows', () => {
    const tooLong = `${['a', 'b', 'c', 'd'].map((c) => c.repeat(63)).join('.')}.com`
    expect(check(tooLong)).toEqual({ domain: null, error: 'INVALID' })
    for (const malformed of [
      '-acme.com',
      'acme-.com',
      'acme..com',
      'acme.c',
      'acme.123',
      'not a domain',
      '',
    ]) {
      expect(check(malformed).domain).toBeNull()
    }
  })

  it('normalises a pasted URL, a trailing root dot and casing', () => {
    expect(normalizePlatformDomain('  HTTPS://Shop.Acme.com/path?x=1  ')).toBe(
      'shop.acme.com',
    )
    expect(check('https://shop.acme.com/').domain).toBe('shop.acme.com')
    expect(check('shop.acme.com.').domain).toBe('shop.acme.com')
    expect(check('  SHOP.ACME.COM  ').domain).toBe('shop.acme.com')
  })

  it('normalises BEFORE it checks, so a pasted reserved URL is still refused', () => {
    // A blocklist applied to the raw input is a blocklist with a bypass.
    expect(check('https://alice.aglyn.app/').domain).toBeNull()
    expect(check('WWW.AGLYN.COM').domain).toBeNull()
    expect(check('www.aglyn.com.').domain).toBeNull()
  })

  it('hands back the caller’s wording, not its own', () => {
    // The two strings a customer reads are the caller's; only the rules are
    // shared. A validator that returned one fixed message would put console
    // copy in the site wizard.
    expect(
      validatePlatformDomain('aglyn.app', { invalid: 'A', reserved: 'B' }).error,
    ).toBe('B')
    expect(
      validatePlatformDomain('!!!', { invalid: 'A', reserved: 'B' }).error,
    ).toBe('A')
  })
})

describe('an ordinary customer domain still passes — the control', () => {
  it('accepts apex, www and deeper names alike', () => {
    for (const real of [
      'example.com',
      'www.example.com',
      'shop.example.com',
      'acme-agency.io',
      'x.example.org',
    ]) {
      expect(check(real)).toEqual({ domain: real, error: null })
      expect(isPlatformReservedDomain(real)).toBe(false)
    }
  })
})
