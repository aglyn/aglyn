/**
 * @jest-environment node
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

import { NextRequest } from 'next/server'
import { middleware } from './middleware'

/**
 * The host gate had no test at all, which is most of why it shipped disabled
 * and stayed disabled: nothing anywhere asserted that an unknown workspace is
 * turned away.
 *
 * These drive the real `middleware` export with `fetch` mocked. That mock is
 * the point — a spoofed `Host` header cannot be verified end-to-end locally,
 * because the verdict lookup goes to the request's own origin and a fake
 * hostname resolves through real DNS to somewhere that is not this process.
 * An earlier attempt to check this with curl silently passed every host for
 * exactly that reason.
 */

const KNOWN: Record<string, { known: boolean; movedTo: string | null }> = {
  zgover: { known: true, movedTo: null },
  'aglyn-org': { known: true, movedTo: null },
  'zach-gover': { known: true, movedTo: 'zgover' },
  // Only the negative-TTL test uses this one. `slugCache` is module state that
  // outlives each test, so a slug another test warmed would start cached.
  'ttl-known-slug': { known: true, movedTo: null },
}

/**
 * Custom console domains (AGL-1099c), keyed exactly as `consoleDomains` is.
 * Everything absent from this map is an ordinary non-workspace host —
 * localhost, a preview deployment, a self-hosted install — and must pass
 * through untouched.
 */
const CONSOLE_DOMAINS: Record<
  string,
  { known: boolean; servable: boolean; orgSlug: string | null }
> = {
  'console.acme-agency.com': { known: true, servable: true, orgSlug: 'acme' },
  'console.lapsed.com': { known: true, servable: false, orgSlug: 'lapsed' },
  'console.orphaned.com': { known: true, servable: false, orgSlug: null },
}

let fetchCalls: string[] = []

beforeEach(() => {
  fetchCalls = []
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    fetchCalls.push(url.toString())
    const body = url.pathname.endsWith('/console-domain-verdict')
      ? (CONSOLE_DOMAINS[url.searchParams.get('host') ?? ''] ?? {
          known: false,
          servable: false,
          orgSlug: null,
        })
      : (KNOWN[url.searchParams.get('slug') ?? ''] ?? {
          known: false,
          movedTo: null,
        })
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
})

function request(host: string, path = '/signin') {
  return new NextRequest(`https://${host}${path}`, {
    headers: { host },
  })
}

describe('workspace host gate', () => {
  it('turns an unregistered workspace subdomain away', async () => {
    const response = await middleware(request('billing-security-update.aglyn.com'))
    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.hostname).toBe('app.aglyn.com')
    expect(location.searchParams.get('unknown-workspace')).toBe(
      'billing-security-update',
    )
  })

  it('serves a registered workspace', async () => {
    const response = await middleware(request('zgover.aglyn.com'))
    // 200 here means "not redirected" — NextResponse.next()/rewrite().
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('308s a renamed workspace to its new slug', async () => {
    const response = await middleware(request('zach-gover.aglyn.com'))
    expect(response.status).toBe(308)
    expect(new URL(response.headers.get('location') ?? '').hostname).toBe(
      'zgover.aglyn.com',
    )
  })

  it.each(['app.aglyn.com', 'www.aglyn.com', 'auth.aglyn.com', 'aglyn.com'])(
    'serves %s without asking for a verdict',
    async (host) => {
      const response = await middleware(request(host))
      expect(response.headers.get('location')).toBeNull()
      // A reserved label must not cost a lookup — and auth.aglyn.com must
      // never be redirected, or the OAuth handshake breaks (AGL-462).
      expect(fetchCalls).toHaveLength(0)
    },
  )

  it.each(['localhost:4200', 'aglyn-console.vercel.app'])(
    'leaves %s alone entirely',
    async (host) => {
      const response = await middleware(request(host))
      expect(response.headers.get('location')).toBeNull()
      // It DOES cost one lookup now (AGL-1099c) — a non-workspace host may be
      // a custom console domain, and only a Firestore claim can tell. What it
      // must never cost is a workspace-slug verdict: `aglyn-console` is not a
      // slug, and treating it as one is how a preview deployment would get
      // rewritten into somebody's org.
      expect(fetchCalls.every((call) => call.includes('console-domain-verdict')))
        .toBe(true)
    },
  )

  it('asks its OWN origin for the verdict, not a hardcoded apex', async () => {
    // A slug no other test touches: `slugCache` is module state and outlives
    // each test, so reusing one would assert against a cache hit.
    await middleware(request('aglyn-org.aglyn.com'))
    expect(fetchCalls).toHaveLength(1)
    expect(new URL(fetchCalls[0]).origin).toBe('https://aglyn-org.aglyn.com')
  })

  it('caches a verdict instead of asking twice', async () => {
    await middleware(request('cache-check.aglyn.com'))
    await middleware(request('cache-check.aglyn.com'))
    expect(fetchCalls).toHaveLength(1)
  })

  it('fails OPEN when the verdict lookup errors', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const response = await middleware(request('outage-check.aglyn.com'))
    // Deliberate: the Vercel domain allowlist is the boundary. A Firestore
    // outage must not take every real workspace subdomain down with it.
    expect(response.headers.get('location')).toBeNull()
  })

  it('does not cache a degraded verdict', async () => {
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input))
      return new Response(
        JSON.stringify({ known: true, movedTo: null, degraded: true }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch
    await middleware(request('degraded-check.aglyn.com'))
    await middleware(request('degraded-check.aglyn.com'))
    // Two lookups, not one: caching a degraded answer would pin the slug open
    // for the full TTL after a single blip.
    expect(fetchCalls).toHaveLength(2)
  })
})

