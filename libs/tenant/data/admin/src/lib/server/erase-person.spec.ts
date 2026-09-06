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

import { createHash } from 'node:crypto'
import { erasePerson } from './erase-person'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    delete: () => ({ __delete: true }),
    increment: (operand: number) => ({ __increment: operand }),
  },
  Timestamp: class {},
}))

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => { throw new Error('use the injected store') } }) },
  firebaseAdmin: { app: () => ({ firestore: () => { throw new Error('use the injected store') } }) },
}))

const mockEraseDeliveries = jest.fn(async (_addresses: unknown, _db: unknown) => ({
  removed: 3,
  addresses: ['jane@example.com'],
  contestedAddresses: [],
}))
jest.mock('./email-delivery-log', () => ({
  eraseEmailDeliveriesForAddresses: (addresses: unknown, db: unknown) =>
    mockEraseDeliveries(addresses, db),
}))

/*==========================================
 * A path-keyed store: every document is `docs.get('a/b/c/d')`. Queries
 * filter the direct children of a collection path on `==`; `getAll`
 * resolves refs by path; a batch replays its writes in order. Enough to
 * watch what the sweep touches and what it leaves.
 *=========================================*/
const docs = new Map<string, Record<string, any>>()
const audit: Record<string, any>[] = []
let autoId = 0
/** Called with the path just before a document delete lands. */
let onDelete: ((path: string) => void) | null = null

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
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
  const data = docs.get(path)
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
      docs.set(path, options?.merge ? applyPatch(docs.get(path) ?? {}, value) : { ...value })
    },
    update: async (value: Record<string, any>) => {
      const existing = docs.get(path)
      if (existing === undefined) throw new Error(`NOT_FOUND ${path}`)
      docs.set(path, applyPatch(existing, value))
    },
    delete: async () => {
      onDelete?.(path)
      docs.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  const make = (filters: Array<[string, unknown]>, max?: number): any => ({
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') throw new Error(`unsupported op ${op}`)
      return make([...filters, [field, value]], max)
    },
    limit: (n: number) => make(filters, n),
    get: async () => {
      const hits = childPaths(path)
        .map(snapshot)
        .filter((snap) => filters.every(([field, value]) => snap.data()?.[field] === value))
        .slice(0, max ?? Number.POSITIVE_INFINITY)
      return { empty: hits.length === 0, size: hits.length, docs: hits }
    },
    doc: (id?: string) => docRef(`${path}/${id ?? `auto-${++autoId}`}`),
    add: async (data: Record<string, any>) => {
      if (path === 'adminAudit') audit.push(data)
      const ref = docRef(`${path}/auto-${++autoId}`)
      await ref.set(data)
      return ref
    },
  })
  return make([])
}

const store = {
  collection: (name: string) => collectionRef(name),
  getAll: async (...refs: any[]) => refs.map((ref) => snapshot(ref.path)),
  batch: () => {
    const queued: Array<() => Promise<void>> = []
    return {
      delete: (ref: any) => void queued.push(() => ref.delete()),
      update: (ref: any, value: Record<string, any>) => void queued.push(() => ref.update(value)),
      commit: async () => {
        for (const write of queued) await write()
      },
    }
  },
}

const ORG = 'org1'
const EMAIL = 'jane@example.com'
const KEY = createHash('sha256').update(EMAIL).digest('hex')

