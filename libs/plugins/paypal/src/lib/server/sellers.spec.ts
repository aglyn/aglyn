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

import { createFakePayPal, type FakePayPal } from '../testing/fake-paypal'
import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import { PAYPAL_TEST_ENV, TEST_ORG, clearPayPalTestEnv, setPayPalTestEnv } from '../testing/paypal-env'
import { readPayPalConfig, type PayPalConfig } from './config'
import { setPayPalDbForTests } from './db'
import { setPayPalFetchForTests } from './paypal-api'
import {
  disconnectSeller,
  findSellerOrg,
  markSellerRevoked,
  readSeller,
  readySeller,
  refreshSeller,
  sellerView,
  startSellerOnboarding,
} from './sellers'

/**
 * A workspace's PayPal seller account (AGL-3630): onboarded through PayPal's
 * Partner Referrals as a third party granting the platform payments,
 * refunds and its fee; ready only when PayPal says it receives payments,
 * its email is confirmed and THIS platform app holds the permission.
 */

let db: MemoryFirestore
let paypal: FakePayPal
let config: PayPalConfig

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => db }) },
}))
jest.mock('@aglyn/tenant-data-admin/server/payment-provider', () => ({
  paymentProvider: () => ({ platformMode: () => 'test' }),
}))

const RETURN = 'https://app.aglyn.com/acme/hosts/candles/products/settings?paypal=returned'

beforeEach(() => {
  setPayPalTestEnv()
  db = createMemoryFirestore()
  setPayPalDbForTests(db)
  paypal = createFakePayPal({ clientId: PAYPAL_TEST_ENV['PAYPAL_CLIENT_ID'], partnerMerchantId: PAYPAL_TEST_ENV['PAYPAL_PARTNER_MERCHANT_ID'] })
  setPayPalFetchForTests(paypal.fetch)
  const read = readPayPalConfig()
  if (!read.configured) throw new Error('env')
  config = read.config
})

afterEach(() => {
  setPayPalDbForTests(null)
  setPayPalFetchForTests(null)
  clearPayPalTestEnv()
})

describe('onboarding a seller', () => {
  it('asks PayPal for a third-party referral with the platform fee and answers its link', async () => {
    const started = await startSellerOnboarding(config, { orgId: TEST_ORG, uid: 'owner-1', returnUrl: RETURN })
    expect(started).toEqual({ actionUrl: 'https://www.sandbox.paypal.com/bizsignup/partner/entry?referralToken=ZjcyODU4ZWYt' })
    const [referral] = paypal.callsTo('POST', '/v2/customer/partner-referrals')
    expect(referral.body).toEqual({
      tracking_id: expect.stringMatching(/^aglyn-org-candles-[0-9a-f]{12}$/),
      operations: [
        {
          operation: 'API_INTEGRATION',
          api_integration_preference: {
            rest_api_integration: {
              integration_method: 'PAYPAL',
              integration_type: 'THIRD_PARTY',
              third_party_details: { features: ['PAYMENT', 'REFUND', 'PARTNER_FEE', 'ACCESS_MERCHANT_INFORMATION'] },
            },
          },
        },
      ],
      products: ['EXPRESS_CHECKOUT'],
      legal_consents: [{ type: 'SHARE_DATA_CONSENT', granted: true }],
      partner_config_override: { return_url: RETURN, return_url_description: expect.any(String) },
    })
    expect(await readSeller(TEST_ORG)).toMatchObject({ status: 'onboarding', startedByUid: 'owner-1', environment: 'sandbox' })
  })

  it('resumes an unfinished connection on its tracking id, and starts afresh after a disconnect', async () => {
    await startSellerOnboarding(config, { orgId: TEST_ORG, uid: 'owner-1', returnUrl: RETURN })
    await startSellerOnboarding(config, { orgId: TEST_ORG, uid: 'owner-1', returnUrl: RETURN })
    const [first, second] = paypal.callsTo('POST', '/v2/customer/partner-referrals')
    expect(second.body.tracking_id).toBe(first.body.tracking_id)
    await disconnectSeller(TEST_ORG)
    await startSellerOnboarding(config, { orgId: TEST_ORG, uid: 'owner-1', returnUrl: RETURN })
    const third = paypal.callsTo('POST', '/v2/customer/partner-referrals')[2]
    expect(third.body.tracking_id).not.toBe(first.body.tracking_id)
  })

  it('starts nothing for a seller that is already ready', async () => {
    await startSellerOnboarding(config, { orgId: TEST_ORG, uid: 'owner-1', returnUrl: RETURN })
    await refreshSeller(config, TEST_ORG)
    expect(await startSellerOnboarding(config, { orgId: TEST_ORG, uid: 'owner-1', returnUrl: RETURN })).toBeNull()
  })
})

describe('reading a seller back from PayPal', () => {
  beforeEach(async () => {
    await startSellerOnboarding(config, { orgId: TEST_ORG, uid: 'owner-1', returnUrl: RETURN })
  })

  it('stays onboarding while PayPal has not linked the tracking id', async () => {
    paypal.sellerLinked = false
    expect(await refreshSeller(config, TEST_ORG)).toMatchObject({ status: 'onboarding' })
    expect(await readySeller(TEST_ORG, config)).toBeNull()
  })

  it('is ready when PayPal says all three, and found by its merchant id', async () => {
    expect(await refreshSeller(config, TEST_ORG)).toMatchObject({ status: 'ready', merchantId: 'SELLER7RXQG3L' })
    expect(await readySeller(TEST_ORG, config)).not.toBeNull()
    expect(await findSellerOrg({ merchantId: 'SELLER7RXQG3L' })).toBe(TEST_ORG)
    expect(sellerView(await readSeller(TEST_ORG), config)).toEqual({
      status: 'ready',
      merchantId: 'SELLER7RXQG3L',
      actions: [],
      livemode: false,
    })
  })

  it.each([
    ['an unconfirmed email', { payments_receivable: true, primary_email_confirmed: false, granted: true }, /Confirm your email/],
    ['payments not receivable', { payments_receivable: false, primary_email_confirmed: true, granted: true }, /receive payments/],
    ['no permission for this app', { payments_receivable: true, primary_email_confirmed: true, granted: false }, /permission/],
  ])('needs the seller to act on %s', async (_label, ready, action) => {
    paypal.sellerReady = ready
    const seller = await refreshSeller(config, TEST_ORG)
    expect(seller?.status).toBe('action-needed')
    expect(sellerView(seller, config).actions.join(' ')).toMatch(action)
    expect(await readySeller(TEST_ORG, config)).toBeNull()
  })

  it('stops offering PayPal when the seller withdraws permission', async () => {
    await refreshSeller(config, TEST_ORG)
    await markSellerRevoked(TEST_ORG)
    expect(await readySeller(TEST_ORG, config)).toBeNull()
    expect(sellerView(await readSeller(TEST_ORG), config).status).toBe('revoked')
  })
})
