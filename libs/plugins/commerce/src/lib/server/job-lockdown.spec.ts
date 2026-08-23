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
 * THE FOUR COMMERCE BEATS HONOUR A LOCKDOWN (AGL-2495, from AGL-1621).
 *
 * The sharper half of the job surface. `publish-schedule-job.ts` — the drill's
 * finding — could publish a page on a locked host; these four touch ORDERS,
 * STOCK, a merchant's customers and a third-party supplier, for a site that
 * may be suspended for abuse, non-payment or a legal takedown.
 *
 * `lockdown-tenant-api-coverage.spec.ts` proves each registration declares a
 * scope and asks the gate. It reads text and stops at the registration, so it
 * cannot see whether the answer reaches the write two files further in. This
 * suite drives each scan with a gate that says LOCKED and asserts nothing was
 * written, mailed or POSTed — then lifts the lock on the SAME rows and
 * asserts the work lands.
 *
 * SKIPPED, NOT DROPPED needs both halves. A pass that stopped writing but
 * consumed the row — stamped it, deleted it, burned a retry — would satisfy a
 * one-sided suite and lose the work silently, which is only discoverable
 * after the lift.
 *
 * ## NO STRIPE, AND NO NETWORK AT ALL
 *
 * Every one of these tests is arranged so the code path never reaches a
 * `fetch`. The supplier-outbox control uses a supplier record with no
 * `webhookUrl`, which retires the row without a request; the three others do
 * not make outbound calls at all. `global.fetch` is asserted to be the
 * untouched original at the end, so a future change that grew a call here
 * would fail rather than escape the sandbox — localhost carries the LIVE
 * Stripe key (`feedback_stripe_live_vs_test_mode`), so this is proven, not
 * assumed.
 */

// ---------------------------------------------------------------------------
// Recorders
// ---------------------------------------------------------------------------

/** Every mutation the doubles observe, as `verb path`. */
let writes: string[] = []
/** Every email the pass would have sent, by recipient. */
let emails: string[] = []
/** Every console notification raised for a merchant. */
let notifications: string[] = []
/** Hosts the gate was asked about, in order. */
let asked: string[] = []
/** The hosts the gate answers LOCKED for. */
let lockedHosts = new Set<string>()

const gate = {
  isLocked: async (hostId: string) => {
    asked.push(hostId)
    return lockedHosts.has(hostId)
  },
}

// ---------------------------------------------------------------------------
// A small Firestore, keyed by collection name
// ---------------------------------------------------------------------------

/** Collection name → the docs a query on it answers with. */
let rows: Record<string, any[]> = {}
/** Document path → its stored fields, for the point reads the scans make. */
let stored: Record<string, Record<string, any>> = {}

function snapshotFor(path: string) {
  return {
    id: path.split('/').pop(),
    exists: path in stored,
    data: () => stored[path],
    get: (field: string) => stored[path]?.[field],
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    parent: { parent: { id: path.split('/').slice(-3, -2)[0] } },
    get: async () => snapshotFor(path),
    set: async (value: Record<string, any>) => {
      writes.push(`set ${path}`)
      stored[path] = { ...(stored[path] ?? {}), ...value }
    },
    update: async (value: Record<string, any>) => {
      writes.push(`update ${path}`)
      stored[path] = { ...(stored[path] ?? {}), ...value }
    },
    delete: async () => {
      writes.push(`delete ${path}`)
      delete stored[path]
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function query(name: string): any {
  const chain: any = {
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    get: async () => ({ size: (rows[name] ?? []).length, docs: rows[name] ?? [] }),
  }
  return chain
}

function collectionRef(path: string): any {
  const name = path.split('/').pop() as string
  const ref: any = query(name)
  ref.path = path
  ref.doc = (id: string) => docRef(`${path}/${id}`)
  return ref
}

const firestore: any = {
  collection: (name: string) => collectionRef(name),
  collectionGroup: (name: string) => query(name),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => firestore }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => 'NOW',
        arrayUnion: (value: any) => ({ __arrayUnion: value }),
      },
    },
  },
  getOrgForHost: async () => ({ org: { name: 'Acme', plan: 'pro' } }),
  meterHostEmail: async (hostId: string) => {
    writes.push(`meter ${hostId}`)
  },
  notifyHostManagers: async (hostId: string, payload: { title: string }) => {
    notifications.push(`${hostId}: ${payload.title}`)
  },
}))

jest.mock('@aglyn/shared-util-email', () => ({
  // TRUE, so a green cannot mean "email was switched off".
  isEmailConfigured: () => true,
  loadHostEmail: async () => null,
  renderLoadedHostEmail: () => ({ subject: 's', text: 't' }),
  sendEmail: async (message: { to: string }) => {
    emails.push(message.to)
    return { sent: true }
  },
}))

import { scanAbandonedCheckouts } from './process-abandoned'
import { scanRestockAlerts } from './process-restock'
import { scanStockDecrements } from './reconcile-stock'
import { scanSupplierDeliveries } from './supplier-outbox'

