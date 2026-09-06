/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * AGL-2606 — the CRM resources of `/v1`: companies, pipelines, deals, tasks
 * and activities.
 *
 * ## What each block has to prove, and what would make it lie
 *
 * - **The stamp.** A record the console cannot open is worse than no record,
 *   and the console opens a CRM row by `visibleTo`. So every create is read
 *   back from the store and its `visibleTo` compared with the tokens the
 *   REAL `crmScopeTokens` computes for the site the write named — never with
 *   a literal the handler could have copied.
 * - **The grammar.** A `400` that named the wrong field is a `400` an
 *   integrator cannot act on, so each refusal pins `fields`.
 * - **The clause count.** The double records every `where()`; a list that
 *   combined two equalities would be a composite index nobody shipped, and a
 *   green that ignored the count would pass here and `500` in production.
 * - **The key.** A replay must return the ORIGINAL body and write nothing
 *   the second time; a refusal must give the key back.
 */

let mockScopes: string[] = ['crm:read', 'crm:write']
let mockOrg: Record<string, unknown> = {}
let mockUidSeq = 0

jest.mock('@aglyn/tenant-data-admin', () => {
  // Spread the REAL http helpers — a closed world, and a fake envelope would
  // test a fake contract.
  const apiHttp = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/api-http',
  )
  const double = jest.requireActual('./api-v1-crm-double')
  return {
    __esModule: true,
    ...apiHttp,
    // The REAL records-band measurement and activity ceiling (AGL-2611),
    // over the same double the creates write to.
    ...jest.requireActual(
      '../../../libs/tenant/data/admin/src/lib/server/crm-records',
    ),
    verifyApiKey: async () => ({
      orgId: 'org-1',
      keyId: 'key-1',
      scopes: mockScopes,
    }),
    getOrgDoc: async () => mockOrg,
    lockdownRefusal: async () => null,
    consumeRateLimit: async () => ({
      allowed: true,
      limit: 120,
      remaining: 119,
      resetMs: Date.now() + 60_000,
      degraded: false,
    }),
    firebaseAdmin: {
      app: () => ({ firestore: () => double.mockFirestore }),
      firestore: { FieldValue: double.mockFieldValue },
    },
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL model throughout: the claim, the plan table, the scope tokens,
  // the consent groups, the CRM constants and the normalizers. Every stamp
  // assertion below compares against what these compute, so a stub here
  // would make the suite a statement about the stub.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/api-idempotency'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/contacts'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/scope-tokens'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/marketing-consent'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/consent-groups'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/crm'),
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/foundation/definitions/contact.types',
  ),
  effectiveDatasetModel: () => ({ fields: [] }),
  coerceDocumentValues: (_m: unknown, v: Record<string, unknown>) => v,
  validateDocument: () => ({}),
  createResourceUid: () => `id_${++mockUidSeq}`,
}))

