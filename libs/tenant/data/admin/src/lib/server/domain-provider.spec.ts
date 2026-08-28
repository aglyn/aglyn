/**
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
 * The domain-provider seam — how a hostname becomes reachable without a
 * hosting vendor's API.
 *
 * Two failure modes are worth more than the happy path, and both end with a
 * customer looking at a green chip on a domain that resolves nowhere:
 * selecting a driver that asserts names are served when nobody said so, and
 * accepting an operator endpoint's answer without checking it is one of ours.
 */

const BASE: Record<string, string | undefined> = {
  VERCEL_TOKEN: undefined,
  VERCEL_CONSOLE_PROJECT_ID: undefined,
  VERCEL_TENANT_PROJECT_ID: undefined,
  AGLYN_DOMAIN_PROVIDER: undefined,
  AGLYN_DOMAIN_WEBHOOK_URL: undefined,
  AGLYN_DOMAIN_WEBHOOK_TOKEN: undefined,
  AGLYN_DOMAIN_WILDCARD_SUFFIXES: undefined,
  NEXT_PUBLIC_WORKSPACE_DOMAIN: 'example.com',
  NEXT_PUBLIC_TENANT_DOMAIN: 'sites.example',
}

const original = { ...process.env }

function env(overrides: Record<string, string | undefined> = {}): void {
  for (const [key, value] of Object.entries({ ...BASE, ...overrides })) {
    if (value === undefined) delete (process.env as Record<string, unknown>)[key]
    else (process.env as Record<string, string>)[key] = value
  }
}

/**
 * `domainProvider()` memoizes on the environment values it reads, so a fresh
 * module is not needed between cases — but it IS needed between the suites
 * below, because a driver that captured a stale suffix list would pass every
 * case for the wrong reason.
 */
async function load() {
  jest.resetModules()
  return import('./domain-provider')
}

afterEach(() => {
  process.env = { ...original } as NodeJS.ProcessEnv
  jest.restoreAllMocks()
})

describe('picking a driver', () => {
  it('THE CONTROL: a Vercel token alone selects the Vercel driver', async () => {
    // Every "does not select" case below is only worth something because this
    // proves detection selects anything at all.
    env({ VERCEL_TOKEN: 'tok', VERCEL_CONSOLE_PROJECT_ID: 'prj' })
    const { domainProvider } = await load()
    expect(domainProvider().id).toBe('vercel')
  })

  it('selects nothing when there is nothing to select', async () => {
    env()
    const { domainProvider } = await load()
    expect(domainProvider().id).toBe('none')
  })

  it('NEVER infers wildcard, however configured the apexes look', async () => {
    /*
     * The case this seam is most dangerous without. The wildcard driver
     * reports a name as SERVING without checking anything, on the strength of
     * an operator's assertion that their proxy answers for the whole apex.
     * `NEXT_PUBLIC_WORKSPACE_DOMAIN` is set on every deployment — inferring
     * from it would have a fresh install show green chips on addresses that
     * resolve nowhere, which is exactly the bug the driver exists to fix.
     */
    env({ NEXT_PUBLIC_WORKSPACE_DOMAIN: 'example.com' })
    const { domainProvider } = await load()
    expect(domainProvider().id).toBe('none')
  })

  it('an explicit choice wins over what is detectable', async () => {
    // Including switching a driver OFF while its credentials are still in the
    // environment, which is how an operator migrates away from one.
    env({ AGLYN_DOMAIN_PROVIDER: 'none', VERCEL_TOKEN: 'tok' })
    expect((await load()).domainProvider().id).toBe('none')

    env({ AGLYN_DOMAIN_PROVIDER: 'wildcard', VERCEL_TOKEN: 'tok' })
    expect((await load()).domainProvider().id).toBe('wildcard')
  })

  it('falls back to detection on a value it does not recognize, and says so', async () => {
    // A typo must not silently disable domains: the deployment still gets the
    // driver it has credentials for, and the operator gets a line naming the
    // valid values.
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    env({ AGLYN_DOMAIN_PROVIDER: 'vercell', VERCEL_TOKEN: 'tok' })
    const { domainProvider } = await load()
    expect(domainProvider().id).toBe('vercel')
    expect(error).toHaveBeenCalled()
  })
})

describe('what counts as serving', () => {
  it('a pending certificate does not (AGL-1996)', async () => {
    // The name is routed but answers with a TLS error, which is worse than a
    // 404 for a customer who has just been told their site is live.
    const { domainStateServes } = await load()
    expect(domainStateServes('certificate-pending')).toBe(false)
    expect(domainStateServes('ownership-pending')).toBe(false)
    expect(domainStateServes('dns-misconfigured')).toBe(false)
    expect(domainStateServes('not-attached')).toBe(false)
  })

  it('a probe that could not answer is not evidence of a problem', async () => {
    /*
     * Deliberate, and the reason the wildcard and webhook drivers may return
     * `unknown` freely: treating "no answer" as "broken" would strand every
     * live domain on a deployment whose provider has no status API — which is
     * most of them.
     */
    const { domainStateServes } = await load()
    expect(domainStateServes('unknown')).toBe(true)
    expect(domainStateServes('skipped')).toBe(true)
    expect(domainStateServes('serving')).toBe(true)
  })
})

