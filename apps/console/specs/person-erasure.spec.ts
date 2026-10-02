/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom.
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
 * A PERSON ERASED FROM A WORKSPACE, END TO END, ACROSS EVERY PLUGIN THAT
 * KEEPS THEM (AGL-2623, AGL-2981, AGL-3080).
 *
 * The erasure is a compliance path: what a workspace admin files for a person
 * has to remove that person from everything the workspace keeps. The platform
 * closes every site's door and sweeps the delivery log; the record system
 * (the CRM), the shop, the calendar, the audience lists and the sequences
 * each erase their own share through `plugin-person-erasure`, and none of
 * them is imported here. This runs the real nightly job, over the console's
 * own server-declarations boot, against one store seeded with everything a
 * person leaves behind — and holds every promise the dialog makes:
 *
 *  1. every site's door closes (an address-free suppression row) BEFORE
 *     anything is deleted;
 *  2. the contact document goes whole, its companies' counts move down once,
 *     its deals are unlinked and kept, its tasks and activities go;
 *  3. the person's lead goes — the organization's row and every legacy
 *     per-site row of this workspace, never another workspace's — and the
 *     plugins keeping a figure over leads are told once they are gone;
 *  4. the person comes off every audience list, and the lists stay;
 *  5. orders and bookings stay as records with the person taken off them;
 *  6. a sequence's enrollments go — found by the contact the record system
 *     named before it erased it — and the do-not-contact entry stays;
 *  7. the completed request and the audit row keep counts and the hash, never
 *     the address;
 *  8. a promised share that is missing refuses the erasure, and the request
 *     stays queued.
 *
 * ⚑ It imports no plugin: an app may not depend on one.
 */

import { createHash } from 'node:crypto'

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    delete: () => ({ __delete: true }),
    increment: (operand: number) => ({ __increment: operand }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
  },
  Timestamp: class {},
}))

/*==========================================
 * A path-keyed store: every document is `mockDocs.get('a/b/c/d')`. Queries
 * filter the direct children of a collection path on `==` and `in`, and
 * `orderBy` lists only the documents carrying the field, ascending; `getAll`
 * resolves refs by path; a batch replays its writes in order.
 *=========================================*/
const mockDocs = new Map<string, Record<string, any>>()
let mockAutoId = 0
/** Called with the path just before a document delete lands. */
let onDelete: ((path: string) => void) | null = null

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...mockDocs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function applyPatch(existing: Record<string, any>, patch: Record<string, any>) {
  const next = { ...existing }
  for (const [field, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && '__delete' in value) delete next[field]
    else if (value && typeof value === 'object' && '__increment' in value) {
      next[field] = Number(next[field] ?? 0) + Number(value.__increment)
    } else next[field] = value
  }
  return next
}

