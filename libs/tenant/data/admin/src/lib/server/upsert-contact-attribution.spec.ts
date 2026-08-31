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
 * THE PURCHASE DOOR IS THE ATTRIBUTION DOOR.
 *
 * `email-revenue-attribution.spec.ts` proves the join is right. This proves
 * it is REACHED, and reached from the one place every purchase in the product
 * announces itself — and, most importantly, that it is reached from OUTSIDE
 * the audience-band gate. A join wired inside that gate would silently lose a
 * Free org's revenue along with the contact record the band dropped, and
 * every test of the join itself would still be green.
 */

const attributeOrderToEmail = jest.fn(async () => null)
jest.mock('./email-revenue-attribution', () => ({
  __esModule: true,
  attributeOrderToEmail: (...args: unknown[]) =>
    (attributeOrderToEmail as any)(...args),
}))

const attributeCampaignConversion = jest.fn(async () => null)
jest.mock('./campaign-conversion-attribution', () => ({
  __esModule: true,
  attributeCampaignConversion: (...args: unknown[]) =>
    (attributeCampaignConversion as any)(...args),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (operand: number) => ({ __inc: operand }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
    delete: () => ({ __delete: true }),
  },
}))

const contacts: Record<string, Record<string, any>> = {}
let added: Record<string, any>[] = []
let quotaAllowed = true

const contactsRef = {
  where: () => ({
    limit: () => ({
      get: async () => ({
        empty: Object.keys(contacts).length === 0,
        docs: Object.entries(contacts).map(([id, data]) => ({
          id,
          get: (key: string) => data[key],
          ref: { set: async () => undefined },
        })),
      }),
    }),
  }),
  count: () => ({
    get: async () => ({ data: () => ({ count: Object.keys(contacts).length }) }),
  }),
  add: async (data: Record<string, any>) => {
    added.push(data)
    return { id: `auto-${added.length}` }
  },
}

/** Counter writes the band gate makes when it drops a contact. */
const droppedCounter: Record<string, unknown>[] = []

jest.mock('./firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({
                set: async (payload: Record<string, unknown>) => {
                  droppedCounter.push(payload)
                },
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

jest.mock('./organizations', () => ({
  // The real resolution, which for an org that declared nothing is the
  // group of one — the shape every case in this file exercises.
  consentGroupForSite: async (hostId: string) =>
    jest
      .requireActual('@aglyn/aglyn/app-utils/consent-groups')
      .soloConsentGroup(hostId),
  getOrgForHost: async () => ({ orgId: 'org1', org: { plan: 'free' } }),
  orgDataCollectionForHost: async () => contactsRef,
  scopedToHost: (ref: unknown) => ref,
}))

jest.mock('@aglyn/aglyn/server', () => {
  const contactsModule = jest.requireActual(
    '../../../../../../aglyn/src/lib/app-utils/contacts',
  )
  return {
    ...contactsModule,
    // The real consent and scope helpers. Reimplementing them here is the
    // unfaithful-double trap: a fake that wrote a basis at the top of the
    // document, or scoped a new contact org-wide, would pass this file while
    // shipping the leak.
    ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/consent-groups'),
    ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/marketing-consent'),
    ORG_SCOPE_TOKEN: 'org',
    checkContactQuota: () => ({ allowed: quotaAllowed }),
  }
})

import { upsertHostContact } from './upsert-contact'

describe('upsertHostContact reaches the revenue join', () => {
  beforeEach(() => {
    for (const key of Object.keys(contacts)) delete contacts[key]
    added = []
    droppedCounter.length = 0
    quotaAllowed = true
    attributeOrderToEmail.mockClear()
    attributeCampaignConversion.mockClear()
  })

  it('offers a purchase to the join, with the order it names', async () => {
    await upsertHostContact({
      hostId: 'h1',
      email: 'Buyer@Example.com',
      source: 'order',
      purchaseCents: 4_200,
      interaction: { refId: 'order_7', atMs: 1_700_000_000_000 },
    })

    expect(attributeOrderToEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        hostId: 'h1',
        orderId: 'order_7',
        // NORMALIZED, so the address hashes to the key the touch was filed
        // under. The raw form would hash differently and join to nobody.
        email: 'buyer@example.com',
        amountCents: 4_200,
        orderedAtMs: 1_700_000_000_000,
      }),
    )
  })

  it('offers it even when the audience band gate DROPS the contact', async () => {
    // A Free org past its included count. The sale still happened and the
    // buyer still clicked; the campaign must still be credited.
    quotaAllowed = false

    await upsertHostContact({
      hostId: 'h1',
      email: 'guest@example.com',
      source: 'order',
      purchaseCents: 4_200,
      interaction: { refId: 'order_7' },
    })

    expect(added).toEqual([])
    expect(droppedCounter.length).toBe(1)
    expect(attributeOrderToEmail).toHaveBeenCalledTimes(1)
  })

  it('passes a currency through when the door knows one', async () => {
    await upsertHostContact({
      hostId: 'h1',
      email: 'buyer@example.com',
      source: 'order',
      purchaseCents: 4_200,
      purchaseCurrency: 'eur',
      interaction: { refId: 'order_7' },
    })
    expect(attributeOrderToEmail).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'eur' }),
    )
  })

  it('does not offer a capture that is not a purchase', async () => {
    await upsertHostContact({
      hostId: 'h1',
      email: 'lead@example.com',
      source: 'form',
      interaction: { refId: 'form_1' },
    })
    expect(attributeOrderToEmail).not.toHaveBeenCalled()
  })

  it('does not offer an order that names nothing it could be filed under', async () => {
    await upsertHostContact({
      hostId: 'h1',
      email: 'buyer@example.com',
      source: 'order',
      purchaseCents: 4_200,
      interaction: { summary: 'Placed an order' },
    })
    expect(attributeOrderToEmail).not.toHaveBeenCalled()
  })

  it('does not offer a capture with no address at all', async () => {
    await upsertHostContact({
      hostId: 'h1',
      email: null,
      source: 'order',
      purchaseCents: 4_200,
      interaction: { refId: 'order_7' },
    })
    expect(attributeOrderToEmail).not.toHaveBeenCalled()
  })
})

