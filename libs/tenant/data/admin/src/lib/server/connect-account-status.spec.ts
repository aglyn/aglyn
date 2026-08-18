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
 * AGL-1997: `account.updated` is what keeps the cached readiness flags every
 * money route gates on from going stale.
 *
 * The Firestore double models the behaviours this depends on exactly (the
 * test-double rule): `update()` REJECTS with gRPC NOT_FOUND on a missing
 * document rather than creating one, and `where(...).get()` returns only
 * matching docs.
 */

const store = new Map<string, Map<string, Record<string, unknown>>>()

class NotFound extends Error {
  code = 5
}

function docRef(collection: string, id: string) {
  return {
    id,
    path: `${collection}/${id}`,
    async update(data: Record<string, unknown>) {
      const docs = store.get(collection)
      const existing = docs?.get(id)
      // Real semantics: update() on a missing document rejects. A merge-set
      // would have created one — which is the phantom this must not mint.
      if (!existing) throw new NotFound(`no document at ${collection}/${id}`)
      docs?.set(id, { ...existing, ...data })
    },
  }
}

jest.mock('./firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (collection: string) => ({
          where: (field: string, op: string, value: unknown) => ({
            get: async () => {
              if (op !== '==') throw new Error(`unmodelled operator ${op}`)
              const docs = [...(store.get(collection)?.entries() ?? [])]
                .filter(([, data]) => data[field] === value)
                .map(([id]) => ({ ref: docRef(collection, id) }))
              return { docs, size: docs.length, empty: docs.length === 0 }
            },
          }),
        }),
      }),
    }),
  },
}))

import { syncConnectAccountStatus } from './connect-account-status'

const read = (collection: string, id: string) => store.get(collection)?.get(id)

beforeEach(() => {
  store.clear()
  store.set(
    'profiles',
    new Map([
      ['merchant-1', { stripeAccountId: 'acct_1', stripeChargesEnabled: true }],
      ['merchant-2', { stripeAccountId: 'acct_2' }],
      ['no-stripe', {}],
    ]),
  )
})

describe('syncConnectAccountStatus (AGL-1997)', () => {
  it('turns a restricted merchant OFF on account.updated', async () => {
    // The fail-open this closes: Stripe restricts the account, and until now
    // `stripeChargesEnabled` stayed `true` until the merchant happened to
    // reopen the connect route. Every money route gates on that field.
    const updated = await syncConnectAccountStatus('profiles', {
      id: 'acct_1',
      charges_enabled: false,
      payouts_enabled: false,
    })
    expect(updated).toBe(1)
    expect(read('profiles', 'merchant-1')).toMatchObject({
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
    })
  })

  // Positive control: the sync must also be able to turn readiness ON, or it
  // is a kill switch rather than a mirror — a merchant who completes
  // verification would stay locked out until they revisited the console.
  it('turns a merchant who becomes ready back ON', async () => {
    store.get('profiles')?.set('merchant-1', {
      stripeAccountId: 'acct_1',
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
    })
    const updated = await syncConnectAccountStatus('profiles', {
      id: 'acct_1',
      charges_enabled: true,
      payouts_enabled: true,
    })
    expect(updated).toBe(1)
    expect(read('profiles', 'merchant-1')).toMatchObject({
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    })
  })

  it('writes only the flags the payload actually states', async () => {
    // Coercing an absent field would invent an answer. `Boolean(undefined)`
    // is `false`, which would lock out a working merchant on any event whose
    // payload omits the field.
    const updated = await syncConnectAccountStatus('profiles', {
      id: 'acct_1',
      payouts_enabled: false,
    })
    expect(updated).toBe(1)
    const doc = read('profiles', 'merchant-1')
    expect(doc?.['stripePayoutsEnabled']).toBe(false)
    // Untouched, not clobbered to false.
    expect(doc?.['stripeChargesEnabled']).toBe(true)
  })

  it('writes nothing at all when the payload states neither flag', async () => {
    const updated = await syncConnectAccountStatus('profiles', {
      id: 'acct_1',
    })
    expect(updated).toBe(0)
    expect(read('profiles', 'merchant-1')).toEqual({
      stripeAccountId: 'acct_1',
      stripeChargesEnabled: true,
    })
  })

  it('touches only the document bound to that account', async () => {
    await syncConnectAccountStatus('profiles', {
      id: 'acct_2',
      charges_enabled: true,
      payouts_enabled: true,
    })
    expect(read('profiles', 'merchant-2')).toMatchObject({
      stripeChargesEnabled: true,
    })
    // merchant-1 is a different account and must be untouched.
    expect(read('profiles', 'merchant-1')).toEqual({
      stripeAccountId: 'acct_1',
      stripeChargesEnabled: true,
    })
  })

  it('is a no-op for an account no document binds', async () => {
    const updated = await syncConnectAccountStatus('profiles', {
      id: 'acct_unknown',
      charges_enabled: false,
      payouts_enabled: false,
    })
    expect(updated).toBe(0)
    // The collection is unchanged — a stranger's account cannot disable ours.
    expect(read('profiles', 'merchant-1')).toEqual({
      stripeAccountId: 'acct_1',
      stripeChargesEnabled: true,
    })
  })

  it('ignores an event carrying no account id', async () => {
    expect(
      await syncConnectAccountStatus('profiles', {
        charges_enabled: false,
      }),
    ).toBe(0)
    expect(await syncConnectAccountStatus('profiles', null)).toBe(0)
  })

  it('does not resurrect a document erased mid-flight', async () => {
    // The query saw it; the erasure sweep removed it before the write. A
    // merge-set would re-create it holding two payout booleans and nothing
    // else. `updateExisting` reports 0 instead.
    const docs = store.get('profiles')
    const queried = syncConnectAccountStatus('profiles', {
      id: 'acct_1',
      charges_enabled: false,
      payouts_enabled: false,
    })
    docs?.delete('merchant-1')
    expect(await queried).toBe(0)
    expect(read('profiles', 'merchant-1')).toBeUndefined()
  })

  it('syncs whichever collection it is pointed at', async () => {
    // The publisher twin: same function, `publisherProfiles`.
    store.set(
      'publisherProfiles',
      new Map([['seller-org', { stripeAccountId: 'acct_9' }]]),
    )
    const updated = await syncConnectAccountStatus('publisherProfiles', {
      id: 'acct_9',
      charges_enabled: true,
      payouts_enabled: false,
    })
    expect(updated).toBe(1)
    expect(read('publisherProfiles', 'seller-org')).toMatchObject({
      stripeChargesEnabled: true,
      stripePayoutsEnabled: false,
    })
  })
})
