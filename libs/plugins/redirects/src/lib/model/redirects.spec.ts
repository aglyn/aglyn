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
  isSelfRedirect,
  normalizeRedirectDestination,
  normalizeRedirectSource,
} from './redirects'

describe('normalizeRedirectSource', () => {
  it('normalizes case, slashes, and query strings', () => {
    expect(normalizeRedirectSource('Old-Page/')).toBe('/old-page')
    expect(normalizeRedirectSource('/A/B/?utm=x')).toBe('/a/b')
    expect(normalizeRedirectSource('/')).toBe('/')
  })

  it('rejects absolute URLs and junk', () => {
    expect(normalizeRedirectSource('https://example.com/x')).toBeNull()
    expect(normalizeRedirectSource('//evil.com')).toBeNull()
    expect(normalizeRedirectSource('  ')).toBeNull()
    expect(normalizeRedirectSource('/has space')).toBeNull()
  })
})

describe('normalizeRedirectDestination', () => {
  it('accepts internal paths and https URLs', () => {
    expect(normalizeRedirectDestination('/pricing/')).toBe('/pricing')
    expect(normalizeRedirectDestination('https://example.com/x')).toBe(
      'https://example.com/x',
    )
  })

  it('rejects http, protocol-relative, and junk', () => {
    expect(normalizeRedirectDestination('http://example.com')).toBeNull()
    expect(normalizeRedirectDestination('//example.com')).toBeNull()
    expect(normalizeRedirectDestination('javascript:alert(1)')).toBeNull()
  })
})

describe('isSelfRedirect', () => {
  it('catches loops onto the same path, case-insensitively', () => {
    expect(
      isSelfRedirect({ source: '/old', destination: '/Old/' }),
    ).toBe(true)
    expect(
      isSelfRedirect({ source: '/old', destination: '/new' }),
    ).toBe(false)
    expect(
      isSelfRedirect({
        source: '/old',
        destination: 'https://example.com/old',
      }),
    ).toBe(false)
  })
})

describe('matchRedirect (v2, AGL-375)', () => {
  const { matchRedirect, validateRedirectRule, compileRedirectRegex } =
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('./redirects')

  it('matches exact, prefix (segment boundary), and regex with captures', () => {
    const rules = [
      { source: '/old', destination: '/new', statusCode: 301, kind: 'exact' },
      {
        source: '/blog',
        destination: '/articles',
        statusCode: 302,
        kind: 'prefix',
      },
      {
        source: '/product/(\\d+)',
        destination: '/products/item-$1',
        statusCode: 302,
        kind: 'regex',
      },
    ]
    expect(matchRedirect(rules, '/old')).toMatchObject({
      destination: '/new',
      statusCode: 301,
    })
    expect(matchRedirect(rules, '/blog/post-1')).toMatchObject({
      destination: '/articles',
    })
    expect(matchRedirect(rules, '/blogging')).toBeNull()
    expect(matchRedirect(rules, '/product/42')).toMatchObject({
      destination: '/products/item-42',
    })
  })

  it('rejects catastrophic-backtracking regexes but keeps normal ones (AGL-505)', () => {
    // Nested quantifiers (star height > 1) are the ReDoS sources.
    expect(compileRedirectRegex('(a+)+')).toBeNull()
    expect(compileRedirectRegex('([a-z]*)*')).toBeNull()
    expect(compileRedirectRegex('((\\d+))+')).toBeNull()
    expect(compileRedirectRegex('/old/(.*)+')).toBeNull()
    expect(validateRedirectRule({ kind: 'regex', source: '(a+)+', destination: '/x' })).not.toBeNull()
    // Ordinary redirect patterns still compile.
    expect(compileRedirectRegex('/product/(\\d+)')).not.toBeNull()
    expect(compileRedirectRegex('/old/(.*)')).not.toBeNull()
    expect(compileRedirectRegex('^/blog/[a-z0-9-]+$')).not.toBeNull()
  })

  it('honors priority order and skips disabled rules', () => {
    const rules = [
      {
        source: '/a',
        destination: '/low',
        statusCode: 302,
        kind: 'exact',
        priority: 200,
      },
      {
        source: '/a',
        destination: '/high',
        statusCode: 302,
        kind: 'exact',
        priority: 1,
      },
      {
        source: '/a',
        destination: '/off',
        statusCode: 302,
        kind: 'exact',
        priority: 0,
        enabled: false,
      },
    ]
    expect(matchRedirect(rules, '/a')?.destination).toBe('/high')
  })

  it('never fires a rule that would redirect the path onto itself', () => {
    const rules = [
      {
        source: '/loop(.*)',
        destination: '/loop$1',
        statusCode: 302,
        kind: 'regex',
      },
    ]
    expect(matchRedirect(rules, '/loop')).toBeNull()
  })

  it('validates rules per kind and rejects bad regexes', () => {
    expect(
      validateRedirectRule({
        kind: 'regex',
        source: '/ok/(\\d+)',
        destination: '/n/$1',
      }),
    ).toBeNull()
    expect(
      validateRedirectRule({
        kind: 'regex',
        source: '(unclosed',
        destination: '/n',
      }),
    ).toBeTruthy()
    expect(compileRedirectRegex('(unclosed')).toBeNull()
  })
})
