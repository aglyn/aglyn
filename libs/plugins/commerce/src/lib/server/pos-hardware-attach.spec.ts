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
 *
 * @jest-environment node
 */

/**
 * Finding and attaching the buyer of a card reader sold in person at the
 * platform's own store (AGL-4038), through the real route with Firestore and
 * the sign-in pools faked:
 *
 * - a lookup by exact email, a person's name or a workspace's name shows
 *   the whole address (masked in the audit log only); a name search reads
 *   workspace rosters only, and never a store's own contacts on an email
 *   list; each is rate-limited and written to the audit log;
 * - attaching checks the account, the workspace and the store, moves a
 *   recorded sale into the buyer's workspace (or rides an open sale until it
 *   is paid), invites a buyer with no account once, and can be undone until a
 *   reader is set up;
 * - a workspace created by an invited buyer claims their sales.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { resetFakeFirestore } from '../testing/fake-firestore'

let mockRateAllowed = true
const mockAudits: Array<Record<string, any>> = []
const mockSent: Array<Record<string, any>> = []
/** Accounts by uid, across every pool. */
const mockUsers: Record<string, { uid: string; email: string; displayName?: string }> = {}

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({ permissions: { managePos: true } }),
}))
jest.mock('@aglyn/tenant-data-admin', () => {
  const fake = jest.requireActual('../testing/fake-firestore')
  const owners: Record<string, string> = {
    'host-seller': 'org-seller',
    'host-other': 'org-other',
    'host-pat-1': 'org-pat',
  }
  return {
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async (token: string) => {
            if (token !== 'cashier') throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' })
            return { uid: 'cashier-1', email_verified: true }
          },
        }),
        firestore: () => fake.fakeFirestore,
      }),
      firestore: { FieldValue: fake.fakeFieldValue },
    },
    getOrgForHost: async (hostId: string) => ({
      orgId: owners[hostId],
      org: { id: owners[hostId], plan: 'business', subscriptionStatus: 'active', ownerUid: 'owner-seller' },
    }),
    consumeRateLimit: async () => ({ allowed: mockRateAllowed }),
    hostDisplayName: (host: Record<string, unknown>, id: string) => String(host['name'] ?? id),
    meterPlatformEmail: async () => undefined,
    raiseOperatorAlert: async () => ({ outcome: 'sent' }),
  }
})
jest.mock('@aglyn/tenant-data-admin/server/auth-pools', () => ({
  findUserByEmailAcrossPools: async (email: string) => {
    const user = Object.values(mockUsers).find((candidate) => candidate.email === email.trim().toLowerCase())
    return user ? { record: user, tenantId: null } : null
  },
  findUserByUidAcrossPools: async (uid: string) => (mockUsers[uid] ? { record: mockUsers[uid], tenantId: null } : null),
}))
jest.mock('@aglyn/tenant-data-admin/server/admin-audit', () => ({
  maskEmailAddress: (address: string) => {
    const at = String(address ?? '').lastIndexOf('@')
    return at > 0 ? `${address.slice(0, 1)}***@${address.slice(at + 1)}` : '***'
  },
}))
jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  addAdminAudit: async (_firestore: unknown, entry: Record<string, any>) => {
    mockAudits.push(entry)
    return { id: 'audit' }
  },
}))
jest.mock('@aglyn/tenant-data-admin/server/email-suppression', () => ({
  filterSuppressedEmails: async (addresses: string[]) => addresses,
}))
jest.mock('@aglyn/tenant-data-admin/server/render-system-email', () => ({
  orgSystemEmailBrand: async () => ({ merge: {}, options: {}, fromName: '' }),
  renderSystemEmailContent: async (key: string, merge: Record<string, string>, _brand: unknown, fallback: { subject: string }) => ({
    subject: fallback.subject,
    html: `<p>${key}</p>`,
    text: JSON.stringify(merge),
  }),
}))
jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email/pos-hardware-emails'),
  sendEmail: async (message: Record<string, any>) => {
    mockSent.push(message)
    return { sent: true }
  },
}))
jest.mock('./pos-stripe', () => ({ ...jest.requireActual('./pos-stripe'), posStripeTestMode: () => false }))