/**
 * The custom-console-domain gate (AGL-1099c).
 *
 * `middleware.ts` had no tests at all before AGL-1135, which is most of why the
 * workspace gate shipped disabled and stayed that way for its whole life. The
 * design memo says outright: do not repeat it here.
 *
 * These drive the real `middleware` export against a `fetch` that answers as
 * `/api/orgs/console-domain-verdict` would, so what is under test is the gate's
 * behaviour rather than the presence of a helper.
 */
describe('custom console domain gate', () => {
  it('rewrites a live custom domain into its ONE org’s path', async () => {
    // The pin. The org comes from a document keyed on the host, so no part of
    // the request can ask for a different one — and the path rewrite is what
    // makes every downstream `[orgSlug]` route agree.
    const response = await middleware(
      request('console.acme-agency.com', '/hosts/site-1'),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-rewrite')).toContain(
      '/acme/hosts/site-1',
    )
  })

  it('never rewrites a path that already names the org', async () => {
    const response = await middleware(
      request('console.acme-agency.com', '/acme/hosts/site-1'),
    )
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
    expect(response.headers.get('location')).toBeNull()
  })

  it('refuses to render SIGN-IN on a custom domain', async () => {
    // The design's biggest structural bet is that the credential prompt only
    // ever happens on an origin we control (AGL-1353 D6): no Firebase
    // authorized-domain entry, no OAuth helper iframe, and nothing durable left
    // on an origin whose DNS the customer can re-point at themselves. The
    // client half is enforced by the sealed auth instance (AGL-1379); this is
    // the route half, and without it the property is only claimed.
    //
    // What changed with the handoff (AGL-1902) is the DESTINATION for
    // `/signin`, not the property: it now starts the handoff here, because the
    // verifier cookie is host-only and can only be set on this origin. The
    // start route bounces on to the auth host itself, so the credential prompt
    // is still never rendered on a customer-controlled origin.
    const signin = await middleware(
      request('console.acme-agency.com', '/signin'),
    )
    expect(signin.status).toBe(307)
    const started = new URL(signin.headers.get('location') ?? '')
    expect(started.hostname).toBe('console.acme-agency.com')
    expect(started.pathname).toBe('/auth/handoff/start')
    // And it is a REDIRECT, not a rewrite: nothing renders a sign-in form here.
    expect(signin.headers.get('x-middleware-rewrite')).toBeNull()

    // The rest of the family still leaves the domain entirely. `signup` must
    // not create accounts from a white-label address, and the other two redeem
    // one-shot codes from emailed links whose origin is ours.
    for (const path of ['/signup', '/verify-email', '/account-recovery']) {
      const response = await middleware(request('console.acme-agency.com', path))
      expect(response.status).toBe(307)
      const location = new URL(response.headers.get('location') ?? '')
      expect(location.hostname).toBe('app.aglyn.com')
      expect(location.pathname).toBe(path)
    }
  })

  it('carries the requested continue path into the handoff start', async () => {
    const response = await middleware(
      request('console.acme-agency.com', '/signin?continue=/acme/sites'),
    )

    const location = new URL(response.headers.get('location') ?? '')
    expect(location.pathname).toBe('/auth/handoff/start')
    expect(location.searchParams.get('continue')).toBe('/acme/sites')
  })

  it('serves the handoff legs unrewritten, never scoped under the org', async () => {
    // `/auth/handoff` is a platform route. Rewritten to `/acme/auth/handoff` it
    // would 404 — and the thing that 404s is the only flow that can put a
    // session on this domain at all, which would read as "the feature does not
    // work" rather than as a routing bug.
    for (const path of [
      '/auth/handoff',
      '/auth/handoff/start',
      '/auth/handoff/continue',
    ]) {
      const response = await middleware(request('console.acme-agency.com', path))
      expect(response.headers.get('x-middleware-rewrite')).toBeNull()
      expect(response.headers.get('location')).toBeNull()
    }
  })

  it('still serves sign-OUT and account routes there', async () => {
    // Ending a session on the host that holds it can never be the wrong
    // answer, and a white-label console that cannot reach account settings is
    // a broken product rather than a closed hole.
    for (const path of ['/signout', '/manage/user']) {
      const response = await middleware(request('console.acme-agency.com', path))
      expect(response.headers.get('location')).toBeNull()
      expect(response.headers.get('x-middleware-rewrite')).toBeNull()
    }
  })

  it('STOPS serving a domain whose org lost the entitlement', async () => {
    // The billing hole: a console domain that keeps serving after a downgrade.
    // The visitor lands on a console that works and is told why, rather than
    // meeting a dead hostname that reads as an outage.
    const response = await middleware(request('console.lapsed.com', '/hosts'))
    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.hostname).toBe('lapsed.aglyn.com')
    expect(location.searchParams.get('console-domain')).toBe('inactive')
  })

  it('sends a 307, NOT a 308, when a domain stops serving', async () => {
    // Suspension is reversible by design — re-upgrade, re-activate — and a 308
    // is cacheable by default and effectively irreversible in a browser.
    // Committing every visitor's browser to a permanent redirect off the
    // customer's own domain because a card declined for a day is a state we
    // could not get back out of. (Deliberate departure from AGL-1353 D7's
    // wording; same property AGL-1430 argues from.)
    const response = await middleware(request('console.lapsed.com', '/'))
    expect(response.status).not.toBe(308)
    expect(response.status).toBe(307)
  })

  it('falls back to the apex when the claim resolves to no workspace', async () => {
    const response = await middleware(request('console.orphaned.com', '/hosts'))
    expect(new URL(response.headers.get('location') ?? '').hostname).toBe(
      'app.aglyn.com',
    )
  })

  it('leaves an unclaimed host completely alone', async () => {
    // Not a refusal. Every self-hosted install and every preview deployment
    // looks exactly like this, and turning them away would be the AGL-1135
    // mistake with the sign flipped.
    const response = await middleware(request('console.nobody-here.com', '/hosts'))
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
  })

  it('fails OPEN when the verdict lookup errors', async () => {
    // The Vercel domain allowlist is the boundary. A Firestore outage must not
    // take every customer's console offline with it.
    globalThis.fetch = jest.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    // A host no other test touches: `consoleDomainCache` is module state and
    // outlives each test, so reusing one would assert against a cache hit.
    const response = await middleware(request('console.outage-check.com', '/hosts'))
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
  })

  it('caches a verdict instead of asking twice', async () => {
    await middleware(request('console.cache-check.com', '/'))
    await middleware(request('console.cache-check.com', '/'))
    expect(fetchCalls).toHaveLength(1)
  })

  it('does NOT cache a degraded verdict', async () => {
    // One blip must not pin a host's verdict for the full TTL — in either
    // direction. A cached "degraded" on a suspended domain would keep serving
    // it for a minute after the suspension.
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input))
      return new Response(
        JSON.stringify({ known: false, servable: false, orgSlug: null, degraded: true }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch
    await middleware(request('console.degraded-check.com', '/'))
    await middleware(request('console.degraded-check.com', '/'))
    expect(fetchCalls).toHaveLength(2)
  })

  it('asks its OWN origin for the verdict, not a hardcoded apex', async () => {
    // Same reason as the workspace gate: a preview deployment must not ask
    // production for a verdict.
    await middleware(request('console.origin-check.com', '/'))
    expect(new URL(fetchCalls[0]).origin).toBe('https://console.origin-check.com')
  })
})

