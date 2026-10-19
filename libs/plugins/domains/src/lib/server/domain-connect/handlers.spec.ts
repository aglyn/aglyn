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

/**
 * The one-click DNS doors (AGL-3963): who may use them, and what each one
 * writes. The member doors refuse exactly what `/api/domains/attach`
 * refuses, in its order and words; the return door, which carries no token,
 * records only whether the provider said yes.
 */

import { generateKeyPairSync } from 'node:crypto'
import type { DomainConnectConfig } from './config'
import type { DomainConnectDiscovery } from './discovery'
import type { DomainConnectEngineDeps, DomainConnectStore } from './engine'
import {
  createDiscoverRoute,
  createFinishRoute,
  createReturnRoute,
  createReturnSubject,
  createStartRoute,
  type DomainConnectRouteDeps,
} from './handlers'
import { domainConnectSessionId, newDomainConnectSession, type DomainConnectSession } from './session'

const STATE = 'S'.repeat(43)
const SESSION_ID = domainConnectSessionId(STATE)!

const config: DomainConnectConfig = {
  providerId: 'aglyn.com',
  signing: { privateKey: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey, keyHost: '_dcpubkeyv1' },
  redirectUri: 'https://app.aglyn.com/api/domain-connect/return',
}

const SUPPORTED: DomainConnectDiscovery = {
  supported: true,
  zone: { root: 'example.com', host: '', template: 'apex', serviceId: 'website', twin: 'www.example.com' },
  provider: {
    providerId: 'provider.example',
    providerName: 'Provider DNS',
    urlSyncUX: 'https://dash.provider.example/dc',
    urlAPI: 'https://api.provider.example/dc',
    width: 640,
    height: 700,
  },
}

const CALLERS = {
  admin: { uid: 'uid-admin', email: 'admin@example.com', staff: false, emailVerified: true },
  editor: { uid: 'uid-editor', email: 'editor@example.com', staff: false, emailVerified: true },
  unverified: { uid: 'uid-admin', email: 'admin@example.com', staff: false, emailVerified: false },
  otherAdmin: { uid: 'uid-other', email: 'other@example.com', staff: false, emailVerified: true },
} as const

function world(patch: Partial<DomainConnectRouteDeps> = {}) {
  const rows = new Map<string, DomainConnectSession>()
  const store: DomainConnectStore = {
    get: async (id) => rows.get(id) ?? null,
    create: async (id, session) => void rows.set(id, session),
    update: async (id, change) => void rows.set(id, { ...rows.get(id)!, ...change }),
    lease: async (id, _now, until) => (rows.has(id) ? { ...rows.get(id)!, leaseUntilMs: until } : null),
    listDue: async () => [],
  }
  const engine: DomainConnectEngineDeps = {
    store,
    pointsHere: async () => false,
    connect: async () => ({ ok: 'connected', servingPending: false }),
    now: () => 2_000,
  }
  const deps: DomainConnectRouteDeps = {
    config: () => config,
    verifyIdToken: async (token) => (token in CALLERS ? CALLERS[token as keyof typeof CALLERS] : 'refused'),
    readSite: async (hostId) =>
      hostId === 'host-1'
        ? {
            orgId: 'org-1',
            org: { plan: 'starter' },
            host: { memberRoles: { 'uid-admin': 'admin', 'uid-other': 'admin', 'uid-editor': 'editor' } },
          }
        : null,
    entitled: (org) => org['plan'] !== 'free',
    validateDomain: (input) => {
      const domain = input.trim().toLowerCase()
      return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)
        ? { domain, error: null }
        : { domain: null, error: 'Enter a valid domain, for example example.com' }
    },
    discover: async () => SUPPORTED,
    heldElsewhere: async () => false,
    customDomainPath: async () => '/acme/hosts/acme/admin/domain',
    engine,
    newState: () => STATE,
    now: () => 1_000,
    ...patch,
  }
  return { deps, rows }
}