import { fakeDocs } from '../testing/fake-firestore'
import { POS_HARDWARE_ENV } from '../model/pos-hardware'
import { posHardwareSaleHandler } from './pos-hardware-sale'
import { posHardwareInPersonOrderId } from './pos-hardware'
import { recordInPersonPosHardwareSale } from './pos-hardware-in-person'
import { claimPosHardwareForNewWorkspace } from './pos-hardware-attach'
import { posHardwareHandler } from './pos-hardware'

const ENV_KEYS = [POS_HARDWARE_ENV.inPersonEnabled, POS_HARDWARE_ENV.sellerHostId, POS_HARDWARE_ENV.sellerOrgId]
const CONFIG = { sellerHostId: 'host-seller', sellerOrgId: 'org-seller' }

function response() {
  const result = { status: 0, body: undefined as any }
  const res = {
    status(code: number) {
      result.status = code
      return res
    },
    json(body: unknown) {
      result.body = body
    },
  } as unknown as PluginApiResponse
  return { res, result }
}

let keys = 0
async function sale(body: Record<string, unknown>, options: { key?: string | null } = {}) {
  const { res, result } = response()
  const key = options.key === undefined ? `key-${++keys}` : options.key
  await posHardwareSaleHandler(
    {
      method: 'POST',
      query: {},
      body: { hostId: 'host-seller', ...body },
      headers: { authorization: 'Bearer cashier', ...(key ? { 'idempotency-key': key } : {}) },
      cookies: {},
      socket: {},
    } as unknown as PluginApiRequest,
    res,
  )
  return result
}

function seed() {
  fakeDocs.set('hosts/host-seller', { name: 'Booth', orgId: 'org-seller' })
  fakeDocs.set('hosts/host-seller/products/reader', { name: 'Stripe Reader S710', hardwareSku: 'stripe-reader-s710' })
  fakeDocs.set('hosts/host-seller/settings/store', {
    tax: { mode: 'manual', origin: { country: 'US', state: 'TX' }, rates: [{ country: 'US', state: 'TX', pct: 8.25 }] },
  })
  // A buyer with a workspace and two stores, one ready for readers.
  mockUsers['uid-pat'] = { uid: 'uid-pat', email: 'pat@example.com', displayName: 'Pat Lee' }
  fakeDocs.set('orgs/org-pat', { name: 'Acme Builders', ownerUid: 'uid-pat', plan: 'business', subscriptionStatus: 'active', nameTokens: ['a', 'ac', 'acm', 'acme', 'b', 'bu', 'bui', 'buil', 'build', 'builde', 'builder', 'builders'] })
  fakeDocs.set('orgs/org-pat/members/uid-pat', {
    uid: 'uid-pat',
    displayName: 'Pat Lee',
    email: 'pat@example.com',
    role: 'owner',
    consoleUserType: 'manager',
    searchTokens: ['p', 'pa', 'pat', 'l', 'le', 'lee', 'patl'],
  })
  fakeDocs.set('hosts/host-pat-1', { name: 'Main Street', orgId: 'org-pat' })
  fakeDocs.set('hosts/host-pat-1/terminal/config', { stripeLocationId: 'tml_1' })
  fakeDocs.set('hosts/host-pat-2', { name: 'Pop-up', orgId: 'org-pat' })
  // Someone on a store's email list with the same name: a contact, never a result.
  fakeDocs.set('orgs/org-other/lists/list-1/members/contact-1', {
    uid: 'contact-1',
    displayName: 'Pat Lee',
    email: 'contact@example.com',
    searchTokens: ['p', 'pa', 'pat', 'l', 'le', 'lee'],
  })
  // A roster row whose ADDRESS starts with "pat" but whose name does not.
  mockUsers['uid-jordan'] = { uid: 'uid-jordan', email: 'patio@example.com', displayName: 'Jordan Kim' }
  fakeDocs.set('orgs/org-jordan', { name: 'Kim Co', ownerUid: 'uid-jordan', plan: 'free' })
  fakeDocs.set('orgs/org-jordan/members/uid-jordan', {
    uid: 'uid-jordan',
    displayName: 'Jordan Kim',
    email: 'patio@example.com',
    consoleUserType: 'manager',
    searchTokens: ['j', 'jo', 'jordan', 'k', 'ki', 'kim', 'p', 'pa', 'pat', 'pati', 'patio'],
  })
}

