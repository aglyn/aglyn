/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment: behind the license header it
 * is silently ignored and this runs on jsdom.
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
 * A STRANGER BUYS CARD READERS ONLINE, END TO END, AGAINST A REAL FIRESTORE
 * (AGL-4038).
 *
 * The other hardware specs drive a Firestore double that implements merges,
 * transactions and queries itself. This one removes it: the real cart
 * checkout, the real billing webhook, the real hardware recorder, the real
 * sign-up claim and the real tax return readers run against the Firestore
 * emulator, and the assertions are what the database holds afterwards.
 * Stripe, email and the operator alert are faked at their boundaries.
 *
 *   1. The platform's own store's cart holds a reader and a dock. Checkout
 *      without the terms of sale is refused; with them the session taxes
 *      both lines as goods and carries the acceptance.
 *   2. Stripe says the session is paid: the store order is written, its
 *      hardware order is pending on To attach with the buyer's email,
 *      address and terms, the buyer is invited, staff are alerted.
 *   3. The buyer signs up and creates a workspace: the order moves into it.
 *   4. The tax return counts the sale once: in its store's own sale, and
 *      out of the storefront row the same session filed.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set, as every
 * `*.emulator.spec.ts`. Run it with the emulator up for the run only:
 *
 *   firebase emulators:exec --config cloud/firebase.json --only firestore \
 *     --project aglyn-main \
 *     "npx jest -c libs/plugins/commerce/jest.config.ts --runTestsByPath \
 *      libs/plugins/commerce/src/lib/server/pos-hardware-storefront.emulator.spec.ts"
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const PROJECT = 'aglyn-main'
if (EMULATED && !getApps().length) initializeApp({ projectId: PROJECT })

const mockSent: Array<Record<string, any>> = []
const mockAlerts: string[] = []
const mockUsers: Record<string, { uid: string; email: string; displayName?: string }> = {}

/**
 * The platform services the handlers import, over the emulator: the real
 * Firestore, and quiet fakes for every side channel (manager notices, host
 * contacts, metering). An export nobody named answers `undefined` from an
 * async function, so a new import in the webhook cannot reach a real service.
 */
jest.mock('@aglyn/tenant-data-admin', () => {
  const { getFirestore: firestore, FieldValue: values } = jest.requireActual('firebase-admin/firestore')
  const known: Record<string, unknown> = {
    firebaseAdmin: {
      app: () => ({ firestore: () => firestore() }),
      firestore: { FieldValue: values },
    },
    getOrgForHost: async (hostId: string) => {
      const host = await firestore().collection('hosts').doc(hostId).get()
      const orgId = String(host.get('orgId') ?? '')
      if (!orgId) return null
      const org = await firestore().collection('orgs').doc(orgId).get()
      return { orgId, org: { id: orgId, ...(org.data() ?? {}) } }
    },
    consentGroupForSite: async (hostId: string) => ({ hostId, groupId: hostId, name: null, hostIds: [hostId], declared: false }),
    hostSendingIdentity: async () => ({ from: 'hello@site.mail.example.com', source: 'custom', domain: 'site.mail.example.com', summary: '', refusal: null }),
    consumeRateLimit: async () => ({ allowed: true }),
    hostDisplayName: (host: Record<string, unknown>, id: string) => String(host['name'] ?? id),
    raiseOperatorAlert: async (key: string) => {
      mockAlerts.push(key)
      return { outcome: 'sent' }
    },
    renderHostEmailWithTokens: async () => null,
    updateExisting: jest.requireActual('@aglyn/tenant-data-admin/server/update-existing').updateExisting,
  }
  return new Proxy(known, {
    get: (target, key) => {
      if (typeof key === 'symbol' || key === 'then' || key === '__esModule') return key === '__esModule' ? true : undefined
      return key in target ? target[key] : async () => undefined
    },
    has: () => true,
  })
})
jest.mock('@aglyn/tenant-data-admin/server/auth-pools', () => ({
  findUserByEmailAcrossPools: async (email: string) => {
    const user = Object.values(mockUsers).find((candidate) => candidate.email === email.trim().toLowerCase())
    return user ? { record: user, tenantId: null } : null
  },
  findUserByUidAcrossPools: async (uid: string) => (mockUsers[uid] ? { record: mockUsers[uid], tenantId: null } : null),
}))
jest.mock('@aglyn/tenant-data-admin/server/payment-provider', () => ({
  ...jest.requireActual('@aglyn/tenant-data-admin/server/payment-provider'),
  merchantAccountIsReady: () => true,
}))
jest.mock('@aglyn/tenant-data-admin/server/email-suppression', () => ({
  filterSuppressedEmails: async (addresses: string[]) => addresses,
}))
jest.mock('@aglyn/tenant-data-admin/server/render-system-email', () => ({
  orgSystemEmailBrand: async () => ({ merge: {}, options: {}, fromName: '' }),
  renderSystemEmailContent: async (key: string, _merge: Record<string, string>, _brand: unknown, fallback: { subject: string }) => ({
    subject: fallback.subject,
    html: `<p>${key}</p>`,
    text: fallback.subject,
  }),
}))
jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email/pos-hardware-emails'),
  isEmailConfigured: () => false,
  sendEmail: async (message: Record<string, any>) => {
    mockSent.push(message)
    return { sent: true }
  },
}))
jest.mock('./pos-stripe', () => ({ ...jest.requireActual('./pos-stripe'), posStripeTestMode: () => false }))

