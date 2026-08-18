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
 * `internal-traffic-flag.spec.ts` pins the CLAIMS predicate. This file pins
 * how the override composes with it, because both failure modes here type-check
 * perfectly, keep that spec green, and produce no error at runtime — they just
 * report a drill session as a paying customer, permanently, since a GA4 data
 * filter is not retroactive.
 *
 * **1. A second `setDefaultEventParameters` call.** The obvious way to add an
 * override is a separate `if (override) setDefaultEventParameters(...)` next to
 * the existing effect. It works until the token resolves — and then the claims
 * branch, which CLEARS the parameter explicitly on its negative path (the
 * console does not remount across a re-auth, AGL-664), wipes it. The wipe
 * happens precisely in the case the override exists for: a non-staff test
 * account. So every `setDefaultEventParameters` in the effect is required to
 * account for the override, which is asserted structurally rather than
 * behaviourally because it is a property of ALL of them, including ones not
 * written yet.
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

  it('leaves NO clear of the parameter that ignores the override', () => {
    // Failure mode 1, stated as the property that actually matters: a call
    // that can set the parameter to `undefined` must consult `override`
    // first. Otherwise it deletes the stamp the moment a non-staff token
    // resolves — which is the exact session the override exists for.
    const calls = argumentsOf(trafficEffect(), 'setDefaultEventParameters')
    // Three today (no-account, resolved, rejected); asserted over however
    // many there turn out to be, so a fourth inherits the rule.
    expect(calls.length).toBeGreaterThanOrEqual(3)
    const clears = calls.filter((call) => /undefined/.test(call))
    expect(clears.length).toBeGreaterThanOrEqual(3)
    for (const call of clears) {
      expect([call, /override/.test(call)]).toEqual([call, true])
    }
  })

  it('stamps from the override alone, before any token exists', () => {
    // The other half: at least one call must be reachable with no account at
    // all, which is what covers a signed-out console tab and the window
    // before sign-in completes.
    expect(trafficEffect()).toMatch(
      /if\s*\(override\)\s*\{?\s*setDefaultEventParameters/,
    )
  })

  it('composes with the claims predicate by OR, not instead of it', () => {
    // The override must never be able to UNFLAG a staff session either.
    expect(trafficEffect()).toMatch(
      /override\s*\|\|\s*isInternalTrafficSession\(/,
    )
  })

  it('sets the parameter from the override BEFORE awaiting the token', () => {
    const body = trafficEffect()
    const firstSet = body.indexOf('setDefaultEventParameters')
    const tokenRead = body.indexOf('getIdTokenResult')
    expect(firstSet).toBeGreaterThan(-1)
    expect(tokenRead).toBeGreaterThan(-1)
    // A token read cannot be made synchronous, so the claims path keeps
    // AGL-1582's accepted first-hit race. The override path need not.
    expect(firstSet).toBeLessThan(tokenRead)
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
    expect(source).not.toMatch(/setDefaultEventParameters\(\{\s*traffic_type:/)
  })
})
