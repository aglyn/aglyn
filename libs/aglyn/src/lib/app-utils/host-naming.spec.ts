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
  generateSubdomain,
  isBlockedSubdomain,
  SUBDOMAIN_PATTERN,
  suggestSubdomains,
} from './host-naming'

describe('isBlockedSubdomain', () => {
  it('blocks reserved platform names', () => {
    expect(isBlockedSubdomain('www')).toBe(true)
    expect(isBlockedSubdomain('admin')).toBe(true)
    expect(isBlockedSubdomain('aglyn')).toBe(true)
  })

  it('blocks profanity fragments even with separators', () => {
    expect(isBlockedSubdomain('total-shit-show')).toBe(true)
    // Separator evasion is collapsed before matching.
    expect(isBlockedSubdomain('sh-it')).toBe(true)
  })

  it('allows ordinary names', () => {
    expect(isBlockedSubdomain('my-bakery')).toBe(false)
    expect(isBlockedSubdomain('demo-2')).toBe(false)
  })
})

describe('generateSubdomain', () => {
  it('slugifies display names', () => {
    expect(generateSubdomain('My Great Bakery!')).toBe('my-great-bakery')
    expect(generateSubdomain('Café Aglyn & Co.')).toBe('cafe-aglyn-co')
  })

  it('returns empty for unusable or blocked names', () => {
    expect(generateSubdomain('!!')).toBe('')
    expect(generateSubdomain('Admin')).toBe('')
  })

  it('caps at 30 chars and stays valid', () => {
    const slug = generateSubdomain('A'.repeat(80) + ' bakery')
    expect(slug.length).toBeLessThanOrEqual(30)
    expect(SUBDOMAIN_PATTERN.test(slug)).toBe(true)
  })
})

describe('suggestSubdomains', () => {
  it('offers -2, -year, and -site variants', () => {
    expect(suggestSubdomains('bakery', 2026)).toEqual([
      'bakery-2',
      'bakery-2026',
      'bakery-site',
    ])
  })

  it('keeps every candidate within the pattern', () => {
    for (const candidate of suggestSubdomains('a'.repeat(30), 2026)) {
      expect(SUBDOMAIN_PATTERN.test(candidate)).toBe(true)
    }
  })
})

/**
 * Both deployment shapes, because a config guard that only exercises the
 * default passes by ignoring the configuration — which is exactly how AGL-2022
 * shipped green over this bug (AGL-2121).
 *
 * `TENANT_APEX` is read at module scope, so each shape needs a fresh module
 * registry: asserting against the already-imported binding would only ever
 * re-test the default.
 */
describe('TENANT_APEX is configuration, not our infrastructure (AGL-2121)', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_TENANT_DOMAIN

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_TENANT_DOMAIN
    else process.env.NEXT_PUBLIC_TENANT_DOMAIN = ORIGINAL
    jest.resetModules()
  })

  /** Re-import under the current env so the module-scope const re-evaluates. */
  function loadWith(value: string | undefined) {
    if (value === undefined) delete process.env.NEXT_PUBLIC_TENANT_DOMAIN
    else process.env.NEXT_PUBLIC_TENANT_DOMAIN = value
    jest.resetModules()
    return require('./host-naming') as typeof import('./host-naming')
  }

  it('SELF-HOST shape: the canonical origin is the operator apex, never ours', () => {
    const naming = loadWith('sites.example.com')

    expect(naming.TENANT_APEX).toBe('sites.example.com')
    // `hostPublicOrigin` is what the tenant renderer emits as
    // `<link rel="canonical">`, what /api/sitemap, /api/robots,
    // /api/collections-rss and /api/manifest publish, what og:image is built
    // from, and what inbox-bound `<img src>` resolves against. Our apex
    // surviving here tells Google, every feed reader and every inbox that an
    // operator's customer lives at a name we do not serve for them.
    expect(naming.hostPublicOrigin({ subdomain: 'acme' })).toBe(
      'https://acme.sites.example.com',
    )
    expect(naming.hostPublicOrigin({ subdomain: 'acme' })).not.toContain(
      'aglyn.app',
    )

    // `liveCustomDomain` refuses a cname INSIDE the apex because redirecting
    // there loops forever. Pinned to ours it never refused an operator's own
    // apex — so the infinite redirect it exists to prevent was reachable on
    // exactly the deployments it was not guarding.
    expect(
      naming.liveCustomDomain({ cname: 'shop.sites.example.com' }),
    ).toBeUndefined()
    // ...while an unrelated custom domain is still served.
    expect(naming.liveCustomDomain({ cname: 'shop.example.org' })).toBe(
      'shop.example.org',
    )
  })

  it('AGLYN-OPERATED shape: unset still resolves to our production apex', () => {
    const naming = loadWith(undefined)

    expect(naming.TENANT_APEX).toBe('aglyn.app')
    expect(naming.hostPublicOrigin({ subdomain: 'acme' })).toBe(
      'https://acme.aglyn.app',
    )
    expect(naming.liveCustomDomain({ cname: 'shop.aglyn.app' })).toBeUndefined()
  })

  it('a whitespace-only .env line reads as absent, not as a blank apex', () => {
    // A half-finished `NEXT_PUBLIC_TENANT_DOMAIN=` line would otherwise make
    // every canonical URL `https://acme.` — worse than either apex.
    expect(loadWith('   ').TENANT_APEX).toBe('aglyn.app')
  })
})