function paidSale(id: string, fields: Record<string, unknown> = {}) {
  fakeDocs.set(`hosts/host-seller/orders/${id}`, {
    status: 'paid',
    channel: 'pos',
    number: 7,
    registerId: 'register-1',
    lineItems: [{ productId: 'reader', name: 'Stripe Reader S710', quantity: 1, unitAmountCents: 30_000 }],
    totals: { itemsCents: 30_000, shippingCents: 0, discountCents: 0, taxCents: 2_475, totalCents: 32_475, feeCents: 0 },
    payments: [{ id: 'pay_cash', method: 'cash', amountCents: 32_475, status: 'succeeded', atMs: 900 }],
    hardwareSalePending: true,
    paidAtMs: 1_000,
    ...fields,
  })
}

/** Stripe, as far as these specs reach it: a store's reader Location. */
const stripeGets: string[] = []
const STORE_LOCATION = {
  id: 'tml_1',
  address: { line1: '1 Market Sq', line2: null, city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' },
}

beforeEach(() => {
  stripeGets.length = 0
  global.fetch = jest.fn(async (url: string) => {
    stripeGets.push(String(url))
    const found = String(url).endsWith('/terminal/locations/tml_1')
    return { ok: found, status: found ? 200 : 404, json: async () => (found ? STORE_LOCATION : {}) }
  }) as unknown as typeof fetch
  resetFakeFirestore()
  mockRateAllowed = true
  mockAudits.length = 0
  mockSent.length = 0
  for (const uid of Object.keys(mockUsers)) delete mockUsers[uid]
  process.env[POS_HARDWARE_ENV.inPersonEnabled] = 'true'
  process.env[POS_HARDWARE_ENV.sellerHostId] = 'host-seller'
  process.env[POS_HARDWARE_ENV.sellerOrgId] = 'org-seller'
  seed()
})

afterAll(() => {
  for (const key of ENV_KEYS) delete process.env[key]
})

describe('finding the buyer', () => {
  it('by exact email: the address in full, every workspace with its stores, its plan and readiness', async () => {
    const result = await sale({ action: 'find', query: 'Pat@Example.com' })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      kind: 'email',
      noAccount: false,
      workspaces: [],
      people: [
        {
          uid: 'uid-pat',
          name: 'Pat Lee',
          email: 'pat@example.com',
          workspaces: [
            {
              orgId: 'org-pat',
              name: 'Acme Builders',
              posPlan: true,
              stores: [
                { hostId: 'host-pat-1', name: 'Main Street', hasLocation: true },
                { hostId: 'host-pat-2', name: 'Pop-up', hasLocation: false },
              ],
            },
          ],
        },
      ],
    })
    // Never a phone, an address, a role or a bill.
    expect(JSON.stringify(result.body)).not.toMatch(/owner|role|phone|billing/i)
  })

  it('by an address with no account: says so, to sell and invite', async () => {
    expect((await sale({ action: 'find', query: 'new@example.com' })).body).toEqual({
      kind: 'email',
      people: [],
      workspaces: [],
      noAccount: true,
    })
  })

  it("by name: rosters only, the name must match, and the whole address is shown", async () => {
    const result = await sale({ action: 'find', query: 'pat' })
    expect(result.body.kind).toBe('name')
    expect(result.body.people.map((person: any) => [person.uid, person.email])).toEqual([['uid-pat', 'pat@example.com']])
    // Neither the list contact named Pat Lee, nor Jordan, whose address starts "pat".
    expect(JSON.stringify(result.body)).not.toMatch(/contact-1|uid-jordan|patio/)
  })

  it("by a workspace's name: the workspace, its stores and its owner, address in full", async () => {
    const result = await sale({ action: 'find', query: 'acme build' })
    expect(result.body.workspaces).toEqual([
      expect.objectContaining({
        orgId: 'org-pat',
        name: 'Acme Builders',
        owner: { uid: 'uid-pat', name: 'Pat Lee', email: 'pat@example.com' },
      }),
    ])
  })

  it('is written to the audit log every time, the address masked there only, and rate-limited', async () => {
    await sale({ action: 'find', query: 'pat@example.com' })
    await sale({ action: 'find', query: 'acme' })
    expect(mockAudits.map((entry) => [entry.action, entry.actorUid, entry.after.kind, entry.after.query])).toEqual([
      ['pos-hardware-buyer-lookup', 'cashier-1', 'email', 'p***@example.com'],
      ['pos-hardware-buyer-lookup', 'cashier-1', 'name', 'acme'],
    ])
    expect(mockAudits[0]!['after'].matched).toEqual(['uid-pat'])
    mockRateAllowed = false
    expect((await sale({ action: 'find', query: 'acme' })).status).toBe(429)
    expect((await sale({ action: 'find', query: 'a' })).status).toBe(400)
  })

  it('is the seller store’s alone', async () => {
    expect((await sale({ action: 'find', query: 'pat', hostId: 'host-other' })).status).toBe(404)
  })
})