function seedWorkspace() {
  docs.set('hosts/h1', { orgId: ORG })
  docs.set('hosts/h2', { orgId: ORG })
  docs.set('hosts/other', { orgId: 'org2' })
  docs.set(`orgs/${ORG}/contacts/c1`, {
    email: EMAIL,
    companyIds: ['co1', 'co2'],
    visibleTo: ['host:h1', 'host:h2'],
    facets: { h1: { notes: 'private' }, h2: { notes: 'also private' } },
  })
  docs.set(`orgs/${ORG}/contacts/c9`, { email: 'someone@else.com', companyIds: ['co1'] })
  docs.set(`orgs/${ORG}/companies/co1`, { name: 'Acme', contactsCount: 2 })
  docs.set(`orgs/${ORG}/companies/co2`, { name: 'Globex', contactsCount: 1 })
  docs.set(`orgs/${ORG}/deals/d1`, { title: 'Renewal', contactId: 'c1', amountCents: 5000 })
  docs.set(`orgs/${ORG}/deals/d2`, { title: 'Other', contactId: 'c9' })
  docs.set(`orgs/${ORG}/crmTasks/t1`, { title: 'Call Jane', contactId: 'c1' })
  docs.set(`orgs/${ORG}/crmTasks/t2`, { title: 'Call someone', contactId: 'c9' })
  docs.set(`orgs/${ORG}/crmActivities/a1`, { body: 'Spoke to Jane', contactId: 'c1' })
  docs.set(`orgs/${ORG}/crmActivities/a2`, { body: 'Spoke to Jane again', contactId: 'c1' })
  docs.set(`orgs/${ORG}/lists/l1`, { name: 'Newsletter' })
  docs.set(`orgs/${ORG}/lists/l1/members/${KEY}`, { email: EMAIL })
  docs.set(`orgs/${ORG}/lists/l1/members/stranger`, { email: 'someone@else.com' })
  docs.set(`orgs/${ORG}/lists/l2`, { name: 'Empty' })
  docs.set(`hosts/h1/leads/${KEY}`, { email: EMAIL, name: 'Jane' })
  docs.set(`hosts/other/leads/${KEY}`, { email: EMAIL, name: 'Jane' })
  docs.set('hosts/h1/orders/o1', {
    customerEmail: EMAIL,
    customerName: 'Jane Doe',
    shippingAddress: { line1: '1 Main St', phone: '+15125550107' },
    totals: { totalCents: 4200 },
  })
  docs.set('hosts/h2/orders/o2', { customerEmail: 'someone@else.com', customerName: 'Other' })
  docs.set('hosts/h2/bookings/b1', { email: EMAIL, name: 'Jane', phone: '+15125550107', serviceId: 's1' })
}

beforeEach(() => {
  docs.clear()
  audit.length = 0
  autoId = 0
  onDelete = null
  mockEraseDeliveries.mockClear()
})

