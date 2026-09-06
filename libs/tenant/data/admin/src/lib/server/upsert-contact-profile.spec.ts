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
 * `upsertHostContact` carries a PROFILE now, and answers (AGL-2596).
 *
 * Three contracts, each of which the console's create route leans on:
 *
 *  1. THE PROFILE LANDS IN THE CAPTURING GROUP'S FACET, on create and on
 *     merge, normalized — a phone number is stored E.164 or not at all, a
 *     country code is upper-cased, a title is trimmed — and a merge writes
 *     the keys given and no others, so a door that knows only the phone
 *     number leaves the title another door wrote. The other holder's facet
 *     is never touched. The phone is echoed to the top of the document for
 *     the console's search, and nothing else is.
 *  2. THE ORDER DOOR MAKES A CUSTOMER, and never un-makes one. A purchase
 *     sets `customer` on a person with no stage or an earlier one, and leaves
 *     an `evangelist` alone. A form capture sets no stage at all.
 *  3. THE CALL SAYS WHAT IT DID. `created` and `merged` carry the id the
 *     route answers with; `refused` names the reason so the route can pick
 *     the status; the capture doors go on ignoring all of it.
 *
 * NO STRIPE PATH IS EXERCISED and no production data is read.
 */

import { upsertHostContact } from './upsert-contact'

jest.mock('./email-revenue-attribution', () => ({
  __esModule: true,
  attributeOrderToEmail: async () => null,
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (operand: number) => ({ __inc: operand }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
  },
}))

const contacts: Record<string, Record<string, any>> = {}
let added: Array<{ id: string; data: Record<string, any> }> = []
/** The band verdict the org gets — flipped by the one refusal case. */
let mockBandAllowed = true

/**
 * A merge-set as Firestore applies one: given keys only, nested maps
 * MERGED rather than replaced. The recursion is what makes the "other
 * holder's facet is untouched" assertions mean anything.
 */
function mergeApply(target: Record<string, any>, data: Record<string, any>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && '__inc' in value) {
      target[key] = (Number(target[key]) || 0) + (value as any).__inc
    } else if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !('__serverTimestamp' in value) &&
      !('__arrayUnion' in value)
    ) {
      target[key] = { ...(target[key] ?? {}) }
      mergeApply(target[key], value)
    } else if (value && typeof value === 'object' && '__arrayUnion' in value) {
      const current: unknown[] = Array.isArray(target[key]) ? target[key] : []
      for (const entry of (value as any).__arrayUnion) {
        if (!current.includes(entry)) current.push(entry)
      }
      target[key] = current
    } else {
      target[key] = value
    }
  }
}

const contactsRef = {
  where: (field: string, _op: string, wanted: unknown) => ({
    limit: () => ({
      get: async () => {
        const hits = Object.entries(contacts).filter(
          ([, data]) => data[field] === wanted,
        )
        return {
          empty: hits.length === 0,
          docs: hits.map(([id, data]) => ({
            id,
            get: (key: string) => data[key],
            data: () => data,
            ref: {
              set: async (
                payload: Record<string, any>,
                options?: { merge?: boolean },
              ) => {
                if (!options?.merge) throw new Error('expected merge set')
                mergeApply(data, payload)
              },
            },
          })),
        }
      },
    }),
  }),
  count: () => ({
    get: async () => ({ data: () => ({ count: Object.keys(contacts).length }) }),
  }),
  add: async (data: Record<string, any>) => {
    const id = `auto-${added.length + 1}`
    added.push({ id, data })
    return { id }
  },
}

jest.mock('./firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({ set: async () => undefined }),
            }),
          }),
        }),
      }),
    }),
  },
}))

/*
 * The records band is the contacts aggregate here — nothing seeds a
 * company or a deal — so the door's verdict is exactly what these cases
 * were written against. The three-collection sum has its own spec.
 */
jest.mock('./crm-records', () => ({
  countCrmRecords: async (_orgRef: unknown, contacts: any) => {
    const contactsCount = (await contacts.count().get()).data().count
    return {
      contactsCount,
      companiesCount: 0,
      dealsCount: 0,
      crmRecordsCount: contactsCount,
    }
  },
}))

jest.mock('./organizations', () => ({
  consentGroupForSite: async (hostId: string) =>
    jest
      .requireActual('@aglyn/aglyn/app-utils/consent-groups')
      .soloConsentGroup(hostId),
  getOrgForHost: async () => ({ orgId: 'org1', org: { plan: 'starter' } }),
  orgDataCollectionForHost: async () => contactsRef,
  scopedToHost: (ref: unknown) => ref,
}))

