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
 * The dropship supplier outbox drain (AGL-2473).
 *
 * `billing-webhook-dropship-outbox.spec.ts` proves the POST leaves the response
 * path durably. This proves the other half is real: that something drains it,
 * that a failing supplier is RETRIED rather than merely recorded, and that a
 * supplier who never comes back produces a fact the merchant can see instead of
 * a row nobody reads. A queue with no drain is the exact defect AGL-2227 found
 * twice over — `restockAlerts` collected shopper addresses for months with
 * nothing on the other end — so the drain is asserted here and its SCHEDULING
 * is asserted in `recovery-jobs-scheduled.spec.ts`.
 *
 * ## The fake
 *
 * `update()` REJECTS a missing document with gRPC `NOT_FOUND` (code 5) while
 * `set({ merge: true })` creates it, and `create()` rejects an existing one
 * with `ALREADY_EXISTS` (code 6). All three are modelled exactly, because this
 * module uses each for a different reason and a double that blurred them would
 * fabricate greens: the enqueue's idempotency IS `create()`'s refusal, and the
 * order stamp is an `update()` precisely so it cannot mint an order stub.
 *
 * `delete()` really removes the document, because "the row is gone" is the
 * assertion for a delivered notification — the body carries the buyer's email
 * and a top-level collection is outside the recursive delete an erasure request
 * runs over `hosts/{hostId}`.
 *
 * The query is modelled as a real filter over stored data rather than a
 * pass-through: `scanSupplierDeliveries` selects on `status == 'pending'`, so a
 * double whose `where()` returned everything would report a dead-lettered row
 * being retried forever and call it green.
 */

import {
  SUPPLIER_DELIVERY_MAX_ATTEMPTS,
  enqueueSupplierDelivery,
  scanSupplierDeliveries,
  supplierDeliveryBackoffMs,
  supplierDeliveryId,
} from './supplier-outbox'

/**
 * An UNLOCKED gate (AGL-2495). This suite is about delivery, backoff and the
 * dead letter; the lockdown behaviour has its own suite in
 * `job-lockdown.spec.ts`, which asserts the opposite answer. Written out
 * rather than defaulted in the scan itself, so "forgot to thread the gate"
 * still cannot compile.
 */
const OPEN_GATE = { isLocked: async () => false }

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

const GRPC_NOT_FOUND = 5
const GRPC_ALREADY_EXISTS = 6

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveValue(previous: unknown, next: unknown): unknown {
  if (isPlainObject(next) && '__arrayUnion' in next) {
    return [...((previous as unknown[]) ?? []), next.__arrayUnion]
  }
  if (isPlainObject(next) && isPlainObject(previous)) {
    return mergeInto(previous, next)
  }
  return next
}

function mergeInto(
  previous: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> {
  const merged = { ...previous }
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = resolveValue(previous[key], value)
  }
  return merged
}

function makeSnapshot(path: string): any {
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
      docs.set(
        path,
        options?.merge
          ? mergeInto(docs.get(path) ?? {}, value)
          : mergeInto({}, value),
      )
    },
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) {
        throw Object.assign(
          new Error(`6 ALREADY_EXISTS: Document already exists: ${path}`),
          { code: GRPC_ALREADY_EXISTS },
        )
      }
      docs.set(path, mergeInto({}, value))
    },
    update: async (value: Record<string, any>) => {
      if (!docs.has(path)) {
        throw Object.assign(
          new Error(`5 NOT_FOUND: No document to update: ${path}`),
          { code: GRPC_NOT_FOUND },
        )
      }
      docs.set(path, mergeInto(docs.get(path) as Record<string, any>, value))
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  const filters: Array<[string, unknown]> = []
  let cap = Infinity
  const ref: any = {
    path,
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    where: (field: string, op: string, value: unknown) => {
      // Only equality is used; anything else is a silent change of meaning.
      if (op !== '==') throw new Error(`unsupported operator ${op}`)
      filters.push([field, value])
      return ref
    },
    limit: (value: number) => {
      cap = value
      return ref
    },
    get: async () => {
      const matched = [...docs.entries()]
        .filter(
          ([docPath]) =>
            docPath.startsWith(`${path}/`) &&
            docPath.slice(path.length + 1).indexOf('/') === -1,
        )
        .filter(([, data]) =>
          filters.every(([field, value]) => data?.[field] === value),
        )
        .slice(0, cap)
        .map(([docPath]) => makeSnapshot(docPath))
      return { docs: matched, size: matched.length }
    },
  }
  return ref
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
}

