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
 * AGL-2486 — the continue URL is carried, and carrying it is not an open
 * redirect.
 *
 * A `continue` that survives a hop through an EXTERNAL identity provider is
 * the textbook phishing primitive: the attacker's URL comes back wearing our
 * origin's clothes, and the app redirects to it with a freshly minted
 * session. So the predicate that guards it is tested here as a predicate —
 * separately from the pages, because the pages can only ever exercise the
 * handful of values they happen to build.
 *
 * The backslash case is the one that was actually WRONG before this issue and
 * is the reason this file exists rather than a comment. `/\evil.com` starts
 * with a single `/`, so it passed the old shape test, and both `new URL()`
 * and `window.location.assign` resolve it to `https://evil.com/` because the
 * URL parser treats `\` as `/` in the authority position. The first assertion
 * below is a live demonstration of that resolution, not a claim about it — if
 * a future runtime stops normalizing, that line fails and tells us.
 */

import {
  isSafeContinueUrl,
  withContinueUrl,
} from '@aglyn/shared-util-next'

describe('a continue URL that leaves the origin is refused', () => {
  it('resolves a backslash form off-site — the reason it is rejected', () => {
    // Not a rule under test; the runtime behaviour the rule exists for.
    expect(new URL('/\\evil.com', 'https://app.aglyn.com').href).toBe(
      'https://evil.com/',
    )
  })

  it.each([
    ['protocol-relative', '//evil.com'],
    ['protocol-relative with a path', '//evil.com/steal'],
    ['an absolute off-origin URL', 'https://evil.com/steal'],
    ['an http absolute', 'http://app.aglyn.com/orgs'],
    ['a javascript: scheme', 'javascript:alert(document.cookie)'],
    ['a data: scheme', 'data:text/html,<script>alert(1)</script>'],
    ['a backslash authority', '/\\evil.com'],
    ['a mixed slash-backslash authority', '/\\/evil.com'],
    ['a lookalike suffix host', 'https://evilaglyn.com/steal'],
    ['the empty string', ''],
    // AGL-1881. The backslash list above was correct and incomplete: the
    // WHATWG parser DELETES tab, LF and CR before it parses, so each of these
    // resolves to `https://evil.com/` while containing neither `//` nor `\`.
    // The predicate now resolves and compares origins instead of reading
    // characters, which is why these pass without a fourth character being
    // added to a list. The exhaustive, generated proof lives beside the
    // predicate in `libs/shared/util/http/src/lib/safe-redirect.spec.ts`.
    ['a tab in the authority', '/\t/evil.com'],
    ['a newline in the authority', '/\n/evil.com'],
    ['a carriage return in the authority', '/\r/evil.com'],
    ['a tab concealing a backslash authority', '/\t\\evil.com'],
    ['a CRLF pair in the authority', '/\r\n/evil.com'],
  ])('refuses %s', (_label, url) => {
    expect(isSafeContinueUrl(url)).toBe(false)
  })

  it.each([
    ['/\t/evil.com'],
    ['/\n/evil.com'],
    ['/\r/evil.com'],
    ['/\t\\evil.com'],
  ])(
    'resolves %j off-site — the runtime behaviour those rejections exist for',
    (url) => {
      // Not a rule under test, and not a claim about the parser: a live
      // demonstration. If a future runtime stops stripping these characters,
      // this line fails and tells us the guard is now stricter than it needs
      // to be, rather than the reverse.
      expect(new URL(url, 'https://app.aglyn.com').origin).toBe(
        'https://evil.com',
      )
    },
  )

  /**
   * `strictNullChecks` is OFF repo-wide, so an absent `continue` reaches this
   * predicate as a real value at runtime however the types read. It must
   * ANSWER, not throw: a TypeError here escapes into a render and takes the
   * sign-in page down, which is a worse outage than the redirect bug this
   * issue started from.
   *
   * The empty string alone does not prove the guard — `''.startsWith('/')` is
   * false and `new URL('')` throws into the same `catch`, so it is refused
   * with or without it. `null`/`undefined` are what the guard is for.
   */
  it.each([[null], [undefined]])('answers false for %p instead of throwing', (
    absent,
  ) => {
    expect(isSafeContinueUrl(absent as unknown as string)).toBe(false)
    expect(withContinueUrl('/sso', absent as unknown as string)).toBe('/sso')
  })

  it.each([
    ['a legitimate deep link', '/orgs/acme/sites/homepage'],
    ['a deep link with a query and fragment', '/orgs/acme?tab=pages#hero'],
    ['a same-site workspace absolute', 'https://acme.aglyn.com/sites'],
    ['the workspace apex', 'https://aglyn.com/pricing'],
  ])('allows %s', (_label, url) => {
    expect(isSafeContinueUrl(url)).toBe(true)
  })
})

describe('forwarding the continue URL onto another auth route', () => {
  it('carries a legitimate deep link, encoded exactly once', () => {
    const href = withContinueUrl('/sso', '/orgs/acme?tab=pages#hero')
    expect(href).toBe('/sso?continue=%2Forgs%2Facme%3Ftab%3Dpages%23hero')
    // The receiving page reads it back through `searchParams.get`, which
    // percent-decodes once. Round-tripping is the property that matters, not
    // the literal above.
    expect(
      new URL(`https://app.aglyn.com${href}`).searchParams.get('continue'),
    ).toBe('/orgs/acme?tab=pages#hero')
  })

  it('appends to a path that already carries a query', () => {
    expect(withContinueUrl('/signup?plan=pro', '/orgs/acme')).toBe(
      '/signup?plan=pro&continue=%2Forgs%2Facme',
    )
  })

  it.each([
    ['//evil.com'],
    ['https://evil.com/steal'],
    ['javascript:alert(1)'],
    ['/\\evil.com'],
    [''],
  ])('drops %s rather than laundering it one hop further', (url) => {
    // The link still works — it just goes to the plain destination. Silently
    // degrading beats propagating, because the value has already been
    // rejected once by whatever page tried to read it.
    expect(withContinueUrl('/sso', url)).toBe('/sso')
  })
})
