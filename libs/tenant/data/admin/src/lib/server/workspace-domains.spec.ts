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
 * The workspace-subdomain attach/detach (AGL-1136).
 *
 * This had no coverage at all, and the reconcile script beside it does not
 * count — that script reimplements the same two HTTP calls rather than calling
 * these functions, so a green reconcile says nothing about this file. The only
 * thing that had ever exercised it was org creation in production, where the
 * failure mode is silence by design.
 *
 * Verified live against the real project before writing this, so the outcomes
 * asserted here are measured rather than assumed:
 *
 *     attach   → { outcome: 'attached' }        12 → 13 domains
 *     attach   → { outcome: 'already-exists' }  (idempotent, second call)
 *     detach   → { outcome: 'detached' }        13 → 12 domains
 *
 * The property that matters most is the last block: NOTHING here may throw.
 * A workspace must not fail to be created because a DNS API was slow.
 */

const ENV = {
  VERCEL_TOKEN: 'tok_test',
  VERCEL_CONSOLE_PROJECT_ID: 'prj_test',
  VERCEL_TEAM_ID: 'team_test',
  NEXT_PUBLIC_WORKSPACE_DOMAIN: 'aglyn.com',
}

/** Re-import with a chosen env — `WORKSPACE_DOMAIN` is read at module load. */
async function load(overrides: Partial<Record<string, string | undefined>> = {}) {
  jest.resetModules()
  for (const [key, value] of Object.entries({ ...ENV, ...overrides })) {
    if (value === undefined) delete (process.env as Record<string, string | undefined>)[key]
    else process.env[key] = value
  }
  return import('./workspace-domains')
}

function respond(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const fetchMock = jest.fn()
const originalEnv = { ...process.env }

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

describe('attachWorkspaceDomain', () => {
  it('POSTs the slug as a subdomain of the workspace domain, on the right team', async () => {
    fetchMock.mockResolvedValue(respond(200))
    const { attachWorkspaceDomain } = await load()

    expect(await attachWorkspaceDomain('acme')).toEqual({
      outcome: 'attached',
      domain: 'acme.aglyn.com',
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://api.vercel.com/v10/projects/prj_test/domains?teamId=team_test',
    )
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ name: 'acme.aglyn.com' })
    expect(init.headers.Authorization).toBe('Bearer tok_test')
  })

  it('treats an already-attached domain as success, both ways Vercel says it', async () => {
    // Idempotency is what lets the reconcile script and the create path run
    // without coordinating — the live probe hit this on its second call.
    for (const response of [
      respond(400, { error: { code: 'domain_already_in_use' } }),
      respond(409, { error: { code: 'something_else' } }),
    ]) {
      fetchMock.mockReset().mockResolvedValue(response)
      const { attachWorkspaceDomain } = await load()
      expect(await attachWorkspaceDomain('acme')).toEqual({
        outcome: 'already-exists',
        domain: 'acme.aglyn.com',
      })
    }
  })

  it('reports a real error as failed, carrying the code', async () => {
    fetchMock.mockResolvedValue(respond(403, { error: { code: 'forbidden' } }))
    const { attachWorkspaceDomain } = await load()
    expect(await attachWorkspaceDomain('acme')).toEqual({
      outcome: 'failed',
      domain: 'acme.aglyn.com',
      detail: 'forbidden',
    })
  })

  it('normalises the slug rather than trusting its case or padding', async () => {
    fetchMock.mockResolvedValue(respond(200))
    const { attachWorkspaceDomain } = await load()
    await attachWorkspaceDomain('  AcMe  ')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      name: 'acme.aglyn.com',
    })
  })

  it('honours NEXT_PUBLIC_WORKSPACE_DOMAIN instead of hardcoding aglyn.com', async () => {
    fetchMock.mockResolvedValue(respond(200))
    const { attachWorkspaceDomain } = await load({
      NEXT_PUBLIC_WORKSPACE_DOMAIN: 'example.test',
    })
    expect((await attachWorkspaceDomain('acme')).domain).toBe('acme.example.test')
  })
})