jest.mock('firebase-admin/firestore', () => {
  const double = jest.requireActual('./api-v1-crm-double')
  return {
    __esModule: true,
    FieldPath: { documentId: () => '__name__' },
    Timestamp: double.MockTimestamp,
    FieldValue: double.mockFieldValue,
  }
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { consentGroupForHost } from '@aglyn/aglyn/app-utils/consent-groups'
import {
  CRM_ACTIVITIES_PER_RECORD_CEILING,
  crmScopeTokens,
  DEFAULT_DEAL_STAGES,
} from '@aglyn/aglyn/app-utils/crm'
import { DELETE, GET, PATCH, POST } from '../app/api/v1/[[...route]]/route'
import {
  childPaths,
  issued,
  lastFilters,
  mockClock,
  mockDocs,
  resetMockFirestore,
} from './api-v1-crm-double'

const readSource = (...parts: string[]) =>
  readFileSync(join(__dirname, '..', '..', '..', ...parts), 'utf8')

const ORG = 'orgs/org-1'
const COMPANIES = `${ORG}/companies`
const PIPELINES = `${ORG}/pipelines`
const DEALS = `${ORG}/deals`
const TASKS = `${ORG}/crmTasks`
const ACTIVITIES = `${ORG}/crmActivities`

const handlers = { GET, POST, PATCH, DELETE }

function call(
  method: keyof typeof handlers,
  path: string,
  body?: unknown,
  idempotencyKey?: string,
) {
  const [pathname, search] = path.split('?')
  const segments = pathname.split('/').filter(Boolean)
  const request = new Request(
    `https://app.aglyn.com/api/v1/${pathname}${search ? `?${search}` : ''}`,
    {
      method,
      headers: {
        authorization: 'Bearer aglyn_sk_test',
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  )
  return handlers[method](request, { params: Promise.resolve({ route: segments }) })
}

async function json(response: Response) {
  return (await response.json()) as Record<string, any>
}

/** The tokens the REAL model stamps for a record created from `hostId`. */
const tokensFor = (hostId: string) =>
  crmScopeTokens(mockOrg, consentGroupForHost(mockOrg, hostId))

beforeEach(() => {
  resetMockFirestore()
  mockUidSeq = 0
  mockScopes = ['crm:read', 'crm:write']
  mockOrg = {
    plan: 'business',
    subscription: { status: 'active' },
    hosts: { 'host-1': true, 'host-2': true },
  }
  mockDocs.set(`${ORG}/members/u-owner`, { role: 'admin' })
  mockDocs.set(`${ORG}/contacts/c-1`, { email: 'avery@example.com' })
})

// ── The premise ─────────────────────────────────────────────────────────────

describe('the premise (AGL-899)', () => {
  it('ships crm:read and crm:write with the endpoints that enforce them', () => {
    // A scope no endpoint enforces is a broken permission; an endpoint whose
    // scope cannot be minted is closed to every customer. Both halves, from
    // source, so neither can drift alone.
    const scopes = readSource('libs/tenant/data/admin/src/lib/server/api-keys.ts')
    expect(scopes).toContain("'crm:read'")
    expect(scopes).toContain("'crm:write'")
    for (const resource of ['companies', 'pipelines', 'deals', 'tasks', 'activities']) {
      const source = readSource(`apps/console/utils/api-v1/crm-${resource}.ts`)
      expect(source).toContain("requireScope(ctx, 'crm:read')")
      if (resource !== 'pipelines') {
        expect(source).toContain("requireScope(ctx, 'crm:write')")
      }
    }
    expect(
      readSource('apps/console/components/org-api-keys-card.component.tsx'),
    ).toMatch(/scope: 'crm:write'/)
  })

  it('advertises the five resources at the root', async () => {
    const root = await json(await call('GET', ''))
    expect(root.resources).toEqual(
      expect.arrayContaining(['companies', 'pipelines', 'deals', 'tasks', 'activities']),
    )
  })

  it('is refused by scope before method — a read key cannot write', async () => {
    mockScopes = ['crm:read']
    const denied = await call('POST', 'companies', { name: 'Acme' })
    expect(denied.status).toBe(403)
    expect((await json(denied)).error).toMatchObject({
      type: 'insufficient_scope',
      code: 'crm:write',
    })
    mockScopes = ['contacts:read']
    expect((await call('GET', 'deals')).status).toBe(403)
    expect((await call('GET', 'pipelines')).status).toBe(403)
  })
})

// ── The CRM suite gate ──────────────────────────────────────────────────────

describe('the CRM suite entitlement (AGL-2611)', () => {
  /** Every plan-gated resource, by a path that resolves on each. */
  const SUITE_PATHS = ['companies', 'pipelines', 'deals', 'tasks', 'activities']

  it('refuses every CRM resource, on any verb, for an org without the suite', async () => {
    // API access without the suite is reachable only through a staff
    // override — Business carries both — so that is the org this asks
    // about. `plan_required` with the `crm` code, before scope and method
    // alike, so a key minted while the suite was held stops answering the
    // day it is withdrawn.
    mockOrg = { ...mockOrg, entitlements: { features: { crm: false } } }
    for (const path of SUITE_PATHS) {
      const read = await call('GET', path)
      expect(`${path}: ${read.status}`).toBe(`${path}: 403`)
      expect((await json(read)).error).toMatchObject({ type: 'plan_required', code: 'crm' })
    }
    const write = await call('POST', 'companies', { name: 'Acme', consentSiteId: 'host-1' })
    expect(write.status).toBe(403)
    expect((await json(write)).error.code).toBe('crm')
    expect(childPaths(COMPANIES)).toEqual([])
  })

  it('leaves contacts open — they are not part of the suite', async () => {
    mockOrg = { ...mockOrg, entitlements: { features: { crm: false } } }
    mockScopes = ['contacts:read']
    expect((await call('GET', 'contacts')).status).toBe(200)
  })

  it('CONTROL: the plan as sold answers, and a per-org grant on a lesser plan answers too', async () => {
    expect((await call('GET', 'companies')).status).toBe(200)
    // Starter carries the suite; the API had to be granted, and a REQUEST
    // band with it — `refuseIfApiQuotaExhausted` walls a zero band with a
    // null rate before any resource runs, which is the API's own gate and
    // not this one.
    mockOrg = {
      plan: 'starter',
      subscription: { status: 'active' },
      hosts: { 'host-1': true },
      entitlements: { apiRequestsPerMonth: 1_000, features: { apiAccess: true } },
    }
    expect((await call('GET', 'companies')).status).toBe(200)
  })
})

// ── The records band ────────────────────────────────────────────────────────

describe('the records band on company and deal creates (AGL-2611)', () => {
  /**
   * A Free org granted the suite and the API by staff, banded at its stock
   * hundred by a smaller override so the case stays readable. Free is the
   * one plan with no overage rate, so it is the one plan that REFUSES; every
   * paid plan meters the same create onto the invoice instead.
   */
  const bandedFree = (contactsPerHost: number) => ({
    plan: 'free',
    hosts: { 'host-1': true },
    entitlements: {
      contactsPerHost,
      // The API's own request band, granted beside the flag: a zero band
      // with no rate is walled before any resource runs.
      apiRequestsPerMonth: 1_000,
      features: { crm: true, apiAccess: true },
    },
  })

  it('refuses a company when contacts, companies and deals together fill the band', async () => {
    // One contact is seeded by the suite's beforeEach. One company and one
    // deal make three: the band is full, and the NEXT record of either
    // kind is refused with the key given back.
    mockOrg = bandedFree(3)
    mockDocs.set(`${COMPANIES}/co-seed`, { name: 'Seed', visibleTo: ['org'] })
    mockDocs.set(`${DEALS}/d-seed`, { title: 'Seed', visibleTo: ['org'] })

    const company = await call(
      'POST',
      'companies',
      { name: 'Acme', consentSiteId: 'host-1' },
      'key-company',
    )
    expect(company.status).toBe(403)
    expect((await json(company)).error).toMatchObject({
      type: 'plan_required',
      code: 'crm_records_quota',
    })
    expect(childPaths(COMPANIES)).toEqual([`${COMPANIES}/co-seed`])

    const deal = await call(
      'POST',
      'deals',
      { title: 'Beans', contactId: 'c-1', consentSiteId: 'host-1' },
      'key-deal',
    )
    expect(deal.status).toBe(403)
    expect((await json(deal)).error.code).toBe('crm_records_quota')
    expect(childPaths(DEALS)).toEqual([`${DEALS}/d-seed`])

    // The key is released: the same key, once the band is raised, lands.
    mockOrg = bandedFree(10)
    const retry = await call(
      'POST',
      'companies',
      { name: 'Acme', consentSiteId: 'host-1' },
      'key-company',
    )
    expect(retry.status).toBe(201)
  })

  it('lands the last record inside the band, of either kind', async () => {
    mockOrg = bandedFree(3)
    mockDocs.set(`${DEALS}/d-seed`, { title: 'Seed', visibleTo: ['org'] })
    // Two records held; the third — a company — fits.
    const company = await call('POST', 'companies', { name: 'Acme', consentSiteId: 'host-1' })
    expect(company.status).toBe(201)
    // …and now the band is full, so a deal does not.
    const deal = await call('POST', 'deals', {
      title: 'Beans',
      contactId: 'c-1',
      consentSiteId: 'host-1',
    })
    expect(deal.status).toBe(403)
  })

  it('CONTROL: a metered plan lands the same create past its band', async () => {
    mockOrg = {
      plan: 'starter',
      subscription: { status: 'active' },
      hosts: { 'host-1': true },
      entitlements: {
        contactsPerHost: 1,
        apiRequestsPerMonth: 1_000,
        features: { apiAccess: true },
      },
    }
    const company = await call('POST', 'companies', { name: 'Acme', consentSiteId: 'host-1' })
    expect(company.status).toBe(201)
  })
})

// ── Companies ───────────────────────────────────────────────────────────────

describe('POST /v1/companies', () => {
  it('stamps the record for the site it names, exactly as that site would', async () => {
    const response = await call('POST', 'companies', {
      name: 'Acme',
      domain: 'https://www.Acme.com/about',
      phone: '(512) 555-0123',
      website: 'acme.com',
      ownerUid: 'u-owner',
      consentSiteId: 'host-1',
    })
    expect(response.status).toBe(201)
    const view = await json(response)
    expect(view).toMatchObject({
      object: 'company',
      name: 'Acme',
      domain: 'acme.com',
      phone: '+15125550123',
      website: 'https://acme.com/',
      ownerUid: 'u-owner',
      siteId: 'host-1',
    })
    const stored = mockDocs.get(`${COMPANIES}/${view.id}`)!
    expect(stored.visibleTo).toEqual(tokensFor('host-1'))
    expect(stored.visibleTo).toEqual(['host:host-1'])
    expect(stored).toMatchObject({
      hostId: 'host-1',
      createdByUid: 'api',
      nameLower: 'acme',
    })
    // Both stamps in one instant, so an `updatedAfter` sweep started before
    // the create still picks the fresh record up.
    expect(view.created).toBe(view.updated)
    expect(view.created).toBe(new Date(mockClock.nowMs).toISOString())
  })

  it('widens to the org when the org has chosen an org-wide default scope', async () => {
    mockOrg = { ...mockOrg, defaultResourceScope: 'org' }
    const view = await json(
      await call('POST', 'companies', { name: 'Acme', consentSiteId: 'host-2' }),
    )
    expect(mockDocs.get(`${COMPANIES}/${view.id}`)!.visibleTo).toEqual(['org'])
  })

  it('requires the site, and refuses one the org does not own', async () => {
    const missing = await call('POST', 'companies', { name: 'Acme' })
    expect(missing.status).toBe(400)
    expect((await json(missing)).error.fields).toHaveProperty('consentSiteId')
    const foreign = await call('POST', 'companies', {
      name: 'Acme',
      consentSiteId: 'somebody-else',
    })
    expect((await json(foreign)).error.fields).toEqual({
      consentSiteId: 'No such site in this organization',
    })
    expect(childPaths(COMPANIES)).toEqual([])
  })

  it('names every field that does not survive its normalizer', async () => {
    const response = await call('POST', 'companies', {
      name: '',
      domain: 'not a domain',
      phone: '555',
      website: 'ftp://acme.com',
      ownerUid: 'u-stranger',
      hostId: 'host-1',
      consentSiteId: 'host-1',
    })
    expect(response.status).toBe(400)
    const { fields } = (await json(response)).error
    expect(Object.keys(fields).sort()).toEqual(
      ['domain', 'hostId', 'name', 'phone', 'website'].sort(),
    )
    expect(fields.hostId).toMatch(/Not writable/)
    // The membership read is spent only once the grammar passes.
    const owner = await call('POST', 'companies', {
      name: 'Acme',
      ownerUid: 'u-stranger',
      consentSiteId: 'host-1',
    })
    expect((await json(owner)).error.fields).toEqual({
      ownerUid: 'Must be a member of this organization',
    })
  })

  it('refuses a second company on one domain, and gives the key back', async () => {
    const first = await json(
      await call('POST', 'companies', {
        name: 'Acme',
        domain: 'acme.com',
        consentSiteId: 'host-1',
      }),
    )
    const dup = await call(
      'POST',
      'companies',
      { name: 'ACME Inc', domain: 'ACME.com', consentSiteId: 'host-1' },
      'key-dup',
    )
    expect(dup.status).toBe(409)
    const { error } = await json(dup)
    expect(error).toMatchObject({ code: 'company_exists' })
    expect(error.message).toContain(first.id)
    // The conflict clears when the duplicate goes; the same key then creates.
    mockDocs.delete(`${COMPANIES}/${first.id}`)
    const retry = await call(
      'POST',
      'companies',
      { name: 'ACME Inc', domain: 'ACME.com', consentSiteId: 'host-1' },
      'key-dup',
    )
    expect(retry.status).toBe(201)
  })

  it('replays a settled key with the original body and writes nothing twice', async () => {
    const body = { name: 'Acme', consentSiteId: 'host-1' }
    const first = await call('POST', 'companies', body, 'key-1')
    expect(first.status).toBe(201)
    const second = await call('POST', 'companies', body, 'key-1')
    expect(second.status).toBe(200)
    expect(await json(second)).toEqual(await json(first))
    expect(childPaths(COMPANIES)).toHaveLength(1)
  })
})

describe('PATCH and DELETE /v1/companies/{id}', () => {
  it('clears a field on null, leaves an omitted one alone, no-ops on {}', async () => {
    const created = await json(
      await call('POST', 'companies', {
        name: 'Acme',
        notes: 'Old',
        industry: 'Coffee',
        consentSiteId: 'host-1',
      }),
    )
    const patched = await json(
      await call('PATCH', `companies/${created.id}`, { notes: null, name: 'Acme Ltd' }),
    )
    expect(patched).toMatchObject({ name: 'Acme Ltd', notes: null, industry: 'Coffee' })
    const stored = mockDocs.get(`${COMPANIES}/${created.id}`)!
    expect(stored).not.toHaveProperty('notes')
    expect(stored.nameLower).toBe('acme ltd')
    const noop = await call('PATCH', `companies/${created.id}`, {})
    expect(noop.status).toBe(200)
    // The site is set at creation and cannot move.
    const moved = await call('PATCH', `companies/${created.id}`, { consentSiteId: 'host-2' })
    expect((await json(moved)).error.fields.consentSiteId).toMatch(/Not writable/)
    expect((await call('PATCH', 'companies/nope', { name: 'X' })).status).toBe(404)
  })

  it('deletes the company alone and replays the receipt on the same key', async () => {
    const company = await json(
      await call('POST', 'companies', { name: 'Acme', consentSiteId: 'host-1' }),
    )
    const deal = await json(
      await call('POST', 'deals', {
        title: 'Beans',
        companyId: company.id,
        consentSiteId: 'host-1',
      }),
    )
    const first = await call('DELETE', `companies/${company.id}`, undefined, 'del-1')
    expect(first.status).toBe(200)
    const receipt = await json(first)
    expect(receipt).toEqual({ id: company.id, object: 'company', deleted: true })
    // No cascade: the deal keeps its history.
    expect(mockDocs.get(`${DEALS}/${deal.id}`)!.companyId).toBe(company.id)
    const replay = await call('DELETE', `companies/${company.id}`, undefined, 'del-1')
    expect(replay.status).toBe(200)
    expect(await json(replay)).toEqual(receipt)
    // A wrong id is still a 404, even with a key.
    expect((await call('DELETE', 'companies/never', undefined, 'del-2')).status).toBe(404)
  })
})

describe('GET /v1/companies filters', () => {
  beforeEach(() => {
    mockDocs.set(`${COMPANIES}/a`, {
      name: 'Acme',
      domain: 'acme.com',
      ownerUid: 'u-owner',
      hostId: 'host-1',
    })
    mockDocs.set(`${COMPANIES}/b`, {
      name: 'Bolt',
      domain: 'bolt.io',
      ownerUid: 'u-owner',
      hostId: 'host-1',
    })
    mockDocs.set(`${COMPANIES}/c`, { name: 'Cog', domain: 'cog.dev', hostId: 'host-2' })
  })

  it('normalizes ?domain= as the write does and sends it as the one clause', async () => {
    const page = await json(await call('GET', 'companies?domain=https://WWW.acme.com/x'))
    expect(page.data.map((row: any) => row.id)).toEqual(['a'])
    expect(lastFilters()).toEqual([{ field: 'domain', op: '==', value: 'acme.com' }])
    const bad = await call('GET', 'companies?domain=nope')
    expect(bad.status).toBe(400)
    expect((await json(bad)).error.fields).toHaveProperty('domain')
  })

  it('sends one equality to Firestore and checks the rest on the page', async () => {
    const page = await json(
      await call('GET', 'companies?ownerUid=u-owner&domain=bolt.io'),
    )
    expect(page.data.map((row: any) => row.id)).toEqual(['b'])
    expect(lastFilters()).toHaveLength(1)
    expect(lastFilters()[0].field).toBe('domain')
    const owner = await json(await call('GET', 'companies?ownerUid=u-owner'))
    expect(owner.data.map((row: any) => row.id)).toEqual(['a', 'b'])
    expect(lastFilters()).toEqual([{ field: 'ownerUid', op: '==', value: 'u-owner' }])
  })

  it('ignores an unknown param and treats an empty one as absent', async () => {
    const page = await json(await call('GET', 'companies?colour=red&ownerUid='))
    expect(page.data).toHaveLength(3)
    expect(lastFilters()).toEqual([])
  })
})

describe('?updatedAfter= — the sync filter', () => {
  it('orders by updated, sends the range alone, and moves the equality to the page', async () => {
    const stamp = (ms: number) => {
      mockClock.nowMs = ms
      return ms
    }
    stamp(1_760_000_003_000)
    const c = await json(await call('POST', 'companies', { name: 'C', consentSiteId: 'host-1' }))
    stamp(1_760_000_001_000)
    const a = await json(
      await call('POST', 'companies', { name: 'A', ownerUid: 'u-owner', consentSiteId: 'host-1' }),
    )
    stamp(1_760_000_002_000)
    const b = await json(await call('POST', 'companies', { name: 'B', consentSiteId: 'host-1' }))

    const since = await json(
      await call('GET', 'companies?updatedAfter=2025-10-09T07:33:20Z'),
    )
    // `>` 1_760_000_000_000: every row, oldest update first — not by id.
    expect(since.data.map((row: any) => row.id)).toEqual([a.id, b.id, c.id])
    expect(lastFilters()).toEqual([
      { field: 'updatedAt', op: '>', value: expect.anything() },
    ])

    const combined = await json(
      await call('GET', 'companies?updatedAfter=2025-10-09T07:33:20Z&ownerUid=u-owner'),
    )
    expect(combined.data.map((row: any) => row.id)).toEqual([a.id])
    expect(lastFilters()).toHaveLength(1)
    expect(lastFilters()[0].field).toBe('updatedAt')

    const bad = await call('GET', 'companies?updatedAfter=yesterday')
    expect(bad.status).toBe(400)
    expect((await json(bad)).error.fields).toHaveProperty('updatedAfter')
  })

  it('pages in updated order with a cursor that yields every row exactly once', async () => {
    for (const [index, name] of ['x', 'y', 'z'].entries()) {
      mockClock.nowMs = 1_760_000_001_000 + index * 1000
      await call('POST', 'companies', { name, consentSiteId: 'host-1' })
    }
    // The three creates above each measured the records band — three
    // aggregates apiece (AGL-2611) — and those are not the reads this case
    // is about. Counted from here: the pages, and nothing else.
    issued.length = 0
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page: Record<string, any> = await json(
        await call(
          'GET',
          `companies?updatedAfter=2025-10-09T07:33:20Z&limit=1${
            cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
          }`,
        ),
      )
      seen.push(...page.data.map((row: any) => row.name))
      cursor = page.next_cursor
    } while (cursor)
    expect(seen).toEqual(['x', 'y', 'z'])
    expect(issued.length).toBe(3)
  })
})

// ── Pipelines and deals ─────────────────────────────────────────────────────

describe('/v1/pipelines', () => {
  it('is read-only, and seeds the default pipeline from the first deal', async () => {
    expect((await json(await call('GET', 'pipelines'))).data).toEqual([])
    const forbidden = await call('POST', 'pipelines', { name: 'Other' })
    expect(forbidden.status).toBe(405)
    expect(forbidden.headers.get('Allow')).toBe('GET')

    const deal = await json(
      await call('POST', 'deals', { title: 'Beans', consentSiteId: 'host-1' }),
    )
    const pipelines = await json(await call('GET', 'pipelines'))
    expect(pipelines.data).toHaveLength(1)
    const [pipeline] = pipelines.data
    expect(pipeline).toMatchObject({ object: 'pipeline', name: 'Sales', isDefault: true })
    expect(pipeline.stages.map((stage: any) => stage.id)).toEqual(
      DEFAULT_DEAL_STAGES.map((stage) => stage.id),
    )
    expect(mockDocs.get(`${PIPELINES}/${pipeline.id}`)!.visibleTo).toEqual(
      tokensFor('host-1'),
    )
    // The deal landed at the top of the pipeline it seeded.
    expect(deal).toMatchObject({
      pipelineId: pipeline.id,
      stageId: 'qualified',
      status: 'open',
      currency: 'usd',
      closedAt: null,
    })
    // The pipeline visible from the site is queried, not the org's whole set.
    const seededBy = issued.find((filters) =>
      filters.some((filter) => filter.field === 'visibleTo'),
    )
    expect(seededBy).toEqual([
      { field: 'visibleTo', op: 'array-contains-any', value: tokensFor('host-1') },
    ])
    // A second deal reuses it rather than seeding another.
    await call('POST', 'deals', { title: 'More beans', consentSiteId: 'host-1' })
    expect(childPaths(PIPELINES)).toHaveLength(1)
    expect((await call('GET', 'pipelines/nope')).status).toBe(404)
  })
})

describe('/v1/deals', () => {
  it('validates the amount, the currency and the references, naming each', async () => {
    const response = await call('POST', 'deals', {
      title: 'Beans',
      amountCents: 12.5,
      currency: 'dollars',
      contactId: 'c-missing',
      companyId: 'co-missing',
      ownerUid: 'u-stranger',
      expectedCloseAt: '2026-12-31',
      consentSiteId: 'host-1',
    })
    expect(response.status).toBe(400)
    expect(Object.keys((await json(response)).error.fields).sort()).toEqual([
      'amountCents',
      'currency',
      'expectedCloseAt',
    ])
    const refs = await call('POST', 'deals', {
      title: 'Beans',
      contactId: 'c-missing',
      companyId: 'co-missing',
      ownerUid: 'u-stranger',
      consentSiteId: 'host-1',
    })
    expect(Object.keys((await json(refs)).error.fields).sort()).toEqual([
      'companyId',
      'contactId',
      'ownerUid',
    ])
    const negative = await call('POST', 'deals', {
      title: 'Beans',
      amountCents: -1,
      consentSiteId: 'host-1',
    })
    expect((await json(negative)).error.fields).toHaveProperty('amountCents')
    expect(childPaths(DEALS)).toEqual([])
  })

  it('lowercases the currency and stores the amount as sent', async () => {
    const deal = await json(
      await call('POST', 'deals', {
        title: 'Beans',
        amountCents: 250000,
        currency: 'USD',
        contactId: 'c-1',
        ownerUid: 'u-owner',
        expectedCloseAt: '2026-12-31T00:00:00Z',
        consentSiteId: 'host-1',
      }),
    )
    expect(deal).toMatchObject({
      amountCents: 250000,
      currency: 'usd',
      contactId: 'c-1',
      ownerUid: 'u-owner',
      expectedCloseAt: '2026-12-31T00:00:00.000Z',
    })
    expect(mockDocs.get(`${DEALS}/${deal.id}`)).toMatchObject({
      visibleTo: tokensFor('host-1'),
      hostId: 'host-1',
      createdByUid: 'api',
      titleLower: 'beans',
    })
  })

  it('moves by stage or by status, never by a pair that disagrees', async () => {
    const deal = await json(
      await call('POST', 'deals', { title: 'Beans', consentSiteId: 'host-1' }),
    )
    const mismatch = await call('PATCH', `deals/${deal.id}`, {
      stageId: 'won',
      status: 'open',
    })
    expect((await json(mismatch)).error.fields).toEqual({
      status: 'Must match the stage, which is won',
    })
    const unknown = await call('PATCH', `deals/${deal.id}`, { stageId: 'nope' })
    expect((await json(unknown)).error.fields).toHaveProperty('stageId')

    mockClock.nowMs = 1_760_000_050_000
    const won = await json(await call('PATCH', `deals/${deal.id}`, { status: 'won' }))
    expect(won).toMatchObject({ stageId: 'won', status: 'won' })
    expect(won.closedAt).toBe(new Date(1_760_000_050_000).toISOString())
    expect(won.stageChangedAt).toBe(won.closedAt)

    const reopened = await json(
      await call('PATCH', `deals/${deal.id}`, { status: 'open' }),
    )
    expect(reopened).toMatchObject({ stageId: 'qualified', status: 'open', closedAt: null })

    const byStage = await json(
      await call('PATCH', `deals/${deal.id}`, { stageId: 'negotiation' }),
    )
    expect(byStage).toMatchObject({ stageId: 'negotiation', status: 'open' })

    const moved = await call('PATCH', `deals/${deal.id}`, { pipelineId: 'other' })
    expect((await json(moved)).error.fields.pipelineId).toMatch(/Not writable/)
  })

  it('validates a status filter and sends the most selective id as the clause', async () => {
    const bad = await call('GET', 'deals?status=closed')
    expect(bad.status).toBe(400)
    expect((await json(bad)).error.fields.status).toBe('Must be one of: open, won, lost')
    await call('POST', 'deals', { title: 'A', contactId: 'c-1', consentSiteId: 'host-1' })
    await call('POST', 'deals', { title: 'B', consentSiteId: 'host-1' })
    const page = await json(await call('GET', 'deals?status=open&contactId=c-1'))
    expect(page.data.map((row: any) => row.title)).toEqual(['A'])
    expect(lastFilters()).toEqual([{ field: 'contactId', op: '==', value: 'c-1' }])
  })
})

// ── Tasks and activities ────────────────────────────────────────────────────

describe('/v1/tasks', () => {
  it('defaults kind, priority and status, and stamps completion both ways', async () => {
    const task = await json(
      await call('POST', 'tasks', {
        title: 'Call back',
        dueAt: '2026-09-10T15:00:00Z',
        assigneeUid: 'u-owner',
        contactId: 'c-1',
        consentSiteId: 'host-1',
      }),
    )
    expect(task).toMatchObject({
      object: 'task',
      kind: 'todo',
      priority: 'normal',
      status: 'open',
      dueAt: '2026-09-10T15:00:00.000Z',
      completedAt: null,
      assigneeUid: 'u-owner',
      contactId: 'c-1',
      siteId: 'host-1',
    })
    expect(mockDocs.get(`${TASKS}/${task.id}`)!.visibleTo).toEqual(tokensFor('host-1'))

    mockClock.nowMs = 1_760_000_060_000
    const done = await json(await call('PATCH', `tasks/${task.id}`, { status: 'done' }))
    expect(done.completedAt).toBe(new Date(1_760_000_060_000).toISOString())
    const reopened = await json(await call('PATCH', `tasks/${task.id}`, { status: 'open' }))
    expect(reopened.completedAt).toBeNull()

    const bad = await call('POST', 'tasks', {
      title: 'X',
      dueAt: 'tomorrow',
      kind: 'fax',
      assigneeUid: 'u-stranger',
      dealId: 'd-missing',
      consentSiteId: 'host-1',
    })
    expect(Object.keys((await json(bad)).error.fields).sort()).toEqual(['dueAt', 'kind'])
  })

  it('filters on one clause, the assignee before the status', async () => {
    await call('POST', 'tasks', { title: 'A', assigneeUid: 'u-owner', consentSiteId: 'host-1' })
    await call('POST', 'tasks', {
      title: 'B',
      assigneeUid: 'u-owner',
      status: 'done',
      consentSiteId: 'host-1',
    })
    const page = await json(await call('GET', 'tasks?status=open&assigneeUid=u-owner'))
    expect(page.data.map((row: any) => row.title)).toEqual(['A'])
    expect(lastFilters()).toEqual([{ field: 'assigneeUid', op: '==', value: 'u-owner' }])
    expect((await call('GET', 'tasks?status=pending')).status).toBe(400)
  })
})

describe('/v1/activities', () => {
  it('refuses the record’s 5,001st activity and lands its 5,000th (AGL-2611)', async () => {
    // The per-record ceiling, counted on the contact the activity names.
    for (let index = 0; index < CRM_ACTIVITIES_PER_RECORD_CEILING - 1; index += 1) {
      mockDocs.set(`${ACTIVITIES}/prior-${index}`, { contactId: 'c-1', body: 'x' })
    }
    // Another record's log does not count against this one.
    mockDocs.set(`${ACTIVITIES}/other`, { contactId: 'c-other', body: 'x' })
    const last = await call('POST', 'activities', {
      body: 'Five thousandth',
      contactId: 'c-1',
      consentSiteId: 'host-1',
    })
    expect(last.status).toBe(201)
    const next = await call('POST', 'activities', {
      body: 'One too many',
      contactId: 'c-1',
      consentSiteId: 'host-1',
    })
    expect(next.status).toBe(409)
    expect((await json(next)).error).toMatchObject({ code: 'activity_log_full' })
    expect(childPaths(ACTIVITIES)).toHaveLength(CRM_ACTIVITIES_PER_RECORD_CEILING + 1)
  })

  it('must hang off something, defaults at and byUid, and is write-once', async () => {
    const orphan = await call('POST', 'activities', { body: 'Called', consentSiteId: 'host-1' })
    expect(orphan.status).toBe(400)
    expect((await json(orphan)).error.fields.contactId).toMatch(/logged against something/)

    const stranger = await call('POST', 'activities', {
      body: 'Called',
      contactId: 'c-1',
      byUid: 'u-stranger',
      consentSiteId: 'host-1',
    })
    expect((await json(stranger)).error.fields).toEqual({
      byUid: 'Must be a member of this organization',
    })

    const activity = await json(
      await call('POST', 'activities', {
        kind: 'call',
        body: 'Called about the order',
        contactId: 'c-1',
        durationMinutes: 12,
        consentSiteId: 'host-1',
      }),
    )
    expect(activity).toMatchObject({
      object: 'activity',
      kind: 'call',
      body: 'Called about the order',
      byUid: 'api',
      at: new Date(mockClock.nowMs).toISOString(),
      durationMinutes: 12,
      contactId: 'c-1',
    })
    expect(mockDocs.get(`${ACTIVITIES}/${activity.id}`)!.visibleTo).toEqual(
      tokensFor('host-1'),
    )

    const edit = await call('PATCH', `activities/${activity.id}`, { body: 'Edited' })
    expect(edit.status).toBe(405)
    expect(edit.headers.get('Allow')).toBe('GET, DELETE')

    const first = await call('DELETE', `activities/${activity.id}`, undefined, 'act-del')
    expect(first.status).toBe(200)
    const replay = await call('DELETE', `activities/${activity.id}`, undefined, 'act-del')
    expect(await json(replay)).toEqual(await json(first))
    expect(childPaths(ACTIVITIES)).toEqual([])
  })

  it('validates ?kind= and filters by deal on one clause', async () => {
    expect((await call('GET', 'activities?kind=fax')).status).toBe(400)
    const deal = await json(
      await call('POST', 'deals', { title: 'Beans', consentSiteId: 'host-1' }),
    )
    await call('POST', 'activities', {
      body: 'Note',
      dealId: deal.id,
      consentSiteId: 'host-1',
    })
    await call('POST', 'activities', {
      kind: 'call',
      body: 'Call',
      contactId: 'c-1',
      consentSiteId: 'host-1',
    })
    const page = await json(await call('GET', `activities?dealId=${deal.id}&kind=note`))
    expect(page.data.map((row: any) => row.body)).toEqual(['Note'])
    expect(lastFilters()).toEqual([{ field: 'dealId', op: '==', value: deal.id }])
  })
})

// ── Usage ───────────────────────────────────────────────────────────────────

describe('GET /v1/usage', () => {
  it('publishes the CRM collection sizes as unlimited, unmetered bands', async () => {
    mockScopes = []
    for (const name of ['a', 'b']) {
      mockDocs.set(`${COMPANIES}/${name}`, { name })
    }
    mockDocs.set(`${DEALS}/d`, { title: 'd' })
    const usage = await json(await call('GET', 'usage'))
    expect(usage.crm).toEqual({
      companies: { used: 2, included: null, remaining: null, metered: false },
      deals: { used: 1, included: null, remaining: null, metered: false },
      tasks: { used: 0, included: null, remaining: null, metered: false },
      activities: { used: 0, included: null, remaining: null, metered: false },
    })
  })
})

// ── Line items and archived pipelines (AGL-2620) ────────────────────────────

describe('line items on a deal (AGL-2620)', () => {
  it('stores the lines and derives the amount, refusing a typed amount beside or over them', async () => {
    const both = await call('POST', 'deals', {
      title: 'Beans',
      consentSiteId: 'host-1',
      amountCents: 100,
      lineItems: [{ name: 'Bag', quantity: 2, unitAmountCents: 1_250 }],
    })
    expect(both.status).toBe(400)
    expect((await json(both)).error.fields.amountCents).toMatch(/Derived from lineItems/)

    const deal = await json(
      await call('POST', 'deals', {
        title: 'Beans',
        consentSiteId: 'host-1',
        currency: 'USD',
        lineItems: [
          { productId: 'p-1', name: '  Bag ', quantity: 2, unitAmountCents: 1_250 },
          { name: 'Delivery', quantity: 1, unitAmountCents: 500, currency: 'usd' },
        ],
      }),
    )
    expect(deal.amountCents).toBe(3_000)
    expect(deal.lineItems).toEqual([
      { productId: 'p-1', name: 'Bag', quantity: 2, unitAmountCents: 1_250, currency: 'usd' },
      { productId: null, name: 'Delivery', quantity: 1, unitAmountCents: 500, currency: 'usd' },
    ])
    expect(mockDocs.get(`${DEALS}/${deal.id}`)).toMatchObject({ amountCents: 3_000 })

    // Over stored lines: neither a typed amount nor a currency the lines are not in.
    const typed = await call('PATCH', `deals/${deal.id}`, { amountCents: 1 })
    expect((await json(typed)).error.fields.amountCents).toMatch(/sum of its line items/)
    const eur = await call('PATCH', `deals/${deal.id}`, { currency: 'eur' })
    expect((await json(eur)).error.fields.currency).toMatch(/line item/)
    // A line in another currency names itself.
    const mixed = await call('PATCH', `deals/${deal.id}`, {
      lineItems: [{ name: 'Bag', quantity: 1, unitAmountCents: 1, currency: 'eur' }],
    })
    expect((await json(mixed)).error.fields.lineItems).toMatch(/Line 1 is in EUR/)
    // Resending the lines in the new currency moves the deal with them.
    const moved = await json(
      await call('PATCH', `deals/${deal.id}`, {
        currency: 'eur',
        lineItems: [{ name: 'Bag', quantity: 3, unitAmountCents: 1_000 }],
      }),
    )
    expect(moved).toMatchObject({ currency: 'eur', amountCents: 3_000 })
    expect(moved.lineItems[0].currency).toBe('eur')
    // Clearing the lines keeps the last sum and hands the amount back.
    const cleared = await json(await call('PATCH', `deals/${deal.id}`, { lineItems: [] }))
    expect(cleared).toMatchObject({ lineItems: [], amountCents: 3_000 })
    const retyped = await json(await call('PATCH', `deals/${deal.id}`, { amountCents: 1 }))
    expect(retyped.amountCents).toBe(1)
    // The grammar names the line.
    const bad = await call('POST', 'deals', {
      title: 'B',
      consentSiteId: 'host-1',
      lineItems: [{ name: '', quantity: 1, unitAmountCents: 1 }],
    })
    expect((await json(bad)).error.fields.lineItems).toMatch(/^Line 1 needs a name/)
  })
})

describe('an archived pipeline (AGL-2620)', () => {
  it('is never the default, takes no new deal, and still resolves the stage of a deal it holds', async () => {
    const stamp = { visibleTo: tokensFor('host-1'), hostId: 'host-1' }
    mockDocs.set(`${PIPELINES}/old`, {
      name: 'Sales 2025',
      stages: [...DEFAULT_DEAL_STAGES],
      isDefault: true,
      archivedAt: 1_700_000_000_000,
      ...stamp,
    })
    mockDocs.set(`${PIPELINES}/sales`, {
      name: 'Sales',
      stages: [...DEFAULT_DEAL_STAGES],
      isDefault: false,
      archivedAt: null,
      ...stamp,
    })
    const deal = await json(await call('POST', 'deals', { title: 'Beans', consentSiteId: 'host-1' }))
    expect(deal.pipelineId).toBe('sales')
    const refused = await call('POST', 'deals', { title: 'Beans', consentSiteId: 'host-1', pipelineId: 'old' })
    expect(refused.status).toBe(400)
    expect((await json(refused)).error.fields.pipelineId).toMatch(/archived/)

    expect(await json(await call('GET', 'pipelines/old'))).toMatchObject({
      archived: true,
      archivedAt: new Date(1_700_000_000_000).toISOString(),
    })
    expect(await json(await call('GET', 'pipelines/sales'))).toMatchObject({ archived: false, archivedAt: null })

    // A deal closed in the archived pipeline can still be moved: its stages resolve.
    mockDocs.set(`${DEALS}/d-old`, { title: 'Old', pipelineId: 'old', stageId: 'won', status: 'won', ...stamp })
    const reopened = await json(await call('PATCH', 'deals/d-old', { status: 'open' }))
    expect(reopened).toMatchObject({ stageId: 'qualified', status: 'open' })
  })
})