jest.mock('@aglyn/aglyn/server', () => {
  const contactsModule = jest.requireActual(
    '../../../../../../aglyn/src/lib/app-utils/contacts',
  )
  return {
    ...contactsModule,
    ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/consent-groups'),
    ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/marketing-consent'),
    ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/campaign-membership'),
    ORG_SCOPE_TOKEN: 'org',
    checkCrmRecordsQuota: () => ({ allowed: mockBandAllowed }),
  }
})

const facet = (id: string, groupId = 'h1') =>
  contacts[id]?.facets?.[groupId] ?? {}

/** A person two sites hold, each with a profile of its own. */
function seedSharedContact() {
  contacts['c1'] = {
    email: 'jo@example.com',
    name: 'Jo',
    visibleTo: ['host:h1', 'host:h2'],
    capturedByHostIds: ['h1', 'h2'],
    facets: {
      h1: {
        sources: { form: true },
        interactions: [],
        tags: [],
        jobTitle: 'Buyer',
        lifecycleStage: 'lead',
      },
      h2: {
        sources: { form: true },
        interactions: [],
        tags: [],
        phone: '+15125550199',
        jobTitle: 'Other holder title',
        lifecycleStage: 'evangelist',
      },
    },
  }
}

beforeEach(() => {
  for (const key of Object.keys(contacts)) delete contacts[key]
  added = []
  mockBandAllowed = true
})

describe('the profile on a create', () => {
  it('lands in the capturing facet, normalized, with the phone echoed up', async () => {
    const result = await upsertHostContact({
      hostId: 'h1',
      email: 'New@Example.com',
      name: 'New Person',
      source: 'manual',
      interaction: { summary: 'Added by hand' },
      facet: {
        phone: '(512) 555-0107',
        jobTitle: '  Head of Ops  ',
        address: { line1: ' 1 Main St ', city: 'Austin', country: 'us' },
        ownerUid: 'owner-1',
        lifecycleStage: 'sales-qualified',
      },
    })

    expect(result).toEqual({ contactId: 'auto-1', created: true })
    const written = added[0].data
    expect(written.facets.h1).toEqual(
      expect.objectContaining({
        phone: '+15125550107',
        jobTitle: 'Head of Ops',
        address: { line1: '1 Main St', city: 'Austin', country: 'US' },
        ownerUid: 'owner-1',
        lifecycleStage: 'sales-qualified',
      }),
    )
    // The search key, and ONLY the search key: the title and the owner are
    // one holder's business and stay inside the facet.
    expect(written.phone).toBe('+15125550107')
    expect(written.jobTitle).toBeUndefined()
    expect(written.ownerUid).toBeUndefined()
  })

  it('drops what it cannot normalize rather than storing it', async () => {
    await upsertHostContact({
      hostId: 'h1',
      email: 'new@example.com',
      source: 'manual',
      interaction: { summary: 'Added by hand' },
      facet: {
        phone: 'call me',
        jobTitle: '   ',
        address: { line1: '  ' },
        lifecycleStage: 'vip' as never,
      },
    })

    const written = added[0].data
    expect(written.facets.h1).not.toHaveProperty('phone')
    expect(written.facets.h1).not.toHaveProperty('jobTitle')
    expect(written.facets.h1).not.toHaveProperty('address')
    expect(written.facets.h1).not.toHaveProperty('lifecycleStage')
    expect(written).not.toHaveProperty('phone')
  })

  it('keeps only the custom values a field definition could hold', async () => {
    await upsertHostContact({
      hostId: 'h1',
      email: 'new@example.com',
      source: 'import',
      interaction: { summary: 'Imported' },
      facet: {
        custom: {
          annual_revenue: 120000,
          region: 'EMEA',
          renewed: true,
          churn_reason: null,
          // Not a key a definition can have: a dot reads as a path.
          'bad.key': 'x',
          // Not a value a field type holds.
          nested: { deep: true } as never,
        },
      },
    })

    expect(added[0].data.facets.h1.custom).toEqual({
      annual_revenue: 120000,
      region: 'EMEA',
      renewed: true,
      churn_reason: null,
    })
  })

  it('sets no stage at all on a capture that carries none', async () => {
    await upsertHostContact({
      hostId: 'h1',
      email: 'form@example.com',
      source: 'form',
      interaction: { summary: 'Submitted the contact form' },
    })

    expect(added[0].data.facets.h1).not.toHaveProperty('lifecycleStage')
  })
})