function snapshot(path: string) {
  const data = mockDocs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
    ref: docRef(path),
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => snapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      mockDocs.set(path, options?.merge ? applyPatch(mockDocs.get(path) ?? {}, value) : { ...value })
    },
    create: async (value: Record<string, any>) => {
      if (mockDocs.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
      mockDocs.set(path, { ...value })
    },
    update: async (value: Record<string, any>) => {
      const existing = mockDocs.get(path)
      if (existing === undefined) throw new Error(`NOT_FOUND ${path}`)
      mockDocs.set(path, applyPatch(existing, value))
    },
    delete: async () => {
      onDelete?.(path)
      mockDocs.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  type Filter = (data: Record<string, any> | undefined) => boolean
  const make = (filters: Filter[], max?: number, order?: string): any => ({
    where: (field: string, op: string, value: unknown) => {
      if (op === '==') return make([...filters, (data) => data?.[field] === value], max, order)
      if (op === 'in') return make([...filters, (data) => (value as unknown[]).includes(data?.[field])], max, order)
      throw new Error(`unsupported op ${op}`)
    },
    orderBy: (field: string) => make([...filters, (data) => typeof data?.[field] === 'number'], max, field),
    limit: (n: number) => make(filters, n, order),
    get: async () => {
      const hits = childPaths(path)
        .map(snapshot)
        .filter((snap) => filters.every((filter) => filter(snap.data())))
        .sort((a, b) => (order ? Number(a.get(order)) - Number(b.get(order)) : 0))
        .slice(0, max ?? Number.POSITIVE_INFINITY)
      return { empty: hits.length === 0, size: hits.length, docs: hits }
    },
    doc: (id?: string) => docRef(`${path}/${id ?? `auto-${++mockAutoId}`}`),
    add: async (data: Record<string, any>) => {
      const ref = docRef(`${path}/auto-${++mockAutoId}`)
      await ref.set(data)
      return ref
    },
  })
  return make([])
}

const mockStore: any = {
  collection: (name: string) => collectionRef(name),
  getAll: async (...refs: any[]) => refs.map((ref) => snapshot(ref.path)),
  batch: () => {
    const queued: Array<() => Promise<void>> = []
    return {
      delete: (ref: any) => void queued.push(() => ref.delete()),
      update: (ref: any, value: Record<string, any>) => void queued.push(() => ref.update(value)),
      set: (ref: any, value: Record<string, any>, options?: { merge?: boolean }) =>
        void queued.push(() => ref.set(value, options)),
      commit: async () => {
        for (const write of queued) await write()
      },
    }
  },
}

// Every plugin's share reaches the store through the data layer's admin app.
// The store is read when a share asks, not when the mock is built.
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => {
  const admin = { app: () => ({ firestore: () => mockStore }) }
  return { __esModule: true, default: admin, firebaseAdmin: admin }
})

/** What the delivery-log sweep was asked to erase: the platform's own sweep, held by its spec. */
const mockEraseDeliveries = jest.fn(async (_addresses: unknown, _db: unknown) => ({
  removed: 3,
  addresses: ['jane@example.com'],
  contestedAddresses: [],
}))
jest.mock('@aglyn/tenant-data-admin/server/email-delivery-log', () => ({
  __esModule: true,
  eraseEmailDeliveriesForAddresses: (addresses: unknown, db: unknown) =>
    mockEraseDeliveries(addresses, db),
}))

const mockOperatorAlerts: string[] = []
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => mockStore }) },
  raiseOperatorAlert: async (type: string) => {
    mockOperatorAlerts.push(type)
    return { outcome: 'delivered', type }
  },
  erasePerson: (...args: unknown[]) =>
    jest.requireActual('@aglyn/tenant-data-admin/server/erase-person').erasePerson(...args),
}))

