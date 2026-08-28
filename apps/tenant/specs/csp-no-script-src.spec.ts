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
 * ## Why the guarantee is worded as ingredients, not as "no header"
 *
 * AGL-1228's header was unsatisfiable because it advertised a **per-request
 * nonce** against **ISR-cached bytes** — two requests to one cached page
 * returned byte-identical HTML with a different nonce in each response header,
 * so the policy could never be met. That is the defect, and `nonce-`,
 * `script-src` and `strict-dynamic` are its proxies. A directive with no
 * per-request component — `img-src` was the example — is the same string on
 * every response and agrees with the cached bytes by construction, so "is there
 * a header" was never the question worth testing.
 *
 * AGL-1703 did briefly ship a report-only header carrying `img-src`, and this
 * file was relaxed to accommodate it. AGL-1152 then flipped that `img-src` to
 * enforcing and removed the second header again, which is the state asserted
 * below.
 *
 * ## Absence tests need a control, and one of these lost its own
 *
 * An absence test passes trivially against a middleware that returns nothing at
 * all, so the base directives that DO enforce are asserted present in the same
 * breath. That control covers the enforcing policy. It does not cover the
 * report-only one: once that header stopped shipping, every assertion about its
 * contents was reading `?? ''` and passing against the empty string. Its own
 * control is now `toBeNull()` — the header's absence stated as a fact rather
 * than relied on silently, so a reinstated header fails here and is re-read
 * rather than waved through.
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
  it('sends no REPORT-ONLY policy at all, so nothing can shadow the nonce reader', async () => {
    // The tenant sends no report-only header: AGL-1152 flipped `img-src` to
    // enforcing and the second header went with it.
    //
    // Asserting that explicitly is the point. The three ingredient checks below
    // read the header as `?? ''`, so with no header to read they pass against
    // the empty string no matter what the middleware does — a green test
    // measuring nothing. `toBeNull()` is what makes them honest: a reinstated
    // report-only header trips here first and sends the reader to this file
    // before the ingredient checks are trusted again.
    //
    // A second header is not merely redundant. Next resolves the nonce as
    // `content-security-policy || …-report-only`, so a report-only policy is
    // only ever safe while the enforcing one carries no `script-src` — the
    // AGL-523 shadowing shape, which served `nonce="$undefined"` platform-wide.
    const reportOnly = (await headersFor())?.get(
      'Content-Security-Policy-Report-Only',
    )
    expect(reportOnly).toBeNull()

    // Kept for the day one returns: the header may exist, but never carrying
    // the ingredient that made AGL-1228's version unsatisfiable. A per-request
    // nonce cannot match ISR-cached bytes, so any of these three reappearing
    // recreates a policy that reports every script on every page load of every
    // published site.
    const policy = reportOnly ?? ''
    expect(policy).not.toContain('script-src')
    expect(policy).not.toContain('strict-dynamic')
    expect(policy).not.toContain('nonce-')
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

describe('tenant ENFORCED img-src (AGL-1703, flipped by AGL-1152)', () => {
  /**
   * This block used to assert the opposite, and AGL-1726 said to update it
   * rather than delete it when the flip came — so this is that update, with
   * the reasoning that changed recorded rather than replaced.
   *
   * The old guard existed because enforcing a PLATFORM-WIDE list would blank
   * author-hotlinked images across published customer sites: a stranger's
   * shopfront, failing silently. That is no longer what enforcing means. The
   * list is the site owner's, the besigner warns before an unapproved host is
   * published, and the site's own origins and the measurement beacons are
   * admitted automatically — so nothing an author already had stops working.
   */
  it('CONTROL — the enforcing header exists and carries `img-src`', async () => {
    // Every assertion below is about the CONTENTS of a header, and all of them
    // would pass against a middleware that stopped sending it — the regression
    // this arc exists to prevent, since a policy nobody sends is
    // indistinguishable from one with nothing to say.
    const policy = (await headersFor())?.get('Content-Security-Policy') ?? ''
    expect(policy).toContain('img-src')
    expect(policy).toContain("'self'")
  })

  it('sends NO report-only header any more', async () => {
    // Not tidiness. Next resolves a nonce as `content-security-policy ||
    // content-security-policy-report-only`, so a second header is only ever
    // safe while the enforcing one carries no `script-src` — the AGL-523
    // shadowing shape. With `img-src` moved across, the enforcing policy
    // carries the reporting tail and the second header has no reason to exist.
    expect(
      (await headersFor())?.get('Content-Security-Policy-Report-Only'),
    ).toBeNull()
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
    // On the ENFORCING policy now: after the flip a violation is an image that
    // did NOT load, which is the most urgent thing the log can carry.
    const policy = headers?.get('Content-Security-Policy') ?? ''
    expect(policy).toContain('report-uri /api/csp-report')
    expect(policy).toContain('report-to csp')
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
    const policy = response.headers.get('Content-Security-Policy') ?? ''
    expect(policy).toContain('report-uri /api/csp-report')
    expect(policy).not.toContain('report-to')
    expect(response.headers.get('Reporting-Endpoints')).toBeNull()
  })

  it('reports to a RELATIVE path, never an absolute aglyn origin', async () => {
    // The endpoint must resolve against the customer's own document. An
    // absolute URL here would make every visitor to every customer's website
    // issue a cross-origin request to an aglyn host — a CORS preflight per
    // origin, and our hostname in the network log of a stranger reading
    // someone's blog.
    // Scoped to the REPORTING directives. Checking the whole policy would now
    // trip over `frame-ancestors`, which legitimately names every first-party
    // origin — a false positive about a directive this test is not about.
    const policy = (await headersFor())?.get('Content-Security-Policy') ?? ''
    const reporting = policy.slice(policy.indexOf('report-uri'))
    expect(reporting).not.toContain('https://')
    expect(reporting).not.toContain('report-uri http')
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
    const policy = (await headersFor())?.get('Content-Security-Policy') ?? ''
    const imgSrc = (policy.match(/img-src[^;]*/) ?? [''])[0]
    expect(imgSrc).toContain('https://firebasestorage.googleapis.com')
    expect(imgSrc).not.toContain('lh3')
    // The measurement beacons are gated on the site running measurement, and
    // this fixture host configures none — so their absence here is the GATE
    // working, not the allowlist being narrow.
    expect(imgSrc).not.toContain('doubleclick')
    expect(imgSrc).not.toContain('google-analytics')
    expect(imgSrc).not.toContain('googletagmanager')
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
