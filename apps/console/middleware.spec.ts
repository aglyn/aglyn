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
    for (const path of [
      '/signin',
      '/signup',
      '/verify-email',
      '/account-recovery',
    ]) {
      const response = await middleware(request('console.acme-agency.com', path))
      expect(response.status).toBe(307)
      const location = new URL(response.headers.get('location') ?? '')
      expect(location.hostname).toBe('app.aglyn.com')
      expect(location.pathname).toBe(path)
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
 * These assert the wiring end to end, because every part of it fails SILENTLY:
 * a `report-to` group with no `Reporting-Endpoints` header is ignored, a
 * missing `report-uri` loses the browsers that only speak the old directive,
 * and either way the symptom is an empty log that reads exactly like "no
 * violations" — the same false all-clear the endpoint exists to end.
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
    // Both, not either: `report-uri` is deprecated but is what Safari and
    // older Chrome actually send, and `report-to` is what the modern ones use.
    expect(policy).toContain(`report-uri ${REPORT_PATH}`)
    expect(policy).toContain('report-to csp')
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

  it('emits exactly ONE policy header, never a report-only twin', async () => {
    // This is the regression guard for the bug that cost AGL-523 months. Next
    // resolves the nonce as `content-security-policy || …-report-only`, so a
    // second header does not add a policy — it SHADOWS the nonce, and every
    // script renders `nonce="$undefined"` while a valid nonce sits unused.
    // One header carrying script-src is what makes the nonce real.
    const response = await middleware(request('app.aglyn.com'))
    expect(response.headers.get('Content-Security-Policy-Report-Only')).toBeNull()
    expect(response.headers.get('Content-Security-Policy')).toContain('script-src')
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
