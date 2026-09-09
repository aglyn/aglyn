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

import { join, resolve } from 'node:path'

/**
 * AN APP'S OWN `headers()` REACHES THE SHIPPED CONFIG (AGL-2716).
 *
 * `withAglyn` merges an app's config over the shared base with
 * `deepFillIn(AGLYN_CONFIG, userConfig)` — which fills in MISSING keys and
 * MUTATES its first argument. The base already defines `headers`, so the
 * merged object's `headers` was ALWAYS the base function, and the wrapper's
 * own `headers()` then read it back: the base rules were returned twice and
 * the app's were discarded.
 *
 * Nothing errored. An app-level `headers()` was simply inert, and had been for
 * as long as this wrapper has existed. It was found by adding a rule to
 * `apps/tenant/next.config.js` and measuring: no header on any response, and
 * no probe header beside it either.
 *
 * This spec exercises the WRAPPER rather than the tenant's config, because the
 * tenant does not currently define a `headers()` of its own — the rule that
 * found the bug turned out to be unable to do its job for a different reason
 * (Next replaces `Vary` on the page pipeline) and was removed. A guard tied to
 * a rule that no longer exists would have gone green by deletion.
 */

/*
  Resolved at RUNTIME, not by a relative specifier.

  `require('../../../with-aglyn.nextjs.config')` reaches outside the project,
  which `@nx/enforce-module-boundaries` refuses — "External resources cannot be
  imported using a relative or absolute path". `production-never-reads-the-root-env.spec.ts`
  reaches the same file the same way for the same reason.
*/
const REPO_ROOT = resolve(__dirname, '../../..')
const withAglyn = require(join(REPO_ROOT, 'with-aglyn.nextjs.config.js'))

type HeaderRule = { source: string; headers: { key: string; value: string }[] }

/** The rules a config built by `withAglyn` actually ships. */
async function shippedRules(userConfig: unknown): Promise<HeaderRule[]> {
  const phase = withAglyn(userConfig)
  const config = await phase('phase-production-build', { defaultConfig: {} })
  return (await config.headers()) as HeaderRule[]
}

describe('withAglyn header merging', () => {
  it('keeps the app’s own rule', async () => {
    const rules = await shippedRules({
      headers: async () => [
        { source: '/probe', headers: [{ key: 'x-app-rule', value: 'kept' }] },
      ],
    })
    expect(
      rules.find((rule) => rule.source === '/probe')?.headers[0],
    ).toEqual({ key: 'x-app-rule', value: 'kept' })
  })

  it('CONTROL — still ships the base security rules alongside it', async () => {
    // Without this the assertion above passes against a merge that threw the
    // BASE away instead, which is the same defect pointed the other way.
    const keys = (
      await shippedRules({
        headers: async () => [
          { source: '/probe', headers: [{ key: 'x-app-rule', value: 'kept' }] },
        ],
      })
    ).flatMap((rule) => rule.headers.map((header) => header.key))
    expect(keys).toContain('X-Content-Type-Options')
    expect(keys).toContain('Strict-Transport-Security')
  })

  it('does not duplicate the base rules when the app defines none', async () => {
    /*
      The other half of the same bug. `merged.headers` was the base function, so
      the wrapper called it a second time and returned every base rule twice —
      harmless in effect, and the visible symptom of the merge having lost the
      app's function.
    */
    const rules = await shippedRules({})
    const sources = rules.map((rule) => rule.source)
    expect(new Set(sources).size).toBe(sources.length)
  })

  it('accepts a plain array as well as a function', async () => {
    const rules = await shippedRules({
      headers: [
        { source: '/array', headers: [{ key: 'x-array-rule', value: 'kept' }] },
      ],
    })
    expect(rules.some((rule) => rule.source === '/array')).toBe(true)
  })
})