import { POS_HARDWARE_ENV, type PosHardwareOrder } from '../model/pos-hardware'
import { commerceBillingWebhookHandler } from './billing-webhook'
import { cartCheckoutHandler } from './cart-checkout'
import { posHardwareInPersonOrderId } from './pos-hardware'
import { claimPosHardwareForNewWorkspace } from './pos-hardware-attach'
import { readPosHardwareTaxReturn } from './pos-hardware-tax-return-source'
import { readStorefrontTaxRows } from './tax-return-source'

const run = EMULATED ? describe : describe.skip

const SESSION = 'cs_live_stranger_1'
const SELLER_HOST = 'host-seller-e2e'
const SELLER_ORG = 'org-seller-e2e'

/** The Checkout Session form Stripe was sent. */
let sessionForm: URLSearchParams | null = null

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
    send(body: unknown) {
      result.body = body
    },
    setHeader() {},
    redirect() {},
    end() {},
  } as unknown as PluginApiResponse
  return { res, result }
}

async function checkout(body: Record<string, unknown>) {
  const { res, result } = response()
  await cartCheckoutHandler(
    {
      method: 'POST',
      body: { hostId: SELLER_HOST, ...body },
      cookies: { [`aglyn_cart_${SELLER_HOST}`]: 'cart-e2e' },
      headers: { host: 'shop.example.com', 'user-agent': 'Mozilla/5.0 (stranger)', 'idempotency-key': `attempt-${Date.now()}` },
      query: {},
      socket: {},
    } as unknown as PluginApiRequest,
    res,
  )
  return result
}

async function clear() {
  const firestore = getFirestore()
  for (const path of [`hosts/${SELLER_HOST}`, `orgs/${SELLER_ORG}`, 'orgs/org-stranger', 'posHardwareSales', 'storefrontTaxCollected', 'profiles']) {
    const ref = path.includes('/') ? firestore.doc(path) : firestore.collection(path)
    await firestore.recursiveDelete(ref as never)
  }
}

