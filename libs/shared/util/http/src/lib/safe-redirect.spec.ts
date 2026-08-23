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
 * AGL-1881 — the redirect guard agrees with the URL parser, by construction.
 *
 * ## Why this file is generative and the one it replaces was not
 *
 * The predicate this supersedes was guarded by a hand-written list of tricks
 * to reject, and the list passed for months while being wrong. AGL-2486 added
 * the backslash to it. The list was still missing tab, LF and CR — which the
 * WHATWG parser deletes from the input BEFORE parsing, so they hide the
 * protocol-relative form from any test that reads the raw characters.
 *
 * A list of payloads someone thought of can only ever prove the payloads
 * someone thought of. So the load-bearing test here does not assert a list: it
 * BUILDS a corpus by inserting each parser-stripped character at each position
 * of a known-hostile authority, and asserts that the guard's verdict matches
 * what `new URL()` actually resolves to — for every one. A future runtime that
 * starts or stops normalizing some form changes both sides together and the
 * test stays honest; a guard that drifts from the parser fails immediately.
 *
 * The explicit cases are kept underneath as documentation of the specific
 * shapes that were once live, not as the proof.
 */

import { isSameOriginPath, safeSameOriginPath } from './safe-redirect'

/** Any origin works; this one is what the implementation resolves against. */
const PROBE = 'https://redirect-probe.aglyn.invalid'

/** What a navigation would actually reach — the ground truth both sides face. */
function resolvesOffOrigin(candidate: string): boolean {
  try {
    return new URL(candidate, PROBE).origin !== PROBE
  } catch {
    // Unparseable is not a same-origin path either.
    return true
  }
}

describe('the guard tracks the URL parser rather than a list of tricks', () => {
  /**
   * The corpus: every parser-stripped character, inserted at every position of
   * `//evil.example` and `/\evil.example`, plus the untouched originals. ~90
   * payloads, none of them chosen by hand.
   */
  const stripped = ['\t', '\n', '\r']
  const authorities = ['//evil.example', '/\\evil.example', '/evil.example']
  const corpus: string[] = []
  for (const authority of authorities) {
    corpus.push(authority)
    for (const char of stripped) {
      for (let at = 0; at <= authority.length; at += 1) {
        corpus.push(authority.slice(0, at) + char + authority.slice(at))
      }
    }
  }

  it('builds a corpus that actually contains off-origin resolutions', () => {
    // Guards the guard: if the corpus were all benign, every assertion below
    // would pass vacuously and prove nothing.
    const hostile = corpus.filter(resolvesOffOrigin)
    expect(hostile.length).toBeGreaterThan(10)
    // And it must contain the specific shape no character-list test caught.
    expect(hostile).toContain('/\t/evil.example')
  })

  it.each(corpus.map((c) => [JSON.stringify(c), c]))(
    'agrees with the parser on %s',
    (_label, candidate) => {
      expect(isSameOriginPath(candidate)).toBe(!resolvesOffOrigin(candidate))
    },
  )

  it('never returns a value that resolves off-origin', () => {
    for (const candidate of corpus) {
      const settled = safeSameOriginPath(candidate, '/fallback')
      expect(resolvesOffOrigin(settled)).toBe(false)
    }
  })
})

describe('the shapes that were live before this issue', () => {
  it('resolves a tab-in-authority form off-site — the reason it is rejected', () => {
    // Not a rule under test; the runtime behaviour the rule exists for. The
    // input contains neither `//` nor `\`, which is precisely how it survived
    // every previous version of this guard.
    expect(new URL('/\t/evil.example', 'https://console.acme.com').href).toBe(
      'https://evil.example/',
    )
  })

  it.each([
    ['a tab between the slashes', '/\t/evil.example'],
    ['a newline between the slashes', '/\n/evil.example'],
    ['a carriage return between the slashes', '/\r/evil.example'],
    ['a tab hiding a backslash authority', '/\t\\evil.example'],
    ['a CRLF pair', '/\r\n/evil.example'],
    ['protocol-relative', '//evil.example'],
    ['a backslash authority', '/\\evil.example'],
    ['a mixed slash-backslash authority', '/\\/evil.example'],
    ['an absolute off-origin URL', 'https://evil.example/steal'],
    ['a javascript: scheme', 'javascript:alert(document.cookie)'],
    ['a data: scheme', 'data:text/html,<script>alert(1)</script>'],
    ['a bare relative path with no leading slash', 'evil'],
    ['the empty string', ''],
  ])('refuses %s', (_label, candidate) => {
    expect(isSameOriginPath(candidate)).toBe(false)
    expect(safeSameOriginPath(candidate, '/fallback')).toBe('/fallback')
  })

  it.each([
    ['a plain path', '/orgs/acme/sites'],
    ['a path with query and fragment', '/orgs/acme?tab=pages#hero'],
    ['the root', '/'],
    ['a path containing an encoded backslash', '/orgs/%5Cacme'],
    ['a path whose LATER segment holds a tab', '/orgs/acme\tsites'],
  ])('allows %s', (_label, candidate) => {
    expect(isSameOriginPath(candidate)).toBe(true)
  })
})

describe('it answers rather than throwing', () => {
  /**
   * `strictNullChecks` is off repo-wide, so an absent query parameter reaches
   * this predicate as a real runtime value however the types read. A TypeError
   * escaping into a sign-in render is a worse outage than the redirect bug.
   */
  it.each([[null], [undefined], [42], [{}], [[]]])(
    'answers false for %p',
    (absent) => {
      expect(isSameOriginPath(absent as unknown as string)).toBe(false)
      expect(safeSameOriginPath(absent as unknown as string)).toBe('/')
    },
  )

  it('returns the trimmed value it validated, not the raw one', () => {
    // Handing back the untrimmed original would mean the string that was
    // checked is not the string that gets navigated to.
    expect(safeSameOriginPath('  /orgs/acme  ')).toBe('/orgs/acme')
  })

  it('uses the caller fallback, defaulting to the site root', () => {
    expect(safeSameOriginPath('//evil.example')).toBe('/')
    expect(safeSameOriginPath('//evil.example', '/account')).toBe('/account')
  })
})