describe('the profile on a merge', () => {
  it("writes the keys given into THIS holder's facet and no other", async () => {
    seedSharedContact()

    const result = await upsertHostContact({
      hostId: 'h1',
      email: 'jo@example.com',
      source: 'manual',
      interaction: { summary: 'Added by hand' },
      facet: { phone: '512-555-0100', ownerUid: 'owner-2' },
    })

    expect(result).toEqual({ contactId: 'c1', created: false })
    // What was given arrived; what was not is exactly as it was.
    expect(facet('c1').phone).toBe('+15125550100')
    expect(facet('c1').ownerUid).toBe('owner-2')
    expect(facet('c1').jobTitle).toBe('Buyer')
    expect(facet('c1').lifecycleStage).toBe('lead')
    // The other holder's profile is untouched, including its phone number.
    expect(facet('c1', 'h2')).toEqual(
      expect.objectContaining({
        phone: '+15125550199',
        jobTitle: 'Other holder title',
        lifecycleStage: 'evangelist',
      }),
    )
    expect(contacts['c1'].phone).toBe('+15125550100')
  })
})

describe('the order door and the lifecycle stage', () => {
  const purchase = (hostId: string) =>
    upsertHostContact({
      hostId,
      email: 'jo@example.com',
      source: 'order',
      interaction: { refId: 'order-1', summary: 'Placed order' },
      purchaseCents: 4200,
      initialLifecycleStage: 'customer',
    })

  it('makes a customer of a lead', async () => {
    seedSharedContact()
    await purchase('h1')
    expect(facet('c1').lifecycleStage).toBe('customer')
  })

  it('makes a customer of somebody with no stage', async () => {
    seedSharedContact()
    delete contacts['c1'].facets.h1.lifecycleStage
    await purchase('h1')
    expect(facet('c1').lifecycleStage).toBe('customer')
  })

  it('never downgrades an evangelist', async () => {
    seedSharedContact()
    await purchase('h2')
    expect(facet('c1', 'h2').lifecycleStage).toBe('evangelist')
    // And the sibling holder's lead is still a lead: a sale on one site is
    // not a sale on the other.
    expect(facet('c1').lifecycleStage).toBe('lead')
  })

  it('creates a customer outright on a first purchase', async () => {
    await purchase('h1')
    expect(added[0].data.facets.h1.lifecycleStage).toBe('customer')
  })
})

/**
 * Every capture door names the earliest stage that describes what happened
 * (AGL-2612), and the write only ever fills or advances.
 */
describe('the capture stage', () => {
  const capture = (
    stage: 'lead' | 'subscriber' | 'customer' | undefined,
    facet?: { lifecycleStage: 'subscriber' | 'lead' | 'customer' },
  ) =>
    upsertHostContact({
      hostId: 'h1',
      email: 'jo@example.com',
      source: 'form',
      interaction: { refId: 's1', summary: 'Submitted the contact form' },
      ...(stage ? { initialLifecycleStage: stage } : {}),
      ...(facet ? { facet } : {}),
    })

  it('fills an empty stage on a merge', async () => {
    seedSharedContact()
    delete contacts['c1'].facets.h1.lifecycleStage
    await capture('lead')
    expect(facet('c1').lifecycleStage).toBe('lead')
    // The sibling holder's stage is its own business.
    expect(facet('c1', 'h2').lifecycleStage).toBe('evangelist')
  })

  it('advances an earlier stage: a subscriber who submits a form is a lead', async () => {
    seedSharedContact()
    contacts['c1'].facets.h1.lifecycleStage = 'subscriber'
    await capture('lead')
    expect(facet('c1').lifecycleStage).toBe('lead')
  })

  it('never downgrades: a customer who submits a form is still a customer', async () => {
    seedSharedContact()
    contacts['c1'].facets.h1.lifecycleStage = 'customer'
    await capture('lead')
    expect(facet('c1').lifecycleStage).toBe('customer')
    // Nor does a newsletter opt-in make a subscriber of a lead.
    contacts['c1'].facets.h1.lifecycleStage = 'lead'
    await capture('subscriber')
    expect(facet('c1').lifecycleStage).toBe('lead')
  })

  it('leaves the key absent when the door named no stage and none was held', async () => {
    seedSharedContact()
    delete contacts['c1'].facets.h1.lifecycleStage
    await capture(undefined)
    expect(facet('c1')).not.toHaveProperty('lifecycleStage')
  })

  it("is the caller's stage on a SET, floored by the door's", async () => {
    seedSharedContact()
    contacts['c1'].facets.h1.lifecycleStage = 'customer'
    // An import that says "subscriber" is a set, and it lands: the file is
    // the merchant's own word.
    await capture(undefined, { lifecycleStage: 'subscriber' })
    expect(facet('c1').lifecycleStage).toBe('subscriber')
    // A door that carries both writes the set, then floors it.
    await capture('lead', { lifecycleStage: 'subscriber' })
    expect(facet('c1').lifecycleStage).toBe('lead')
  })

  it('writes the stage on a create and tells the hook about it', async () => {
    const created: Array<Record<string, unknown>> = []
    await upsertHostContact({
      hostId: 'h1',
      email: 'new@example.com',
      source: 'newsletter',
      interaction: { summary: 'Subscribed' },
      initialLifecycleStage: 'subscriber',
      onCreated: (report) => {
        created.push(report as unknown as Record<string, unknown>)
      },
    })
    expect(added[0].data.facets.h1.lifecycleStage).toBe('subscriber')
    expect(created[0]['lifecycleStage']).toBe('subscriber')
  })

  it('tells the hook nothing about a stage the create did not write', async () => {
    const created: Array<Record<string, unknown>> = []
    await upsertHostContact({
      hostId: 'h1',
      email: 'new@example.com',
      source: 'manual',
      interaction: { summary: 'Added by hand' },
      onCreated: (report) => {
        created.push(report as unknown as Record<string, unknown>)
      },
    })
    expect(added[0].data.facets.h1).not.toHaveProperty('lifecycleStage')
    expect(created[0]).not.toHaveProperty('lifecycleStage')
  })
})