describe('redirectHostname — Vercel takes a BARE HOSTNAME (AGL-1365)', () => {
  it('reduces a URL to its host rather than sending one', async () => {
    // `https://aglyn.com` comes back as `bad_request: Unable to redirect to
    // "https://…", because that domain is not added to the project`. The
    // message blames the target for being absent when the format was wrong,
    // which is why AGL-1273's redirect shipped looking correct and never once
    // succeeded — for weeks, until AGL-1365.
    const { redirectHostname } = await load()
    expect(redirectHostname('https://acme.com')).toBe('acme.com')
    expect(redirectHostname('https://acme.com/path?utm=1')).toBe('acme.com')
    expect(redirectHostname('  HTTP://Acme.COM.  ')).toBe('acme.com')
    expect(redirectHostname('acme.com')).toBe('acme.com')
  })

  it('returns null for anything that is not a hostname', async () => {
    const { redirectHostname } = await load()
    for (const bad of ['', '   ', 'acme', 'https://', '-acme.com', 'acme..com']) {
      expect(redirectHostname(bad)).toBeNull()
    }
  })
})

describe('attachProjectDomain', () => {
  it('sends a bare-hostname redirect and a 307, never a URL', async () => {
    fetchMock.mockResolvedValue(respond(200))
    const { attachProjectDomain } = await load()
    await attachProjectDomain('www.acme.com', { redirectTo: 'https://acme.com' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({
      name: 'www.acme.com',
      redirect: 'acme.com',
      redirectStatusCode: 307,
    })
    expect(body.redirect).not.toMatch(/^https?:\/\//)
  })

  it('refuses a redirect target it cannot reduce, without calling Vercel', async () => {
    const { attachProjectDomain } = await load()
    expect(await attachProjectDomain('www.acme.com', { redirectTo: 'nonsense' })).toEqual({
      outcome: 'failed',
      domain: 'www.acme.com',
      detail: 'invalid-redirect',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('PATCHes an existing name so the redirect is actually applied', async () => {
    // A name already on the project answers `domain_already_in_use`. Treating
    // that as done would leave the twin SERVING the console instead of
    // forwarding to the primary.
    fetchMock
      .mockResolvedValueOnce(respond(409, { error: { code: 'domain_already_in_use' } }))
      .mockResolvedValueOnce(respond(200))
    const { attachProjectDomain } = await load()
    expect(await attachProjectDomain('www.acme.com', { redirectTo: 'acme.com' })).toEqual({
      outcome: 'already-exists',
      domain: 'www.acme.com',
    })
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe(
      'https://api.vercel.com/v9/projects/prj_test/domains/www.acme.com?teamId=team_test',
    )
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({
      redirect: 'acme.com',
      redirectStatusCode: 307,
    })
  })

  it('does not PATCH when there is no redirect to apply', async () => {
    fetchMock.mockResolvedValue(
      respond(409, { error: { code: 'domain_already_in_use' } }),
    )
    const { attachProjectDomain } = await load()
    expect(await attachProjectDomain('console.acme.com')).toEqual({
      outcome: 'already-exists',
      domain: 'console.acme.com',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('takes a fully-qualified name, unchanged by the workspace domain', async () => {
    fetchMock.mockResolvedValue(respond(200))
    const { attachProjectDomain } = await load()
    await attachProjectDomain('  Console.Acme-Agency.com.  ')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      name: 'console.acme-agency.com',
    })
  })
})

describe('detachWorkspaceDomain', () => {
  it('DELETEs the domain', async () => {
    fetchMock.mockResolvedValue(respond(200))
    const { detachWorkspaceDomain } = await load()

    expect(await detachWorkspaceDomain('acme')).toEqual({
      outcome: 'detached',
      domain: 'acme.aglyn.com',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://api.vercel.com/v9/projects/prj_test/domains/acme.aglyn.com?teamId=team_test',
    )
    expect(init.method).toBe('DELETE')
  })

  it('reports an absent domain as not-found, not as a failure', async () => {
    // Erasing a workspace whose domain was never attached is a normal
    // outcome, and calling it a failure would page someone for nothing.
    fetchMock.mockResolvedValue(respond(404))
    const { detachWorkspaceDomain } = await load()
    expect(await detachWorkspaceDomain('acme')).toEqual({
      outcome: 'not-found',
      domain: 'acme.aglyn.com',
    })
  })
})

describe('configuration', () => {
  it('skips without calling Vercel when a required variable is missing', async () => {
    for (const missing of ['VERCEL_TOKEN', 'VERCEL_CONSOLE_PROJECT_ID']) {
      fetchMock.mockReset()
      const mod = await load({ [missing]: undefined })
      expect(mod.workspaceDomainsConfigured()).toBe(false)
      expect(await mod.attachWorkspaceDomain('acme')).toEqual({
        outcome: 'skipped',
        domain: 'acme.aglyn.com',
      })
      expect(await mod.detachWorkspaceDomain('acme')).toEqual({
        outcome: 'skipped',
        domain: 'acme.aglyn.com',
      })
      expect(fetchMock).not.toHaveBeenCalled()
    }
  })

  it('omits the team query entirely when no team is set', async () => {
    fetchMock.mockResolvedValue(respond(200))
    const { attachWorkspaceDomain } = await load({ VERCEL_TEAM_ID: undefined })
    await attachWorkspaceDomain('acme')
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.vercel.com/v10/projects/prj_test/domains',
    )
  })

  it('skips an empty slug rather than attaching the bare domain', async () => {
    // `''` would produce `.aglyn.com`, and on the detach side that is a
    // request to delete the apex.
    const mod = await load()
    expect(await mod.attachWorkspaceDomain('')).toMatchObject({ outcome: 'skipped' })
    expect(await mod.detachWorkspaceDomain('')).toMatchObject({ outcome: 'skipped' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('it never takes the caller down with it (AGL-1136)', () => {
  // The load-bearing property. Org creation AWAITS these, so anything that
  // rejects or hangs stops a workspace from being created — and the whole
  // reason this call is best-effort is that it can lose alone.
  const brokenFetches: Array<[string, () => unknown]> = [
    ['network error', () => Promise.reject(new Error('ECONNREFUSED'))],
    [
      'timeout',
      () => Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })),
    ],
    ['abort', () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))],
    ['500 with an unreadable body', () => ({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json') },
    })],
    ['a response that is not a response at all', () => undefined],
  ]

  for (const [label, impl] of brokenFetches) {
    it(`resolves rather than throws on ${label}`, async () => {
      fetchMock.mockImplementation(impl as () => Promise<Response>)
      const mod = await load()
      await expect(mod.attachWorkspaceDomain('acme')).resolves.toMatchObject({
        domain: 'acme.aglyn.com',
      })
      await expect(mod.detachWorkspaceDomain('acme')).resolves.toMatchObject({
        domain: 'acme.aglyn.com',
      })
    })
  }

  it('labels a timeout distinctly, so a slow API is not read as a bad token', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
    )
    const { attachWorkspaceDomain } = await load()
    expect(await attachWorkspaceDomain('acme')).toEqual({
      outcome: 'failed',
      domain: 'acme.aglyn.com',
      detail: 'timeout',
    })
  })

  it('passes an abort signal, so a hung API cannot hang org creation', async () => {
    fetchMock.mockResolvedValue(respond(200))
    const { attachWorkspaceDomain } = await load()
    await attachWorkspaceDomain('acme')
    // A promise with no deadline cannot lose — it just never returns.
    expect(fetchMock.mock.calls[0][1].signal).toBeDefined()
  })
})

/**
 * `projectDomainStatus` — the difference between "the POST succeeded" and "the
 * domain is serving" (AGL-1913).
 *
 * Every payload shape below was read off the REAL Vercel API before this was
 * written, not guessed:
 *
 *     GET /v9/projects/{p}/domains/demo.aglyn.com  → 200 {"verified":true,…}
 *     GET /v9/projects/{p}/domains/{unknown}       → 404
 *     GET /v6/domains/demo.aglyn.com/config        → {"misconfigured":false,
 *                                                     "conflicts":[],…}
 *     GET /v6/domains/example.com/config           → {"misconfigured":true,…}
 *     GET /v5/certs?domain=demo.aglyn.com          → {"certs":[{"cns":["*.aglyn.com"],…}]}
 *
 * The states that matter are the two that used to be indistinguishable from
 * success: `not-attached` (the POST answered `domain_already_in_use` because
 * the name is on SOMEONE ELSE'S project) and `ownership-pending` (accepted,
 * then withheld pending a TXT challenge). Both returned `attached: true`.
 */
describe('projectDomainStatus (AGL-1913)', () => {
  /** Routes by URL so a test states only the answers it cares about. */
  function route(answers: {
    domain?: () => unknown
    config?: () => unknown
    certs?: () => unknown
  }) {
    return (url: string) => {
      if (url.includes('/certs?')) {
        return Promise.resolve((answers.certs ?? (() => respond(200, { certs: [] })))())
      }
      if (url.includes('/config')) {
        return Promise.resolve(
          (answers.config ?? (() => respond(200, { misconfigured: false, conflicts: [] })))(),
        )
      }
      return Promise.resolve((answers.domain ?? (() => respond(200, { verified: true })))())
    }
  }

  it('reports serving when the name is on the project, DNS is clean and a cert covers it', async () => {
    fetchMock.mockImplementation(
      route({
        certs: () =>
          respond(200, { certs: [{ cns: ['demo.example.com'] }] }),
      }) as never,
    )
    const { projectDomainStatus } = await load()
    expect(await projectDomainStatus('demo.example.com')).toEqual({
      state: 'serving',
      domain: 'demo.example.com',
      verification: [],
      conflicts: [],
    })
  })

  it('accepts a WILDCARD certificate as covering the name', async () => {
    // `*.aglyn.com` is what the real API returns for `demo.aglyn.com`; an
    // exact-match-only test would have reported a live domain as pending.
    fetchMock.mockImplementation(
      route({ certs: () => respond(200, { certs: [{ cns: ['*.example.com'] }] }) }) as never,
    )
    const { projectDomainStatus } = await load()
    expect((await projectDomainStatus('demo.example.com')).state).toBe('serving')
  })

  it('does NOT accept a wildcard one level up as covering a deeper name', async () => {
    // `*.example.com` covers `demo.example.com`, never `a.b.example.com`.
    fetchMock.mockImplementation(
      route({ certs: () => respond(200, { certs: [{ cns: ['*.example.com'] }] }) }) as never,
    )
    const { projectDomainStatus } = await load()
    expect((await projectDomainStatus('a.b.example.com')).state).toBe(
      'certificate-pending',
    )
  })

  it('separates certificate-pending from serving', async () => {
    fetchMock.mockImplementation(
      route({ certs: () => respond(200, { certs: [] }) }) as never,
    )
    const { projectDomainStatus } = await load()
    expect((await projectDomainStatus('demo.example.com')).state).toBe(
      'certificate-pending',
    )
  })

  it('reports not-attached on a 404, which is the false green attach used to swallow', async () => {
    fetchMock.mockImplementation(route({ domain: () => respond(404, {}) }) as never)
    const { projectDomainStatus } = await load()
    expect(await projectDomainStatus('someone-elses.example')).toEqual({
      state: 'not-attached',
      domain: 'someone-elses.example',
      verification: [],
      conflicts: [],
    })
    // The walk stops: no point asking DNS about a name we do not hold.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces the ownership challenge rather than calling it attached', async () => {
    fetchMock.mockImplementation(
      route({
        domain: () =>
          respond(200, {
            verified: false,
            verification: [
              {
                type: 'TXT',
                domain: '_vercel.example.com',
                value: 'vc-domain-verify=…',
                reason: 'pending_domain_verification',
              },
            ],
          }),
      }) as never,
    )
    const { projectDomainStatus } = await load()
    const status = await projectDomainStatus('example.com')
    expect(status.state).toBe('ownership-pending')
    expect(status.verification[0]).toMatchObject({
      type: 'TXT',
      domain: '_vercel.example.com',
    })
  })

  it('reports dns-misconfigured, with the conflicting records the platform names', async () => {
    // The stale-A-shadowing-an-ALIAS shape, as `/v6/…/config` reports it.
    fetchMock.mockImplementation(
      route({
        config: () =>
          respond(200, {
            misconfigured: true,
            conflicts: [{ type: 'A', name: 'example.com', value: '203.0.113.9' }],
          }),
      }) as never,
    )
    const { projectDomainStatus } = await load()
    const status = await projectDomainStatus('example.com')
    expect(status.state).toBe('dns-misconfigured')
    expect(status.conflicts).toEqual([
      { type: 'A', name: 'example.com', value: '203.0.113.9' },
    ])
  })

  it('carries conflicts through on a domain that IS serving', async () => {
    // Serving today, intermittently wrong tomorrow — the customer has to be
    // told even though nothing is failing yet.
    fetchMock.mockImplementation(
      route({
        config: () =>
          respond(200, {
            misconfigured: false,
            conflicts: [{ type: 'A', name: 'example.com', value: '203.0.113.9' }],
          }),
        certs: () => respond(200, { certs: [{ cns: ['example.com'] }] }),
      }) as never,
    )
    const { projectDomainStatus } = await load()
    const status = await projectDomainStatus('example.com')
    expect(status.state).toBe('serving')
    expect(status.conflicts).toHaveLength(1)
  })

  it('reports serving when the CERTS read fails — an unreachable API is not a customer problem', async () => {
    fetchMock.mockImplementation(route({ certs: () => respond(500, {}) }) as never)
    const { projectDomainStatus } = await load()
    expect((await projectDomainStatus('demo.example.com')).state).toBe('serving')
  })

  it('reports unknown, not serving, when the project read fails', async () => {
    fetchMock.mockImplementation(route({ domain: () => respond(500, {}) }) as never)
    const { projectDomainStatus } = await load()
    expect(await projectDomainStatus('demo.example.com')).toMatchObject({
      state: 'unknown',
      detail: '500',
    })
  })

  it('queries the project it is GIVEN, not the console one', async () => {
    // The tenant custom-domain routes attach to a different project; a status
    // that always asked about the console project would report every customer
    // domain as not-attached.
    fetchMock.mockImplementation(route({}) as never)
    const { projectDomainStatus } = await load()
    await projectDomainStatus('demo.example.com', { projectId: 'prj_tenant' })
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.vercel.com/v9/projects/prj_tenant/domains/demo.example.com?teamId=team_test',
    )
    expect(fetchMock.mock.calls[2][0]).toContain('teamId=team_test')
  })

  it('is skipped, not failed, without a token', async () => {
    fetchMock.mockImplementation(route({}) as never)
    const { projectDomainStatus } = await load({ VERCEL_TOKEN: undefined })
    expect(await projectDomainStatus('demo.example.com')).toMatchObject({
      state: 'skipped',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never throws, whatever the API does', async () => {
    for (const impl of [
      () => Promise.reject(new Error('ECONNREFUSED')),
      () => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' })),
      () => undefined,
    ]) {
      fetchMock.mockImplementation(impl as never)
      const { projectDomainStatus } = await load()
      await expect(projectDomainStatus('demo.example.com')).resolves.toMatchObject({
        domain: 'demo.example.com',
      })
    }
  })
})