describe('attaching the buyer', () => {
  const pat = { uid: 'uid-pat', orgId: 'org-pat', hostId: 'host-pat-1' }
  const idOf = (registerOrderId: string) => posHardwareInPersonOrderId('host-seller', registerOrderId)

  it('rides an open sale, and the order is the workspace’s once it is paid', async () => {
    paidSale('open-1', { status: 'pending' })
    const result = await sale({ action: 'attach', registerOrderId: 'open-1', buyer: pat })
    expect(result.body).toEqual({ outcome: 'waiting' })
    expect(fakeDocs.get('hosts/host-seller/orders/open-1')?.['hardwareBuyer']).toMatchObject({ ...pat, attachedBy: 'cashier-1' })
    fakeDocs.set('hosts/host-seller/orders/open-1', { ...fakeDocs.get('hosts/host-seller/orders/open-1'), status: 'paid' })
    await recordInPersonPosHardwareSale('host-seller', 'open-1')
    expect(fakeDocs.get(`orgs/org-pat/hardwareOrders/${idOf('open-1')}`)).toMatchObject({
      hostId: 'host-pat-1',
      createdBy: 'uid-pat',
      contactEmail: 'pat@example.com',
      attachment: { state: 'attached', orgId: 'org-pat' },
    })
  })

  it('moves a recorded sale into the workspace, with its record and the register order, once', async () => {
    paidSale('paid-1')
    await recordInPersonPosHardwareSale('host-seller', 'paid-1')
    const id = idOf('paid-1')
    expect(fakeDocs.has(`orgs/org-seller/hardwareOrders/${id}`)).toBe(true)
    const result = await sale({ action: 'attach', orderId: id, buyer: { uid: 'uid-pat', orgId: 'org-pat' } })
    expect(result.status).toBe(200)
    expect(result.body.outcome).toBe('attached')
    // The account's whole address, as the lookup showed it.
    expect(result.body.order).toMatchObject({ id, attached: true, contactEmail: 'pat@example.com' })
    expect(fakeDocs.has(`orgs/org-seller/hardwareOrders/${id}`)).toBe(false)
    expect(fakeDocs.get(`orgs/org-pat/hardwareOrders/${id}`)).toMatchObject({ orgId: 'org-pat', hostId: '' })
    expect(fakeDocs.get(`posHardwareSales/${id}`)?.['orgId']).toBe('org-pat')
    expect(fakeDocs.get('hosts/host-seller/orders/paid-1')?.['hardwareBuyer']).toMatchObject({ uid: 'uid-pat', orgId: 'org-pat' })
    // The same again changes nothing; another buyer needs a detach first.
    expect((await sale({ action: 'attach', orderId: id, buyer: { uid: 'uid-pat', orgId: 'org-pat' } })).status).toBe(200)
    mockUsers['uid-jordan'] = { uid: 'uid-jordan', email: 'patio@example.com' }
    expect((await sale({ action: 'attach', orderId: id, buyer: { uid: 'uid-jordan', orgId: 'org-jordan' } })).status).toBe(409)
    const audit = mockAudits.find((entry) => entry.action === 'pos-hardware-sale-attach')
    expect(audit).toMatchObject({ actorUid: 'cashier-1', target: `posHardwareSales/${id}`, after: { outcome: 'attached', uid: 'uid-pat' } })
  })

  it('records a paid sale the listener has not reached yet, already attached', async () => {
    paidSale('paid-2')
    const result = await sale({ action: 'attach', registerOrderId: 'paid-2', buyer: pat })
    expect(result.body.outcome).toBe('attached')
    expect(fakeDocs.has(`orgs/org-pat/hardwareOrders/${idOf('paid-2')}`)).toBe(true)
    expect(fakeDocs.has(`orgs/org-seller/hardwareOrders/${idOf('paid-2')}`)).toBe(false)
  })

  it('checks the account, the workspace and the store, and wants a key', async () => {
    paidSale('paid-3')
    expect((await sale({ action: 'attach', registerOrderId: 'paid-3', buyer: { uid: 'nobody', orgId: 'org-pat' } })).status).toBe(404)
    mockUsers['uid-jordan'] = { uid: 'uid-jordan', email: 'patio@example.com' }
    expect((await sale({ action: 'attach', registerOrderId: 'paid-3', buyer: { uid: 'uid-jordan', orgId: 'org-pat' } })).status).toBe(409)
    expect((await sale({ action: 'attach', registerOrderId: 'paid-3', buyer: { ...pat, hostId: 'host-seller' } })).status).toBe(409)
    expect((await sale({ action: 'attach', registerOrderId: 'paid-3', buyer: { email: 'pat@example.com' } })).status).toBe(409)
    expect((await sale({ action: 'attach', registerOrderId: 'paid-3', buyer: pat }, { key: null })).status).toBe(400)
    paidSale('voided-1', { status: 'voided' })
    expect((await sale({ action: 'attach', registerOrderId: 'voided-1', buyer: pat })).status).toBe(409)
  })

  it('invites a buyer with no account once, and keeps the sale on the To attach list', async () => {
    paidSale('paid-4')
    const result = await sale({ action: 'attach', registerOrderId: 'paid-4', buyer: { email: 'New@Example.com' } })
    expect(result.body.outcome).toBe('pending')
    expect(result.body.order).toMatchObject({ invited: true, contactEmail: 'new@example.com' })
    const id = idOf('paid-4')
    expect(fakeDocs.get(`orgs/org-seller/hardwareOrders/${id}`)?.['attachment']).toMatchObject({
      state: 'pending',
      email: 'new@example.com',
      invitedAtMs: expect.any(Number),
    })
    expect(mockSent).toHaveLength(1)
    expect(mockSent[0]).toMatchObject({ to: 'new@example.com', context: 'pos-hardware-sign-up-invite' })
    expect(mockSent[0]!['text']).toContain('/signup')
    await sale({ action: 'attach', orderId: id, buyer: { email: 'new@example.com' } })
    expect(mockSent).toHaveLength(1)
    expect((await sale({ action: 'pending' })).body.orders.map((row: any) => [row.id, row.invited])).toEqual([[id, true]])
  })

  it('invites a buyer named while the sale was open, once it is recorded', async () => {
    paidSale('open-2', { status: 'pending' })
    await sale({ action: 'attach', registerOrderId: 'open-2', buyer: { email: 'later@example.com' } })
    expect(mockSent).toHaveLength(0)
    fakeDocs.set('hosts/host-seller/orders/open-2', { ...fakeDocs.get('hosts/host-seller/orders/open-2'), status: 'paid' })
    await recordInPersonPosHardwareSale('host-seller', 'open-2')
    expect(mockSent.map((message) => message['to'])).toEqual(['later@example.com'])
  })

  it('detaches back to the To attach list, until a reader is set up', async () => {
    paidSale('paid-5')
    await sale({ action: 'attach', registerOrderId: 'paid-5', buyer: pat })
    const id = idOf('paid-5')
    const detached = await sale({ action: 'detach', orderId: id })
    expect(detached.status).toBe(200)
    expect(fakeDocs.get(`orgs/org-seller/hardwareOrders/${id}`)).toMatchObject({
      createdBy: null,
      contactEmail: null,
      attachment: { state: 'pending', uid: null },
    })
    expect(fakeDocs.get('hosts/host-seller/orders/paid-5')).not.toHaveProperty('hardwareBuyer')
    await sale({ action: 'attach', orderId: id, buyer: pat })
    const order = fakeDocs.get(`orgs/org-pat/hardwareOrders/${id}`)!
    fakeDocs.set(`orgs/org-pat/hardwareOrders/${id}`, { ...order, units: [{ ...order['units'][0], readerId: 'tmr_1' }] })
    expect((await sale({ action: 'detach', orderId: id })).status).toBe(409)
  })
})

