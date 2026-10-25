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

import { MemoryFirestore } from '../testing/memory-firestore'

const mockStore = { current: new MemoryFirestore() }
const mockRole = { current: 'owner' as string | null }
const mockActivity: string[] = []
const mockEffects: { current: unknown } = { current: null }

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => mockStore.current,
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'user-1', email: 'alex@testbakery.com', name: 'Alex Test' }),
      }),
    }),
  },
  getOrgForHost: async (hostId: string) => {
    const host = mockStore.current.docs.get(`hosts/${hostId}`)
    const orgId = String(host?.['orgId'] ?? '')
    return orgId ? { orgId, org: mockStore.current.docs.get(`orgs/${orgId}`) ?? {} } : null
  },
  resolveOrgMembership: async (_uid: string, orgId: string) =>
    mockRole.current ? { orgId, member: { role: mockRole.current } } : null,
  memberHasOrgPermission: async () => true,
  logHostActivity: async (_hostId: string, _actor: unknown, action: string) => void mockActivity.push(action),
}))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  logOrgActivity: async (_orgId: string, _actor: unknown, action: string) => void mockActivity.push(action),
}))
jest.mock('@aglyn/tenant-data-admin/server/payment-fraud-hold', () => ({
  isPaymentFraudHeld: async () => false,
}))
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  isEmailVerified: () => true,
  isImpersonationSession: () => false,
}))
jest.mock('@aglyn/tenant-data-admin/server/id-token-refusal', () => ({
  isRefusedIdToken: () => false,
}))
jest.mock('./platform-effects', () => ({
  platformEffects: () => mockEffects.current,
}))

import type { DomainRegistrationDoc } from '../model/registration'
import { readRegistration, registrationRef } from './db'
import type { LifecycleEffects } from './lifecycle'
import type { RegistrarDriver, RegistrarResult } from './registrar'
import {
  contactRoute,
  dnsRoute,
  transferInQuoteRoute,
  transferOutRoute,
  workspaceRoute,
} from './routes'

/**
 * The console routes at the workspace level (AGL-4040): the Domains page's
 * list, the registry's own transfer-out lock date, the server-only contact,
 * the DNS records Aglyn keeps, and the transfer-in price.
 */

const DAY = 24 * 60 * 60 * 1000
const yes = <T,>(value: T): RegistrarResult<T> => ({ ok: 'yes', value })

let driver: jest.Mocked<RegistrarDriver>
let emails: string[] = []

function driverWith(overrides: Partial<RegistrarDriver> = {}): jest.Mocked<RegistrarDriver> {
  const base = {
    id: 'fake',
    configured: () => true,
    authCode: async () => yes('AUTH-CODE'),
    info: async () => yes({ owned: false, registeredAtMs: null, expiresAtMs: null, autoRenew: null }),
    standardContact: async () => yes(true),
    transferPrice: async () => yes(11.25),
    renewalPrice: async () => yes(11.25),
    nameservers: async () =>
      yes({ ours: true, nameservers: ['ns1.vercel-dns.com'], intended: ['ns1.vercel-dns.com'] }),
    listDnsRecords: async () =>
      yes([
        { id: 'rec_alias', type: 'ALIAS', name: '', value: 'cname.vercel-dns.com', ttl: 60, priority: null, creator: 'system' },
        { id: 'rec_a', type: 'A', name: '', value: '76.76.21.21', ttl: 60, priority: null, creator: 'user' },
        { id: 'rec_mx', type: 'MX', name: '', value: 'mx.example.com', ttl: 60, priority: 10, creator: 'user' },
      ]),
    createDnsRecord: async () => yes({ id: 'rec_new' }),
    updateDnsRecord: async () => yes(true as const),
    deleteDnsRecord: async () => yes(true as const),
    ...overrides,
  } as RegistrarDriver
  for (const key of Object.keys(base) as (keyof RegistrarDriver)[]) {
    const value = base[key]
    if (typeof value === 'function') {
      ;(base as never as Record<string, unknown>)[key] = jest.fn(value as (...args: never[]) => unknown)
    }
  }
  return base as jest.Mocked<RegistrarDriver>
}