run('a stranger buys card readers online from the platform’s own store (emulator)', () => {
  const firestore = () => getFirestore()
  const orderId = posHardwareInPersonOrderId(SELLER_HOST, SESSION)

  beforeAll(async () => {
    process.env[POS_HARDWARE_ENV.inPersonEnabled] = 'true'
    process.env[POS_HARDWARE_ENV.sellerHostId] = SELLER_HOST
    process.env[POS_HARDWARE_ENV.sellerOrgId] = SELLER_ORG
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_emulated'
    process.env['TOKEN_SIGNING_SECRET'] = 'emulated-token-secret'
    global.fetch = jest.fn(async (url: string, init: { body?: string }) => {
      const target = String(url)
      if (target.endsWith('/v1/checkout/sessions')) {
        sessionForm = new URLSearchParams(String(init?.body ?? ''))
        return { ok: true, status: 200, json: async () => ({ id: SESSION, url: `https://checkout.stripe.com/pay/${SESSION}` }) }
      }
      if (target.endsWith('/v1/tax_rates')) return { ok: true, status: 200, json: async () => ({ id: 'txr_e2e' }) }
      return { ok: false, status: 404, json: async () => ({ error: { message: `not faked: ${target}` } }) }
    }) as unknown as typeof fetch
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    await clear()
    const db = firestore()
    await db.doc(`orgs/${SELLER_ORG}`).set({ name: 'Seller', ownerUid: 'owner-seller', plan: 'business', subscriptionStatus: 'active' })
    await db.doc(`hosts/${SELLER_HOST}`).set({ name: 'Our store', orgId: SELLER_ORG })
    await db.doc('profiles/owner-seller').set({ stripeAccountId: 'acct_seller', stripeChargesEnabled: true })
    // The store charges its own Texas rate, so the sale files a storefront row.
    await db.doc(`hosts/${SELLER_HOST}/settings/store`).set({
      tax: { mode: 'manual', origin: { country: 'US', state: 'TX' }, rates: [{ country: 'US', state: 'TX', pct: 8.25 }] },
    })
    await db.doc(`hosts/${SELLER_HOST}/products/reader`).set({
      name: 'Touchscreen reader (S700)',
      status: 'active',
      type: 'physical',
      hardwareSku: 'stripe-reader-s700',
      variants: [{ id: 'default', priceUsd: 299, inventory: 5 }],
    })
    await db.doc(`hosts/${SELLER_HOST}/products/dock`).set({
      name: 'Charging dock for the S700 and S710',
      status: 'active',
      type: 'physical',
      hardwareSku: 'stripe-reader-s700-dock',
      variants: [{ id: 'default', priceUsd: 49, inventory: 5 }],
    })
    await db.doc(`hosts/${SELLER_HOST}/carts/cart-e2e`).set({
      lines: [
        { productId: 'reader', quantity: 1 },
        { productId: 'dock', quantity: 1 },
      ],
    })
  })

  afterAll(async () => {
    await clear()
    for (const key of [POS_HARDWARE_ENV.inPersonEnabled, POS_HARDWARE_ENV.sellerHostId, POS_HARDWARE_ENV.sellerOrgId]) {
      delete process.env[key]
    }
  })

  it('1. refuses checkout without the terms of sale, then taxes the hardware as goods with them', async () => {
    const refused = await checkout({})
    expect(refused.status).toBe(400)
    expect(refused.body.needsHardwareTerms).toBe(true)
    expect(sessionForm).toBeNull()

    const taken = await checkout({ hardwareTerms: { accepted: true, businessUse: true } })
    expect(taken.status).toBe(200)
    expect(sessionForm!.get('line_items[0][price_data][product_data][tax_code]')).toBe('txcd_99999999')
    expect(sessionForm!.get('line_items[1][price_data][product_data][tax_code]')).toBe('txcd_99999999')
    expect(sessionForm!.get('metadata[hardwareTermsVersion]')).toBe('v21')
    expect(sessionForm!.get('metadata[hardwareTermsBusinessUse]')).toBe('true')
    expect(sessionForm!.get('metadata[hardwareTermsUserAgent]')).toBe('Mozilla/5.0 (stranger)')
  })

  it('2. a paid session becomes a pending hardware order, the buyer is invited and staff alerted', async () => {
    const metadata = Object.fromEntries(
      [...sessionForm!.entries()].flatMap(([key, value]) => {
        const match = /^metadata\[(.+)\]$/.exec(key)
        return match ? [[match[1], value]] : []
      }),
    )
    await commerceBillingWebhookHandler({
      type: 'checkout.session.completed',
      object: {
        id: SESSION,
        object: 'checkout.session',
        mode: 'payment',
        payment_status: 'paid',
        livemode: true,
        created: 1_762_300_000,
        currency: 'usd',
        amount_total: 39_671,
        payment_intent: 'pi_stranger_1',
        customer_details: { email: 'Stranger@Example.com', name: 'Jordan Lee' },
        shipping_details: {
          name: 'Jordan Lee',
          address: { line1: '12 Main St', line2: null, city: 'Springfield', state: 'IL', postal_code: '62701', country: 'US' },
        },
        shipping_cost: { amount_total: 2_000 },
        total_details: { amount_tax: 2_871, amount_shipping: 2_000, amount_discount: 0 },
        metadata,
      },
      event: { livemode: true },
      requestHost: 'shop.example.com',
    } as never)

    const storeOrder = (await firestore().doc(`hosts/${SELLER_HOST}/orders/${SESSION}`).get()).data()
    expect(storeOrder).toMatchObject({ status: 'paid', channel: 'online', hardwareOrderId: orderId })
    expect(storeOrder?.['hardwareSalePending']).toBeUndefined()

    const pending = (await firestore().doc(`orgs/${SELLER_ORG}/hardwareOrders/${orderId}`).get()).data() as PosHardwareOrder
    expect(pending).toMatchObject({
      source: 'storefront',
      status: 'paid',
      contactEmail: 'stranger@example.com',
      subtotalCents: 34_800,
      taxCents: 2_871,
      totalCents: 39_671,
      shipping: { cents: 2_000, name: 'Jordan Lee', address: { line1: '12 Main St', state: 'IL', postalCode: '62701' } },
      termsAcceptance: { method: 'online', version: 'v21', businessUse: true, atMs: 1_762_300_000_000 },
      attachment: { state: 'pending', email: 'stranger@example.com', uid: null },
      paidTo: { account: 'seller_store', hostId: SELLER_HOST, orgId: SELLER_ORG },
    })
    expect(pending.units).toHaveLength(1)

    const record = (await firestore().doc(`posHardwareSales/${orderId}`).get()).data()
    expect(record).toMatchObject({ source: 'storefront', storefrontTaxRowId: SESSION, buyer: { name: 'Jordan Lee' } })

    expect(mockSent.filter((message) => message.context === 'pos-hardware-sign-up-invite').map((message) => message.to)).toEqual([
      'stranger@example.com',
    ])
    expect(mockAlerts).toHaveLength(1)
  })

  it('3. the buyer’s new workspace claims the order', async () => {
    mockUsers['uid-stranger'] = { uid: 'uid-stranger', email: 'stranger@example.com', displayName: 'Jordan Lee' }
    await firestore().doc('orgs/org-stranger/members/uid-stranger').set({ uid: 'uid-stranger', role: 'owner' })
    const claimed = await claimPosHardwareForNewWorkspace({
      config: { sellerHostId: SELLER_HOST, sellerOrgId: SELLER_ORG },
      orgId: 'org-stranger',
      ownerUid: 'uid-stranger',
      ownerEmail: 'stranger@example.com',
      emailVerified: true,
    })
    expect(claimed).toEqual({ claimed: 1 })
    expect((await firestore().doc(`orgs/${SELLER_ORG}/hardwareOrders/${orderId}`).get()).exists).toBe(false)
    const mine = (await firestore().doc(`orgs/org-stranger/hardwareOrders/${orderId}`).get()).data()
    expect(mine).toMatchObject({ orgId: 'org-stranger', attachment: { state: 'attached', uid: 'uid-stranger' } })
    expect((await firestore().doc(`posHardwareSales/${orderId}`).get()).get('orgId')).toBe('org-stranger')
  })

  it('4. the tax return counts the sale once', async () => {
    const request = {
      period: '2025-Q4',
      start: new Date(Date.UTC(2025, 9, 1)),
      end: new Date(Date.UTC(2027, 0, 1)),
      filing: { code: 'TX', label: 'Texas', figuresName: 'Items 1–2' },
      rowCap: 500,
    } as never
    // The store's own sale: in the hardware section's papers, folded in as
    // its store's sale, and in no part the section adds to the figures.
    const hardware = await readPosHardwareTaxReturn(request, { ownHostIds: new Set([SELLER_HOST]) })
    const rows = (hardware as unknown as { rows: Array<{ orderId: string; foldedAs: string }> }).rows
    expect(rows.find((row) => row.orderId === orderId)?.foldedAs).toBe('store register sale')
    const shop = hardware.operatorSales?.find((part) => part.id === 'posHardwareShop')
    expect(Object.values(shop?.byJurisdiction ?? {}).reduce((sum, part) => sum + part.transactionCount, 0)).toBe(0)
    // The storefront row the session filed is the hardware alone: taken out.
    const filed = await firestore().doc(`storefrontTaxCollected/${SESSION}`).get()
    expect(filed.exists).toBe(true)
    const storefront = await readStorefrontTaxRows(request)
    expect(storefront.rows.find((row) => row.id === SESSION)).toBeUndefined()
  })
})