describe('the buyer’s name and address, kept for the reseller’s records (AGL-4038)', () => {
  const idOf = (registerOrderId: string) => posHardwareInPersonOrderId('host-seller', registerOrderId)
  const typed = { line1: '9 Elm St', city: 'Dallas', state: 'TX', postalCode: '75201', country: 'us' }

  it('takes the account’s name and, with no address typed, the address of the store chosen for the readers', async () => {
    paidSale('id-1')
    await sale({ action: 'attach', registerOrderId: 'id-1', buyer: { uid: 'uid-pat', orgId: 'org-pat', hostId: 'host-pat-1' } })
    const id = idOf('id-1')
    expect(fakeDocs.get(`orgs/org-pat/hardwareOrders/${id}`)?.['attachment']).toMatchObject({
      name: 'Pat Lee',
      address: { line1: '1 Market Sq', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
    })
    expect(fakeDocs.get(`posHardwareSales/${id}`)?.['buyer']).toEqual({
      name: 'Pat Lee',
      address: { line1: '1 Market Sq', line2: null, city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
    })
    // Still taxed where the selling store is, not where the buyer is.
    expect(fakeDocs.get(`posHardwareSales/${id}`)?.['shipTo']).toMatchObject({ state: 'TX' })
    // The address never reaches the audit log.
    expect(JSON.stringify(mockAudits)).not.toContain('Market Sq')
  })

  it('keeps an address the register typed rather than the store’s, and refuses half of one', async () => {
    paidSale('id-2')
    const bad = await sale({ action: 'attach', registerOrderId: 'id-2', buyer: { uid: 'uid-pat', orgId: 'org-pat', address: { line1: '9 Elm St' } } })
    expect(bad.status).toBe(400)
    await sale({ action: 'attach', registerOrderId: 'id-2', buyer: { uid: 'uid-pat', orgId: 'org-pat', hostId: 'host-pat-1', address: typed } })
    expect(fakeDocs.get(`posHardwareSales/${idOf('id-2')}`)?.['buyer']).toEqual({
      name: 'Pat Lee',
      address: { line1: '9 Elm St', line2: null, city: 'Dallas', state: 'TX', postalCode: '75201', country: 'US' },
    })
    expect(stripeGets).toHaveLength(0)
  })

  it('keeps a name typed for a buyer with no account through their sign-up, and drops a buyer detached', async () => {
    paidSale('id-3')
    await sale({ action: 'attach', registerOrderId: 'id-3', buyer: { email: 'new@example.com', name: 'Robin Diaz', address: typed } })
    const id = idOf('id-3')
    expect(fakeDocs.get(`posHardwareSales/${id}`)?.['buyer']).toMatchObject({ name: 'Robin Diaz' })
    await claimPosHardwareForNewWorkspace({ config: CONFIG, orgId: 'org-new', ownerUid: 'uid-new', ownerEmail: 'new@example.com', emailVerified: true })
    expect(fakeDocs.get(`orgs/org-new/hardwareOrders/${id}`)?.['attachment']).toMatchObject({ name: 'Robin Diaz', address: { city: 'Dallas' } })
    expect(fakeDocs.get(`posHardwareSales/${id}`)?.['buyer']).toMatchObject({ name: 'Robin Diaz', address: { city: 'Dallas' } })

    paidSale('id-4')
    await sale({ action: 'attach', registerOrderId: 'id-4', buyer: { uid: 'uid-pat', orgId: 'org-pat' } })
    expect(fakeDocs.get(`posHardwareSales/${idOf('id-4')}`)?.['buyer']).toMatchObject({ name: 'Pat Lee' })
    await sale({ action: 'detach', orderId: idOf('id-4') })
    // The wrong buyer was chosen: they come off the record too.
    expect(fakeDocs.get(`posHardwareSales/${idOf('id-4')}`)?.['buyer']).toBeNull()
  })
})

describe('a workspace created by an invited buyer claims their sales', () => {
  it('by their verified address or their account, and not by an unverified address', async () => {
    paidSale('paid-6')
    await sale({ action: 'attach', registerOrderId: 'paid-6', buyer: { email: 'new@example.com' } })
    expect(
      await claimPosHardwareForNewWorkspace({ config: CONFIG, orgId: 'org-new', ownerUid: 'uid-new', ownerEmail: 'new@example.com', emailVerified: false }),
    ).toEqual({ claimed: 0 })
    expect(
      await claimPosHardwareForNewWorkspace({ config: CONFIG, orgId: 'org-new', ownerUid: 'uid-new', ownerEmail: 'NEW@example.com', emailVerified: true }),
    ).toEqual({ claimed: 1 })
    const id = posHardwareInPersonOrderId('host-seller', 'paid-6')
    expect(fakeDocs.get(`orgs/org-new/hardwareOrders/${id}`)).toMatchObject({
      createdBy: 'uid-new',
      contactEmail: 'new@example.com',
      attachment: { state: 'attached', orgId: 'org-new', attachedBy: null },
    })
    // An account with no workspace yet, attached at the booth by its uid.
    mockUsers['uid-solo'] = { uid: 'uid-solo', email: 'solo@example.com' }
    paidSale('paid-7')
    await sale({ action: 'attach', registerOrderId: 'paid-7', buyer: { uid: 'uid-solo' } })
    expect(
      await claimPosHardwareForNewWorkspace({ config: CONFIG, orgId: 'org-solo', ownerUid: 'uid-solo', ownerEmail: 'solo@example.com', emailVerified: false }),
    ).toEqual({ claimed: 1 })
    expect(fakeDocs.has(`orgs/org-solo/hardwareOrders/${posHardwareInPersonOrderId('host-seller', 'paid-7')}`)).toBe(true)
  })

  it('does nothing while the in-person sale is off', async () => {
    expect(
      await claimPosHardwareForNewWorkspace({ config: null, orgId: 'org-new', ownerUid: 'uid-new', ownerEmail: 'new@example.com', emailVerified: true }),
    ).toEqual({ claimed: 0 })
  })
})

describe("the buyer's Hardware card", () => {
  it('lists a reader bought in person for the workspace, beside the store’s own orders', async () => {
    fakeDocs.set('orgs/org-pat/hardwareOrders/hw_cccccccccccccccccccc', {
      orgId: 'org-pat',
      hostId: 'host-pat-1',
      status: 'shipped',
      lines: [],
      createdAtMs: 500,
      shipping: { method: 'standard', label: 'Standard shipping', cents: 0 },
    })
    paidSale('paid-8')
    await sale({ action: 'attach', registerOrderId: 'paid-8', buyer: { uid: 'uid-pat', orgId: 'org-pat' } })
    // Pending sales on the selling workspace's own list are never its orders.
    paidSale('paid-9')
    await recordInPersonPosHardwareSale('host-seller', 'paid-9')
    const { res, result } = response()
    await posHardwareHandler(
      {
        method: 'POST',
        query: {},
        body: { action: 'orders', hostId: 'host-pat-1' },
        headers: { authorization: 'Bearer cashier' },
        cookies: {},
        socket: {},
      } as unknown as PluginApiRequest,
      res,
    )
    expect(result.status).toBe(200)
    expect(result.body.orders.map((order: any) => [order.id, order.source, order.readersToSetUp])).toEqual([
      [posHardwareInPersonOrderId('host-seller', 'paid-8'), 'in_person', 1],
      ['hw_cccccccccccccccccccc', 'online', 0],
    ])
  })
})
