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
 * AGL-1979 — every Firebase Analytics binding in the console is behind ONE
 * gate, and the gate is a mount, not a habit.
 *
 * `useAnalytics()` is typed as always returning an `Analytics` and
 * strictNullChecks is off repo-wide, so a call site that forgets the
 * possibility of `undefined` type-checks perfectly and then throws
 * `Cannot read properties of undefined (reading 'app')` out of an effect —
 * the top Cloud Error Reporting group, still firing on app.aglyn.com.
 *
 * The first attempt at this (526608b9) guarded the transport registration
 * with an `if (!analytics) return` and left the four
 * `logEvent`/`setUserId`/`setUserProperties` sites below it bare. That is the
 * failure mode of a per-call-site guard: it gets half applied, and the half
 * that is missing looks exactly like the half that is not. So what is pinned
 * here is the STRUCTURE — the bindings live in a child component that is only
 * mounted when there is an instance — because that is the property a new call
 * site inherits without anyone remembering to.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

const LAYOUT = resolve(
  __dirname,
  '../components/layouts/firebase-app.layout.tsx',
)

/** Comments describe these APIs at length; only CODE is being asserted on. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/**
 * The gating parent's body — from its declaration to the bindings component's.
 * Imports sit above it and would otherwise read as call sites.
 */
function gateSource(source: string): string {
  const start = source.indexOf('function AnalyticsGlobalEvents')
  const end = source.indexOf('function AnalyticsBindings')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return stripComments(source.slice(start, end))
}

describe('the analytics instance gate (AGL-1979)', () => {
  const source = readFileSync(LAYOUT, 'utf8')

  it('mounts the bindings only when there is an instance to bind to', () => {
    expect(gateSource(source)).toMatch(
      /\{\s*analytics\s*\?\s*<AnalyticsBindings\s+analytics=\{analytics\}\s*\/>\s*:\s*null\s*\}/,
    )
  })

  it('leaves NO firebase-analytics call outside that gate', () => {
    // The regression proper. Each of these threw a TypeError on every mount
    // and every route change for any visitor whose Analytics failed to
    // initialize; `logEvent` was the one Zach hit on /admin/users.
    const ungated = gateSource(source)

    expect(ungated).not.toMatch(/logEvent\s*\(/)
    expect(ungated).not.toMatch(/setUserId\s*\(/)
    expect(ungated).not.toMatch(/setUserProperties\s*\(/)
    expect(ungated).not.toMatch(/setDefaultEventParameters\s*\(/)
    // The transport closes over the instance and `deliver()` commits to it
    // before it can fail, so registering one that cannot deliver is worse
    // than registering none (AGL-1516).
    expect(ungated).not.toMatch(/configureAnalyticsTransport\s*\(/)
  })

  it('every analytics import is actually used inside the gated child', () => {
    // Guards the inverse mistake: deleting the bindings component and
    // leaving the imports, or re-adding a call site to the parent under a
    // different name.
    const bindings = stripComments(
      source.slice(source.indexOf('function AnalyticsBindings')),
    )

    for (const api of [
      'logEvent',
      'setUserId',
      'setUserProperties',
      'setDefaultEventParameters',
      'configureAnalyticsTransport',
    ]) {
      expect(bindings).toContain(`${api}(`)
    }
  })
})
