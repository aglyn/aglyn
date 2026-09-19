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

/**
 * A SUBSCRIPTION'S ADD-ON QUANTITIES LAND ON THE ORG DOC (AGL-3060).
 *
 * `seatAddons` stays on `orgs/{orgId}` (`ORG_BILLING_MOVED_KEYS` leaves it
 * out): it is an entitlement input that every member's surfaces resolve, the
 * AI add-on's band and overage rate included. The billing webhook syncs it
 * from the subscription items and a plan switch re-derives it from the
 * re-priced items; both hand it to `writeOrgBilling`, beside the keys that
 * did move.
 *
 * Asserted against the REAL writer. The webhook's own spec records the
 * payload a stub was handed, which cannot see what the writer does with a
 * key it does not move.
 */

import {
  ORG_BILLING_DOC_ID,
  ORG_BILLING_SUBCOLLECTION,
} from '@aglyn/aglyn/server'
import { hasAiAddon } from '@aglyn/aglyn/app-utils/plan-entitlements'

/** Every `set` the batch received: path, data, options. */
let writes: Array<[string, Record<string, unknown>, { merge?: boolean } | undefined]>

const docRef = (path: string) => ({ path })

const firestore = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      ...docRef(`${name}/${id}`),
      collection: (sub: string) => ({
        doc: (subId: string) => docRef(`${name}/${id}/${sub}/${subId}`),
      }),
    }),
  }),
  batch: () => ({
    set: (
      ref: { path: string },
      data: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      writes.push([ref.path, data, options])
    },
    commit: async () => undefined,
  }),
}

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => firestore }),
    firestore: {
      FieldValue: { serverTimestamp: () => '<<serverTimestamp>>' },
    },
  },
}))

import { writeOrgBilling } from './org-billing'

const ORIGINAL_ENV = process.env
const billingPath = `orgs/org-1/${ORG_BILLING_SUBCOLLECTION}/${ORG_BILLING_DOC_ID}`

/** Every add-on kind at zero, the shape `addonQuantitiesFromItems` returns. */
const NO_ADDONS = {
  managers: 0,
  members: 0,
  datasets: 0,
  hosts: 0,
  posRegisters: 0,
  eventCalendar: 0,
  aiAddon: 0,
}

/** The webhook's call for one `customer.subscription.*` delivery, as it makes it. */
function subscriptionSync(seatAddons: Record<string, number>, status = 'active') {
  return writeOrgBilling('org-1', {
    stripeCustomerId: 'cus_live_1',
    seatAddons,
    subscription: { status, priceId: 'price_starter', interval: 'month' },
  } as never)
}

const writeTo = (path: string) => writes.find(([written]) => written === path)

beforeEach(() => {
  writes = []
  process.env = { ...ORIGINAL_ENV, STRIPE_SECRET_KEY: 'sk_live_fake' } as NodeJS.ProcessEnv
})

afterEach(() => {
  process.env = ORIGINAL_ENV
})

describe('the add-on quantities a subscription carries land on the org doc (AGL-3060)', () => {
  it('an add-on bought with the plan is granted: the quantities are merged onto the org doc', async () => {
    // A Starter checkout with the AI add-on reaches the workspace only
    // through this sync. FORCED RED by writing the moved keys alone: the org
    // doc received `billingStatus` and nothing else, so the add-on that was
    // charged was never granted.
    await subscriptionSync({ ...NO_ADDONS, aiAddon: 1 })
    const orgWrite = writeTo('orgs/org-1')
    expect(orgWrite?.[1]).toEqual({
      billingStatus: 'active',
      seatAddons: { ...NO_ADDONS, aiAddon: 1 },
    })
    // Merged, so a key the items do not name survives the sync.
    expect(orgWrite?.[2]).toEqual({ merge: true })
    expect(hasAiAddon({ plan: 'starter', ...orgWrite?.[1] } as never)).toBe(true)
  })

  it('an add-on the subscription no longer carries is taken away: its zero lands', async () => {
    // A reduction scheduled for the period end is applied by this sync when
    // the phase flips; the add-ons route leaves the old quantity in place
    // until then, on purpose.
    await subscriptionSync(NO_ADDONS)
    expect(writeTo('orgs/org-1')?.[1]?.['seatAddons']).toEqual(NO_ADDONS)
    expect(hasAiAddon({ plan: 'starter', ...writeTo('orgs/org-1')?.[1] } as never)).toBe(false)
  })

  it('the quantities stay off the manager-gated billing doc, which carries only the keys that moved', async () => {
    await subscriptionSync({ ...NO_ADDONS, hosts: 2 })
    const billing = writeTo(billingPath)?.[1] ?? {}
    expect(billing).not.toHaveProperty('seatAddons')
    expect(Object.keys(billing).sort()).toEqual(['stripeCustomerId', 'subscription'])
  })

  it('THE CONTROL: a patch that carries no quantities writes none', async () => {
    // A status-only patch keeps writing the status alone, and a customer-id
    // patch touches no org field at all, so neither can blank the add-ons.
    await writeOrgBilling('org-1', { subscription: { status: 'past_due' } as never })
    expect(writeTo('orgs/org-1')?.[1]).toEqual({ billingStatus: 'past_due' })
    writes = []
    await writeOrgBilling('org-1', { stripeCustomerId: 'cus_live_1' })
    expect(writeTo('orgs/org-1')).toBeUndefined()
  })
})
