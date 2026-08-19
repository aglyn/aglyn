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
 * Both deployment shapes, because a guard that only exercises the default
 * passes on a module that ignores configuration entirely (AGL-2121).
 *
 * That is not hypothetical here. AGL-2022 shipped `NEXT_PUBLIC_TENANT_DOMAIN`
 * and a spec for it, both green, while `TENANT_APEX` — the constant every
 * PUBLIC surface reads — stayed a literal. The console's links obeyed the
 * operator; the canonical tag, sitemap, robots, RSS, manifest, `og:image` and
 * inbox-bound `<img src>` did not. So the assertions below are written in
 * both directions and every one of them names our apex as the thing that must
 * NOT survive an operator's configuration.
 *
 * `TENANT_APEX` is module scope, so each shape needs a fresh module registry;
 * asserting against the already-imported binding only ever re-tests the
 * default.
 */
describe('tenant apex is configuration, not our infrastructure (AGL-2121)', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_TENANT_DOMAIN

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_TENANT_DOMAIN
    else process.env.NEXT_PUBLIC_TENANT_DOMAIN = ORIGINAL
    jest.resetModules()
  })

  function loadWith(value: string | undefined) {
    if (value === undefined) delete process.env.NEXT_PUBLIC_TENANT_DOMAIN
    else process.env.NEXT_PUBLIC_TENANT_DOMAIN = value
    jest.resetModules()
    return require('./host-naming') as typeof import('./host-naming')
  }

  it('SELF-HOST shape: the operator apex replaces ours everywhere it is printed', () => {
    const naming = loadWith('sites.example.com')

    expect(naming.TENANT_APEX).toBe('sites.example.com')
    // The canonical origin — <link rel="canonical">, sitemap, robots, RSS
    // item links, manifest, og:image, and email <img src> all build on this.
    expect(naming.hostPublicOrigin({ subdomain: 'acme' })).toBe(
      'https://acme.sites.example.com',
    )
    // The whole point: our origin must not survive an operator's config.
    expect(naming.hostPublicOrigin({ subdomain: 'acme' })).not.toContain(
      'aglyn.app',
    )
  })

  it('SELF-HOST shape: the redirect loop guard follows the operator apex', () => {
    const naming = loadWith('sites.example.com')

    // A cname inside the SERVING apex is the self-redirect the guard exists
    // to refuse. Pinned to `aglyn.app` it refused the wrong apex on exactly
    // the deployments it was not guarding.
    expect(
      naming.liveCustomDomain({ cname: 'acme.sites.example.com' }),
    ).toBeUndefined()
    // And it must not refuse a real custom domain that merely is not ours.
    expect(naming.liveCustomDomain({ cname: 'acme.com' })).toBe('acme.com')
    // Ours is just another third-party name to an operator who does not
    // serve it — no longer a special case, which is what makes it config.
    expect(naming.liveCustomDomain({ cname: 'acme.aglyn.app' })).toBe(
      'acme.aglyn.app',
    )
  })

  it('AGLYN-OPERATED shape: unset still serves our own cloud unchanged', () => {
    const naming = loadWith(undefined)

    expect(naming.TENANT_APEX).toBe('aglyn.app')
    expect(naming.hostPublicOrigin({ subdomain: 'acme' })).toBe(
      'https://acme.aglyn.app',
    )
    expect(naming.liveCustomDomain({ cname: 'acme.aglyn.app' })).toBeUndefined()
  })

  it('a half-finished .env is absent, not an apex of whitespace', () => {
    // '   ' satisfies a truthiness check and would build
    // `https://acme.   ` — the shape a partly-filled file actually takes.
    expect(loadWith('   ').TENANT_APEX).toBe('aglyn.app')
    expect(loadWith('').TENANT_APEX).toBe('aglyn.app')
  })
})
