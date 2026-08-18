/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom, where `next/server` fails to
 * load at all (`Class extends value undefined`).
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
 * The tenant CSP must not block the storefront Payment Element (AGL-1944).
 *
 * ## What was expected, and what is actually true
 *
 * Both AGL-1132 and AGL-1944 said the same thing: "Stripe.js needs
 * `js.stripe.com` in `script-src` and its frames in `frame-src`." Read against
 * the middleware, that turns out to be a change that must NOT be made — the
 * tenant sends neither directive, deliberately and at length (AGL-1228). Its
 * whole policy is `object-src 'none'; base-uri 'self'; frame-ancestors …`.
 *
 * A directive that does not exist blocks nothing, so Stripe.js and its payment
 * iframes load on a customer domain today with no allowlist change at all.
 * Adding `script-src https://js.stripe.com` to "make it work" would be strictly
 * worse than doing nothing: `script-src` has no implicit fallback to permissive,
 * so naming Stripe would silently forbid every OTHER script on the page —
 * including the ~12 inline RSC scripts Next emits — and blank every published
 * site to fix a problem that was not there.
 *
 * ## What this file guards, then
 *
 * Not the absence itself — `csp-no-script-src.spec.ts` owns that, for AGL-1228's
 * own reasons. This guards the CONDITIONAL: if a future change does introduce
 * `script-src` or `frame-src` on the tenant (AGL-1228 contemplates exactly that,
 * via build-time hashes or a nonce baked into the cached bytes), then Stripe's
 * origins have to be in it or in-page checkout dies on every storefront at once.
 *
 * Written as an implication rather than an equality so it is silent today and
 * loud on the day it matters. That is the opposite of the usual failure of a
 * guard like this: asserting the current absence would pass forever and say
 * nothing about the change it exists to catch.
 */

import { NextRequest } from 'next/server'

/** See `csp-no-script-src.spec.ts` — a `.aglyn.app` host redirects under jest. */
const HOST = 'demo.localhost:4500'

/** The origins Stripe.js loads from, and frames payment into. */
const STRIPE_SCRIPT_ORIGIN = 'https://js.stripe.com'
const STRIPE_FRAME_ORIGINS = ['https://js.stripe.com', 'https://hooks.stripe.com']

const headersFor = async (): Promise<Headers> => {
  const { middleware } = await import('../middleware')
  const response = await middleware(
    new NextRequest(new URL('/', `https://${HOST}`), {
      headers: { host: HOST },
    }),
    {} as never,
  )
  if (!response || !('headers' in response)) {
    throw new Error('middleware returned no response — it redirected or fell through')
  }
  return response.headers
}

/** Pull one directive out of a policy string, or null when it is absent. */
function directive(policy: string, name: string): string | null {
  for (const part of policy.split(';')) {
    const trimmed = part.trim()
    if (trimmed === name || trimmed.startsWith(`${name} `)) {
      return trimmed.slice(name.length).trim()
    }
  }
  return null
}

describe('the tenant CSP and the storefront Payment Element (AGL-1944)', () => {
  it('CONTROL — the middleware really did send an enforcing policy', async () => {
    // Without this, every implication below is vacuously true against a
    // response that carries no CSP at all — which is the shape of pass this
    // whole file would otherwise be.
    const policy = (await headersFor()).get('Content-Security-Policy') ?? ''
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("base-uri 'self'")
  })

  it('does not name Stripe, because it names no script-src to name it in', async () => {
    // The measured fact the design rests on, asserted so that a future reader
    // does not "fix" a CSP problem the tenant does not have. If this ever
    // fails, the next test is the one that matters.
    const policy = (await headersFor()).get('Content-Security-Policy') ?? ''
    expect(directive(policy, 'script-src')).toBeNull()
    expect(directive(policy, 'default-src')).toBeNull()
  })

  it('IF a script-src or default-src ever appears, Stripe.js must be in it', async () => {
    const policy = (await headersFor()).get('Content-Security-Policy') ?? ''
    for (const name of ['script-src', 'default-src']) {
      const value = directive(policy, name)
      if (value === null) continue
      if (!value.includes(STRIPE_SCRIPT_ORIGIN)) {
        throw new Error(
          `The tenant now sends \`${name} ${value}\` and it does not allow ${STRIPE_SCRIPT_ORIGIN}. Stripe.js cannot load, so in-page checkout is dead on every storefront with release_native_checkout on — and it fails as a blank card form, not as an error anyone will report. Add the origin, or turn the flag off first.`,
        )
      }
    }
  })

  it('IF a frame-src or default-src ever appears, the payment frames must be in it', async () => {
    // `frame-ancestors` is present and is NOT this: it says who may frame US.
    // `frame-src` says whom WE may frame, which is what the Payment Element's
    // card iframe and the 3-D Secure challenge need. Confusing the two is easy
    // and would read as "Stripe is already allowed".
    const policy = (await headersFor()).get('Content-Security-Policy') ?? ''
    expect(directive(policy, 'frame-ancestors')).not.toBeNull()
    for (const name of ['frame-src', 'default-src']) {
      const value = directive(policy, name)
      if (value === null) continue
      const missing = STRIPE_FRAME_ORIGINS.filter(
        (origin) => !value.includes(origin),
      )
      if (missing.length > 0) {
        throw new Error(
          `The tenant now sends \`${name} ${value}\`, which does not allow ${missing.join(', ')}. The Payment Element's card field and the 3-D Secure challenge are iframes on those origins; without them a shopper sees an empty box where the card form should be.`,
        )
      }
    }
  })
})
