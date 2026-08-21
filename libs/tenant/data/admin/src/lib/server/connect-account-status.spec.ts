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
                .map(([id, data]) => {
                  // Real semantics: a QueryDocumentSnapshot carries a FROZEN
                  // copy of the document as it was when the query ran, and
                  // `get(field)` reads that copy — not the live document. The
                  // snapshot is what the transition check must read, so a
                  // double that proxied to the store would hide a bug where
                  // the code read back its own write and saw no transition.
                  const snapshot = { ...data }
                  return {
                    ref: docRef(collection, id),
                    get: (path: string) => snapshot[path],
                    data: () => ({ ...snapshot }),
                  }
                })
              return { docs, size: docs.length, empty: docs.length === 0 }
            },
          }),
        }),
      }),
    }),
  },
}))

const sendGa4StripeConnected = jest.fn(async () => ({
  sent: true,
  synthesizedClientId: true,
}))

jest.mock('./ga4-measurement-protocol', () => ({
  sendGa4StripeConnected: (...args: unknown[]) =>
    sendGa4StripeConnected(...(args as [])),
}))

import { syncConnectAccountStatus } from './connect-account-status'

const read = (collection: string, id: string) => store.get(collection)?.get(id)

beforeEach(() => {
  sendGa4StripeConnected.mockClear()
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

  // -------------------------------------------------------------------------
  // Which Stripe world the account is in (AGL-2471)
  // -------------------------------------------------------------------------

  it('records the mode the EVENT states', async () => {
    // This is the self-healing path for the three production linkages whose
    // mode was never recorded: one `account.updated` and they are verified,
    // with nobody editing the database by hand.
    expect(
      await syncConnectAccountStatus(
        'profiles',
        { id: 'acct_1', charges_enabled: true, payouts_enabled: true },
        true,
      ),
    ).toBe(1)
    expect(read('profiles', 'merchant-1')).toMatchObject({
      stripeAccountLivemode: true,
    })
  })

  it('records a TEST-mode event as test, not as absent', async () => {
    await syncConnectAccountStatus(
      'profiles',
      { id: 'acct_1', charges_enabled: true, payouts_enabled: true },
      false,
    )
    expect(read('profiles', 'merchant-1')).toMatchObject({
      stripeAccountLivemode: false,
    })
  })

  it('writes nothing for the field when the mode is not a boolean', async () => {
    // Same doctrine as the two flags above: only what Stripe actually said.
    // Coercing `undefined` here would mint a `false` and pin a live merchant
    // as test-mode — a wrong answer invented from no evidence.
    for (const value of [undefined, 'true', 1, null]) {
      await syncConnectAccountStatus(
        'profiles',
        { id: 'acct_1', charges_enabled: true, payouts_enabled: true },
        value,
      )
      expect(read('profiles', 'merchant-1')).not.toHaveProperty(
        'stripeAccountLivemode',
      )
    }
  })
})

/**
 * AGL-1580: `stripe_connected` is one of the four launch key events, and GA4
 * refuses to mark an event as a key event until it has been seen once — so an
 * event that cannot fire is indistinguishable from one nobody has triggered
 * yet, and blocks the Ads conversion import behind it.
 *
 * Both browser emitters gate on the merchant's profile still reading "not
 * connected" at click time. THIS webhook is what makes that reading false: it
 * lands while the merchant is still on Stripe's hosted onboarding. The two
 * guards read the same stored flag from opposite sides, so exactly one of them
 * can be open for any given account.
 */
describe('syncConnectAccountStatus → stripe_connected (AGL-1580)', () => {
  it('reports the activation when a never-asked profile becomes able to charge', async () => {
    // `merchant-2` has NO `stripeChargesEnabled` field at all, which is the
    // commonest first-connect shape: nobody has ever asked Stripe about it.
    const updated = await syncConnectAccountStatus('profiles', {
      id: 'acct_2',
      charges_enabled: true,
      payouts_enabled: false,
    })
    expect(updated).toBe(1)
    expect(sendGa4StripeConnected).toHaveBeenCalledTimes(1)
    // Seeded with the ACCOUNT, so one connected account is one synthetic user
    // however many times it reconnects.
    expect(sendGa4StripeConnected).toHaveBeenCalledWith({ accountId: 'acct_2' })
  })

  it('reports the activation on a false → true flip', async () => {
    store.get('profiles')?.set('merchant-1', {
      stripeAccountId: 'acct_1',
      stripeChargesEnabled: false,
    })
    await syncConnectAccountStatus('profiles', {
      id: 'acct_1',
      charges_enabled: true,
    })
    expect(sendGa4StripeConnected).toHaveBeenCalledTimes(1)
  })

  it('stays silent on a redelivery of an account already connected', async () => {
    // `merchant-1` is seeded `stripeChargesEnabled: true`. Stripe redelivers
    // freely and `account.updated` mirrors current state rather than a delta,
    // so "already true" is the ordinary case — and it is also the case where
    // the merchant clicked first and the BROWSER already reported it.
    await syncConnectAccountStatus('profiles', {
      id: 'acct_1',
      charges_enabled: true,
      payouts_enabled: true,
    })
    expect(sendGa4StripeConnected).not.toHaveBeenCalled()
  })

  it('stays silent when the account is restricted rather than enabled', async () => {
    // `merchant-2` has never been connected, so the PRIOR-state half of the
    // guard is open and only the `=== true` half can hold this shut. Written
    // against `acct_1` (already `true`) it would pass with that half deleted —
    // proved by mutation, not assumed.
    await syncConnectAccountStatus('profiles', {
      id: 'acct_2',
      charges_enabled: false,
    })
    expect(sendGa4StripeConnected).not.toHaveBeenCalled()
  })

  it('stays silent when only payout readiness moved', async () => {
    // AGL-1997 split the two flags: payouts can be released days later and
    // that is not a second activation.
    store.get('profiles')?.set('merchant-1', {
      stripeAccountId: 'acct_1',
      stripeChargesEnabled: true,
      stripePayoutsEnabled: false,
    })
    await syncConnectAccountStatus('profiles', {
      id: 'acct_1',
      payouts_enabled: true,
    })
    expect(sendGa4StripeConnected).not.toHaveBeenCalled()
  })

  it('does not report an activation for a document erased mid-flight', async () => {
    // The query saw it, the erasure sweep removed it, `updateExisting`
    // reports 0 — and a merchant who no longer exists did not activate.
    const docs = store.get('profiles')
    const queried = syncConnectAccountStatus('profiles', {
      id: 'acct_2',
      charges_enabled: true,
    })
    docs?.delete('merchant-2')
    expect(await queried).toBe(0)
    expect(sendGa4StripeConnected).not.toHaveBeenCalled()
  })

  it('reports for a marketplace publisher too', async () => {
    // Same function, `publisherProfiles` — the seller panel's emitter is
    // gated identically and loses the same race.
    store.set(
      'publisherProfiles',
      new Map([['seller-org', { stripeAccountId: 'acct_9' }]]),
    )
    await syncConnectAccountStatus('publisherProfiles', {
      id: 'acct_9',
      charges_enabled: true,
    })
    expect(sendGa4StripeConnected).toHaveBeenCalledWith({ accountId: 'acct_9' })
  })
})
