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
 * AGL-1703: it now DOES send a report-only header, and this file had to change.
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
 * ## What changed, and why it is not a loosening
 *
 * This file used to assert `Content-Security-Policy-Report-Only` was **null**.
 * AGL-1703 ships one carrying a report-only `img-src`, so that assertion had to
 * go — and deleting it would have thrown away the AGL-1228 guarantee along with
 * it, because "no report-only header" was standing in for "no unsatisfiable
 * `script-src`". The two are now separated: the header may exist, and every
 * ingredient of the AGL-1228 defect is pinned by name in it.
 *
 * The distinction is mechanical rather than stylistic. AGL-1228's header was
 * unsatisfiable because it advertised a **per-request nonce** against
 * **ISR-cached bytes** — two requests to one cached page returned byte-identical
 * HTML with a different nonce in each response header, so the policy could never
 * be met. An `img-src` has no per-request component at all: the same string on
 * every response, agreeing with the cached bytes by construction. So the test to
 * write is not "is there a header" but "does it contain anything per-request",
 * which is what `nonce-`, `script-src` and `strict-dynamic` are proxies for.
 *
 * It still asserts absence in places, which is worth being careful about — an
 * absence test passes trivially against a middleware that returns nothing at
 * all. So the base directives that DO enforce are asserted present in the same
 * breath, and the report-only header is asserted to actually carry `img-src`
 * rather than merely to exist.
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
  it('sends no `script-src`, nonce or `strict-dynamic` in the REPORT-ONLY policy', async () => {
    // This replaces `expect(...).toBeNull()`. The guarantee is unchanged in
    // substance and narrower in wording: the header may exist — AGL-1703 needs
    // one — but not one carrying the ingredient that made AGL-1228's version
    // unsatisfiable. A per-request nonce cannot match ISR-cached bytes, so any
    // of these three reappearing here recreates a policy that reports every
    // script on every page load of every published site.
    const reportOnly =
      (await headersFor())?.get('Content-Security-Policy-Report-Only') ?? ''
    expect(reportOnly).not.toContain('script-src')
    expect(reportOnly).not.toContain('strict-dynamic')
    expect(reportOnly).not.toContain('nonce-')
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

describe('tenant report-only img-src (AGL-1703)', () => {
  it('CONTROL — the report-only header exists and actually carries `img-src`', async () => {
    // The counterpart to the base-directive control above. Every assertion in
    // this block is about the CONTENTS of a header, and all of them would pass
    // against a middleware that stopped sending it — which is the regression
    // this whole arc exists to prevent, since a policy that reports nothing is
    // indistinguishable from a site with nothing to report.
    const reportOnly =
      (await headersFor())?.get('Content-Security-Policy-Report-Only') ?? ''
    expect(reportOnly).toContain('img-src')
    expect(reportOnly).toContain("'self'")
  })

  it('keeps `img-src` OUT of the enforcing policy', async () => {
    // The load-bearing one. Enforcing this list would blank author-hotlinked
    // images across published customer sites — a stranger's shopfront, failing
    // silently. AGL-1726 states what must be true before that flips; until
    // then, an `img-src` reaching the enforcing header is the bug.
    const policy = (await headersFor())?.get('Content-Security-Policy') ?? ''
    expect(policy).not.toContain('img-src')
  })

  it('carries BOTH reporting directives and resolves the `report-to` group', async () => {
    // AGL-518 shipped a report-only policy with no reporting directive for
    // months: it detected violations, told nobody, and read as an all-clear.
    // Over https both directives deliver, by different routes — Chrome through
    // the Reporting API, Safari by posting to the `report-uri` path — so both
    // ship. `report-to` needs `Reporting-Endpoints` to name its group, and
    // without it nothing is delivered by EITHER browser (AGL-1788), which is
    // why the header is asserted here rather than treated as decoration.
    const headers = await headersFor()
    const reportOnly = headers?.get('Content-Security-Policy-Report-Only') ?? ''
    expect(reportOnly).toContain('report-uri /api/csp-report')
    expect(reportOnly).toContain('report-to csp')
    expect(headers?.get('Reporting-Endpoints')).toBe('csp="/api/csp-report"')
  })

  it('drops `report-to` over plain http, where it would silence everything', async () => {
    // AGL-1788, measured rather than reasoned: `report-to` suppresses
    // `report-uri` whether or not its group resolves, and Chrome refuses a
    // `Reporting-Endpoints` header on a non-secure transport. The pair
    // therefore reports NOTHING over `http://`, which is every `nx serve
    // tenant` session. Published customer sites are https and unaffected.
    const { middleware } = await import('../middleware')
    const response = await middleware(
      new NextRequest(new URL('/', `http://${HOST}`), {
        headers: { host: HOST },
      }),
      {} as never,
    )
    if (!response || !('headers' in response)) {
      throw new Error('middleware returned no response')
    }
    const reportOnly =
      response.headers.get('Content-Security-Policy-Report-Only') ?? ''
    expect(reportOnly).toContain('report-uri /api/csp-report')
    expect(reportOnly).not.toContain('report-to')
    expect(response.headers.get('Reporting-Endpoints')).toBeNull()
  })

  it('reports to a RELATIVE path, never an absolute aglyn origin', async () => {
    // The endpoint must resolve against the customer's own document. An
    // absolute URL here would make every visitor to every customer's website
    // issue a cross-origin request to an aglyn host — a CORS preflight per
    // origin, and our hostname in the network log of a stranger reading
    // someone's blog.
    const reportOnly =
      (await headersFor())?.get('Content-Security-Policy-Report-Only') ?? ''
    expect(reportOnly).not.toContain('https://console.aglyn')
    expect(reportOnly).not.toContain('report-uri http')
  })

  it('allowlists the DAM storage host and nothing else third-party', async () => {
    // `firebasestorage.googleapis.com` is not optional: orgs without the paid
    // `mediaCdn` entitlement store the absolute download URL, so dropping it
    // blanks every FREE-TIER customer's images while paying customers' sites
    // keep working.
    //
    // The absence pins name bare labels rather than full origins, following
    // pos-card-qr-local.spec: `no-remote-image-service` cannot tell an
    // assertion of absence from a use. `lh3` is pinned because it is in the
    // CONSOLE list and copying that list over is the obvious wrong move — the
    // tenant loads no Firebase client SDK and renders no account avatars.
    // The analytics hosts are pinned because gtag runs on published sites and
    // silencing its own image beacon by allowlisting it is the AGL-1671
    // mistake played backwards.
    const reportOnly =
      (await headersFor())?.get('Content-Security-Policy-Report-Only') ?? ''
    expect(reportOnly).toContain('https://firebasestorage.googleapis.com')
    expect(reportOnly).not.toContain('lh3')
    expect(reportOnly).not.toContain('doubleclick')
    expect(reportOnly).not.toContain('google-analytics')
    expect(reportOnly).not.toContain('googletagmanager')
  })

  it('does not drag in the 26 console first-party origins', async () => {
    // `imgSrcDirective` was the obvious thing to reuse and is the wrong shape:
    // a customer's website loads no images from `console.aglyn.com`, and every
    // unneeded entry is one the reports cannot distinguish from a needed one.
    // `'self'` is what covers the site's own origin — including the
    // `*.aglyn.app` subdomain, which appears in `PRODUCTION_DOMAINS` nowhere,
    // and the custom domain, which could not appear there in principle.
    const reportOnly =
      (await headersFor())?.get('Content-Security-Policy-Report-Only') ?? ''
    expect(reportOnly).not.toContain('console.aglyn')
    expect(reportOnly).not.toContain('admin.aglyn')
    expect(reportOnly).not.toContain('cname.aglyn')
  })
})