const notifications: any[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: {
      FieldValue: {
        arrayUnion: (value: any) => ({ __arrayUnion: value }),
      },
    },
  },
  notifyHostManagers: async (hostId: string, payload: any) => {
    notifications.push({ hostId, ...payload })
  },
}))

// ---------------------------------------------------------------------------

const HOST = 'host-1'
const ORDER = 'cs_dropship_1'
const SUPPLIER = 'supplier-1'
const DELIVERY_PATH = `supplierDeliveries/${supplierDeliveryId(HOST, ORDER, SUPPLIER)}`
const PAYLOAD = JSON.stringify({ orderId: ORDER, quantity: 2 })

/**
 * Distinct on purpose: `NOW` is not a round number and none of the backoff
 * steps coincide with it, so an assertion that lands on the right timestamp
 * cannot have got there by reaching for the nearest available number.
 */
const NOW = 1_755_000_123_456

let fetchMock: jest.Mock

function seedDelivery(overrides: Record<string, any> = {}): void {
  docs.set(DELIVERY_PATH, {
    status: 'pending',
    hostId: HOST,
    orderId: ORDER,
    supplierId: SUPPLIER,
    supplierName: 'Northwind Fulfilment',
    url: 'https://supplier.example.com/orders',
    body: PAYLOAD,
    attempts: 0,
    nextAttemptAtMs: NOW,
    createdAtMs: NOW,
    ...overrides,
  })
}

const delivery = () => docs.get(DELIVERY_PATH)
const order = () => docs.get(`hosts/${HOST}/orders/${ORDER}`)