import {
  registerPluginEventHandler,
  resetPluginEventHandlersForTests,
  type PluginEventPayloads,
} from '@aglyn/aglyn/plugin-manager/plugin-events'
import {
  listPluginPersonErasers,
  PLUGIN_REQUIRED_PERSON_ERASERS,
  resetPluginPersonErasersForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { registerPluginServerDeclarations } from '../constants/plugins.declarations.server.generated'
import { runPersonErasures } from '../utils/server/run-person-erasures'

const ORG = 'org1'
const EMAIL = 'jane@example.com'
const KEY = createHash('sha256').update(EMAIL).digest('hex')
const REQUEST = `personErasures/${ORG}__${KEY}`
const NOW = 1_700_000_000_000

/** What the erasure told the plugins it removed (AGL-3330). */
const removed: Array<PluginEventPayloads['host.records.removed']> = []

function seedWorkspace() {
  mockDocs.set(REQUEST, {
    orgId: ORG,
    personKey: KEY,
    status: 'pending',
    email: EMAIL,
    requestedAtMs: NOW - 1000,
    requestedByUid: 'uid-admin',
    pendingSinceMs: NOW - 1000,
  })
  mockDocs.set(`orgs/${ORG}`, { name: 'Harbor View' })
  mockDocs.set('hosts/h1', { orgId: ORG })
  mockDocs.set('hosts/h2', { orgId: ORG })
  mockDocs.set('hosts/other', { orgId: 'org2' })
  // The record system's people, and what it files beside them.
  mockDocs.set(`orgs/${ORG}/contacts/c1`, {
    email: EMAIL,
    companyIds: ['co1', 'co2'],
    visibleTo: ['host:h1', 'host:h2'],
    facets: { h1: { notes: 'private' }, h2: { notes: 'also private' } },
  })
  mockDocs.set(`orgs/${ORG}/contacts/c9`, { email: 'someone@else.com', companyIds: ['co1'] })
  mockDocs.set(`orgs/${ORG}/companies/co1`, { name: 'Acme', contactsCount: 2 })
  mockDocs.set(`orgs/${ORG}/companies/co2`, { name: 'Globex', contactsCount: 1 })
  mockDocs.set(`orgs/${ORG}/deals/d1`, { title: 'Renewal', contactId: 'c1', amountCents: 5000 })
  mockDocs.set(`orgs/${ORG}/deals/d2`, { title: 'Other', contactId: 'c9' })
  mockDocs.set(`orgs/${ORG}/crmTasks/t1`, { title: 'Call Jane', contactId: 'c1' })
  mockDocs.set(`orgs/${ORG}/crmTasks/t2`, { title: 'Call someone', contactId: 'c9' })
  mockDocs.set(`orgs/${ORG}/crmActivities/a1`, { body: 'Spoke to Jane', contactId: 'c1' })
  mockDocs.set(`orgs/${ORG}/crmActivities/a2`, { body: 'Spoke to Jane again', contactId: 'c1' })
  mockDocs.set(`orgs/${ORG}/leads/${KEY}`, { email: EMAIL, sources: ['form:form-1', 'booking'] })
  mockDocs.set(`hosts/h1/leads/${KEY}`, { email: EMAIL, sources: ['form:form-2'] })
  mockDocs.set(`hosts/other/leads/${KEY}`, { email: EMAIL, name: 'Jane' })
  // The audience lists.
  mockDocs.set(`orgs/${ORG}/lists/l1`, { name: 'Newsletter' })
  mockDocs.set(`orgs/${ORG}/lists/l1/members/${KEY}`, { email: EMAIL })
  mockDocs.set(`orgs/${ORG}/lists/l1/members/stranger`, { email: 'someone@else.com' })
  mockDocs.set(`orgs/${ORG}/lists/l2`, { name: 'Empty' })
  // The shop's orders and the calendar's bookings.
  mockDocs.set('hosts/h1/orders/o1', {
    customerEmail: EMAIL,
    customerName: 'Jane Doe',
    shippingAddress: { line1: '1 Main St', phone: '+15125550107' },
    totals: { totalCents: 4200 },
    customerEmailLower: EMAIL,
    customerEmailTokens: ['j', 'ja', 'jane'],
    searchTokens: ['#1', '1', 'j', 'ja', 'jane', 'm', 'mu', 'mug'],
  })
  mockDocs.set('hosts/h2/orders/o2', { customerEmail: 'someone@else.com', customerName: 'Other' })
  mockDocs.set('hosts/h2/bookings/b1', { email: EMAIL, name: 'Jane', phone: '+15125550107', serviceId: 's1' })
  // A sequence's enrollment, filed under the CONTACT — found only through
  // the ids the record system names before it erases — and its history.
  mockDocs.set(`orgs/${ORG}/outreachEnrollments/e1`, { contactId: 'c1', email: 'jane@work.example' })
  mockDocs.set(`orgs/${ORG}/outreachEnrollments/e1/history/h1`, { url: 'https://example.com' })
  mockDocs.set(`orgs/${ORG}/outreachEnrollments/e9`, { contactId: 'c9', email: 'someone@else.com' })
  mockDocs.set(`orgs/${ORG}/outreachDoNotContact/${KEY}`, { detail: 'asked us to stop', enrollmentId: 'e1' })
}

beforeAll(async () => {
  await registerPluginServerDeclarations()
})

beforeEach(() => {
  mockDocs.clear()
  mockAutoId = 0
  onDelete = null
  removed.length = 0
  mockOperatorAlerts.length = 0
  mockEraseDeliveries.mockClear()
  resetPluginEventHandlersForTests()
  registerPluginEventHandler('host.records.removed', (payload) => void removed.push(payload), {
    pluginId: 'forms',
  })
  seedWorkspace()
})

const run = () => runPersonErasures({ firestore: mockStore, now: NOW })

describe('the shares, in this console', () => {
  it('has every promised share registered, the record system’s last', () => {
    expect(PLUGIN_REQUIRED_PERSON_ERASERS.length).toBeGreaterThan(0)
    const order = listPluginPersonErasers()
    for (const pluginId of PLUGIN_REQUIRED_PERSON_ERASERS) expect(order).toContain(pluginId)
    expect(order.at(-1)).toBe('crm')
  })
})

describe('a person erased from the workspace', () => {
  it('closes every site’s door before anything is deleted (claim 1)', async () => {
    let suppressedWhenContactWent: boolean | null = null
    onDelete = (path) => {
      if (path !== `orgs/${ORG}/contacts/c1`) return
      suppressedWhenContactWent =
        mockDocs.get(`hosts/h1/suppressions/${KEY}`)?.reason === 'erasure' &&
        mockDocs.get(`hosts/h2/suppressions/${KEY}`)?.reason === 'erasure'
    }
    const outcome = await run()
    expect(outcome.erased).toEqual([`${ORG}__${KEY}`])
    expect(suppressedWhenContactWent).toBe(true)
    expect(mockDocs.get(`hosts/h1/suppressions/${KEY}`)?.email).toBeNull()
    expect(mockDocs.has(`hosts/other/suppressions/${KEY}`)).toBe(false)
  })

  it('deletes the contact whole and what the CRM files beside it, keeping the deals (claim 2)', async () => {
    await run()
    expect(mockDocs.has(`orgs/${ORG}/contacts/c1`)).toBe(false)
    expect(mockDocs.has(`orgs/${ORG}/contacts/c9`)).toBe(true)
    expect(mockDocs.get(`orgs/${ORG}/companies/co1`)?.contactsCount).toBe(1)
    expect(mockDocs.get(`orgs/${ORG}/companies/co2`)?.contactsCount).toBe(0)
    expect(mockDocs.get(`orgs/${ORG}/deals/d1`)).toMatchObject({ title: 'Renewal', amountCents: 5000 })
    expect(mockDocs.get(`orgs/${ORG}/deals/d1`)).not.toHaveProperty('contactId')
    expect(mockDocs.get(`orgs/${ORG}/deals/d2`)?.contactId).toBe('c9')
    expect(mockDocs.has(`orgs/${ORG}/crmTasks/t1`)).toBe(false)
    expect(mockDocs.has(`orgs/${ORG}/crmTasks/t2`)).toBe(true)
    expect(mockDocs.has(`orgs/${ORG}/crmActivities/a1`)).toBe(false)
    expect(mockDocs.has(`orgs/${ORG}/crmActivities/a2`)).toBe(false)
  })

  it('deletes the person’s lead in this workspace only, and says which leads went (claim 3)', async () => {
    await run()
    expect(mockDocs.has(`orgs/${ORG}/leads/${KEY}`)).toBe(false)
    expect(mockDocs.has(`hosts/h1/leads/${KEY}`)).toBe(false)
    expect(mockDocs.has(`hosts/other/leads/${KEY}`)).toBe(true)
    expect(removed).toEqual([
      expect.objectContaining({
        orgId: ORG,
        collection: 'leads',
        records: [
          { id: KEY, data: { email: EMAIL, sources: ['form:form-1', 'booking'] } },
          { id: KEY, data: { email: EMAIL, sources: ['form:form-2'] } },
        ],
      }),
    ])
  })

  it('takes the person off every audience list, leaving the lists (claim 4)', async () => {
    await run()
    expect(mockDocs.has(`orgs/${ORG}/lists/l1/members/${KEY}`)).toBe(false)
    expect(mockDocs.has(`orgs/${ORG}/lists/l1/members/stranger`)).toBe(true)
    expect(mockDocs.has(`orgs/${ORG}/lists/l1`)).toBe(true)
  })

  it('keeps orders and bookings as records, with the person taken off them (claim 5)', async () => {
    await run()
    const order = mockDocs.get('hosts/h1/orders/o1')
    expect(order).toMatchObject({ customerEmail: null, customerName: null, customerErasedAtMs: NOW })
    expect(order).not.toHaveProperty('shippingAddress')
    expect(order?.totals).toEqual({ totalCents: 4200 })
    expect(order).toMatchObject({ customerEmailLower: null, customerEmailTokens: [] })
    expect(order?.searchTokens).toEqual(['#1', '1', 'm', 'mu', 'mug'])
    expect(mockDocs.get('hosts/h2/orders/o2')?.customerEmail).toBe('someone@else.com')
    const booking = mockDocs.get('hosts/h2/bookings/b1')
    expect(booking).toMatchObject({ email: null, serviceId: 's1', customerErasedAtMs: NOW })
    expect(booking).not.toHaveProperty('name')
    expect(booking).not.toHaveProperty('phone')
  })

  it('erases a sequence’s enrollment found by the contact, and keeps the do-not-contact promise (claim 6)', async () => {
    await run()
    expect(mockDocs.has(`orgs/${ORG}/outreachEnrollments/e1`)).toBe(false)
    expect(mockDocs.has(`orgs/${ORG}/outreachEnrollments/e1/history/h1`)).toBe(false)
    expect(mockDocs.has(`orgs/${ORG}/outreachEnrollments/e9`)).toBe(true)
    expect(mockDocs.get(`orgs/${ORG}/outreachDoNotContact/${KEY}`)).toEqual({ detail: null, enrollmentId: null })
  })

  it('keeps counts and the hash on the request and the audit row, never the address (claim 7)', async () => {
    await run()
    const request = mockDocs.get(REQUEST)
    expect(request).toMatchObject({ status: 'erased', erasedAtMs: NOW })
    expect(request).not.toHaveProperty('email')
    expect(request?.result).toMatchObject({
      hosts: 2,
      hostsSuppressed: 2,
      records: 1,
      emailDeliveries: 3,
      plugins: {
        crm: { contacts: 1, companyLinks: 2, deals: 1, tasks: 1, activities: 2, leads: 2 },
        commerce: { orders: 1 },
        bookings: { bookings: 1 },
        email: { memberships: 1 },
        outreach: { enrollments: 1 },
      },
    })
    const audits = [...mockDocs.entries()].filter(([path]) => path.startsWith('adminAudit/'))
    expect(audits).toHaveLength(1)
    expect(audits[0][1]).toMatchObject({ action: 'person.erased', target: `orgs/${ORG}/people/${KEY}` })
    expect(JSON.stringify(request)).not.toContain(EMAIL)
    expect(JSON.stringify(audits)).not.toContain(EMAIL)
    expect(mockEraseDeliveries).toHaveBeenCalledWith([{ address: EMAIL }], mockStore)
  })
})

/*
 * Last in the file on purpose: it takes every share away, and the boot that
 * registered them runs once per process.
 */
describe('a console that cannot run a promised share (claim 8)', () => {
  it('refuses the erasure before anything is written, and the request stays queued', async () => {
    resetPluginPersonErasersForTests()
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const outcome = await run()
    spy.mockRestore()
    expect(outcome.erased).toEqual([])
    expect(outcome.failed).toEqual([
      { requestId: `${ORG}__${KEY}`, reason: expect.stringMatching(/required person eraser/) },
    ])
    expect(mockDocs.get(REQUEST)).toMatchObject({ status: 'failed', email: EMAIL })
    expect(typeof mockDocs.get(REQUEST)?.pendingSinceMs).toBe('number')
    // Nothing was touched: not a door, not a contact, not an order.
    expect(mockDocs.has(`hosts/h1/suppressions/${KEY}`)).toBe(false)
    expect(mockDocs.has(`orgs/${ORG}/contacts/c1`)).toBe(true)
    expect(mockDocs.get('hosts/h1/orders/o1')?.customerEmail).toBe(EMAIL)
  })
})