/**
 * The form mirror (`HostContact.formIds`): the one top-level array a form's
 * contact list can query, kept in step with the interaction that is the
 * record of the entry point.
 */
describe('the form mirror', () => {
  const submit = (formId: string | undefined, email = 'jo@example.com') =>
    upsertHostContact({
      hostId: 'h1',
      email,
      source: 'form',
      interaction: {
        refId: 's1',
        summary: 'Submitted',
        ...(formId ? { formId } : {}),
      },
      initialLifecycleStage: 'lead',
    })

  it('starts the mirror on a create, and only for a capture that names a form', async () => {
    await submit('form-a', 'new@example.com')
    expect(added[0].data.formIds).toEqual(['form-a'])
    await submit(undefined, 'other@example.com')
    expect(added[1].data).not.toHaveProperty('formIds')
  })

  it('unions a new form onto a merge and never repeats one', async () => {
    seedSharedContact()
    await submit('form-a')
    await submit('form-b')
    await submit('form-a')
    expect(contacts['c1'].formIds).toEqual(['form-a', 'form-b'])
  })

  it('stops at the cap rather than dropping an earlier form', async () => {
    seedSharedContact()
    contacts['c1'].formIds = Array.from({ length: 20 }, (_, i) => `form-${i}`)
    await submit('form-late')
    expect(contacts['c1'].formIds).toHaveLength(20)
    expect(contacts['c1'].formIds).not.toContain('form-late')
    // The interaction still carries the entry point: the timeline is the
    // record and the mirror is only its index.
    expect(facet('c1').interactions[0].formId).toBe('form-late')
    // A form already in the mirror is still recognized at the cap.
    await submit('form-3')
    expect(contacts['c1'].formIds).toHaveLength(20)
  })
})

describe('what the call answers', () => {
  it('refuses an address that is not one, writing nothing', async () => {
    const result = await upsertHostContact({
      hostId: 'h1',
      email: 'not an address',
      source: 'manual',
      interaction: { summary: 'Added by hand' },
    })
    expect(result).toEqual({ refused: 'invalid-email' })
    expect(added).toHaveLength(0)
  })

  it('refuses at the band, and says that is why', async () => {
    mockBandAllowed = false
    const result = await upsertHostContact({
      hostId: 'h1',
      email: 'new@example.com',
      source: 'manual',
      interaction: { summary: 'Added by hand' },
    })
    expect(result).toEqual({ refused: 'band' })
    expect(added).toHaveLength(0)
  })

  it('still merges at the band: an existing person is not a new record', async () => {
    mockBandAllowed = false
    seedSharedContact()
    const result = await upsertHostContact({
      hostId: 'h1',
      email: 'jo@example.com',
      source: 'manual',
      interaction: { summary: 'Added by hand' },
    })
    expect(result).toEqual({ contactId: 'c1', created: false })
  })
})