describe('the wildcard driver', () => {
  const wildcard = async () => {
    env({ AGLYN_DOMAIN_PROVIDER: 'wildcard' })
    return (await load()).domainProvider()
  }

  it('THE CONTROL: a workspace subdomain is attached and serving', async () => {
    const provider = await wildcard()
    expect(await provider.attach('console', 'acme.example.com')).toMatchObject({
      outcome: 'attached',
    })
    expect(await provider.status('console', 'acme.example.com')).toMatchObject({
      state: 'serving',
    })
  })

  it('covers ONE label, because that is what a wildcard covers', async () => {
    /*
     * `*.example.com` serves `a.example.com` and does not serve
     * `a.b.example.com`, and a certificate for it covers exactly the same set.
     * An "ends with the suffix" test would report the deeper name as serving,
     * which the operator discovers as a TLS error before we do.
     */
    const provider = await wildcard()
    expect(await provider.status('console', 'deep.acme.example.com')).toMatchObject({
      state: 'unknown',
    })
    // Nor the apex itself: a wildcard record does not answer for it.
    expect(await provider.status('console', 'example.com')).toMatchObject({
      state: 'unknown',
    })
  })

  it('never claims a customer domain it cannot see', async () => {
    /*
     * The honest middle. `skipped`/`unknown` rather than `attached`/`serving`,
     * because nobody's wildcard covers `shop.acme.co` — and rather than
     * `failed`/`not-attached`, because an operator who added a vhost by hand
     * has a working domain this driver has no way to observe.
     */
    const provider = await wildcard()
    const attached = await provider.attach('tenant', 'shop.acme.co')
    expect(attached.outcome).toBe('skipped')
    expect(attached.detail).toContain('example.com')
    expect((await provider.status('tenant', 'shop.acme.co')).state).toBe('unknown')
  })

  it('serves the tenant apex as well as the workspace one', async () => {
    // Both are names the product hands out, so both are what an operator
    // choosing this driver is choosing it for.
    const provider = await wildcard()
    expect(await provider.status('tenant', 'acme.sites.example')).toMatchObject({
      state: 'serving',
    })
  })

  it('takes an explicit suffix list, `*.` and all', async () => {
    env({
      AGLYN_DOMAIN_PROVIDER: 'wildcard',
      AGLYN_DOMAIN_WILDCARD_SUFFIXES: '*.corp.internal, other.test',
    })
    const provider = (await load()).domainProvider()
    expect(await provider.status('console', 'a.corp.internal')).toMatchObject({
      state: 'serving',
    })
    expect(await provider.status('console', 'b.other.test')).toMatchObject({
      state: 'serving',
    })
    // The defaults are REPLACED, not added to — an operator listing their own
    // apexes is describing their whole certificate.
    expect(await provider.status('console', 'a.example.com')).toMatchObject({
      state: 'unknown',
    })
  })

  it('covers NOTHING when nobody has named an apex', async () => {
    /*
     * ⛔ No hardcoded fallback, and this is the case that says why. Elsewhere
     * an unset `NEXT_PUBLIC_TENANT_DOMAIN` may default to Aglyn's own name,
     * because the consequence is a visibly wrong URL the operator corrects on
     * their first click. Here the consequence is different in kind: this
     * driver ASSERTS the names it covers are served, so a default would have
     * an operator's install report `serving` for `*.aglyn.com` — a domain they
     * do not own and never named.
     */
    env({
      AGLYN_DOMAIN_PROVIDER: 'wildcard',
      NEXT_PUBLIC_WORKSPACE_DOMAIN: undefined,
      NEXT_PUBLIC_TENANT_DOMAIN: undefined,
    })
    const provider = (await load()).domainProvider()
    for (const name of ['acme.aglyn.com', 'acme.aglyn.app', 'a.example.com']) {
      expect(await provider.status('console', name)).toMatchObject({
        state: 'unknown',
      })
      expect(await provider.attach('console', name)).toMatchObject({
        outcome: 'skipped',
      })
    }
  })

  it('satisfies a redirect without an edge rule', async () => {
    /*
     * The renamed workspace's old slug still resolves under the wildcard, and
     * the app's own canonical redirect 308s it to the new one — which is the
     * behaviour the edge rule was imitating. `attached` is true here rather
     * than merely convenient.
     */
    const provider = await wildcard()
    expect(
      await provider.attach('console', 'old.example.com', {
        redirectTo: 'https://new.example.com/dashboard',
      }),
    ).toMatchObject({ outcome: 'attached' })
  })

  it('reports a detach honestly: there is no entry to remove', async () => {
    // A wildcard cannot un-serve one of its names. Saying `detached` would
    // claim an effect that did not happen.
    const provider = await wildcard()
    expect(await provider.detach('console', 'acme.example.com')).toMatchObject({
      outcome: 'not-found',
    })
  })
})