/**
 * The OTHER door on this function — the identify moments an order does not
 * cover.
 *
 * The two joins share a function and must never share a conversion: an order
 * is credited by `attributeOrderToEmail`, keyed on the order id, and a second
 * record for the same sale would be one sale counted twice under two rules.
 */
describe('upsertHostContact reaches the conversion join', () => {
  const TOUCH = {
    channel: 'web' as const,
    campaign: 'sept-launch',
    touchedAtMs: 1_700_000_000_000,
  }

  beforeEach(() => {
    for (const key of Object.keys(contacts)) delete contacts[key]
    added = []
    droppedCounter.length = 0
    quotaAllowed = true
    attributeOrderToEmail.mockClear()
    attributeCampaignConversion.mockClear()
  })

  it('credits a NEW contact to the campaign the door resolved', async () => {
    await upsertHostContact({
      hostId: 'h1',
      email: 'visitor@example.com',
      source: 'form',
      interaction: { refId: 'form_1', atMs: 1_700_000_100_000 },
      campaignTouch: TOUCH,
    })

    expect(attributeCampaignConversion).toHaveBeenCalledWith(
      expect.objectContaining({
        hostId: 'h1',
        kind: 'contact',
        refId: 'auto-1',
        touch: TOUCH,
        convertedAtMs: 1_700_000_100_000,
      }),
    )
  })

  it('credits NOTHING when the door resolved no campaign', async () => {
    await upsertHostContact({
      hostId: 'h1',
      email: 'visitor@example.com',
      source: 'form',
      interaction: { refId: 'form_1' },
    })

    expect(added).toHaveLength(1)
    expect(attributeCampaignConversion).not.toHaveBeenCalled()
  })

  it('credits nothing for a person the site ALREADY held', async () => {
    contacts['c1'] = { email: 'visitor@example.com', interactions: [] }

    await upsertHostContact({
      hostId: 'h1',
      email: 'visitor@example.com',
      source: 'form',
      interaction: { refId: 'form_2' },
      campaignTouch: TOUCH,
    })

    // A returning visitor's capture is another visit, not a new person.
    // Crediting it would let whichever campaign ran most recently re-earn the
    // entire contact list.
    expect(added).toEqual([])
    expect(attributeCampaignConversion).not.toHaveBeenCalled()
  })

  it('credits nothing when the audience band gate DROPS the contact', async () => {
    // The deliberate opposite of the revenue join above, which is offered the
    // order from OUTSIDE this gate. Money is real whether or not a CRM record
    // was kept; a contact that was dropped does not exist, and reporting a
    // campaign as having produced people the customer cannot find anywhere in
    // the console would be a figure with nothing behind it.
    quotaAllowed = false

    await upsertHostContact({
      hostId: 'h1',
      email: 'visitor@example.com',
      source: 'form',
      interaction: { refId: 'form_1' },
      campaignTouch: TOUCH,
    })

    expect(added).toEqual([])
    expect(droppedCounter.length).toBe(1)
    expect(attributeCampaignConversion).not.toHaveBeenCalled()
  })
})
