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
 * A marketplace sale's fraud shape, and a young publisher's payout hold
 * (AGL-3365). No live Stripe: `fetch` is replaced, and the only key the suite
 * holds is a `sk_test_` placeholder.
 */

// Every notice goes through the risk notice seam (AGL-3368).
const mockPublisherNotices: Array<Record<string, any>> = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  notifyRiskEvent: async (input: Record<string, any>) => {
    mockPublisherNotices.push(input)
  },
  firebaseAdmin: {
    app: () => {
      throw new Error('the spec passes its own firestore')
    },
    firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
  },
}))

import { renderOwnerRiskNotice } from '@aglyn/shared-util-email/risk-notice-catalog'
import {
  applyPublisherPayoutPolicy,
  isOrgMember,
  screenMarketplaceSale,
} from './sale-risk'

const DAY = 86_400_000
const NOW = Date.parse('2026-09-28T12:00:00Z')
const KEY = 'sk_test_spec_only'

let docs: Map<string, Record<string, unknown>>
let stripeCalls: Array<{ method: string; url: string; body: string }>
let fingerprint: string | null

function snapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function docRef(path: string): any {
  return {
    path,
    get: async () => snapshot(path),
    set: async (value: Record<string, unknown>, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function query(path: string, filters: Array<[string, unknown]>): any {
  return {
    where: (field: string, _op: string, value: unknown) => query(path, [...filters, [field, value]]),
    limit: (n: number) => ({
      get: async () => ({
        docs: [...docs.keys()]
          .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
          .map(snapshot)
          .filter((doc) => filters.every(([field, value]) => doc.get(field) === value))
          .slice(0, n),
      }),
    }),
  }
}

function collectionRef(path: string): any {
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    where: (field: string, op: string, value: unknown) => query(path, []).where(field, op, value),
    limit: (n: number) => query(path, []).limit(n),
  }
}

const firestore = { collection: collectionRef } as any
const staffNotices: Array<Record<string, any>> = []
const notifyRisk = async (input: Record<string, any>) => {
  staffNotices.push(input)
}

beforeEach(() => {
  docs = new Map()
  stripeCalls = []
  fingerprint = 'fp_card_1'
  staffNotices.length = 0
  mockPublisherNotices.length = 0
  docs.set('orgs/org-pub', { name: 'Northwind Labs', createdAt: NOW - 400 * DAY })
  docs.set('orgs/org-pub/members/owner-1', { role: 'owner' })
  docs.set('orgs/org-buyer', { name: 'Harbor View' })
  docs.set('orgs/org-buyer/members/buyer-1', { role: 'owner' })
  docs.set('publisherProfiles/org-pub', { stripeAccountId: 'acct_pub' })
  docs.set('marketplacePurchases/cs_1', { sellerOrgId: 'org-pub', buyerOrgId: 'org-buyer' })
  global.fetch = jest.fn(async (url: unknown, init?: { method?: string; body?: unknown }) => {
    const method = String(init?.method ?? 'GET')
    stripeCalls.push({ method, url: String(url), body: String(init?.body ?? '') })
    if (method === 'GET') {
      return {
        ok: true,
        json: async () => ({
          latest_charge: { payment_method_details: { card: fingerprint ? { fingerprint } : {} } },
        }),
      }
    }
    return { ok: true, json: async () => ({ id: 'acct_pub' }) }
  }) as never
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

const sale = (overrides: Record<string, unknown> = {}) => ({
  purchaseRef: docRef('marketplacePurchases/cs_1'),
  sessionId: 'cs_1',
  buyerUid: 'buyer-1',
  buyerOrgId: 'org-buyer',
  sellerOrgId: 'org-pub',
  amountCents: 4900,
  paymentIntentId: 'pi_1',
  livemode: false,
  ...overrides,
})

const payoutWrites = () => stripeCalls.filter((call) => call.method === 'POST')

describe("a young publisher's payouts", () => {
  it('are held on the connected account, once, and the publisher is told without the rule', async () => {
    expect(
      await applyPublisherPayoutPolicy({ firestore, publisherOrgId: 'org-pub', ageDays: 3, stripeKey: KEY, nowMs: NOW }),
    ).toBe('applied')
    expect(payoutWrites()).toEqual([
      expect.objectContaining({
        url: 'https://api.stripe.com/v1/accounts/acct_pub',
        body: 'settings%5Bpayouts%5D%5Bschedule%5D%5Bdelay_days%5D=14',
      }),
    ])
    expect(docs.get('publisherProfiles/org-pub')).toMatchObject({ payoutDelayDays: 14 })
    expect(mockPublisherNotices).toEqual([
      expect.objectContaining({ kind: 'publisher-payouts-held', orgId: 'org-pub' }),
    ])
    // The words the publisher reads never carry the delay the rule set.
    const told = renderOwnerRiskNotice('publisher-payouts-held', {})
    expect([told.meaning, ...told.steps].join(' ')).not.toMatch(/\d/)
    // A second sale changes nothing.
    expect(
      await applyPublisherPayoutPolicy({ firestore, publisherOrgId: 'org-pub', ageDays: 4, stripeKey: KEY, nowMs: NOW }),
    ).toBe('current')
    expect(payoutWrites()).toHaveLength(1)
  })

  it('return to the standard schedule when the publisher ages out', async () => {
    docs.set('publisherProfiles/org-pub', { stripeAccountId: 'acct_pub', payoutDelayDays: 14 })
    expect(
      await applyPublisherPayoutPolicy({ firestore, publisherOrgId: 'org-pub', ageDays: 45, stripeKey: KEY }),
    ).toBe('applied')
    expect(payoutWrites()[0].body).toBe('settings%5Bpayouts%5D%5Bschedule%5D%5Bdelay_days%5D=minimum')
  })

  it('never touch an established account this code never delayed', async () => {
    expect(
      await applyPublisherPayoutPolicy({ firestore, publisherOrgId: 'org-pub', ageDays: 400, stripeKey: KEY }),
    ).toBe('current')
    expect(stripeCalls).toEqual([])
  })
})

describe("a sale's fraud shape", () => {
  it('files nothing for an ordinary sale between two unrelated workspaces', async () => {
    const result = await screenMarketplaceSale(sale(), { firestore, stripeKey: KEY, notifyRisk, nowMs: NOW })
    expect(result).toEqual({ signals: [], filed: null })
    expect([...docs.keys()].some((key) => key.startsWith('abuseReports/'))).toBe(false)
    expect(docs.get('marketplacePurchases/cs_1')).toMatchObject({ cardFingerprint: 'fp_card_1' })
  })

  it('flags a buyer workspace that shares a member with the publisher', async () => {
    docs.set('orgs/org-buyer/members/owner-1', { role: 'editor' })
    docs.set('marketplacePurchases/cs_1', { sellerOrgId: 'org-pub', buyerOrgId: 'org-buyer', listingId: 'invoice-kit' })
    docs.set('marketplaceListings/invoice-kit', { displayName: 'Invoice Kit' })
    const result = await screenMarketplaceSale(sale(), { firestore, stripeKey: KEY, notifyRisk, nowMs: NOW })
    expect(result.signals).toEqual([{ code: 'shared-member', uids: ['owner-1'] }])
    const row = [...docs.entries()].find(([key]) => key.startsWith('abuseReports/'))?.[1]
    expect(row).toMatchObject({
      source: 'marketplace-sale-risk',
      severity: 'urgent',
      orgId: 'org-pub',
      status: 'open',
    })
    // One notice: staff get the shape as evidence, the publisher's owners the
    // catalog's words — the outcome, never the shape that was found.
    expect(staffNotices).toEqual([
      expect.objectContaining({
        kind: 'marketplace-sale-review',
        orgId: 'org-pub',
        reference: expect.stringMatching(/^MR-/),
        amount: '$49.00',
        staffEvidence: expect.stringMatching(/member/i),
        // Which sale, by its listing (AGL-3432), for a publisher with several.
        item: expect.objectContaining({ label: 'a sale of your listing "Invoice Kit"' }),
      }),
    ])
    const told = renderOwnerRiskNotice('marketplace-sale-review', {
      'item.label': staffNotices[0].item.label,
    })
    expect(Object.values(told).flat().join(' ')).not.toMatch(/member|card|shared|self/i)
  })

  it('flags one card buying from one publisher for several workspaces', async () => {
    docs.set('marketplacePurchases/cs_0', {
      sellerOrgId: 'org-pub',
      buyerOrgId: 'org-other',
      cardFingerprint: 'fp_card_1',
    })
    const result = await screenMarketplaceSale(sale(), { firestore, stripeKey: KEY, notifyRisk, nowMs: NOW })
    expect(result.signals).toEqual([
      { code: 'card-reused-across-buyers', otherBuyerOrgIds: ['org-other'] },
    ])
  })

  it("flags a young publisher's large sale, and holds its payouts", async () => {
    docs.set('orgs/org-pub', { name: 'Northwind Labs', createdAt: NOW - 2 * DAY })
    const result = await screenMarketplaceSale(sale({ amountCents: 25_000 }), {
      firestore,
      stripeKey: KEY,
      notifyRisk,
      nowMs: NOW,
    })
    expect(result.signals).toEqual([
      { code: 'young-publisher-large-sale', ageDays: 2, amountCents: 25_000 },
    ])
    expect(payoutWrites()).toHaveLength(1)
  })

  it("does not flag a young publisher's small sale, but still holds its payouts", async () => {
    docs.set('orgs/org-pub', { name: 'Northwind Labs', createdAt: NOW - 2 * DAY })
    const result = await screenMarketplaceSale(sale(), { firestore, stripeKey: KEY, notifyRisk, nowMs: NOW })
    expect(result.signals).toEqual([])
    expect(payoutWrites()).toHaveLength(1)
  })
})

describe('isOrgMember', () => {
  it('answers for any role, and no for a stranger', async () => {
    docs.set('orgs/org-pub/members/editor-1', { role: 'editor' })
    expect(await isOrgMember(firestore, 'org-pub', 'editor-1')).toBe(true)
    expect(await isOrgMember(firestore, 'org-pub', 'buyer-1')).toBe(false)
  })
})
