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
 * AGL-1785: the console measures what its bare `https:` is actually covering.
 *
 * The enforcing `script-src` is `'self' https: blob: 'nonce-…'`, and the bare
 * `https:` admits a script from ANY https origin. `@monaco-editor/loader`
 * exercised that: several MB of unpinned, un-SRI'd Monaco from
 * `cdn.jsdelivr.net`, executing in the `app.aglyn.com` origin, PERMITTED rather
 * than merely unreported (AGL-1779). It was found by reading `node_modules`.
 *
 * This suite pins the report-only twin that would have named it. Four of the
 * properties below are the guard; the rest pin behaviour that already existed
 * and that this change must not disturb.
 */

import { NextRequest } from 'next/server'
// The middleware reads this same module; the spec reads it to prove the
// production/development split rather than to restate the list.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { scriptSrcReportOnlyDirective } from '../../../security-origins'

/**
 * `app.aglyn.com` — an APEX_LABELS host, chosen so the middleware short-circuits
 * to `pass()` without a `fetch` for a slug verdict. A host that needed one would
 * make this suite depend on a network call that cannot succeed under jest, and
 * the request would fall through to a branch that sets no CSP at all — which
 * every assertion below would then pass against for the wrong reason. The
 * enforcing-header control is what would catch that.
 */
const HOST = 'app.aglyn.com'

const headersFor = async (): Promise<Headers> => {
  const { middleware } = await import('../middleware')
  const response = await middleware(
    new NextRequest(new URL('/', `https://${HOST}`), {
      headers: { host: HOST },
    }),
  )
  if (!response || !('headers' in response)) {
    throw new Error(
      'middleware returned no response — it redirected or fell through, so ' +
        'there is no CSP on it to assert about',
    )
  }
  return response.headers
}

const reportOnly = async () =>
  (await headersFor()).get('Content-Security-Policy-Report-Only') ?? ''
const enforcing = async () =>
  (await headersFor()).get('Content-Security-Policy') ?? ''

/** The `script-src` clause of a policy string, without the other directives. */
const scriptClause = (policy: string) =>
  policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('script-src')) ?? ''

