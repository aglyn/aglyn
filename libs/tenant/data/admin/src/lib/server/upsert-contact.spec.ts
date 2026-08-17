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
 * `upsertHostContact`'s RFM branch for an EXISTING contact.
 *
 * The defect this pins was found empirically by the AGL-1753 backfill dry
 * run: the production e2e contact carried `ltvCents` and `lastPurchaseAtMs`
 * but NO `firstPurchaseAtMs`, because only the CREATE path ever wrote it. A
 * lead captured by a form who later buys is exactly the customer RFM is
 * for, and their recency anchor was permanently absent.
 */

import { upsertHostContact } from './upsert-contact'

// Faithful increment semantics: the fake applies `{ __inc }` the way the
// Admin SDK applies `FieldValue.increment` — add to the stored number, or
// start from the operand when the field is absent. An unfaithful fake here
// would hide exactly the compounding the AGL-1745/1752 issues warn about.
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (operand: number) => ({ __inc: operand }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
  },
}))

const contacts: Record<string, Record<string, any>> = {}
let added: Record<string, any>[] = []

/** Applies a merge-set the way Firestore does: given keys only, increments applied. */
function mergeApply(target: Record<string, any>, data: Record<string, any>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && '__inc' in value) {
      target[key] = (Number(target[key]) || 0) + (value as any).__inc
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
    added.push(data)
    return { id: `auto-${added.length}` }
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

jest.mock('./organizations', () => ({
  getOrgForHost: async () => ({ orgId: 'org1', org: { plan: 'starter' } }),
  orgDataCollectionForHost: async () => contactsRef,
  scopedToHost: (ref: unknown) => ref,
}))

jest.mock('@aglyn/aglyn/server', () => {
  // The pure contact helpers are the real ones — a reimplementation here
  // would be the unfaithful-double trap (normalization or the interaction
  // cap drifting from production without a red).
  const contactsModule = jest.requireActual(
    '../../../../../../aglyn/src/lib/app-utils/contacts',
  )
  return {
    ...contactsModule,
    ORG_SCOPE_TOKEN: 'org',
    checkContactQuota: () => ({ allowed: true }),
  }
})

describe('upsertHostContact RFM fields on an existing contact', () => {
  beforeEach(() => {
    for (const key of Object.keys(contacts)) delete contacts[key]
    added = []
  })

  it('sets firstPurchaseAtMs when a pre-existing contact makes their FIRST purchase', async () => {
    // A lead captured by a form: contact exists, has never bought.
    contacts['c1'] = { email: 'lead@example.com', sources: { form: true }, interactions: [] }
    await upsertHostContact({
      hostId: 'h1',
      email: 'Lead@Example.com',
      source: 'order',
      purchaseCents: 1800,
      interaction: { refId: 'o1', summary: 'Placed an order' },
    })
    expect(contacts['c1'].ltvCents).toBe(1800)
    expect(contacts['c1'].ordersCount).toBe(1)
    expect(contacts['c1'].lastPurchaseAtMs).toEqual(expect.any(Number))
    // The red before the fix: this field stayed absent forever.
    expect(contacts['c1'].firstPurchaseAtMs).toEqual(expect.any(Number))
  })

  it('never moves firstPurchaseAtMs on a later purchase', async () => {
    contacts['c1'] = {
      email: 'buyer@example.com',
      sources: { order: true },
      interactions: [],
      ltvCents: 1000,
      ordersCount: 1,
      firstPurchaseAtMs: 111,
      lastPurchaseAtMs: 111,
    }
    await upsertHostContact({
      hostId: 'h1',
      email: 'buyer@example.com',
      source: 'order',
      purchaseCents: 2500,
      interaction: { refId: 'o2', summary: 'Placed an order' },
    })
    expect(contacts['c1'].firstPurchaseAtMs).toBe(111) // anchored
    expect(contacts['c1'].ltvCents).toBe(3500) // increment applied for real
    expect(contacts['c1'].ordersCount).toBe(2)
    expect(contacts['c1'].lastPurchaseAtMs).toBeGreaterThan(111)
  })

  it('leaves every RFM field untouched when there is no purchase', async () => {
    contacts['c1'] = { email: 'lead@example.com', sources: { form: true }, interactions: [] }
    await upsertHostContact({
      hostId: 'h1',
      email: 'lead@example.com',
      source: 'form',
      interaction: { refId: 'f1', summary: 'Submitted a form' },
    })
    expect(contacts['c1'].ltvCents).toBeUndefined()
    expect(contacts['c1'].firstPurchaseAtMs).toBeUndefined()
    expect(contacts['c1'].lastPurchaseAtMs).toBeUndefined()
  })
})