/**
 * The report-only policy shipped from AGL-518 with no reporting directive, so
 * it detected violations and told nobody — which is why AGL-523's first
 * "before flipping" item, reviewing the violations, was never done.
 *
 * These assert the wiring end to end, because every part of it fails SILENTLY,
 * and one part fails worse than it looks (AGL-1788). A `report-to` group with
 * no `Reporting-Endpoints` header does not merely go unused: its presence
 * suppresses `report-uri`, so the policy delivers nothing to ANY browser —
 * measured in Chrome and Safari, not inferred. A missing `report-uri` loses
 * the browsers that only speak the old directive. Either way the symptom is an
 * empty log that reads exactly like "no violations" — the same false all-clear
 * the endpoint exists to end.
 */
describe('CSP violation reporting (AGL-523)', () => {
  const REPORT_PATH = '/api/csp-report'

  it('names the reporting group in a Reporting-Endpoints header', async () => {
    const response = await middleware(request('app.aglyn.com'))
    expect(response.headers.get('Reporting-Endpoints')).toBe(
      `csp="${REPORT_PATH}"`,
    )
  })

  it('sends BOTH directives on the enforcing policy', async () => {
    const response = await middleware(request('app.aglyn.com'))
    const policy = response.headers.get('Content-Security-Policy')
    // Both over https, where both work: Chrome delivers through the Reporting
    // API and Safari posts to the `report-uri` path. Not a fallback pair —
    // see the http case below for what `report-to` actually does to
    // `report-uri` (AGL-1788).
    expect(policy).toContain(`report-uri ${REPORT_PATH}`)
    expect(policy).toContain('report-to csp')
  })

  /**
   * The http branch (AGL-1788).
   *
   * Chrome refuses a `Reporting-Endpoints` header on a non-secure transport,
   * and `report-to` suppresses `report-uri` whether or not its group resolves
   * — so the pair we ship reports NOTHING over `http://localhost`. Measured,
   * one violation per case, Chrome 152 and Safari 26. Dropping `report-to`
   * there is what makes a CSP report visible while developing at all.
   *
   * Production is https, so none of this changes what production sends; the
   * https tests above are the ones that pin that.
   */
  describe('over a non-secure transport', () => {
    const httpRequest = (host: string) =>
      new NextRequest(`http://${host}/signin`, {
        headers: { host },
      })

    it('drops report-to rather than letting it suppress report-uri', async () => {
      const response = await middleware(httpRequest('app.aglyn.com'))
      const policy = response.headers.get('Content-Security-Policy')
      expect(policy).toContain(`report-uri ${REPORT_PATH}`)
      expect(policy).not.toContain('report-to')
    })

    it('drops the Reporting-Endpoints header with it', async () => {
      // A `Reporting-Endpoints` header without `report-to` is inert, and
      // `report-to` without the header is the total-silence case. They move
      // together or not at all.
      const response = await middleware(httpRequest('app.aglyn.com'))
      expect(response.headers.get('Reporting-Endpoints')).toBeNull()
    })

    it('also drops it from the report-only policy', async () => {
      // The report-only header is the one AGL-1702 and AGL-1726 are gated on,
      // so it is the one where silence is most expensive.
      const response = await middleware(httpRequest('app.aglyn.com'))
      const policy = response.headers.get(
        'Content-Security-Policy-Report-Only',
      )
      expect(policy).toContain(`report-uri ${REPORT_PATH}`)
      expect(policy).not.toContain('report-to')
    })

    it('trusts x-forwarded-proto over the request URL', async () => {
      // Vercel terminates TLS ahead of the function, so `nextUrl.protocol` can
      // read `http:` on a request the browser made over https. Reading the URL
      // alone would strip the modern channel from every production response.
      const response = await middleware(
        new NextRequest('http://app.aglyn.com/signin', {
          headers: { host: 'app.aglyn.com', 'x-forwarded-proto': 'https' },
        }),
      )
      expect(response.headers.get('Content-Security-Policy')).toContain(
        'report-to csp',
      )
      expect(response.headers.get('Reporting-Endpoints')).toBe(
        `csp="${REPORT_PATH}"`,
      )
    })

    it('reads only the client-facing hop of a chained x-forwarded-proto', async () => {
      // Proxies append, so the header is a list and the FIRST entry is the one
      // the browser saw. Reading the last would call an https request http.
      const response = await middleware(
        new NextRequest('http://app.aglyn.com/signin', {
          headers: { host: 'app.aglyn.com', 'x-forwarded-proto': 'https,http' },
        }),
      )
      expect(response.headers.get('Content-Security-Policy')).toContain(
        'report-to csp',
      )
    })
  })

  it('enforces script-src with a nonce by DEFAULT, with no opt-in', async () => {
    // The AGL-523 flip. There was a `?csp=enforce` cookie that armed this for
    // one session; it is gone, so a plain request must already be enforcing.
    const response = await middleware(request('app.aglyn.com'))
    const enforced = response.headers.get('Content-Security-Policy')
    expect(enforced).toMatch(/script-src[^;]*'nonce-[a-f0-9]{32}'/)
    // A violation here is a script that did NOT run — the most urgent thing
    // the log can carry, so it must not be the one case reporting nowhere.
    expect(enforced).toContain(`report-uri ${REPORT_PATH}`)
  })

  /**
   * The regression guard for the bug that cost AGL-523 months, restated
   * against what actually causes it (AGL-1685).
   *
   * It used to be `Content-Security-Policy-Report-Only` → `toBeNull()`, and
   * that assertion was a PROXY. The defect was never "a second header exists";
   * it was "the header Next reads the nonce out of carries no `script-src`".
   * AGL-1685 ships a report-only `img-src`, so the proxy and the thing it
   * stood for came apart, and the proxy is the half that had to go.
   *
   * Both halves of the mechanism were re-read in the INSTALLED next@16.2.11,
   * not assumed:
   *
   * 1. `next/dist/server/lib/router-utils/resolve-routes.js:458-461` copies
   *    EVERY middleware response header onto `req.headers` as well as the
   *    response — both CSP headers included. This is the undocumented step the
   *    comment above `nonce` in `middleware.ts` records.
   * 2. `next/dist/server/app-render/app-render.js:167` then resolves
   *    `headers['content-security-policy'] || headers['content-security-policy-report-only']`
   *    and hands the winner to `getScriptNonceFromHeader`, which takes the
   *    first `script-src` directive, else `default-src`, else no nonce.
   *
   * So the real invariant has two clauses, and the tests below are one per
   * clause: an ENFORCING policy is present on every response that carries a
   * report-only one, and that enforcing policy carries `script-src`. A second
   * enforcing policy breaks the first; deleting `script-src` breaks the second.
   * Either one reproduces `nonce="$undefined"` on every script.
   */
  it('emits exactly ONE enforcing policy, and it carries script-src', async () => {
    const response = await middleware(request('app.aglyn.com'))
    const enforced = response.headers.get('Content-Security-Policy')
    // Clause two. Not merely "contains script-src" — it must be the directive
    // the nonce is read out of, since that is the whole job of this header.
    expect(enforced).toMatch(/script-src[^;]*'nonce-[a-f0-9]{32}'/)
    // Clause one. `,` is CSP's own separator between multiple policies in one
    // header, and it is also what `Headers.append` joins with — so a second
    // enforcing policy arriving by EITHER route shows up here, while a plain
    // `.set()` cannot produce one. Nothing legitimate in this policy contains
    // a comma: `frame-ancestors` joins its origins with spaces, and the two
    // reporting directives carry a single path each.
    expect(enforced).not.toContain(',')
  })

  it('never sends a report-only policy on a response with no enforcing one', async () => {
    // The clause the `||` above depends on, and the one that is easiest to
    // break by accident. The short-circuit only protects a response that HAS
    // an enforcing header; on a response carrying report-only ALONE, the
    // report-only header IS the string Next parses for the nonce, and AGL-523
    // comes straight back. `applyCsp` sets both headers together, which is
    // what makes this true — so the test is that every response path either
    // goes through it or carries neither header.
    //
    // Exercised across all four shapes the middleware returns: pass, rewrite,
    // redirect and the sanctions refusal. The redirects and the 451 are the
    // interesting ones — they set NO CSP at all, which is fine, and would stop
    // being fine the moment a report-only header were hoisted out of
    // `applyCsp` to "make sure it always ships".
    const responses = await Promise.all([
      middleware(request('app.aglyn.com')), // pass
      middleware(request('zgover.aglyn.com')), // org rewrite
      middleware(request('console.acme-agency.com')), // custom-domain rewrite
      middleware(request('zach-gover.aglyn.com')), // 308 renamed slug
      middleware(request('console.lapsed.com')), // 307 off a dead domain
      middleware(request('unknown-workspace-xyz.aglyn.com')), // 307 to apex
      middleware(
        new NextRequest('https://app.aglyn.com/signup', {
          headers: { host: 'app.aglyn.com', 'x-vercel-ip-country': 'KP' },
        }),
      ), // 451 sanctions refusal
    ])
    for (const response of responses) {
      const reportOnly = response.headers.get(
        'Content-Security-Policy-Report-Only',
      )
      if (reportOnly === null) continue
      const enforced = response.headers.get('Content-Security-Policy') ?? ''
      expect(enforced).toMatch(/script-src[^;]*'nonce-[a-f0-9]{32}'/)
    }
    // CONTROL. Every assertion above is inside a conditional, so a middleware
    // that stopped sending the report-only header entirely would pass it
    // vacuously — and "the measurement quietly stopped" is exactly the failure
    // AGL-1685 exists to avoid. At least one of these must carry one.
    expect(
      responses.filter((r) =>
        r.headers.get('Content-Security-Policy-Report-Only'),
      ),
    ).not.toHaveLength(0)
  })

  it('never lets the report-only policy carry a DIFFERENT nonce, or strict-dynamic', async () => {
    // Defence in depth behind the two clauses above. This used to assert that
    // the report-only header carried no `script-src` and no `nonce-` at all,
    // which was right while `img-src` was the only thing in it — AGL-1785 added
    // a report-only `script-src` to measure what the enforcing policy's bare
    // `https:` is covering, and that directive is worthless without a nonce.
    //
    // So the invariant is narrowed rather than dropped, and what replaces it is
    // STRONGER than what it removes. The hazard was never "a nonce is present";
    // it was "Next reads a nonce that does not match the rendered bytes"
    // (AGL-523: every script became `nonce="$undefined"`). Forbidding the
    // mechanism forbade one way of reaching that. Requiring every nonce in this
    // header to be the ENFORCING one forbids the outcome directly — including
    // the specific mistake of minting a second `randomUUID()` for the
    // report-only directive, which would report every inline Next script on
    // every page load and read as an all-clear the moment anyone stopped
    // looking.
    //
    // Two things carry the rest of the weight, and neither is asserted here:
    // the test above proves this header never ships without an enforcing one
    // carrying `script-src`, so the `||` always short-circuits before this
    // string is consulted; and console responses are uncached (`no-store`), so
    // a per-request nonce agrees with the bytes — measured, and structurally
    // guaranteed by the ENFORCING policy already depending on it.
    //
    // The tenant keeps the absolute version of this invariant in
    // `apps/tenant/specs/csp-no-script-src.spec.ts`, and must: its pages ARE
    // ISR-cached, so a per-request nonce there can never agree with the bytes
    // (AGL-1228). The two apps genuinely differ; one invariant no longer covers
    // both.
    const response = await middleware(request('app.aglyn.com'))
    const reportOnly =
      response.headers.get('Content-Security-Policy-Report-Only') ?? ''
    const enforced = response.headers.get('Content-Security-Policy') ?? ''
    expect(reportOnly).not.toContain('strict-dynamic')
    const enforcedNonce = /'nonce-([a-f0-9]{32})'/.exec(enforced)?.[1]
    expect(enforcedNonce).toBeTruthy()
    const reportedNonces = [
      ...reportOnly.matchAll(/'nonce-([a-f0-9]{32})'/g),
    ].map((match) => match[1])
    // Not `toContain`: EVERY nonce in the header has to be the enforcing one,
    // so a second directive quietly acquiring its own fails this.
    for (const nonce of reportedNonces) expect(nonce).toBe(enforcedNonce)
    // CONTROLS. Every assertion above passes vacuously against a header that
    // stopped shipping, or a `script-src` that quietly lost its nonce — and
    // "the measurement quietly stopped" is the failure AGL-1685 exists to
    // avoid.
    expect(reportOnly).toContain('img-src')
    expect(reportOnly).toContain('script-src')
    expect(reportedNonces).toHaveLength(1)
  })

  it('does not honour the retired ?csp= opt-in', async () => {
    // `?csp=off` used to disarm enforcement for a session. If that still
    // worked it would be a way for a link to WEAKEN the policy, which is the
    // opposite of what the affordance was for.
    const response = await middleware(
      request('app.aglyn.com', '/signin?csp=off'),
    )
    expect(response.headers.get('Content-Security-Policy')).toMatch(
      /script-src[^;]*'nonce-[a-f0-9]{32}'/,
    )
    expect(response.cookies.get('aglyn-csp-enforce')).toBeUndefined()
  })

  it('keeps `strict-dynamic` OUT of the enforcing policy', async () => {
    // Measured, not assumed: the same signed-in flow produced 1 violation
    // under `'self' https: blob:` and 70 under `'strict-dynamic'`, because
    // nonce propagation does not reach Next's chunk loads — so `'self'` going
    // inert takes the whole bundle with it. Re-adopting it blanks the console.
    const response = await middleware(request('app.aglyn.com'))
    const policy = response.headers.get('Content-Security-Policy') ?? ''
    expect(policy).not.toContain('strict-dynamic')
    expect(policy).toContain("script-src 'self' https: blob:")
  })

  it('points reporting at a same-origin path, never an absolute URL', async () => {
    // An absolute URL here would ship violation reports — which name our
    // internal paths and inline script samples — to whatever host the string
    // carried. Asserted on the reporting DIRECTIVES specifically: the policy
    // as a whole is full of absolute URLs by design, because `frame-ancestors`
    // is an allowlist of our own origins, so a blanket "no https://" check
    // would fail for a reason that has nothing to do with reporting.
    const response = await middleware(request('app.aglyn.com'))
    const policy = response.headers.get('Content-Security-Policy') ?? ''
    const reportUri = /report-uri ([^;]+)/.exec(policy)?.[1]?.trim()
    expect(reportUri).toBe(REPORT_PATH)
    expect(response.headers.get('Reporting-Endpoints')).not.toMatch(/https?:\/\//)
  })

  /**
   * `'unsafe-eval'` is the one directive here that is deliberately WEAKER off
   * production, so it needs both directions asserted. React's dev build evals
   * to reconstruct callstacks and the dev console is unusable without it; a
   * production policy carrying it would hand an injected string back its
   * ability to become code, and nothing else in this file would notice.
   *
   * `middleware` reads `NODE_ENV` per call, so flipping it around one await is
   * enough — no module reset needed.
   */
  describe("'unsafe-eval' is DEVELOPMENT ONLY", () => {
    const env = process.env as Record<string, string | undefined>
    const original = env.NODE_ENV

    afterEach(() => {
      env.NODE_ENV = original
    })

    it('grants it off production, so React dev mode can eval', async () => {
      env.NODE_ENV = 'development'
      const response = await middleware(request('app.aglyn.com'))
      expect(response.headers.get('Content-Security-Policy')).toContain(
        "'unsafe-eval'",
      )
    })

    it('NEVER grants it in production', async () => {
      // The regression that matters: this is the assertion standing between a
      // dev convenience and a real weakening shipped to every signed-in user.
      env.NODE_ENV = 'production'
      const response = await middleware(request('app.aglyn.com'))
      const policy = response.headers.get('Content-Security-Policy') ?? ''
      expect(policy).not.toContain('unsafe-eval')
      // Still a real policy, so the absence above cannot be passing because
      // the whole directive went missing.
      expect(policy).toMatch(/script-src[^;]*'nonce-[a-f0-9]{32}'/)
      expect(policy).not.toContain('unsafe-inline')
    })
  })
})

/**
 * The sanctions geo-block, driven through the REAL `middleware` export
 * (AGL-1492).
 *
 * `sanctions-geo.spec.ts` proves the policy is right. These prove it is
 * REACHED — on the actual request path, ahead of every other gate — which is
 * the half that a passing policy test cannot tell you anything about.
 */
describe('sanctions geo-block', () => {
  function geoRequest(
    country: string | null,
    region?: string,
    host = 'app.aglyn.com',
    path = '/signup',
  ) {
    const headers: Record<string, string> = { host }
    if (country) headers['x-vercel-ip-country'] = country
    if (region) headers['x-vercel-ip-country-region'] = region
    return new NextRequest(`https://${host}${path}`, { headers })
  }

  it.each(['CU', 'IR', 'KP', 'SY'])(
    'refuses a %s request with 451 before anything else runs',
    async (country) => {
      const response = await middleware(geoRequest(country))
      expect(response.status).toBe(451)
      // Ahead of the host gates: an embargoed request must not even reach the
      // verdict lookup, let alone be served.
      expect(fetchCalls).toHaveLength(0)
    },
  )

  it('refuses Donetsk — a country check alone would have served it', async () => {
    const response = await middleware(geoRequest('UA', '14'))
    expect(response.status).toBe(451)
  })

  it('serves the rest of Ukraine', async () => {
    const response = await middleware(geoRequest('UA', '30'))
    expect(response.status).toBe(200)
  })

  it('serves an allowed region normally, CSP and all', async () => {
    const response = await middleware(geoRequest('US', 'TX'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Security-Policy')).toContain('script-src')
  })

  it('FAILS OPEN when the edge sent no geo header', async () => {
    // Measured, not hypothetical: a production sign-in device record reads
    // "Unknown location", so this path carries real users — local dev, self
    // hosted installs, and anything the edge did not annotate.
    const response = await middleware(geoRequest(null))
    expect(response.status).toBe(200)
  })

  it('blocks the signin page too, not only signup', async () => {
    const response = await middleware(geoRequest('IR', undefined, 'app.aglyn.com', '/signin'))
    expect(response.status).toBe(451)
  })

  it('blocks a workspace subdomain and a custom console domain alike', async () => {
    expect((await middleware(geoRequest('IR', undefined, 'zgover.aglyn.com'))).status)
      .toBe(451)
    expect(
      (await middleware(geoRequest('IR', undefined, 'console.acme-agency.com'))).status,
    ).toBe(451)
  })
})

describe('the reserved /.well-known namespace (AGL-3016)', () => {
  /*
   * The catch-all these pin is `/[orgSlug]/[...pluginSlug]` (AGL-2974), which
   * claimed the whole namespace and answered 200 with the console shell. Each
   * path below is one a machine probes to decide that a protocol endpoint
   * EXISTS, so a 200 is not a cosmetic wrong answer — it is a false claim, and
   * `openid-configuration` on the auth host is the one that was believed.
   */
  it.each([
    '/.well-known/openid-configuration',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
    '/.well-known/security.txt',
    '/.well-known/apple-app-site-association',
    '/.well-known/anything-we-do-not-serve',
  ])('answers 404 for %s', async (path) => {
    const response = await middleware(request('app.aglyn.com', path))
    expect(response.status).toBe(404)
  })

  it('answers 404 on the auth host, which is the one an OIDC client probes', async () => {
    const response = await middleware(
      request('auth.aglyn.com', '/.well-known/openid-configuration'),
    )
    expect(response.status).toBe(404)
  })

  it('refuses the bare namespace root too', async () => {
    expect(
      (await middleware(request('app.aglyn.com', '/.well-known'))).status,
    ).toBe(404)
  })

  it('spends no verdict lookup on a path that names nothing', async () => {
    // A workspace subdomain would otherwise cost a slug lookup. Ordering, not
    // politeness: the gate has to sit above every Firestore-backed verdict.
    await middleware(
      request('zgover.aglyn.com', '/.well-known/openid-configuration'),
    )
    expect(fetchCalls).toHaveLength(0)
  })

  it('still lets the geo refusal answer first', async () => {
    const response = await middleware(
      new NextRequest(
        'https://app.aglyn.com/.well-known/openid-configuration',
        {
          headers: {
            host: 'app.aglyn.com',
            'x-vercel-ip-country': 'IR',
          },
        },
      ),
    )
    expect(response.status).toBe(451)
  })

  it('is anchored at the root, so a segment spelled the same way is served', async () => {
    // `/acme/.well-known/x` is an org path whose surface happens to be spelled
    // like the namespace. Nothing discovers a protocol endpoint there.
    // A KNOWN workspace, deliberately: since AGL-3017 an unknown first
    // segment answers 404 on its own, which would pass this for the wrong
    // reason.
    const response = await middleware(
      request('app.aglyn.com', '/zgover/.well-known/x'),
    )
    expect(response.status).toBe(200)
  })

  it('leaves an ordinary console page alone', async () => {
    const response = await middleware(request('app.aglyn.com', '/signin'))
    expect(response.status).toBe(200)
  })
})

describe('Cross-Origin-Opener-Policy (AGL-3046)', () => {
  /*
   * The published site's admin bar opens `/edit-access` in a popup and reads
   * the edit token back through `window.opener`. Any isolating COOP on that
   * response moves the popup to a new browsing context group and nulls the
   * opener — measured in Chrome with the exact pair production sends — so the
   * page said "Connected" to a site that never received anything. The page's
   * own spec mocks `window.opener`, which is why only this header can pin it.
   */
  const coop = async (host: string, path: string) =>
    (await middleware(request(host, path))).headers.get(
      'Cross-Origin-Opener-Policy',
    )

  it('leaves /edit-access its opener, so the popup can hand the token back', async () => {
    expect(
      await coop(
        'app.aglyn.com',
        '/edit-access?hostId=host-1&origin=https%3A%2F%2Fwww.example.com',
      ),
    ).toBe('unsafe-none')
  })

  it.each([
    ['app.aglyn.com', '/signin'],
    ['app.aglyn.com', '/'],
    ['app.aglyn.com', '/zgover/hosts'],
    ['zgover.aglyn.com', '/hosts'],
    ['console.acme-agency.com', '/hosts'],
  ])('isolates every other page from its opener — %s%s', async (host, path) => {
    expect(await coop(host, path)).toBe('same-origin-allow-popups')
  })

  it('is an exact path, not a prefix', async () => {
    // A workspace page whose path merely ENDS with the name keeps its
    // isolation.
    expect(await coop('app.aglyn.com', '/zgover/edit-access')).toBe(
      'same-origin-allow-popups',
    )
    // A top-level path that merely begins with the name is not the page — and
    // since AGL-3017 it names no route and no workspace, so it never reaches
    // the page policy at all.
    expect(
      (await middleware(request('app.aglyn.com', '/edit-access-log'))).status,
    ).toBe(404)
  })

  it('keeps the rest of the page policy on /edit-access', async () => {
    // Only the opener policy moves. The page still refuses to be framed by
    // anything but first-party hosts, and still runs under the nonce'd CSP.
    const response = await middleware(request('app.aglyn.com', '/edit-access'))
    const policy = response.headers.get('Content-Security-Policy') ?? ''
    expect(policy).toContain('frame-ancestors')
    expect(policy).toMatch(/script-src [^;]*'nonce-/)
  })
})

describe('the auth origin serves only its own family (AGL-3090)', () => {
  /*
   * These are the paths an agent-readiness scanner walks looking for an
   * authorization server. Every one of them rendered the console shell with a
   * 200, because `auth.aglyn.com` is a console domain and `[orgSlug]` binds to
   * anything. Closing `/.well-known/*` alone (AGL-3016) only moved the scanner
   * to the next name on its list, which is why the rule here is about the HOST
   * rather than about any particular path.
   */
  it.each([
    '/oauth/authorize',
    '/oauth/token',
    '/oauth/jwks',
    '/authorize',
    '/connect/authorize',
    '/openid/authorize',
    '/saml/metadata',
  ])('answers 404 for %s on the auth host', async (path) => {
    const response = await middleware(request('auth.aglyn.com', path))
    expect(response.status).toBe(404)
  })

  it('refuses an org path there too — it is not a console', async () => {
    expect(
      (await middleware(request('auth.aglyn.com', '/acme/hosts/site'))).status,
    ).toBe(404)
  })

  it.each([
    '/',
    '/signin',
    '/signup',
    '/signout',
    '/verify-email',
    '/account-recovery',
    '/auth/handoff/start',
    '/auth/handoff/continue',
  ])('still serves %s, which is what the host is for', async (path) => {
    const response = await middleware(request('auth.aglyn.com', path))
    expect(response.status).toBe(200)
  })

  it('spends no verdict lookup refusing a path the host does not serve', async () => {
    await middleware(request('auth.aglyn.com', '/oauth/authorize'))
    expect(fetchCalls).toHaveLength(0)
  })

  it('still lets the geo refusal answer first', async () => {
    const response = await middleware(
      new NextRequest('https://auth.aglyn.com/oauth/authorize', {
        headers: { host: 'auth.aglyn.com', 'x-vercel-ip-country': 'IR' },
      }),
    )
    expect(response.status).toBe(451)
  })

  it('refuses without a verdict lookup, unlike the console host', async () => {
    // The point of the host rule: on the auth origin nothing below the top
    // level can be a workspace, so no slug has to be resolved to know that.
    await middleware(request('auth.aglyn.com', '/acme/hosts/site'))
    expect(fetchCalls).toHaveLength(0)
    // The console host reaches the same refusal by a different road (AGL-3017)
    // — it asks first, because there a first segment CAN name a workspace.
    expect(
      (await middleware(request('app.aglyn.com', '/acme/hosts/site'))).status,
    ).toBe(404)
    expect(fetchCalls).not.toHaveLength(0)
  })
})

describe('no console URL is wrong any more (AGL-3017)', () => {
  /*
   * `[orgSlug]` binds to anything, so every unmatched console URL rendered the
   * shell with a 200. These are the probes an agent-readiness audit walks; it
   * read the 200s as an authorization server we do not run.
   */
  it.each([
    '/oauth/authorize',
    '/oauth/token',
    '/authorize',
    '/connect/authorize',
    '/notanorg/notasurface',
    '/definitely-not-a-page-xyz',
  ])('answers 404 for %s, which names no workspace', async (path) => {
    expect((await middleware(request('app.aglyn.com', path))).status).toBe(404)
  })

  it.each(['/zgover', '/zgover/hosts/site', '/aglyn-org/settings'])(
    'still serves %s, which names a real one',
    async (path) => {
      expect((await middleware(request('app.aglyn.com', path))).status).toBe(200)
    },
  )

  /*
   * The list that decides this is `CONSOLE_TOP_LEVEL_SEGMENTS`, and its first
   * draft was `APEX_PATH_SEGMENTS` — which omits all four of these. Two are
   * credential flows, so that draft would have answered 404 to a password
   * reset and to SSO sign-in.
   */
  it.each([
    '/signin',
    '/signup',
    '/signout',
    '/verify-email',
    '/account-recovery',
    '/reset-password',
    '/sso',
    '/billing',
    '/edit-access',
    '/manage',
    '/admin',
    '/auth/handoff/start',
    '/',
  ])('serves %s without spending a verdict on it', async (path) => {
    const response = await middleware(request('app.aglyn.com', path))
    expect(response.status).toBe(200)
    expect(fetchCalls).toHaveLength(0)
  })

  it('leaves the framework its own namespace', async () => {
    // `_next/data` is inside the matcher and is not ours to enumerate.
    const response = await middleware(request('app.aglyn.com', '/_next/data/x.json'))
    expect(response.status).toBe(200)
    expect(fetchCalls).toHaveLength(0)
  })

  it('does not 404 a renamed workspace — the app still owes it a redirect', async () => {
    expect(
      (await middleware(request('app.aglyn.com', '/zach-gover/hosts/site'))).status,
    ).toBe(200)
  })

  it('FAILS OPEN when the verdict lookup errors', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    // A Firestore blip must serve the console, never 404 it.
    expect(
      (await middleware(request('app.aglyn.com', '/outage-path-check/hosts/x'))).status,
    ).toBe(200)
  })

  it('does not apply where the org comes from the HOST, not the path', async () => {
    // On a workspace subdomain `/hosts/site` is a page inside that org, not a
    // slug. Reading it as one would 404 every real page on every subdomain.
    expect(
      (await middleware(request('zgover.aglyn.com', '/hosts/site'))).status,
    ).toBe(200)
    // Same for a custom console domain, which is rewritten into its one org.
    expect(
      (await middleware(request('console.acme-agency.com', '/hosts/site'))).status,
    ).toBe(200)
  })

  it('trusts an UNKNOWN verdict for less time than a known one', async () => {
    // `Date.now` rather than fake timers: the TTL is the only clock in play,
    // and faking every timer stalls the awaited verdict fetch instead.
    const now = jest.spyOn(Date, 'now')
    try {
      now.mockReturnValue(1_000_000)
      await middleware(request('app.aglyn.com', '/ttl-unknown-slug/x'))
      await middleware(request('app.aglyn.com', '/ttl-known-slug/x'))
      expect(fetchCalls).toHaveLength(2)

      // Six seconds on: past the negative window, well inside the positive
      // one. An org created moments after something probed its slug must not
      // stay 404 for the rest of a minute.
      now.mockReturnValue(1_006_000)
      await middleware(request('app.aglyn.com', '/ttl-unknown-slug/x'))
      await middleware(request('app.aglyn.com', '/ttl-known-slug/x'))
      expect(fetchCalls).toHaveLength(3)
    } finally {
      now.mockRestore()
    }
  })
})