describe('console script-src, report-only (AGL-1785)', () => {
  it('sends a script-src in the REPORT-ONLY header at all', async () => {
    // The guard. Before this the report-only header carried `img-src` only, so
    // a `<script src>` to any https host was invisible at runtime — which is
    // the precise reason AGL-1779 had to be found by reading `node_modules`.
    expect(scriptClause(await reportOnly())).toContain('script-src ')
  })

  it('OMITS the bare `https:` — the whole point of the exercise', async () => {
    // If this ever passes with `https:` present, the directive still parses,
    // still reports, and measures NOTHING: every off-origin script would be
    // permitted by it exactly as it is by the enforcing policy. A green suite
    // around a vacuous policy is the failure mode this issue exists to end.
    const clause = scriptClause(await reportOnly())
    expect(clause).not.toMatch(/(^|\s)https:(\s|$)/)
    // The same hole spelled the other two ways.
    expect(clause).not.toMatch(/(^|\s)\*(\s|$)/)
    expect(clause).not.toContain("'unsafe-inline'")
  })

  it('reuses the ENFORCING nonce, and does not mint a second one', async () => {
    // The AGL-1228 trap, and the one mistake here that would look completely
    // fine. Next stamps every inline script with the nonce from the ENFORCING
    // header (it resolves `content-security-policy || …-report-only`, so the
    // `||` short-circuits there). A second `randomUUID()` for this directive
    // would match none of those scripts, and the header would report every
    // inline script Next emits, on every page load — a policy structurally
    // guaranteed to report everything, which can never surface anything new.
    // That is exactly why the tenant's report-only script-src was deleted.
    const headers = await headersFor()
    const enforced = /'nonce-([a-f0-9]+)'/.exec(
      headers.get('Content-Security-Policy') ?? '',
    )
    const reported = /'nonce-([a-f0-9]+)'/.exec(
      scriptClause(headers.get('Content-Security-Policy-Report-Only') ?? ''),
    )
    expect(enforced?.[1]).toBeTruthy()
    expect(reported?.[1]).toBe(enforced?.[1])
  })

  it('does NOT imply strict-dynamic', async () => {
    // Measured, not feared: the note above `scriptSrc` in the middleware records
    // that `strict-dynamic` took the same signed-in flow from 1 violation to 70,
    // because it makes `'self'` inert and Next's chunk loads are not
    // nonce-propagated. In a REPORT-ONLY policy that failure is quieter and
    // worse — it breaks nothing, so nobody notices that the whole bundle is
    // now the signal.
    expect(await reportOnly()).not.toContain('strict-dynamic')
  })

  it('does NOT allowlist the CDN that motivated this', async () => {
    // AGL-1779's egress, plus its two nearest neighbours. Self-hosting Monaco
    // (`fa84e4fc8`) removed the flow; an entry here would re-authorise the
    // class at the one layer that can still see a dependency assembling a URL
    // at runtime, which is how that egress worked in the first place — no host
    // literal of ours appeared anywhere.
    const clause = scriptClause(await reportOnly())
    expect(clause).not.toContain('jsdelivr')
    expect(clause).not.toContain('unpkg')
    expect(clause).not.toContain('cdnjs')
  })

  it('allows the off-origin scripts the console provably loads', async () => {
    // Measured in a browser on a signed-in besigner route, not guessed: with
    // these present the page raised ZERO violations across 182 same-origin
    // scripts, and an injected jsDelivr `<script>` raised exactly one. A
    // directive that fires on every page load is noise that gets switched off,
    // which is why the candidate list ships populated rather than empty.
    const clause = scriptClause(await reportOnly())
    // `loadStripe`, embedded-checkout-dialog.component.tsx:61.
    expect(clause).toContain('https://js.stripe.com')
    // App Check's ReCaptchaV3Provider, firebase-app.ts:55 — path-scoped, so
    // this does NOT hand the rest of two very large Google hosts a free pass.
    expect(clause).toContain('https://www.google.com/recaptcha/')
    expect(clause).toContain('https://www.gstatic.com/recaptcha/')
    expect(clause).not.toMatch(/https:\/\/www\.google\.com(\s|$)/)
    expect(clause).not.toMatch(/https:\/\/www\.gstatic\.com(\s|$)/)
    // Firebase Analytics' gtag loader, observed on the besigner route.
    expect(clause).toContain('https://www.googletagmanager.com')
  })

  it('reports SOMEWHERE, and keeps img-src in the same header', async () => {
    // Two properties at once, both regressions worth catching. A report-only
    // policy with no reporting directive is the AGL-518 mistake — it detects
    // violations and tells nobody, which reads as an all-clear. And a third CSP
    // header is not a thing, so `script-src` had to JOIN `img-src` rather than
    // displace it; overwriting instead of appending would silently end the
    // AGL-1685 measurement that AGL-1702 is waiting on.
    const policy = await reportOnly()
    expect(policy).toContain('img-src ')
    expect(policy).toContain('report-uri /api/csp-report')
    expect(policy).toContain('report-to csp')
  })

  it('CONTROL — the ENFORCING policy is untouched', async () => {
    // Nothing here may tighten what is enforced; this is a measurement, and the
    // flip is a separate decision gated on the reports. This also catches the
    // catastrophic version of getting it wrong: strip `script-src` from the
    // enforcing header and Next resolves the nonce off the report-only one, so
    // every script renders `nonce="$undefined"` (AGL-523).
    const policy = await enforcing()
    expect(policy).toContain("script-src 'self' https: blob: 'nonce-")
    expect(policy).toContain("object-src 'none'")
  })
})

describe('scriptSrcReportOnlyDirective production split (AGL-1785)', () => {
  const NONCE = 'deadbeefdeadbeefdeadbeefdeadbeef'

  it('leaks no http:, loopback or unsafe-eval into the production policy', async () => {
    // `'unsafe-eval'` is the one that matters most: it is in the ENFORCING
    // policy off production because React's dev build evals, and a report-only
    // copy carrying it in production would quietly bless `eval` in the very
    // directive built to find code we did not intend to run.
    const production = scriptSrcReportOnlyDirective(NONCE, true)
    expect(production).not.toContain('http://')
    expect(production).not.toContain('localhost')
    expect(production).not.toContain("'unsafe-eval'")
  })

  it('keeps development quiet, so the directive stays worth reading', async () => {
    // Without this every dev page load reports an eval violation, and a
    // directive that is always red is one everybody learns to skip.
    expect(scriptSrcReportOnlyDirective(NONCE, false)).toContain("'unsafe-eval'")
  })

  it('carries the nonce it was handed', async () => {
    expect(scriptSrcReportOnlyDirective(NONCE, true)).toContain(
      `'nonce-${NONCE}'`,
    )
  })
})
