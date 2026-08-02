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
