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
 * `Referrer-Policy` and `Permissions-Policy` on every console response
 * (AGL-2646).
 *
 * Measured on 2026-09-07: the console sent HSTS, `nosniff`, COOP and its
 * nonce'd CSP, and neither of these. Both ride the shared static block in
 * `with-aglyn.nextjs.config.js`, which is what makes this spec necessary on
 * the console side too: `apps/tenant/specs/platform-fingerprint-headers.spec.ts`
 * asserts the TENANT's config, and a console `next.config.js` that grew a
 * `headers()` of its own, or stopped wrapping with `withAglyn`, would drop
 * both here while that spec stayed green.
 *
 * Read from the config the console actually ships rather than grepped out of
 * the shared file, for the reason that spec gives: a grep passes just as
 * happily against a config that no longer emits any headers.
 */

// The console config vendors Monaco into `public/` at load (AGL-1779). That
// is a build step, not a test fixture; a unit test must not write into the
// checkout to read a header list.
jest.mock('../../../tools/scripts/lib/sync-monaco-assets', () => ({
  syncMonacoAssets: jest.fn(),
}))

import { readFileSync } from 'fs'
import { resolve } from 'path'

/** The console's own config, i.e. the one Vercel builds. */
const nextConfigPhase = require('../next.config.js')

type HeaderRule = { source: string; headers: { key: string; value: string }[] }

/**
 * `@nx/next`'s plugin exports the PHASE function, not the config object, so
 * the config only exists once that function is invoked.
 */
const shippedHeaderRules = async (): Promise<HeaderRule[]> => {
  const config = await nextConfigPhase('phase-production-build', {
    defaultConfig: {},
  })
  return (await config.headers()) as HeaderRule[]
}

/** The value the rule covering EVERY path sends for one header, or `''`. */
const shippedSiteWideValue = async (key: string): Promise<string> =>
  (await shippedHeaderRules())
    .find((rule) => rule.source === '/(.*)')
    ?.headers.find((header) => header.key.toLowerCase() === key.toLowerCase())
    ?.value ?? ''

describe('the console static security headers (AGL-2646)', () => {
  it('CONTROL — the config still emits the security headers', async () => {
    // Without this every assertion below could pass against a `headers()`
    // that returns `[]` — the same shape the tenant spec guards against.
    expect(await shippedSiteWideValue('X-Content-Type-Options')).toBe('nosniff')
    expect(await shippedSiteWideValue('Strict-Transport-Security')).toMatch(
      /max-age=\d+/,
    )
  })

  it('sends a Referrer-Policy on every path', async () => {
    expect(await shippedSiteWideValue('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin',
    )
  })

  it('denies the features nothing in the console reads', async () => {
    const policy = await shippedSiteWideValue('Permissions-Policy')

    for (const feature of ['camera', 'microphone', 'geolocation', 'usb']) {
      expect(policy).toContain(`${feature}=()`)
    }
  })

  it('keeps the Payment Request API for the billing PaymentElement', async () => {
    // `billing-card-form.component.tsx` mounts `<PaymentElement>`; its iframe
    // asks for `payment` through `allow`, and the delegation is only honoured
    // when this document holds the feature itself.
    const policy = await shippedSiteWideValue('Permissions-Policy')

    expect(policy).toContain('payment=(self)')
    expect(policy).not.toContain('payment=()')
  })

  it('keeps the clipboard the console writes keys and URLs to', async () => {
    // Premise guard, read from source: the copy buttons are what make a
    // `clipboard-write=()` here a regression rather than a tightening.
    const source = readFileSync(
      resolve(__dirname, '../components/org-api-keys-card.component.tsx'),
      'utf8',
    )
    expect(source).toContain('navigator.clipboard.writeText')

    expect(await shippedSiteWideValue('Permissions-Policy')).not.toContain(
      'clipboard-write=()',
    )
  })

  it('the middleware sets neither, so the static values are what ships', () => {
    // A header the middleware SET would win over the static rule, and a
    // stricter `Referrer-Policy` there would blank `Origin` on the console's
    // own form posts. It sets the CSP, COOP and the reporting endpoint, and
    // nothing else that these two could collide with.
    const middleware = readFileSync(resolve(__dirname, '../middleware.ts'), 'utf8')

    expect(middleware).not.toMatch(/['"]Referrer-Policy['"]/)
    expect(middleware).not.toMatch(/['"]Permissions-Policy['"]/)
  })
})