describe('erasePerson', () => {
  it('refuses an address it cannot key, touching nothing', async () => {
    seedWorkspace()
    const before = docs.size
    expect(await erasePerson({ orgId: ORG, email: 'nope', firestore: store })).toEqual({
      ok: false,
      skippedReason: 'invalid-email',
    })
    expect(docs.size).toBe(before)
  })

  it('deletes the shared contact document whole, whoever holds it', async () => {
    // Not a detach: both sites' facets go with the row.
    seedWorkspace()
    const result = await erasePerson({ orgId: ORG, email: ' Jane@Example.com ', firestore: store, now: 1000 })
    expect(result.ok).toBe(true)
    expect(docs.has(`orgs/${ORG}/contacts/c1`)).toBe(false)
    expect(docs.has(`orgs/${ORG}/contacts/c9`)).toBe(true)
    expect(result).toMatchObject({ contacts: 1, hosts: 2 })
  })

  it('moves each linked company\'s contact count down once', async () => {
    seedWorkspace()
    const result = await erasePerson({ orgId: ORG, email: EMAIL, firestore: store })
    expect(docs.get(`orgs/${ORG}/companies/co1`)?.contactsCount).toBe(1)
    expect(docs.get(`orgs/${ORG}/companies/co2`)?.contactsCount).toBe(0)
    expect(result).toMatchObject({ companyLinks: 2 })
  })

  it('unlinks the person\'s deals and keeps them; deletes their tasks and activities', async () => {
    seedWorkspace()
    const result = await erasePerson({ orgId: ORG, email: EMAIL, firestore: store })
    expect(docs.get(`orgs/${ORG}/deals/d1`)).toMatchObject({ title: 'Renewal', amountCents: 5000 })
    expect(docs.get(`orgs/${ORG}/deals/d1`)).not.toHaveProperty('contactId')
    expect(docs.get(`orgs/${ORG}/deals/d2`)?.contactId).toBe('c9')
    expect(docs.has(`orgs/${ORG}/crmTasks/t1`)).toBe(false)
    expect(docs.has(`orgs/${ORG}/crmTasks/t2`)).toBe(true)
    expect(docs.has(`orgs/${ORG}/crmActivities/a1`)).toBe(false)
    expect(docs.has(`orgs/${ORG}/crmActivities/a2`)).toBe(false)
    expect(result).toMatchObject({ deals: 1, tasks: 1, activities: 2 })
  })

  it('deletes the lead on every site of the workspace and no other workspace\'s', async () => {
    seedWorkspace()
    const result = await erasePerson({ orgId: ORG, email: EMAIL, firestore: store })
    expect(docs.has(`hosts/h1/leads/${KEY}`)).toBe(false)
    // Another workspace's relationship with the same person is not this
    // request's to end.
    expect(docs.has(`hosts/other/leads/${KEY}`)).toBe(true)
    expect(result).toMatchObject({ leads: 1 })
  })

  it('takes the person off every audience list, leaving the list and its other members', async () => {
    seedWorkspace()
    const result = await erasePerson({ orgId: ORG, email: EMAIL, firestore: store })
    expect(docs.has(`orgs/${ORG}/lists/l1/members/${KEY}`)).toBe(false)
    expect(docs.has(`orgs/${ORG}/lists/l1/members/stranger`)).toBe(true)
    expect(docs.has(`orgs/${ORG}/lists/l1`)).toBe(true)
    expect(result).toMatchObject({ listMemberships: 1 })
  })

  it('anonymizes orders and bookings rather than deleting them', async () => {
    seedWorkspace()
    const result = await erasePerson({ orgId: ORG, email: EMAIL, firestore: store, now: 777 })
    const order = docs.get('hosts/h1/orders/o1')
    expect(order).toMatchObject({ customerEmail: null, customerName: null, customerErasedAtMs: 777 })
    expect(order).not.toHaveProperty('shippingAddress')
    // The financial record survives.
    expect(order?.totals).toEqual({ totalCents: 4200 })
    expect(docs.get('hosts/h2/orders/o2')?.customerEmail).toBe('someone@else.com')
    const booking = docs.get('hosts/h2/bookings/b1')
    expect(booking).toMatchObject({ email: null, serviceId: 's1', customerErasedAtMs: 777 })
    expect(booking).not.toHaveProperty('name')
    expect(booking).not.toHaveProperty('phone')
    expect(result).toMatchObject({ orders: 1, bookings: 1 })
  })

  it('writes an address-free erasure row on every site BEFORE deleting anything', async () => {
    seedWorkspace()
    // A capture during the sweep must find the door already closed, so the
    // suppression rows are the first writes: read their state at the moment
    // the contact document goes.
    let suppressedWhenContactWent: boolean | null = null
    onDelete = (path) => {
      if (path !== `orgs/${ORG}/contacts/c1`) return
      suppressedWhenContactWent =
        docs.get(`hosts/h1/suppressions/${KEY}`)?.reason === 'erasure' &&
        docs.get(`hosts/h2/suppressions/${KEY}`)?.reason === 'erasure'
    }
    const result = await erasePerson({ orgId: ORG, email: EMAIL, firestore: store })
    expect(suppressedWhenContactWent).toBe(true)
    expect(docs.get(`hosts/h1/suppressions/${KEY}`)?.email).toBeNull()
    expect(docs.has(`hosts/other/suppressions/${KEY}`)).toBe(false)
    expect(result).toMatchObject({ hostsSuppressed: 2 })
  })

  it('sweeps the delivery log under the address and reports its count', async () => {
    seedWorkspace()
    const result = await erasePerson({ orgId: ORG, email: EMAIL, firestore: store })
    expect(mockEraseDeliveries).toHaveBeenCalledWith([{ address: EMAIL }], store)
    expect(result).toMatchObject({ emailDeliveries: 3 })
  })

  it('records counts and the hash on the audit row, never the address', async () => {
    seedWorkspace()
    await erasePerson({ orgId: ORG, email: EMAIL, firestore: store })
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      action: 'person.erased',
      target: `orgs/${ORG}/people/${KEY}`,
      after: { contacts: 1, leads: 1, orders: 1 },
    })
    expect(JSON.stringify(audit[0])).not.toContain(EMAIL)
  })

  it('finishes, with counts, when one sweep fails', async () => {
    seedWorkspace()
    mockEraseDeliveries.mockRejectedValueOnce(new Error('log unavailable'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await erasePerson({ orgId: ORG, email: EMAIL, firestore: store })
    spy.mockRestore()
    expect(result.ok).toBe(true)
    expect(result).toMatchObject({ contacts: 1, emailDeliveries: 0 })
  })
})