const get = (path: string, token?: string) =>
  new Request(`https://app.aglyn.com/api/${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })

const post = (path: string, body: unknown, token?: string) =>
  new Request(`https://app.aglyn.com/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })

describe('the member doors refuse what /api/domains/attach refuses', () => {
  const cases: Array<[string, Request, number, string]> = [
    ['no bearer token', post('domain-connect/start', { hostId: 'host-1', domain: 'example.com' }), 401, 'unauthenticated'],
    ['a token the verifier refused', post('domain-connect/start', { hostId: 'host-1', domain: 'example.com' }, 'forged'), 401, 'unauthenticated'],
    ['an unverified address', post('domain-connect/start', { hostId: 'host-1', domain: 'example.com' }, 'unverified'), 403, 'email-unverified'],
    ['no site named', post('domain-connect/start', { domain: 'example.com' }, 'admin'), 400, 'invalid-request'],
    ['a site that does not exist', post('domain-connect/start', { hostId: 'host-9', domain: 'example.com' }, 'admin'), 404, 'unknown-site'],
    ['a member who is not the site’s admin', post('domain-connect/start', { hostId: 'host-1', domain: 'example.com' }, 'editor'), 403, 'not-admin'],
  ]

  it.each(cases)('start refuses %s', async (_label, request, status, code) => {
    const response = await createStartRoute(world().deps)(request)
    expect(response.status).toBe(status)
    expect((await response.json()).code).toBe(code)
  })

  it('refuses a plan without custom domains, in the attach route’s words', async () => {
    const { deps } = world({
      readSite: async () => ({ orgId: 'org-1', org: { plan: 'free' }, host: { memberRoles: { 'uid-admin': 'admin' } } }),
    })
    const response = await createStartRoute(deps)(post('domain-connect/start', { hostId: 'host-1', domain: 'example.com' }, 'admin'))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Custom domains require a Starter plan', code: 'not-entitled' })
  })

  it('discover and finish climb the same gate', async () => {
    const { deps } = world()
    expect((await createDiscoverRoute(deps)(get('domain-connect/discover?hostId=host-1&domain=example.com', 'editor'))).status).toBe(403)
    expect((await createFinishRoute(deps)(post('domain-connect/finish', { hostId: 'host-1', state: STATE }))).status).toBe(401)
  })
})

describe('discover', () => {
  it('names the provider when it can apply our template', async () => {
    const response = await createDiscoverRoute(world().deps)(
      get('domain-connect/discover?hostId=host-1&domain=example.com', 'admin'),
    )
    expect(await response.json()).toEqual({ supported: true, providerName: 'Provider DNS' })
  })

  it('answers not supported with no signing key, before asking anything', async () => {
    const discover = jest.fn()
    const { deps } = world({ config: () => null, discover })
    const response = await createDiscoverRoute(deps)(get('domain-connect/discover?hostId=host-1&domain=example.com'))
    expect(await response.json()).toEqual({ supported: false })
    expect(discover).not.toHaveBeenCalled()
  })

  it('answers not supported for a partial domain and for a provider that cannot', async () => {
    expect(
      await (await createDiscoverRoute(world().deps)(get('domain-connect/discover?hostId=host-1&domain=exa', 'admin'))).json(),
    ).toEqual({ supported: false })
    const { deps } = world({ discover: async () => ({ supported: false, reason: 'no-template' }) })
    expect(
      await (await createDiscoverRoute(deps)(get('domain-connect/discover?hostId=host-1&domain=example.com', 'admin'))).json(),
    ).toEqual({ supported: false })
  })
})

describe('start', () => {
  it('opens a session keyed by the state’s hash and answers the signed link', async () => {
    const { deps, rows } = world()
    const response = await createStartRoute(deps)(
      post('domain-connect/start', { hostId: 'host-1', domain: 'Example.com' }, 'admin'),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ width: 640, height: 700, state: STATE, providerName: 'Provider DNS' })
    const url = new URL(body.url)
    expect(url.pathname).toBe('/dc/v2/domainTemplates/providers/aglyn.com/services/website/apply')
    expect(url.searchParams.get('domain')).toBe('example.com')
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri)
    expect(url.searchParams.get('sig')).toBeTruthy()
    expect([...rows.keys()]).toEqual([SESSION_ID])
    expect(rows.get(SESSION_ID)).toMatchObject({
      orgId: 'org-1',
      hostId: 'host-1',
      domain: 'example.com',
      twin: 'www.example.com',
      status: 'started',
      createdBy: 'uid-admin',
      expiresAtMs: 1_000 + 48 * 60 * 60 * 1000,
    })
    expect(JSON.stringify(rows.get(SESSION_ID))).not.toContain(STATE)
  })

  it('refuses a domain another site holds BEFORE sending the owner to their provider', async () => {
    const asked: string[][] = []
    const { deps, rows } = world({
      heldElsewhere: async (names) => {
        asked.push([...names])
        return true
      },
    })
    const response = await createStartRoute(deps)(post('domain-connect/start', { hostId: 'host-1', domain: 'example.com' }, 'admin'))
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('That domain is already connected to another site')
    expect(asked).toEqual([['example.com', 'www.example.com']])
    expect(rows.size).toBe(0)
  })

  it('refuses a malformed domain in the validator’s words, and a provider that cannot apply it', async () => {
    const bad = await createStartRoute(world().deps)(post('domain-connect/start', { hostId: 'host-1', domain: 'not a domain' }, 'admin'))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe('Enter a valid domain, for example example.com')
    const { deps } = world({ discover: async () => ({ supported: false, reason: 'no-template' }) })
    const unsupported = await createStartRoute(deps)(post('domain-connect/start', { hostId: 'host-1', domain: 'example.com' }, 'admin'))
    expect(unsupported.status).toBe(409)
  })

  it('does not exist without a signing key', async () => {
    const { deps } = world({ config: () => null })
    expect((await createStartRoute(deps)(post('domain-connect/start', { hostId: 'host-1', domain: 'example.com' }, 'admin'))).status).toBe(404)
  })
})

