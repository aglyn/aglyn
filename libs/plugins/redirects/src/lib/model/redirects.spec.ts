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

  it('compiles ordinary redirect patterns', () => {
    expect(compileRedirectRegex('/product/(\\d+)')).not.toBeNull()
    expect(compileRedirectRegex('/old/(.*)')).not.toBeNull()
    expect(compileRedirectRegex('^/blog/[a-z0-9-]+$')).not.toBeNull()
    // Patterns the old AGL-505 star-height heuristic refused. They are
    // accepted now because the engine underneath them is linear-time, so
    // there is nothing left for them to exploit -- see the timing spec below.
    expect(compileRedirectRegex('(a+)+')).not.toBeNull()
    expect(compileRedirectRegex('([a-z]*)*')).not.toBeNull()
    expect(compileRedirectRegex('/old/(.*)+')).not.toBeNull()
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

/**
 * SEC-M8 (AGL-1881): host redirect regexes are attacker-authored and run on
 * the tenant render path in the process shared by every tenant, so the cost
 * of matching one has to be bounded for EVERY input, not just for the
 * pattern shapes someone thought to look for.
 *
 * The AGL-505 star-height guard these replace accepted `(a|a|aa)+` — nine
 * characters — and matching it against a 27-character path took 59 s,
 * roughly x5.8 for every two further characters. Against the pattern used
 * below the old code does not finish at all.
 */
describe('redirect regex matching is linear-time (SEC-M8)', () => {
  const { compileRedirectRegex, matchRedirect, validateRedirectRule } =
    require('./redirects')

  /**
   * Generous on purpose: the fix completes in well under a millisecond, and
   * a CI box under load must not turn that into a flake. Anything anywhere
   * near this budget means backtracking is back.
   */
  const BUDGET_MS = 2000

  const timed = (run: () => unknown): number => {
    const started = Date.now()
    run()
    return Date.now() - started
  }

  it(
    'matches the catastrophic-backtracking pattern in bounded time',
    () => {
      // The exact pattern from the audit. The old guard let it through.
      const pattern = compileRedirectRegex('(a|a|aa)+')
      expect(pattern).not.toBeNull()

      // The attack input: a run of `a` that the pattern can decompose an
      // exponential number of ways, then one character that forces every
      // one of those decompositions to be tried and fail.
      const attack = `${'a'.repeat(32)}!`

      const elapsed = timed(() => {
        expect(pattern.exec(attack)).toBeNull()
      })
      expect(elapsed).toBeLessThan(BUDGET_MS)
    },
    15000,
  )

  it(
    'stays bounded through the whole matcher, at the longest allowed path',
    () => {
      // Reached the way a real request reaches it: a stored rule, matched by
      // `matchRedirect`, at the 500-character ceiling `normalizeRedirectSource`
      // allows. Several classic ReDoS shapes at once.
      // NOTE the leading `/` in every source. Without it the anchored
      // pattern fails on the path's first character and never reaches the
      // exponential part -- a way to write this test so it passes against
      // the vulnerable code too.
      const rules = [
        { source: '/(a|a|aa)+', destination: '/x', statusCode: 302, kind: 'regex' },
        { source: '/(a+)+', destination: '/y', statusCode: 302, kind: 'regex' },
        { source: '/([a-z]*)*', destination: '/z', statusCode: 302, kind: 'regex' },
        { source: '/(x+x+)+y', destination: '/w', statusCode: 302, kind: 'regex' },
      ]
      const attack = `/${'a'.repeat(498)}!`
      expect(attack.length).toBe(500)

      const elapsed = timed(() => {
        expect(matchRedirect(rules, attack)).toBeNull()
      })
      expect(elapsed).toBeLessThan(BUDGET_MS)
    },
    15000,
  )

  it('negative control: an ordinary pattern still works, and is still fast', () => {
    const rules = [
      {
        source: '/product/(\\d+)',
        destination: '/products/item-$1',
        statusCode: 301,
        kind: 'regex',
      },
      {
        source: '^/blog/(\\d{4})/([a-z0-9-]+)$',
        destination: '/articles/$2?year=$1',
        statusCode: 302,
        kind: 'regex',
      },
    ]

    const elapsed = timed(() => {
      // Captures substitute exactly as they did under `RegExp`.
      expect(matchRedirect(rules, '/product/12345')).toMatchObject({
        destination: '/products/item-12345',
        statusCode: 301,
      })
      expect(matchRedirect(rules, '/blog/2026/hello-world')).toMatchObject({
        destination: '/articles/hello-world?year=2026',
        statusCode: 302,
      })
      // Non-matches stay non-matches.
      expect(matchRedirect(rules, '/product/abc')).toBeNull()
      expect(matchRedirect(rules, '/blog/26/x')).toBeNull()
    })
    // 1000 legitimate matches' worth of headroom for four of them.
    expect(elapsed).toBeLessThan(BUDGET_MS)
  })

  it('refuses syntax that cannot be matched in linear time', () => {
    // Not a shape heuristic: the parser has no production for these, so
    // there is no path by which one could reach a matcher.
    for (const source of [
      '(?=/admin)/x', // lookahead
      '(?!/x)/y', // negative lookahead
      '(?<=/a)/b', // lookbehind
      '(/a)\\1', // backreference
      '(?<name>/a)', // named group
    ]) {
      expect(compileRedirectRegex(source)).toBeNull()
      const problem = validateRedirectRule({
        kind: 'regex',
        source,
        destination: '/x',
      })
      // The author is told which construct is unavailable, not "invalid".
      expect(problem).toMatch(/can't be used/)
    }
  })

  it('bounds compiled program size so bounded repeats cannot blow up', () => {
    // `{n}` is expanded, so the repeat counts are what needs a ceiling —
    // a resource bound on an engine that is already linear, not a guess
    // about which patterns are dangerous.
    expect(compileRedirectRegex('(\\d{99}){99}')).toBeNull()
    expect(compileRedirectRegex('a{500}')).toBeNull()
    // Ordinary bounded repeats are unaffected.
    expect(compileRedirectRegex('/p/(\\d{1,8})')).not.toBeNull()
  })
})
