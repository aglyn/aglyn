/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
 *
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
 * No platform fingerprint in the STATIC header config (AGL-2088).
 *
 * `with-aglyn.nextjs.config.js` used to append `x-aglyn-package-version` and
 * `x-aglyn-process-version` to a `source: '/(.*)'` rule, so every response
 * from every published customer site disclosed the platform and its version.
 * Measured against production on 2026-08-18:
 *
 *     $ curl -sSI https://aglyn.com/
 *     x-aglyn-package-version: 1.0.0-alpha.0
 *     x-aglyn-process-version: v24.15.0
 *
 * WHY THIS LAYER CAN NEVER CARRY THE GATE, and therefore why the test is
 * "absent", not "absent when white-labelled": `headers()` in a Next config is
 * evaluated ONCE at build time and compiled into a static route rule. There is
 * no request, no host and no org — the `whiteLabel` entitlement is not merely
 * inconvenient to read here, it does not exist here. A future reader who wants
 * to re-add a version header "just for non-white-label sites" cannot do it in
 * this file; the host-aware header lives in the middleware.
 *
 * The list is read from the config the app actually ships rather than grepped
 * out of the source, because a grep passes just as happily against a config
 * that no longer emits ANY headers — which is why the control below asserts the
 * security headers are still there.
 */

/** The tenant's own config, i.e. the one Vercel builds. */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nextConfigPhase = require('../next.config.js')

type HeaderRule = { source: string; headers: { key: string; value: string }[] }

/**
 * `@nx/next`'s plugin exports the PHASE function, not the config object, so the
 * config only exists once that function is invoked. Calling `.headers()` on the
 * export directly throws `not a function` — which would fail loudly, but a
 * `try`/`catch` or an optional call around it would turn this whole file into a
 * suite that passes because it measured nothing.
 */
const shippedHeaderKeys = async (): Promise<string[]> => {
  const config = await nextConfigPhase('phase-production-build', {
    defaultConfig: {},
  })
  const rules = (await config.headers()) as HeaderRule[]
  return rules.flatMap((rule) => rule.headers.map((header) => header.key))
}

describe('the static header config (AGL-2088)', () => {
  it('CONTROL — it still emits the security headers', async () => {
    // Without this every assertion below passes against a `headers()` that
    // returns `[]`, which is a security regression wearing the shape of the
    // fix. Verified to fail on purpose by returning `[]` from `headers()`.
    const keys = await shippedHeaderKeys()

    expect(keys).toContain('X-Content-Type-Options')
    expect(keys).toContain('Strict-Transport-Security')
  })

  it('discloses no Aglyn package or process version', async () => {
    const keys = await shippedHeaderKeys()

    expect(keys).not.toContain('x-aglyn-package-version')
    expect(keys).not.toContain('x-aglyn-process-version')
  })

  it('emits NO `x-aglyn-*` header at all from this layer', async () => {
    // Broader than the two names on purpose. The defect is not those specific
    // strings; it is that a build-time rule cannot consult the `whiteLabel`
    // entitlement, so ANY Aglyn-identifying header added here ships to every
    // white-labelled site by construction.
    const keys = await shippedHeaderKeys()

    expect(keys.filter((key) => /^x-aglyn-/i.test(key))).toEqual([])
  })
})
