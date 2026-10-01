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

import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import type { PluginPersonRefundRequest } from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import { recordPersonRefund } from './person-refund'

/**
 * Money handed back, on the customer's record (AGL-1754), as the CRM records
 * it when a seller reports a refund through `plugin-person-records`
 * (AGL-3080).
 *
 * The seller's side — that a refund or a lost dispute is REPORTED, once, with
 * the amount this attempt reversed and whether it closed the sale — is held
 * by commerce's own refund and dispute specs. These hold what the report does
 * to the person: `ltvCents` stays GROSS under its existing name and
 * `refundedCents` is recorded beside it, so the stored numbers cannot go
 * negative and a reader computes the net. Every case asserts both halves,
 * since a decrement would pass "the contact knows about the refund" as well.
 *
 * Firestore is an in-memory map keyed by path, and the address index and the
 * `update()`-only write are the real ones, so a missing document is genuinely
 * refused rather than conjured.
 */

const docs = new Map<string, Record<string, any>>()

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

/** `FieldValue.increment` as a sentinel the double resolves, so a number is read back. */
function resolveFieldValues(
  existing: Record<string, any> | undefined,
  value: Record<string, any>,
): Record<string, any> {
  const resolved: Record<string, any> = {}
  for (const [key, field] of Object.entries(value)) {
    resolved[key] =
      field && typeof field === 'object' && '__increment' in field
        ? Number(existing?.[key] ?? 0) + Number(field.__increment)
        : field
  }
  return resolved
}

/** Set by a test to delete the contact between the read that finds it and the write. */
let deleteContactDuringQuery = false

function makeSnapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
    ref: makeDocRef(path),
  }
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => makeSnapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      const existing = docs.get(path)
      const resolved = resolveFieldValues(existing, value)
      docs.set(path, options?.merge ? { ...(existing ?? {}), ...resolved } : resolved)
    },
    // `update()` REJECTS an absent document with gRPC NOT_FOUND (code 5).
    update: async (value: Record<string, any>) => {
      const existing = docs.get(path)
      if (existing === undefined) {
        const error: any = new Error(`NOT_FOUND: no entity to update: ${path}`)
        error.code = 5
        throw error
      }
      docs.set(path, { ...existing, ...resolveFieldValues(existing, value) })
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeQuery(path: string, filters: Array<{ field: string; value: any }>, limit?: number): any {
  return {
    where: (field: string, _op: string, value: any) =>
      makeQuery(path, [...filters, { field, value }], limit),
    limit: (count: number) => makeQuery(path, filters, count),
    get: async () => {
      const matched = childPaths(path).filter((child) =>
        filters.every((filter) => (docs.get(child) ?? {})[filter.field] === filter.value),
      )
      const snapshots = (limit == null ? matched : matched.slice(0, limit)).map(makeSnapshot)
      if (deleteContactDuringQuery) for (const child of matched) docs.delete(child)
      return { empty: snapshots.length === 0, docs: snapshots }
    },
  }
}

function makeCollectionRef(path: string): any {
  return {
    get parent() {
      const parentPath = path.slice(0, path.lastIndexOf('/'))
      return parentPath ? { collection: (name: string) => makeCollectionRef(`${parentPath}/${name}`) } : null
    },
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    where: (field: string, _op: string, value: any) => makeQuery(path, [{ field, value }]),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  // Contacts are the ORGANIZATION's (AGL-237).
  orgDataCollectionForHost: async (_hostId: string, name: string) =>
    makeCollectionRef(`orgs/org-1/${name}`),
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({ collection: (name: string) => makeCollectionRef(name) }),
    }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => '<server-timestamp>',
        increment: (by: number) => ({ __increment: by }),
      },
    },
  },
}))

const CONTACT = 'orgs/org-1/contacts/contact-1'
const contact = () => docs.get(CONTACT) ?? {}
const unmatched = () => docs.get('hosts/host-1/counters/contactRefundsUnmatched') ?? {}

function refund(overrides: Partial<PluginPersonRefundRequest> = {}): PluginPersonRefundRequest {
  return {
    hostId: 'host-1',
    refId: 'order-1',
    // As the order typed it: the contact is keyed lowercased.
    email: 'Buyer@Example.com',
    amountCents: 5000,
    closedTheSale: true,
    ...overrides,
  }
}