function seeded(patch: Partial<DomainConnectSession> = {}, depsPatch: Partial<DomainConnectRouteDeps> = {}) {
  const w = world(depsPatch)
  w.rows.set(SESSION_ID, {
    ...newDomainConnectSession({
      orgId: 'org-1',
      hostId: 'host-1',
      domain: 'example.com',
      root: 'example.com',
      host: '',
      template: 'apex',
      twin: 'www.example.com',
      providerId: 'provider.example',
      providerName: 'Provider DNS',
      serviceId: 'website',
      createdBy: 'uid-admin',
      createdByEmail: 'admin@example.com',
      nowMs: 1_000,
    }),
    ...patch,
  })
  return w
}

describe('finish', () => {
  it('answers the session as it now stands', async () => {
    const { deps } = seeded({ status: 'applied' })
    const response = await createFinishRoute(deps)(post('domain-connect/finish', { hostId: 'host-1', state: STATE }, 'admin'))
    expect(await response.json()).toEqual({
      status: 'waiting',
      code: null,
      providerName: 'Provider DNS',
      domain: 'example.com',
    })
  })

  it('reads another member’s session, or another site’s, as no session at all', async () => {
    const { deps } = seeded()
    const other = await createFinishRoute(deps)(post('domain-connect/finish', { hostId: 'host-1', state: STATE }, 'otherAdmin'))
    expect(other.status).toBe(404)
    const { deps: elsewhere } = seeded({ hostId: 'host-2' })
    const wrongSite = await createFinishRoute(elsewhere)(post('domain-connect/finish', { hostId: 'host-1', state: STATE }, 'admin'))
    expect(wrongSite.status).toBe(404)
    const junk = await createFinishRoute(deps)(post('domain-connect/finish', { hostId: 'host-1', state: 'nope' }, 'admin'))
    expect(junk.status).toBe(400)
  })
})

describe('the return page', () => {
  it('records the owner declining and tells the opener, with no token at all', async () => {
    const { deps, rows } = seeded()
    const response = await createReturnRoute(deps)(get(`domain-connect/return?state=${STATE}&error=access_denied`))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('content-security-policy')).toMatch(/script-src 'nonce-[^']+'/)
    const html = await response.text()
    expect(html).toContain('No changes were made')
    expect(html).toContain('"outcome":"cancelled"')
    expect(html).not.toContain(STATE)
    expect(rows.get(SESSION_ID)).toMatchObject({ status: 'cancelled', code: 'access_denied' })
  })

  it('records applied on a return with no error, and links back to the site’s domain page', async () => {
    const { deps, rows } = seeded()
    const html = await (await createReturnRoute(deps)(get(`domain-connect/return?state=${STATE}`))).text()
    expect(rows.get(SESSION_ID)?.status).toBe('applied')
    expect(html).toContain('/acme/hosts/acme/admin/domain')
  })

  it('says the link expired for a state it does not know, and writes nothing', async () => {
    const { deps, rows } = seeded()
    const html = await (await createReturnRoute(deps)(get(`domain-connect/return?state=${'T'.repeat(43)}`))).text()
    expect(html).toContain('This link has expired')
    expect(rows.get(SESSION_ID)?.status).toBe('started')
  })

  it('names the session’s organization for the release gate, and nobody’s uid', async () => {
    const { deps } = seeded()
    const subject = createReturnSubject(deps)
    expect(await subject(get(`domain-connect/return?state=${STATE}`))).toEqual({ orgId: 'org-1' })
    expect(await subject(get('domain-connect/return?state=junk'))).toBeNull()
  })
})