function request(path: string, body?: Record<string, unknown>, query = ''): Request {
  return new Request(`https://console.test/api/registrar/${path}${query}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

function registration(patch: Partial<DomainRegistrationDoc> = {}): DomainRegistrationDoc {
  return {
    domain: 'testbakery.com',
    orgId: 'org-1',
    hostId: null,
    registrar: 'fake',
    status: 'active',
    autoRenew: true,
    firstYearCents: 1599,
    renewalCents: 1599,
    costUsd: 11.25,
    renewalCostUsd: 11.25,
    registeredAtMs: Date.now() - 100 * DAY,
    expiresAtMs: Date.now() + 200 * DAY,
    registrant: { name: 'Alex Test', email: 'alex@testbakery.com' },
    createdBy: 'user-1',
    createdAtMs: Date.now() - 100 * DAY,
    updatedAtMs: Date.now(),
    history: [],
    ...patch,
  } as DomainRegistrationDoc
}

async function seed(...docs: DomainRegistrationDoc[]): Promise<void> {
  for (const doc of docs) await registrationRef(doc.domain).set(doc as never)
}

beforeEach(() => {
  mockStore.current = new MemoryFirestore()
  mockStore.current.docs.set('orgs/org-1', { name: 'Test Org', plan: 'starter' })
  mockStore.current.docs.set('hosts/host-1', { orgId: 'org-1', cname: 'testbakery.com', memberRoles: {} })
  mockStore.current.docs.set('hosts/host-2', { orgId: 'org-1', cname: 'otherbakery.com', memberRoles: {} })
  mockRole.current = 'owner'
  mockActivity.length = 0
  emails = []
  driver = driverWith()
  mockEffects.current = {
    driver,
    now: () => Date.now(),
    email: async (kind: string) => void emails.push(kind),
    sleep: async () => undefined,
  } as Partial<LifecycleEffects>
  process.env['STRIPE_PRODUCT_DOMAIN_REGISTRATION'] = 'prod_test'
})

afterEach(() => {
  delete process.env['STRIPE_PRODUCT_DOMAIN_REGISTRATION']
})

describe('the Domains page list', () => {
  it('lists every name the workspace holds, and which a site really serves', async () => {
    await seed(
      registration({ hostId: 'host-1' }),
      // Named on a site that has since moved on to another domain.
      registration({ domain: 'stale.com', hostId: 'host-2' }),
      registration({ domain: 'spare.com' }),
      registration({ domain: 'moving.com', status: 'transferring-in', origin: 'transfer-in' }),
      registration({ domain: 'gone.com', status: 'declined' }),
      registration({ domain: 'theirs.com', orgId: 'org-2' }),
    )
    const answer = await workspaceRoute(request('workspace', undefined, '?orgId=org-1'))
    expect(answer.status).toBe(200)
    const body = await answer.json()
    const rows = Object.fromEntries(
      (body.rows as { domain: string; connected: boolean; status: string }[]).map((row) => [row.domain, row]),
    )
    expect(Object.keys(rows).sort()).toEqual(['moving.com', 'spare.com', 'stale.com', 'testbakery.com'])
    expect(rows['testbakery.com'].connected).toBe(true)
    expect(rows['stale.com'].connected).toBe(false)
    expect(rows['moving.com'].status).toBe('transferring-in')
    expect(body).toMatchObject({ configured: true, entitled: true, billingPermission: true })
    // Every site's current domain, so Connect can name the one it replaces.
    expect(body.siteDomains).toEqual({ 'host-1': 'testbakery.com', 'host-2': 'otherbakery.com' })
    expect(JSON.stringify(body)).not.toContain('costUsd')
  })

  it('is a workspace owner’s or admin’s page', async () => {
    mockRole.current = 'editor'
    expect((await workspaceRoute(request('workspace', undefined, '?orgId=org-1'))).status).toBe(403)
  })

  it('lists held names on a plan without domains, and says the plan is why buying is off', async () => {
    mockStore.current.docs.set('orgs/org-1', { name: 'Test Org', plan: 'free' })
    await seed(registration())
    const body = await (await workspaceRoute(request('workspace', undefined, '?orgId=org-1'))).json()
    expect(body).toMatchObject({ entitled: false, canBuy: false })
    expect(body.rows).toHaveLength(1)
  })
})

describe('transfer out', () => {
  it('answers the registry’s own lock date, not an estimate', async () => {
    await seed(registration({ registeredAtMs: Date.now() - 2 * DAY }))
    const untilMs = Date.parse('2026-12-18T00:00:00Z')
    driver.authCode.mockResolvedValue({
      ok: 'no',
      code: 'domain_cannot_be_transfered_out_until',
      retryable: false,
      untilMs,
    })
    const answer = await transferOutRoute(request('transfer-out', { orgId: 'org-1', domain: 'testbakery.com' }))
    expect(answer.status).toBe(409)
    const body = await answer.json()
    expect(body).toMatchObject({ code: 'locked', untilMs })
    expect(body.error).toContain('Dec 18, 2026')
    expect(emails).toEqual([])
  })

  it('asks the registrar even for a name registered yesterday, and shows the code', async () => {
    await seed(registration({ registeredAtMs: Date.now() - DAY }))
    const answer = await transferOutRoute(request('transfer-out', { orgId: 'org-1', domain: 'testbakery.com' }))
    expect(await answer.json()).toEqual({ authCode: 'AUTH-CODE' })
    expect(emails).toEqual(['transferCode'])
  })
})

describe('the registrant contact', () => {
  const CONTACT = {
    firstName: 'Jordan', lastName: 'Lee', email: 'jordan@example.com', phone: '+1 512 555 0123',
    address1: '1 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'US',
  }

  it('stores an edit server-side for the next renewal, and says when it takes effect', async () => {
    await seed(registration())
    const saved = await contactRoute(request('contact', { orgId: 'org-1', domain: 'testbakery.com', contact: CONTACT }))
    expect(saved.status).toBe(200)
    const body = await saved.json()
    expect(body.pendingSinceMs).toBeGreaterThan(0)
    expect(body.takesEffectAtMs).toBeGreaterThan(Date.now())
    const stored = await readRegistration('testbakery.com')
    expect(stored?.registrantContact).toMatchObject({ firstName: 'Jordan', phone: '+1.5125550123' })
    expect(stored?.contactChange?.updatedBy).toBe('user-1')
    // The registrar is not asked: it takes contact changes only on renew.
    expect(Object.values(driver).some((fn) => jest.isMockFunction(fn) && fn.mock.calls.length > 0)).toBe(false)
    expect(mockActivity).toEqual(['Changed the registrant contact for a domain'])
  })

  it('refuses a malformed contact by field', async () => {
    await seed(registration())
    const answer = await contactRoute(
      request('contact', { orgId: 'org-1', domain: 'testbakery.com', contact: { ...CONTACT, email: 'nope' } }),
    )
    expect(answer.status).toBe(400)
    expect(await answer.json()).toMatchObject({ code: 'contact', fields: ['email'] })
  })

  it('prefills from the registrant before any edit, for the workspace admin only', async () => {
    await seed(registration({ contactVerification: { verified: false, verifyByMs: 5, email: 'a@b.co', checkedAtMs: 1 } }))
    const body = await (await contactRoute(request('contact', undefined, '?orgId=org-1&domain=testbakery.com'))).json()
    expect(body).toMatchObject({
      contact: { firstName: 'Alex', lastName: 'Test', email: 'alex@testbakery.com' },
      stored: false,
      verification: { verified: false, verifyByMs: 5 },
    })
    mockRole.current = 'editor'
    expect((await contactRoute(request('contact', undefined, '?orgId=org-1&domain=testbakery.com'))).status).toBe(403)
  })
})

describe('DNS records', () => {
  it('marks the records Aglyn keeps for a connected site', async () => {
    await seed(registration({ hostId: 'host-1' }))
    const body = await (await dnsRoute(request('dns', undefined, '?orgId=org-1&domain=testbakery.com'))).json()
    expect(body.ours).toBe(true)
    expect(body.siteConnected).toBe(true)
    expect(
      Object.fromEntries((body.records as { id: string; managed: boolean }[]).map((r) => [r.id, r.managed])),
    ).toEqual({ rec_alias: true, rec_a: true, rec_mx: false })
  })

  it('shows no editor for a name on another provider’s nameservers', async () => {
    await seed(registration())
    driver.nameservers.mockResolvedValue(yes({ ours: false, nameservers: ['ns1.otherhost.example'], intended: [] }))
    const body = await (await dnsRoute(request('dns', undefined, '?orgId=org-1&domain=testbakery.com'))).json()
    // host-1 serves it by hand, so its address records stay protected.
    expect(body).toEqual({ ours: false, nameservers: ['ns1.otherhost.example'], siteConnected: true, records: [] })
    expect(driver.listDnsRecords).not.toHaveBeenCalled()
    const write = await dnsRoute(
      request('dns', { orgId: 'org-1', domain: 'testbakery.com', action: 'create', record: { type: 'TXT', name: '', value: 'x' } }),
    )
    expect(await write.json()).toMatchObject({ code: 'not-our-nameservers' })
  })

  it('refuses to change or delete a record Aglyn keeps, or add one over the site’s address', async () => {
    await seed(registration({ hostId: 'host-1' }))
    const remove = await dnsRoute(
      request('dns', { orgId: 'org-1', domain: 'testbakery.com', action: 'delete', recordId: 'rec_a' }),
    )
    expect(remove.status).toBe(409)
    expect(await remove.json()).toMatchObject({ code: 'managed' })
    const add = await dnsRoute(
      request('dns', {
        orgId: 'org-1', domain: 'testbakery.com', action: 'create',
        record: { type: 'CNAME', name: 'www', value: 'elsewhere.example.com' },
      }),
    )
    expect(await add.json()).toMatchObject({ code: 'managed' })
    expect(driver.deleteDnsRecord).not.toHaveBeenCalled()
    expect(driver.createDnsRecord).not.toHaveBeenCalled()
  })

  it('refuses a CAA record while a site is connected', async () => {
    await seed(registration({ hostId: 'host-1' }))
    const add = await dnsRoute(
      request('dns', {
        orgId: 'org-1', domain: 'testbakery.com', action: 'create',
        record: { type: 'CAA', name: '', value: 'other-ca.example', caaTag: 'issue' },
      }),
    )
    expect(await add.json()).toMatchObject({ code: 'managed' })
    expect(driver.createDnsRecord).not.toHaveBeenCalled()
  })

  it('adds, changes and deletes the owner’s own records', async () => {
    await seed(registration({ hostId: 'host-1' }))
    const add = await dnsRoute(
      request('dns', {
        orgId: 'org-1', domain: 'testbakery.com', action: 'create',
        record: { type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=none' },
      }),
    )
    expect(add.status).toBe(200)
    expect(driver.createDnsRecord).toHaveBeenCalledWith('testbakery.com', { type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=none' })
    await dnsRoute(
      request('dns', {
        orgId: 'org-1', domain: 'testbakery.com', action: 'update', recordId: 'rec_mx',
        record: { type: 'MX', name: '', value: 'mx2.example.com', priority: 20 },
      }),
    )
    expect(driver.updateDnsRecord).toHaveBeenCalledWith('rec_mx', { type: 'MX', name: '', value: 'mx2.example.com', mxPriority: 20 })
    await dnsRoute(request('dns', { orgId: 'org-1', domain: 'testbakery.com', action: 'delete', recordId: 'rec_mx' }))
    expect(driver.deleteDnsRecord).toHaveBeenCalledWith('testbakery.com', 'rec_mx')
    expect(mockActivity).toEqual(['Added a DNS record', 'Changed a DNS record', 'Deleted a DNS record'])
  })

  it('fails closed when it cannot tell whether a site serves the name', async () => {
    await seed(registration())
    const store = mockStore.current
    const original = store.collection.bind(store)
    store.collection = ((name: string) =>
      name === 'hosts'
        ? {
            doc: () => ({ get: async () => { throw new Error('unavailable') } }),
            where: () => ({ limit: () => ({ get: async () => { throw new Error('unavailable') } }) }),
          }
        : original(name)) as typeof store.collection
    const write = await dnsRoute(
      request('dns', { orgId: 'org-1', domain: 'testbakery.com', action: 'delete', recordId: 'rec_a' }),
    )
    expect(write.status).toBe(503)
    expect(await write.json()).toMatchObject({ code: 'site-unreadable' })
    expect(driver.deleteDnsRecord).not.toHaveBeenCalled()
    const read = await dnsRoute(request('dns', undefined, '?orgId=org-1&domain=testbakery.com'))
    expect(read.status).toBe(503)
  })

  it('names a malformed record’s fields', async () => {
    await seed(registration())
    const answer = await dnsRoute(
      request('dns', { orgId: 'org-1', domain: 'testbakery.com', action: 'create', record: { type: 'A', name: '', value: 'x' } }),
    )
    expect(await answer.json()).toMatchObject({ code: 'record', fields: ['value'] })
  })
})

describe('the transfer-in price', () => {
  it('is the renewal formula on the registrar’s transfer price', async () => {
    const answer = await transferInQuoteRoute(request('transfer-in-quote', undefined, '?orgId=org-1&domain=testbakery.com'))
    expect(await answer.json()).toEqual({ domain: 'testbakery.com', priceCents: 1599, renewalCents: 1599 })
  })

  it('refuses a lapsed name, even another workspace’s, and one already in our registrar account', async () => {
    await seed(registration({ orgId: 'org-2', status: 'expired' }))
    const lapsed = await transferInQuoteRoute(request('transfer-in-quote', undefined, '?orgId=org-1&domain=testbakery.com'))
    expect(await lapsed.json()).toMatchObject({ code: 'already-here' })
    driver.info.mockResolvedValue(yes({ owned: true, registeredAtMs: 1, expiresAtMs: 2, autoRenew: true }))
    const owned = await transferInQuoteRoute(request('transfer-in-quote', undefined, '?orgId=org-1&domain=fresh.com'))
    expect(await owned.json()).toMatchObject({ code: 'already-here' })
  })

  it('tells a workspace to renew its own expired name', async () => {
    await seed(registration({ status: 'expired' }))
    const answer = await transferInQuoteRoute(request('transfer-in-quote', undefined, '?orgId=org-1&domain=testbakery.com'))
    const body = await answer.json()
    expect(body).toMatchObject({ code: 'renew-instead' })
    expect(body.error).toMatch(/Renew now/)
  })

  it('says a name already in the workspace is already here', async () => {
    await seed(registration())
    const answer = await transferInQuoteRoute(request('transfer-in-quote', undefined, '?orgId=org-1&domain=testbakery.com'))
    expect(await answer.json()).toMatchObject({ code: 'already-yours' })
  })
})