beforeEach(() => {
  docs.clear()
  deleteContactDuringQuery = false
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  // Every figure distinct from every other (AGL-1711): the sale is 5000, the
  // partial 1500, the lifetime value 7400 and the order count 3.
  docs.set(CONTACT, {
    hostId: 'host-1',
    visibleTo: ['org'],
    email: 'buyer@example.com',
    name: 'Dana Buyer',
    sources: { booking: true },
    interactions: [
      { type: 'booking', atMs: 1, refId: 'reservation-9', summary: 'Reserved a stay ($210.00)' },
    ],
    ltvCents: 7400,
    ordersCount: 3,
  })
})

afterEach(() => jest.restoreAllMocks())

describe('a refund on the customer’s record (AGL-1754, AGL-3080)', () => {
  it('records a full refund beside the gross, which it leaves alone', async () => {
    expect(await recordPersonRefund(refund())).toBe('recorded')
    expect(contact().refundedCents).toBe(5000)
    expect(contact().ltvCents).toBe(7400)
    expect(contact().ordersCount).toBe(3)
    expect(contact().refundedOrdersCount).toBe(1)
    expect(contact().lastRefundAtMs).toEqual(expect.any(Number))
    expect(unmatched().total).toBeUndefined()
  })

  it('finds the contact through an address a merge folded into it', async () => {
    docs.set(CONTACT, {
      ...contact(),
      email: 'dana@work.example.com',
      alternateEmails: ['buyer@example.com'],
    })
    docs.set(`orgs/org-1/emailIndex/${personKey('buyer@example.com')}`, {
      email: 'buyer@example.com',
      contactId: 'contact-1',
    })
    expect(await recordPersonRefund(refund())).toBe('recorded')
    expect(contact().refundedCents).toBe(5000)
  })

  it('records only what a partial reversed, and no reversed sale until one closes it', async () => {
    await recordPersonRefund(refund({ amountCents: 1500, closedTheSale: false }))
    expect(contact().refundedCents).toBe(1500)
    expect(contact().refundedOrdersCount).toBeUndefined()
    await recordPersonRefund(refund({ amountCents: 3500, closedTheSale: true }))
    expect(contact().refundedCents).toBe(5000)
    expect(contact().refundedOrdersCount).toBe(1)
    expect(contact().ltvCents).toBe(7400)
  })

  it('puts the refund on the timeline, newest first, saying so when it closed the sale', async () => {
    await recordPersonRefund(refund({ amountCents: 1500, closedTheSale: false }))
    expect(contact().interactions[0]).toMatchObject({
      type: 'order',
      refId: 'order-1',
      summary: '$15.00 refunded',
    })
    expect(contact().interactions[1].refId).toBe('reservation-9')
    await recordPersonRefund(refund({ amountCents: 3500, closedTheSale: true }))
    expect(contact().interactions[0].summary).toBe('$35.00 refunded (full)')
  })

  it('says "charged back" for a dispute lost', async () => {
    await recordPersonRefund(refund({ reason: 'chargeback', amountCents: 2600 }))
    expect(contact().interactions[0].summary).toBe('$26.00 charged back (full)')
    expect(contact().refundedCents).toBe(2600)
  })

  it('adds no capture source: a refund captures nobody', async () => {
    await recordPersonRefund(refund())
    expect(contact().sources).toEqual({ booking: true })
  })

  it('refuses to create a contact for a buyer it holds nobody at, and counts it', async () => {
    docs.delete(CONTACT)
    expect(await recordPersonRefund(refund())).toBe('no-person')
    expect(childPaths('orgs/org-1/contacts')).toHaveLength(0)
    expect(unmatched()).toMatchObject({ total: 1, lastReason: 'no-contact', lastOrderId: 'order-1' })
  })

  it('does not resurrect a contact deleted under the write', async () => {
    deleteContactDuringQuery = true
    expect(await recordPersonRefund(refund())).toBe('gone')
    expect(childPaths('orgs/org-1/contacts')).toHaveLength(0)
    expect(unmatched().lastReason).toBe('contact-deleted')
  })

  it('counts a sale that never named its buyer', async () => {
    expect(await recordPersonRefund(refund({ email: null }))).toBe('no-email')
    expect(contact().refundedCents).toBeUndefined()
    expect(unmatched().lastReason).toBe('no-email')
  })

  it('does not reach a contact only another site may see', async () => {
    docs.set(CONTACT, { ...contact(), visibleTo: ['host:host-2'] })
    expect(await recordPersonRefund(refund())).toBe('no-person')
    expect(contact().refundedCents).toBeUndefined()
    expect(unmatched().lastReason).toBe('no-contact')
  })

  it('records nothing for nothing handed back', async () => {
    expect(await recordPersonRefund(refund({ amountCents: 0 }))).toBe('recorded')
    expect(contact().refundedCents).toBeUndefined()
    expect(unmatched().total).toBeUndefined()
  })
})
