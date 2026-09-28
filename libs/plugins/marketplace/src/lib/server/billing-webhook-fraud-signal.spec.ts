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
 * A card fraud signal on a marketplace sale (AGL-3365).
 *
 * An early fraud warning or a Radar review lands on the purchase it names,
 * and the claim names the PUBLISHER's workspace — the org the sale paid — so
 * the platform route counts it on that seller's ledger. Before this the
 * marketplace ignored both events, so a publisher's pattern was filed with
 * no workspace at all.
 */

jest.mock('next/server', () => ({ after: (work: () => unknown) => void work() }))

const mockRecorded: Array<Record<string, unknown>> = []
jest.mock('@aglyn/tenant-data-admin/server/payment-risk-record', () => ({
  recordPaymentRiskOnRecord: async (input: Record<string, unknown>) => {
    mockRecorded.push(input)
    return true
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const store: Record<string, Record<string, unknown>> = {
    'marketplacePurchases/cs_1': {
      paymentIntentId: 'pi_1',
      sellerOrgId: 'org-publisher',
      buyerOrgId: 'org-buyer',
    },
  }
  return {
    notifyRiskEvent: async () => ({ duplicate: false }),
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: (name: string) => ({
            where: (field: string, _op: string, value: unknown) => ({
              limit: () => ({
                get: async () => {
                  const docs = Object.entries(store)
                    .filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value)
                    .map(([path, data]) => ({
                      ref: { path },
                      get: (key: string) => data[key],
                    }))
                  return { empty: docs.length === 0, docs }
                },
              }),
            }),
          }),
        }),
      }),
    },
  }
})

import { marketplaceBillingWebhookHandler } from './billing-webhook'

beforeEach(() => {
  mockRecorded.length = 0
})

describe('a fraud signal on a marketplace sale (AGL-3365)', () => {
  it.each(['radar.early_fraud_warning.created', 'review.opened'])(
    '%s lands on the purchase and names the publisher, not the buyer',
    async (type) => {
      const result = await marketplaceBillingWebhookHandler({
        type,
        object: { id: 'issfr_1', charge: 'ch_1', payment_intent: 'pi_1', created: 1_790_000_000 },
        event: { livemode: false },
      } as any)
      expect(result).toEqual({ claimed: true, orgId: 'org-publisher' })
      expect(mockRecorded).toEqual([
        expect.objectContaining({
          ref: { path: 'marketplacePurchases/cs_1' },
          signal: expect.objectContaining({ stripeObjectId: 'issfr_1' }),
          // No site: the publisher's own owners are told (AGL-3368), in the
          // words for a sale they cannot refund; staff hear through the
          // pattern, never per signal.
          hostId: '',
          orgId: 'org-publisher',
          noticeKind: 'marketplace-sale-warning',
          link: '/org/marketplace/payouts',
        }),
      ])
    },
  )

  it('leaves a charge that is no marketplace sale unclaimed', async () => {
    const result = await marketplaceBillingWebhookHandler({
      type: 'radar.early_fraud_warning.created',
      object: { id: 'issfr_2', charge: 'ch_2', payment_intent: 'pi_storefront' },
      event: { livemode: false },
    } as any)
    expect(result).toBeUndefined()
    expect(mockRecorded).toEqual([])
  })
})