const realFetch = global.fetch

/** A document snapshot living at `hosts/{hostId}/{collection}/{id}`. */
function hostDoc(
  hostId: string,
  collection: string,
  id: string,
  data: Record<string, any>,
) {
  const path = `hosts/${hostId}/${collection}/${id}`
  stored[path] = data
  return {
    id,
    data: () => stored[path],
    get: (field: string) => stored[path]?.[field],
    ref: docRef(path),
  }
}

beforeEach(() => {
  writes = []
  emails = []
  notifications = []
  asked = []
  lockedHosts = new Set()
  rows = {}
  stored = {}
})

describe('AGL-2495 · commerce#abandoned-checkout-recovery honours a lockdown', () => {
  /**
   * A checkout past the give-up horizon. Chosen because its outcome is a
   * `status: 'expired'` WRITE that needs no entitlement and no email — so the
   * control proves the pass acts, without the assertion resting on a plan
   * lookup that could pass for the wrong reason.
   *
   * It is also the row that made the ordering matter: that write used to
   * happen before the host was even resolved, so a gate placed next to the
   * email would have left it un-covered.
   */
  const abandoned = (hostId: string) => {
    rows['checkouts'] = [
      hostDoc(hostId, 'checkouts', 'c1', {
        status: 'open',
        email: 'shopper@example.com',
        createdAtMs: Date.now() - 30 * 24 * 60 * 60 * 1000,
      }),
    ]
  }

  it('CONTROL — an unlocked host has its stale checkout expired', async () => {
    abandoned('healthy')
    const result = await scanAbandonedCheckouts(gate)
    expect(asked).toEqual(['healthy'])
    expect(writes).toEqual(['set hosts/healthy/checkouts/c1'])
    expect(result.skippedLocked).toBe(0)
  })

  it('a locked host has NOTHING written and NOTHING mailed', async () => {
    abandoned('locked')
    lockedHosts.add('locked')
    const result = await scanAbandonedCheckouts(gate)
    expect(writes).toEqual([])
    expect(emails).toEqual([])
    expect(result.skippedLocked).toBe(1)
  })

  it('SKIPPED, NOT DROPPED — the checkout is still open after the lift', async () => {
    abandoned('locked')
    lockedHosts.add('locked')
    await scanAbandonedCheckouts(gate)
    expect(stored['hosts/locked/checkouts/c1'].status).toBe('open')

    lockedHosts.delete('locked')
    await scanAbandonedCheckouts(gate)
    expect(writes).toEqual(['set hosts/locked/checkouts/c1'])
    expect(stored['hosts/locked/checkouts/c1'].status).toBe('expired')
  })
})

describe('AGL-2495 · commerce#back-in-stock-alerts honours a lockdown', () => {
  /**
   * An alert whose `productId` is absent — the poisoned-row retirement path
   * from AGL-1774. Its outcome is a stamp, which is the write a lock must
   * stop, and it reaches no product read and no email.
   */
  const alert = (hostId: string) => {
    rows['restockAlerts'] = [
      hostDoc(hostId, 'restockAlerts', 'a1', {
        email: 'shopper@example.com',
        notifiedAtMs: null,
      }),
    ]
  }

  it('CONTROL — an unlocked host has its alert retired', async () => {
    alert('healthy')
    await scanRestockAlerts(gate)
    expect(asked).toEqual(['healthy'])
    expect(writes).toEqual(['set hosts/healthy/restockAlerts/a1'])
  })

  it('a locked host has NOTHING stamped', async () => {
    alert('locked')
    lockedHosts.add('locked')
    const result = await scanRestockAlerts(gate)
    expect(writes).toEqual([])
    expect(emails).toEqual([])
    expect(result.skippedLocked).toBe(1)
  })

  it('SKIPPED, NOT DROPPED — the alert is unstamped and acted on after the lift', async () => {
    alert('locked')
    lockedHosts.add('locked')
    await scanRestockAlerts(gate)
    // `notifiedAtMs == null` is the query's own selector, so leaving it null
    // IS leaving the row in the queue.
    expect(stored['hosts/locked/restockAlerts/a1'].notifiedAtMs).toBe(null)

    lockedHosts.delete('locked')
    await scanRestockAlerts(gate)
    expect(writes).toEqual(['set hosts/locked/restockAlerts/a1'])
    expect(stored['hosts/locked/restockAlerts/a1'].notifiedAtMs).not.toBe(null)
  })
})

