/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
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
 * AGL-1228: the tenant must not advertise a `script-src` it cannot satisfy.
 *
 * A report-only `script-src 'self' 'nonce-…' 'strict-dynamic'` used to ship on
 * every published page. Measured on two live sites, a page carried **33
 * `<script>` tags and ZERO nonces** — under `strict-dynamic` nothing else can
 * authorise a script, so all 33 violated on every page load of every site. A
 * policy guaranteed to report everything can never surface anything new, so it
 * was evidence-gathering in name only.
 *
 * Re-adding it is the easy mistake: it looks like free security, reads as
 * "we're measuring before enforcing", and nothing about the running site
 * complains. This suite is the thing that complains.
 *
 * It asserts absence, which is worth being careful about — an absence test
 * passes trivially against a middleware that returns nothing at all. So the
 * base directives that DO enforce are asserted present in the same breath.
 */

import { NextRequest } from 'next/server'

/**
 * `demo.localhost:4500`, not a `*.aglyn.app` host, and that matters.
 *
 * The `.aglyn.app` branch of the host switch is gated on `IS_VERCEL`, so under
 * jest a production-shaped host falls through to a 307 redirect at the console
 * and never reaches the CSP code at all. Asserting "no report-only header" on
 * THAT response passes for the wrong reason — it is a redirect, it has no CSP
 * of any kind. Caught here by the base-directive control below, which is the
 * only assertion in this file that can tell the two apart.
 */
const HOST = 'demo.localhost:4500'

const headersFor = async (path = '/'): Promise<Headers> => {
  const { middleware } = await import('../middleware')
  // `NextMiddleware` takes (req, event) and may return void, so the event is
  // stubbed and the result narrowed rather than asserted away wholesale.
  const response = await middleware(
    new NextRequest(new URL(path, `https://${HOST}`), {
      headers: { host: HOST },
    }),
    {} as never,
  )
  if (!response || !('headers' in response)) {
    throw new Error('middleware returned no response — it redirected or fell through')
  }
  return response.headers
}

describe('tenant CSP (AGL-1228)', () => {
  it('sends NO report-only header at all', async () => {
    // The whole point. A report-only policy nobody can satisfy costs a header
    // on every response and returns nothing.
    const headers = await headersFor()
    expect(headers?.get('Content-Security-Policy-Report-Only')).toBeNull()
  })

  it('sends no `script-src` in the enforcing policy either', async () => {
    // Not a smaller version of the same mistake: `strict-dynamic` blanks the
    // site because a per-request nonce cannot match ISR-cached bytes, and a
    // plain `'self'` blocks the ~12 inline RSC scripts Next emits per page.
    const policy = (await headersFor())?.get('Content-Security-Policy') ?? ''
    expect(policy).not.toContain('script-src')
    expect(policy).not.toContain('strict-dynamic')
    expect(policy).not.toContain('nonce-')
  })

  it('CONTROL — the base directives that DO enforce are still sent', async () => {
    // Without this, every assertion above would pass against a middleware that
    // set no CSP whatsoever, which is a security regression wearing the same
    // shape as the fix.
    const policy = (await headersFor())?.get('Content-Security-Policy') ?? ''
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("base-uri 'self'")
    expect(policy).toContain('frame-ancestors')
  })

  it('mints no x-nonce for a reader that does not exist', async () => {
    // `x-nonce` was set on the rewritten REQUEST and read by nothing in the
    // tenant — grep confirms one `set`, zero `get`. Generating a UUID per
    // request to satisfy no consumer is the cost half of the same mistake.
    //
    // Asserted on `x-middleware-request-x-nonce`, NOT `x-nonce`: middleware
    // request-header overrides are encoded onto the response under that
    // prefix. The obvious `headers.get('x-nonce')` is null whether or not the
    // nonce is being minted, so it cannot fail — this assertion was written
    // that way first and caught by re-adding the code and watching it pass.
    const headers = await headersFor()
    expect(headers?.get('x-middleware-request-x-nonce')).toBeNull()
  })
})
