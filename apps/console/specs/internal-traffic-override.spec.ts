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
 * The browser-pinned override, and the two ways it silently stops working
 * (AGL-2065).
 *
 * AGL-2087 renamed the call these assertions read: the raw
 * `setDefaultEventParameters` now goes through the single owner
 * `setAnalyticsDefaultParams`, because `page_title` needed the same API and
 * two raw callers race each other at boot. Every property below is unchanged
 * — the clear on the negative branch is still a clear, and still has to
 * consult the override.
 *
 * `internal-traffic-flag.spec.ts` pins the CLAIMS predicate. This file pins
 * how the override composes with it, because both failure modes here type-check
 * perfectly, keep that spec green, and produce no error at runtime — they just
 * report a drill session as a paying customer, permanently, since a GA4 data
 * filter is not retroactive.
 *
 * **1. A second default-parameters call.** The obvious way to add an
 * override is a separate `if (override) setAnalyticsDefaultParams(...)` next to
 * the existing effect. It works until the token resolves — and then the claims
 * branch, which CLEARS the parameter explicitly on its negative path (the
 * console does not remount across a re-auth, AGL-664), wipes it, precisely in
 * the case the override exists for: a non-staff test account.
 *
 * That is also a RACE, not only a logic error, and the reason this is now a
 * shared invariant (AGL-2087): the raw `setDefaultEventParameters` ASSIGNS
 * rather than merges before gtag is wrapped, so two callers during boot means
 * whichever loses silently drops the other's params. AGL-2087 folds
 * `page_title` into the same composed object for that reason, written from a
 * DIFFERENT effect — which is why the raw API is now behind one merging owner
 * and this file must not name it in code at all. What is pinned here is the
 * half that is local: within this effect the parameter has exactly ONE call
 * site and every write goes through the helper in front of it, so a new
 * branch inherits the override rule without anyone remembering to.
 *
 * **2. Effect order.** The override can be read synchronously, so unlike the
 * token it can land before the console's manual `page_view`. That only holds
 * while this effect is DECLARED above the `page_view` effect — React runs them
 * in declaration order. Reordering the two is an invisible, plausible edit.
 *
 * Planted reds, verified: hoist the override into its own effect → case 1;
 * swap the two effects → case 2; replace the OR with the claims call alone →
 * the composition case.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

const LAYOUT = resolve(
  __dirname,
  '../components/layouts/firebase-app.layout.tsx',
)

/** The file explains all of this in prose; only CODE may be asserted on. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const source = stripComments(readFileSync(LAYOUT, 'utf8'))

/** The body of the effect that owns `traffic_type`, comments removed. */
function trafficEffect(): string {
  const start = source.indexOf('readInternalTrafficOverride()')
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('}, [user])', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(source.lastIndexOf('useEffect', start), end)
}


/**
 * The argument text of every `name(...)` call in `body`, by counting
 * parentheses rather than matching a regex — the calls span several lines and
 * nest object literals, and a lazy regex would silently return the first line
 * of each, which is where the `override` reference is NOT.
 */
function argumentsOf(body: string, name: string): string[] {
  const found: string[] = []
  const needle = `${name}(`
  let at = body.indexOf(needle)
  while (at !== -1) {
    let depth = 0
    let index = at + needle.length - 1
    for (; index < body.length; index += 1) {
      if (body[index] === '(') depth += 1
      else if (body[index] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    found.push(body.slice(at + needle.length, index))
    at = body.indexOf(needle, index)
  }
  return found
}

describe('the internal-traffic override (AGL-2065)', () => {
  it('reads the override once, at the top of the effect', () => {
    expect(trafficEffect()).toMatch(
      /const\s+override\s*=\s*readInternalTrafficOverride\(\)/,
    )
  })

  it('writes this parameter from exactly ONE call site, behind the owner', () => {
    // Failure mode 1, and a shared invariant rather than tidiness (AGL-2087).
    // The raw `setDefaultEventParameters` ASSIGNS rather than merges before
    // gtag is wrapped, so two callers racing during boot means whichever
    // loses silently drops the other's params — and dropping `traffic_type`
    // puts our own browsing back into the launch metrics, irreversibly. It is
    // also the logic bug: a clear that did not consult the override would
    // wipe it the moment a non-staff token resolved, which is the exact
    // session the override exists for.
    //
    // Two levels, and both are needed. The raw API is gone from this file
    // entirely — `page_title` wanted it too, from a DIFFERENT effect, which
    // is a collision no per-effect discipline can see — so every write goes
    // through the merging owner in `utils/analytics-default-params.ts`
    // (pinned by `analytics-default-params.spec.ts`). Within this effect the
    // parameter still has exactly one call site, so a fourth branch inherits
    // the override rule rather than restating it.
    expect(argumentsOf(source, 'setDefaultEventParameters')).toHaveLength(0)
    expect(
      argumentsOf(trafficEffect(), 'setAnalyticsDefaultParams'),
    ).toHaveLength(1)
    // And that one call is the composed helper, not a literal.
    expect(trafficEffect()).toMatch(
      /const\s+stamp\s*=\s*\(internal:\s*boolean\)\s*=>\s*\n?\s*setAnalyticsDefaultParams/,
    )
  })

  it('routes every write through that helper, override included', () => {
    const body = trafficEffect()
    const writes = body.match(/\bstamp\(/g) ?? []
    // Sync pre-token, resolved, rejected. Asserted as a floor so a fourth
    // path inherits the rule rather than escaping it.
    expect(writes.length).toBeGreaterThanOrEqual(3)
    for (const call of argumentsOf(body, 'stamp')) {
      expect([call, /override/.test(call)]).toEqual([call, true])
    }
  })

  it('composes with the claims predicate by OR, not instead of it', () => {
    // The override must never be able to UNFLAG a staff session either.
    expect(trafficEffect()).toMatch(
      /override\s*\|\|\s*isInternalTrafficSession\(/,
    )
  })

  it('stamps from the override alone, before the token is read', () => {
    const body = trafficEffect()
    const firstWrite = body.indexOf('stamp(override)')
    const tokenRead = body.indexOf('getIdTokenResult')
    expect(firstWrite).toBeGreaterThan(-1)
    expect(tokenRead).toBeGreaterThan(-1)
    // A token read cannot be made synchronous, so the claims path keeps
    // AGL-1582's accepted first-hit race. The override path need not.
    expect(firstWrite).toBeLessThan(tokenRead)
  })

  it('is declared above the page_view effect, which is what makes that work', () => {
    // Failure mode 2. React runs effects in declaration order; below the
    // page_view effect the synchronous stamp would arrive one hit too late.
    const traffic = source.indexOf('readInternalTrafficOverride()')
    const pageView = source.indexOf("'page_view'")
    expect(traffic).toBeGreaterThan(-1)
    expect(pageView).toBeGreaterThan(-1)
    expect(traffic).toBeLessThan(pageView)
  })

  it('never spells the GA parameter as a bare string', () => {
    // It has to agree with a setting in the GA UI that nothing here can
    // typecheck against, so there is exactly one definition of it and this
    // file is not allowed to be the second.
    expect(source).not.toMatch(/setAnalyticsDefaultParams\(\{\s*traffic_type:/)
  })
})