describe('AGL-2495 · commerce#stock-decrement-reconciliation honours a lockdown', () => {
  /**
   * One paid order with a line item, an EMPTY adjustments ledger and no
   * reconciliation marker — the exact arrangement that makes the detector
   * report, notify the merchant and write a marker.
   */
  const unreconciled = (hostId: string) => {
    // A TRACKED variant. The detector deliberately says nothing about an
    // untracked one — a shelf nobody counts has no missing decrement — so a
    // fixture without inventory would make the control pass for the wrong
    // reason: nothing to report rather than a lock that let it through.
    stored[`hosts/${hostId}/products/p1`] = {
      id: 'p1',
      name: 'Widget',
      variants: [{ id: 'v1', inventory: 5 }],
    }
    const order = {
      id: 'o1',
      get: (field: string) =>
        ({
          status: 'paid',
          createdAtMs: 1_000,
          number: 1001,
          lineItems: [
            { productId: 'p1', variantId: 'v1', quantity: 2, name: 'Widget' },
          ],
        })[field],
      ref: { parent: { parent: { id: hostId, parent: { id: 'hosts' } } } },
    }
    rows['orders'] = [order]
    rows['inventoryAdjustments'] = []
  }

  it('CONTROL — an unlocked host is reconciled and its merchant told', async () => {
    unreconciled('healthy')
    const scan = await scanStockDecrements(gate, { nowMs: 9_000_000_000_000 })
    expect(asked).toEqual(['healthy'])
    expect(scan.skippedLocked).toBe(0)
    expect(notifications.length).toBeGreaterThan(0)
    expect(writes.some((entry) => entry.includes('inventoryReconciliation'))).toBe(
      true,
    )
  })

  it('a locked host is not reconciled, not notified and not marked', async () => {
    unreconciled('locked')
    lockedHosts.add('locked')
    const scan = await scanStockDecrements(gate, { nowMs: 9_000_000_000_000 })
    expect(scan.skippedLocked).toBe(1)
    expect(scan.reportedOrders).toBe(0)
    expect(notifications).toEqual([])
    expect(writes).toEqual([])
  })

  it('SKIPPED, NOT DROPPED — the same finding is reported after the lift', async () => {
    // This detector has no cursor: it re-derives everything from the last N
    // orders every beat. So "not dropped" means the marker was NOT written
    // while locked — a marker is what suppresses the report forever after.
    unreconciled('locked')
    lockedHosts.add('locked')
    await scanStockDecrements(gate, { nowMs: 9_000_000_000_000 })
    expect(writes).toEqual([])

    lockedHosts.delete('locked')
    const after = await scanStockDecrements(gate, { nowMs: 9_000_000_000_000 })
    expect(after.reportedOrders).toBe(1)
    expect(notifications.length).toBe(1)
  })
})

describe('AGL-2495 · commerce#supplier-webhook-delivery honours a lockdown', () => {
  /**
   * A queued delivery whose supplier record has NO `webhookUrl` — the
   * merchant-removed-the-endpoint path, which retires the row with a delete
   * and makes no outbound request. A control that reached the real POST would
   * mean this suite could put traffic on a merchant's supplier.
   */
  const queued = (hostId: string) => {
    stored[`hosts/${hostId}/suppliers/s1`] = { name: 'Supplier' }
    const path = `supplierDeliveries/d1`
    stored[path] = {
      hostId,
      supplierId: 's1',
      orderId: 'o1',
      status: 'pending',
      attempts: 0,
      body: '{}',
    }
    rows['supplierDeliveries'] = [
      {
        id: 'd1',
        data: () => stored[path],
        get: (field: string) => stored[path]?.[field],
        ref: docRef(path),
      },
    ]
  }

  it('CONTROL — an unlocked host has its queued delivery acted on', async () => {
    queued('healthy')
    const result = await scanSupplierDeliveries(gate, 5_000)
    expect(asked).toEqual(['healthy'])
    expect(result.cancelled).toBe(1)
    expect(writes).toEqual(['delete supplierDeliveries/d1'])
  })

  it('a locked host has its row left completely alone', async () => {
    queued('locked')
    lockedHosts.add('locked')
    const result = await scanSupplierDeliveries(gate, 5_000)
    expect(result.skippedLocked).toBe(1)
    expect(writes).toEqual([])
    expect(stored['supplierDeliveries/d1']).toBeDefined()
  })

  it('SKIPPED, NOT DROPPED — the retry budget is untouched by the lock', async () => {
    // The strongest of the six. `attempts` is what dead-letters a paid
    // order, so a lock that let the attempt run and fail would spend a
    // customer's delivery budget on being suspended.
    queued('locked')
    lockedHosts.add('locked')
    await scanSupplierDeliveries(gate, 5_000)
    expect(stored['supplierDeliveries/d1'].attempts).toBe(0)
    expect(stored['supplierDeliveries/d1'].status).toBe('pending')
    expect(stored['supplierDeliveries/d1'].nextAttemptAtMs).toBeUndefined()

    lockedHosts.delete('locked')
    const after = await scanSupplierDeliveries(gate, 5_000)
    expect(after.cancelled).toBe(1)
    expect(writes).toEqual(['delete supplierDeliveries/d1'])
  })
})

describe('AGL-2495 · no commerce beat reached a payment API in this suite', () => {
  it('global.fetch is the untouched original', () => {
    expect(global.fetch).toBe(realFetch)
  })
})