describe('the webhook driver', () => {
  let fetchMock: jest.Mock

  const webhook = async (overrides: Record<string, string | undefined> = {}) => {
    env({
      AGLYN_DOMAIN_PROVIDER: 'webhook',
      AGLYN_DOMAIN_WEBHOOK_URL: 'https://proxy.internal/domains',
      ...overrides,
    })
    return (await load()).domainProvider()
  }

  const respond = (status: number, body: unknown) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as never

  beforeEach(() => {
    fetchMock = jest.fn()
    ;(globalThis as { fetch: unknown }).fetch = fetchMock
  })

  it('THE CONTROL: relays what the endpoint answered, and its own detail', async () => {
    fetchMock.mockResolvedValue(
      respond(200, { outcome: 'attached', detail: 'added to caddy' }),
    )
    const provider = await webhook()
    expect(await provider.attach('tenant', 'shop.acme.co')).toMatchObject({
      outcome: 'attached',
      domain: 'shop.acme.co',
      detail: 'added to caddy',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://proxy.internal/domains')
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      action: 'attach',
      scope: 'tenant',
      domain: 'shop.acme.co',
    })
  })

  it('an unrecognized outcome is a FAILURE, never a success', async () => {
    /*
     * The case that decides whether a typo costs a customer their domain.
     * `{"outcome":"attach"}` has registered nothing; reading it as success
     * leaves a workspace advertising a URL that resolves nowhere, and nothing
     * downstream ever asks again.
     */
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    fetchMock.mockResolvedValue(respond(200, { outcome: 'attach' }))
    const provider = await webhook()
    expect(await provider.attach('console', 'a.example.com')).toMatchObject({
      outcome: 'failed',
      detail: 'bad-outcome',
    })
  })

  it('a status it cannot parse is unknown, never not-attached', async () => {
    // `not-attached` blocks the domain; `unknown` does not. An endpoint that
    // answered badly is not evidence that the name is missing.
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    fetchMock.mockResolvedValue(respond(200, { state: 'live' }))
    const provider = await webhook()
    expect(await provider.status('tenant', 'shop.acme.co')).toMatchObject({
      state: 'unknown',
      detail: 'bad-state',
    })
  })

  it('an endpoint that is down does not strand every live domain', async () => {
    // The operator's service restarting must not turn every customer's
    // working site into a broken one in the console.
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const provider = await webhook()
    expect(await provider.status('tenant', 'shop.acme.co')).toMatchObject({
      state: 'unknown',
      detail: 'network',
    })
    // …but an attach that did not happen is still a failure, because the
    // caller has to know the name was not registered.
    expect(await provider.attach('tenant', 'shop.acme.co')).toMatchObject({
      outcome: 'failed',
    })
  })

  it('reports a non-2xx as failed, with the status', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    fetchMock.mockResolvedValue(respond(503, null))
    const provider = await webhook()
    expect(await provider.detach('tenant', 'shop.acme.co')).toMatchObject({
      outcome: 'failed',
      detail: '503',
    })
  })

  it('carries the bearer token only when one is configured', async () => {
    fetchMock.mockResolvedValue(respond(200, { outcome: 'attached' }))
    let provider = await webhook({ AGLYN_DOMAIN_WEBHOOK_TOKEN: 'sec' })
    await provider.attach('console', 'a.example.com')
    expect(
      (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers[
        'Authorization'
      ],
    ).toBe('Bearer sec')

    fetchMock.mockClear()
    provider = await webhook()
    await provider.attach('console', 'a.example.com')
    expect(
      (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers,
    ).not.toHaveProperty('Authorization')
  })

  it('sends a redirect as a BARE HOSTNAME, and refuses one that is not', async () => {
    /*
     * Normalized before the wire so an operator's endpoint receives the same
     * shape Vercel demands and no two drivers disagree. Vercel rejects a URL
     * here with an error blaming the target for being absent — the misreading
     * that let AGL-1273's redirect ship looking correct and never once work.
     */
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    fetchMock.mockResolvedValue(respond(200, { outcome: 'attached' }))
    const provider = await webhook()
    await provider.attach('console', 'old.example.com', {
      redirectTo: 'https://new.example.com/path?x=1',
    })
    expect(
      JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body).redirectTo,
    ).toBe('new.example.com')

    fetchMock.mockClear()
    expect(
      await provider.attach('console', 'old.example.com', { redirectTo: 'not a host' }),
    ).toMatchObject({ outcome: 'failed', detail: 'invalid-redirect' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is skipped, not failed, with no URL configured', async () => {
    // Same rule as every other driver: unconfigured is not an error, and must
    // not log one per signup forever.
    env({ AGLYN_DOMAIN_PROVIDER: 'webhook' })
    const provider = (await load()).domainProvider()
    expect(provider.configured('tenant')).toBe(false)
    expect(await provider.attach('tenant', 'shop.acme.co')).toMatchObject({
      outcome: 'skipped',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
