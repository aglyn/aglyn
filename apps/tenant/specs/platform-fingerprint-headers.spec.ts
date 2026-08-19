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

/**
 * The deliberate half: `x-powered-by: Aglyn` (AGL-2088).
 *
 * Set by the middleware, which is the first layer that knows WHICH site it is
 * serving and therefore the only layer that can honour the entitlement. The
 * per-host answer rides on the lockdown verdict the middleware already fetches
 * on every request, so this costs no additional edge round trip.
 *
 * Every case is asserted from both sides, and the suppression cases outnumber
 * the emission ones on purpose. A "the header is present" test passes against
 * a middleware that sets it unconditionally — which is the defect this whole
 * issue exists to fix, rebuilt under a new name.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

import { PLATFORM_GENERATOR_NAME } from '@aglyn/aglyn/server'
import { NextRequest } from 'next/server'

/**
 * `demo.localhost:4500`, not a `*.aglyn.app` host: the production-shaped
 * branch is gated on `IS_VERCEL`, so under jest it falls through to a 307 at
 * the console and never reaches the header code at all. Asserting "no
 * x-powered-by" on THAT response passes for the wrong reason — it is a
 * redirect. The CSP control below is what tells the two apart.
 */
const MIDDLEWARE_HOST = 'demo.localhost:4500'

/** The verdict body the middleware's own `fetch` would have received. */
const givenVerdict = (body: unknown | 'unreachable') => {
  global.fetch = jest.fn(async () => {
    if (body === 'unreachable') throw new Error('verdict route unreachable')
    return {
      ok: true,
      json: async () => body,
    } as never
  }) as never
}

const middlewareHeaders = async (): Promise<Headers> => {
  // A FRESH module registry per call. The middleware memoizes verdicts per
  // isolate for 30s keyed on the host, so without this the second case in
  // this file would read the first case's answer and pass no matter what the
  // gate does.
  jest.resetModules()
  const { middleware } = await import('../middleware')
  const response = await middleware(
    new NextRequest(new URL('/', `https://${MIDDLEWARE_HOST}`), {
      headers: { host: MIDDLEWARE_HOST },
    }),
    {} as never,
  )
  if (!response || !('headers' in response)) {
    throw new Error('middleware returned no response — it redirected')
  }
  return response.headers
}

describe('the gated `x-powered-by` header (AGL-2088)', () => {
  afterEach(() => {
    delete (global as { fetch?: unknown }).fetch
  })

  it('CONTROL — the request reached the page-rewrite branch', async () => {
    // Everything below asserts the presence or absence of one header on this
    // response. If the middleware redirected instead, the absence cases would
    // all pass while measuring nothing. The enforcing CSP is set on exactly
    // the branch the header is set on, so it is the right witness.
    givenVerdict({ locked: false, attribution: true })

    expect(
      (await middlewareHeaders()).get('Content-Security-Policy'),
    ).toContain("object-src 'none'")
  })

  it('SENDS it when the verdict says the site may be attributed', async () => {
    givenVerdict({ locked: false, attribution: true })

    expect((await middlewareHeaders()).get('x-powered-by')).toBe(
      PLATFORM_GENERATOR_NAME,
    )
  })

  it('sends the SAME name the generator tag uses', async () => {
    // The middleware cannot import the lib constant — it runs in the edge
    // runtime, and no middleware in this repo pulls in a server graph — so it
    // holds a literal copy. This assertion is what keeps the copy honest: a
    // rename on either side fails here rather than shipping two different
    // strings to detectors that key on the string.
    givenVerdict({ locked: false, attribution: true })

    const sent = (await middlewareHeaders()).get('x-powered-by')
    expect(sent).toBe(PLATFORM_GENERATOR_NAME)
    expect(sent).not.toMatch(/\d/)
  })

  it('SENDS NOTHING when the verdict says the site is white-labelled', async () => {
    // The expensive case, and the one a "header is present" test never runs.
    givenVerdict({ locked: false, attribution: false })

    expect((await middlewareHeaders()).get('x-powered-by')).toBeNull()
  })

  it('⚠️ sends nothing when the verdict OMITS the field', async () => {
    // An older deployment, a partial response, a route rolled back. The
    // middleware reads `data?.attribution === true`, so anything that is not
    // an explicit `true` suppresses. The tempting `!== false` would emit here
    // — on every site — during exactly the window when the two halves of a
    // deploy disagree.
    givenVerdict({ locked: false })

    expect((await middlewareHeaders()).get('x-powered-by')).toBeNull()
  })

  it('sends nothing when the verdict route is unreachable', async () => {
    // The lock fails OPEN here (an outage is not a takedown) and the
    // attribution fails CLOSED, in the same catch. Serving a site we could not
    // price is recoverable; naming the platform on a site that paid to hide it
    // is not.
    givenVerdict('unreachable')

    expect((await middlewareHeaders()).get('x-powered-by')).toBeNull()
  })

  it('still serves the site when the verdict route is unreachable', async () => {
    // The other half of the previous case: proves "no header" came from the
    // fail-closed attribution and not from the middleware refusing the
    // request outright.
    givenVerdict('unreachable')

    expect(
      (await middlewareHeaders()).get('Content-Security-Policy'),
    ).toContain("object-src 'none'")
  })

  it('discloses no version alongside it', async () => {
    givenVerdict({ locked: false, attribution: true })

    const headers = await middlewareHeaders()
    expect(headers.get('x-aglyn-package-version')).toBeNull()
    expect(headers.get('x-aglyn-process-version')).toBeNull()
  })
})

/**
 * The edge copy and the canonical constant read the SAME configuration
 * (AGL-2153).
 *
 * The suite above asserts the emitted header equals the lib constant — which
 * it did before this issue too, because both were the literal `'Aglyn'`. That
 * agreement proved nothing about configuration: the moment the brand became
 * an env var, a hand-copied literal in the edge bundle would have served
 * `<meta name="generator">` with the operator's name and `x-powered-by` with
 * ours, on the same response, and every assertion above would still pass.
 *
 * A runtime test cannot reach it either — both constants are captured at
 * module scope in two different bundles — so this is a source-level check on
 * the one thing that makes divergence impossible: one env name, read by both.
 */
describe('the edge x-powered-by copy is configured, not restated (AGL-2153)', () => {
  const BRAND_ENV = 'NEXT_PUBLIC_PLATFORM_BRAND_NAME'

  it('the tenant middleware reads the brand env var rather than a literal', () => {
    const source = readFileSync(
      resolve(__dirname, '../middleware.ts'),
      'utf8',
    )
    expect(source).toContain(`process.env.${BRAND_ENV}`)
    // Bracket notation is never substituted into an edge bundle (AGL-2037),
    // so it would read undefined and silently pin the default.
    expect(source).not.toContain(`process.env['${BRAND_ENV}']`)
    expect(source).not.toMatch(/const PLATFORM_GENERATOR_NAME = 'Aglyn'/)
  })

  it('the canonical constant reads the same env var, under the same name', () => {
    const source = readFileSync(
      resolve(__dirname, '../../../libs/aglyn/src/lib/app-utils/platform-brand.ts'),
      'utf8',
    )
    expect(source).toContain(`process.env.${BRAND_ENV}`)
  })
})

