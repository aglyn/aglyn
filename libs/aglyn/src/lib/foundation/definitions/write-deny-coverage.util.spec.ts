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
 * `readFieldsOf` collects only real document fields (AGL-1719).
 *
 * The write-deny coverage guards (AGL-1355, AGL-1361) derive half their field
 * universe by scanning `libs/aglyn/src/lib/app-utils` for `host.<name>`. That
 * scan matches on the identifier NAME and has no idea what the binding holds,
 * so an unrelated local of the same name contributes its property reads too.
 *
 * AGL-1701 shipped `isFirstPartyHost(host: string)` whose body is
 * `host.toLowerCase()` — a hostname string, not the site document — and the
 * guard went red on main demanding that a `String.prototype` method be
 * classified as server-owned or client-writable.
 *
 * These tests pin the two halves that matter, and they are the reason the fix
 * was not an exclusion list: the ASSERTIONS name prototype methods, the
 * PRODUCTION code does not. A list in a test goes stale loudly; a list in the
 * scanner goes stale silently.
 */

import { readFieldsOf } from './write-deny-coverage.util'

/**
 * Method names taken from the REAL prototypes at test time, not hand-written.
 *
 * A hand-maintained list is the thing this guard exists to avoid, and it would
 * miss whatever method a future engine or a future local variable reaches for.
 * Derived, it cannot go stale.
 */
const PROTOTYPE_METHODS = [
  ...new Set(
    [Object.prototype, String.prototype, Array.prototype, Number.prototype]
      .flatMap((prototype) => Object.getOwnPropertyNames(prototype))
      .filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)),
  ),
]

describe('readFieldsOf ignores method calls (AGL-1719)', () => {
  it('does not collect `toLowerCase` from the exact AGL-1701 shape', () => {
    // Verbatim from libs/aglyn/src/lib/app-utils/media-ref.ts, the source of
    // the two failures this fix closes.
    const source = `
      function isFirstPartyHost(host: string): boolean {
        const lower = host.toLowerCase()
        return FIRST_PARTY_APEXES.some((apex) => lower === apex)
      }
    `
    expect(readFieldsOf([source], 'host')).toEqual([])
  })

  it('collects no prototype method, on any binding, in any call form', () => {
    // The general property, not the one name. If a future local called `host`
    // calls `.trim()`, `.at()` or `.hasOwnProperty()`, none of them is a field
    // of `hosts/{hostId}` and none may enter the universe.
    const leaked: string[] = []
    for (const method of PROTOTYPE_METHODS) {
      const sources = [
        `const a = host.${method}()`,
        `const b = host?.${method}()`,
        `const c = host.${method}?.()`,
        `if (host.${method}(x)) return null`,
      ]
      for (const field of readFieldsOf(sources, 'host')) leaked.push(field)
    }
    expect(leaked).toEqual([])
  })

  it('still collects a genuine field, including through optional chaining', () => {
    // The half that must NOT regress. A coverage guard's only real failure
    // mode is missing a field (AGL-1420), so the fix is worthless if it costs
    // a true positive.
    const source = `
      const a = host.cname
      const b = host?.subdomain
      const c = (host as { cnameAttachmentPending?: unknown }).cnameAttachmentPending
    `
    expect(readFieldsOf([source], 'host')).toEqual([
      'cname',
      'cnameAttachmentPending',
      'subdomain',
    ])
  })

  it('keeps the field when a METHOD is called on it', () => {
    // `disabledPlugins` is a real, denied host field and it is read exactly
    // this way. Only the trailing `includes` is a call; dropping the whole
    // expression would lose a genuine field and re-open AGL-1364.
    const source = `
      if (host.disabledPlugins.includes(slug)) return null
      const n = host.screens.length
    `
    expect(readFieldsOf([source], 'host')).toEqual([
      'disabledPlugins',
      'screens',
    ])
  })

  it('drops a call but not a same-named field read elsewhere', () => {
    // A name is not permanently banned — it is judged per occurrence. If some
    // document genuinely declared a field called `search`, a read of it still
    // counts even though a sibling line calls `String.prototype.search`.
    const source = `
      const a = host.search
      const b = host.search(pattern)
    `
    expect(readFieldsOf([source], 'host')).toEqual(['search'])
  })

  it('is unaffected by the binding name', () => {
    // The same scan runs for `org` and `listing`. `org` is green today only
    // because no `org.<method>()` happens to exist in that directory yet.
    expect(readFieldsOf(['const a = org.toLowerCase()'], 'org')).toEqual([])
    expect(readFieldsOf(['const a = listing.trim()'], 'listing')).toEqual([])
    expect(readFieldsOf(['const a = org.plan'], 'org')).toEqual(['plan'])
  })

  it('sees a call that wraps across lines', () => {
    // Formatting must not decide the answer: prettier wraps a long call and
    // the result is still a call, not a field.
    expect(readFieldsOf(['const a = host.toLowerCase\n  ()'], 'host')).toEqual(
      [],
    )
  })

  it('falls back to COLLECTING when it cannot tell — never to silence', () => {
    // The direction the fix fails in, stated as a test rather than claimed in
    // a comment. `host.x!()` is a call, but the lookahead does not model the
    // non-null assertion — so the name is COLLECTED and a human is made to
    // classify it, which is the old, stricter behaviour.
    //
    // That asymmetry is the whole argument for touching the scanner at all: an
    // unrecognised shape degrades to a loud false positive, never to a silent
    // false negative. A coverage guard can survive the first and is worthless
    // after the second (AGL-1420).
    expect(readFieldsOf(['const a = host.weirdShape!()'], 'host')).toEqual([
      'weirdShape',
    ])
  })
})