beforeEach(() => {
  docs.clear()
  notifications.length = 0
  fetchMock = jest.fn(async () => ({ ok: true, status: 202 }))
  ;(global as any).fetch = fetchMock
  jest.spyOn(console, 'error').mockImplementation(() => undefined)

  docs.set(`hosts/${HOST}/suppliers/${SUPPLIER}`, {
    name: 'Northwind Fulfilment',
    webhookUrl: 'https://supplier.example.com/orders',
    webhookSecret: 'supplier-shared-secret',
  })
  docs.set(`hosts/${HOST}/orders/${ORDER}`, {
    status: 'paid',
    timeline: [{ atMs: 1, event: 'paid' }],
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------

describe('the supplier outbox drains (AGL-2473)', () => {
  it('posts the queued body and retires the row on success', async () => {
    seedDelivery()
    const result = await scanSupplierDeliveries(OPEN_GATE, NOW)
    expect(result).toEqual({
      scanned: 1,
      delivered: 1,
      retried: 0,
      deadLettered: 0,
      cancelled: 0,
      // AGL-2495. Zero here is load-bearing: the gate above says UNLOCKED,
      // so a non-zero count would mean the drain declined work it should
      // have done.
      skippedLocked: 0,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as any[]
    expect(url).toBe('https://supplier.example.com/orders')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(PAYLOAD)
    // The buyer's email rides in that body, and a top-level document is
    // outside the recursive delete an erasure request runs over the host.
    expect(docs.has(DELIVERY_PATH)).toBe(false)
  })

  /**
   * The signature is computed from the supplier's CURRENT secret, over the
   * frozen body. AGL-2455: an empty key produces a signature any party can
   * compute, and a supplier who also left their secret unset would verify it
   * and believe the delivery was authenticated — worse than no header at all.
   */
  it('signs with the live secret and omits the header when there is none', async () => {
    seedDelivery()
    await scanSupplierDeliveries(OPEN_GATE, NOW)
    expect(
      (fetchMock.mock.calls[0] as any[])[1].headers['x-aglyn-signature'],
    ).toEqual(expect.any(String))

    docs.clear()
    docs.set(`hosts/${HOST}/suppliers/${SUPPLIER}`, {
      name: 'Northwind Fulfilment',
      webhookUrl: 'https://supplier.example.com/orders',
    })
    seedDelivery()
    fetchMock.mockClear()
    await scanSupplierDeliveries(OPEN_GATE, NOW)
    expect(
      (fetchMock.mock.calls[0] as any[])[1].headers,
    ).not.toHaveProperty('x-aglyn-signature')
  })

  /**
   * A merchant who fixes a typo'd endpoint fixes what is already queued. The
   * row's own `url` is a record of what was configured at routing time and is
   * deliberately NOT what gets called.
   */
  it('re-reads the endpoint rather than replaying the frozen one', async () => {
    seedDelivery()
    docs.set(`hosts/${HOST}/suppliers/${SUPPLIER}`, {
      name: 'Northwind Fulfilment',
      webhookUrl: 'https://corrected.example.com/inbound',
    })
    await scanSupplierDeliveries(OPEN_GATE, NOW)
    expect((fetchMock.mock.calls[0] as any[])[0]).toBe(
      'https://corrected.example.com/inbound',
    )
  })

  it('leaves a row that is still inside its backoff alone', async () => {
    seedDelivery({ attempts: 1, nextAttemptAtMs: NOW + 1 })
    const result = await scanSupplierDeliveries(OPEN_GATE, NOW)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.scanned).toBe(1)
    expect(result.delivered + result.retried + result.deadLettered).toBe(0)
  })

  it('ignores a row that is not pending', async () => {
    seedDelivery({ status: 'failed', attempts: SUPPLIER_DELIVERY_MAX_ATTEMPTS })
    const result = await scanSupplierDeliveries(OPEN_GATE, NOW)
    expect(result.scanned).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('a supplier that does not answer (AGL-2473)', () => {
  /**
   * THE PROPERTY THE OLD CODE HAD NO WAY TO PROVIDE. A 500 from the supplier
   * used to be `.catch(() => undefined)` inside a floating promise — the POST
   * was gone and nothing said so. Now the row books the failure and schedules
   * itself.
   */
  it('books a retry with backoff on an error status', async () => {
    seedDelivery()
    fetchMock.mockResolvedValue({ ok: false, status: 503 } as never)
    const result = await scanSupplierDeliveries(OPEN_GATE, NOW)
    expect(result.retried).toBe(1)
    expect(delivery()?.status).toBe('pending')
    expect(delivery()?.attempts).toBe(1)
    expect(delivery()?.lastStatus).toBe(503)
    expect(delivery()?.lastError).toContain('503')
    expect(delivery()?.nextAttemptAtMs).toBe(NOW + supplierDeliveryBackoffMs(1))
    // Nothing is claimed on the order yet: one bad minute is not a failure to
    // route, and an alarm on the first blip is an alarm nobody reads.
    expect(order()?.timeline).toHaveLength(1)
    expect(notifications).toHaveLength(0)
  })

  it('books a retry when the request itself throws', async () => {
    seedDelivery()
    fetchMock.mockRejectedValue(new Error('The operation was aborted') as never)
    const result = await scanSupplierDeliveries(OPEN_GATE, NOW)
    expect(result.retried).toBe(1)
    expect(delivery()?.lastError).toContain('aborted')
  })

  /** Each failure waits longer, and the last step is clamped, not extrapolated. */
  it('lengthens the wait with each attempt', async () => {
    const steps = [1, 2, 3, 4, 5].map(supplierDeliveryBackoffMs)
    expect(steps).toEqual([...steps].sort((a, b) => a - b))
    expect(new Set(steps).size).toBe(steps.length)
    expect(supplierDeliveryBackoffMs(99)).toBe(steps[steps.length - 1])
  })

  /**
   * THE DEAD LETTER. The point of the whole change: a dropship order that was
   * paid for and never routed becomes something a human is told about, on the
   * order they are looking at AND in the bell — rather than a log line on a
   * serverless container that was frozen before it could even be written.
   */
  it('dead-letters after the last attempt and tells the merchant', async () => {
    seedDelivery({ attempts: SUPPLIER_DELIVERY_MAX_ATTEMPTS - 1 })
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as never)
    const result = await scanSupplierDeliveries(OPEN_GATE, NOW)

    expect(result.deadLettered).toBe(1)
    expect(delivery()?.status).toBe('failed')
    expect(delivery()?.attempts).toBe(SUPPLIER_DELIVERY_MAX_ATTEMPTS)
    expect(delivery()?.failedAtMs).toBe(NOW)
    // Kept, not deleted: this is the row a human has to act on.
    expect(docs.has(DELIVERY_PATH)).toBe(true)

    const stamped = (order()?.timeline as any[]).find(
      (event) => event.event === 'routing-failed',
    )
    expect(stamped).toBeDefined()
    expect(stamped.detail).toContain('Northwind Fulfilment')
    expect(stamped.detail).toContain('never routed')
    // The `paid` entry is still there — the stamp is an arrayUnion, not a
    // rewrite of the timeline the console renders.
    expect(order()?.timeline).toHaveLength(2)

    expect(notifications).toHaveLength(1)
    expect(notifications[0].hostId).toBe(HOST)
    expect(notifications[0].title).toContain('Northwind Fulfilment')
  })

  /**
   * And it stops. A dead-lettered row is excluded by the drain's own filter,
   * so the merchant is told once rather than every minute forever.
   */
  it('does not re-notify a dead letter on the next beat', async () => {
    seedDelivery({ attempts: SUPPLIER_DELIVERY_MAX_ATTEMPTS - 1 })
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as never)
    await scanSupplierDeliveries(OPEN_GATE, NOW)
    await scanSupplierDeliveries(OPEN_GATE, NOW + 86_400_000)
    expect(notifications).toHaveLength(1)
    expect(
      (order()?.timeline as any[]).filter(
        (event) => event.event === 'routing-failed',
      ),
    ).toHaveLength(1)
  })
})

describe('a supplier the merchant changed (AGL-2473)', () => {
  /**
   * Removing the endpoint is a DECISION, not an outage, and dead-lettering it
   * would alarm a merchant about a delivery they cancelled. The row is retired
   * quietly instead.
   */
  it('retires the row without alarm when the webhook URL is removed', async () => {
    seedDelivery()
    docs.set(`hosts/${HOST}/suppliers/${SUPPLIER}`, {
      name: 'Northwind Fulfilment',
    })
    const result = await scanSupplierDeliveries(OPEN_GATE, NOW)
    expect(result.cancelled).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(docs.has(DELIVERY_PATH)).toBe(false)
    expect(notifications).toHaveLength(0)
    expect(order()?.timeline).toHaveLength(1)
  })

  /**
   * A supplier document that is GONE is the same decision. The distinction that
   * matters is against a read that FAILED — `reconcile-stock.ts`'s rule that a
   * failed read is not an absent marker — which is why the code separates the
   * two rather than treating any falsy snapshot as absence.
   */
  it('retires the row when the supplier record is deleted', async () => {
    seedDelivery()
    docs.delete(`hosts/${HOST}/suppliers/${SUPPLIER}`)
    const result = await scanSupplierDeliveries(OPEN_GATE, NOW)
    expect(result.cancelled).toBe(1)
    expect(docs.has(DELIVERY_PATH)).toBe(false)
  })
})

describe('the enqueue is idempotent (AGL-2473)', () => {
  /**
   * `create()` REFUSES an existing document; a `set()` would have overwritten
   * a retry part-way through its backoff and reset it to attempt zero, which is
   * a supplier POSTed to forever.
   */
  it('refuses to overwrite a delivery already in flight', async () => {
    const options = {
      firestore: fakeFirestore as never,
      hostId: HOST,
      orderId: ORDER,
      supplierId: SUPPLIER,
      supplierName: 'Northwind Fulfilment',
      url: 'https://supplier.example.com/orders',
      body: PAYLOAD,
      now: NOW,
    }
    expect(await enqueueSupplierDelivery(options)).toBe('queued')
    docs.set(DELIVERY_PATH, { ...delivery(), attempts: 4 })
    expect(await enqueueSupplierDelivery(options)).toBe('exists')
    expect(delivery()?.attempts).toBe(4)
  })

  /**
   * An id that `.doc()` would read as a PATH is refused rather than written
   * somewhere nobody looks (AGL-1771). The fulfilment path must not throw, so
   * the refusal is a return value.
   */
  it('refuses an id that would become a path, without throwing', async () => {
    const result = await enqueueSupplierDelivery({
      firestore: fakeFirestore as never,
      hostId: HOST,
      orderId: 'cs_1/../evil',
      supplierId: SUPPLIER,
      supplierName: 'Northwind Fulfilment',
      url: 'https://supplier.example.com/orders',
      body: PAYLOAD,
      now: NOW,
    })
    expect(result).toBe('skipped')
    expect([...docs.keys()].some((path) => path.includes('evil'))).toBe(false)
  })
})
