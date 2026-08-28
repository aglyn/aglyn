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
 * A payout that never landed leaves a record (AGL-2513).
 *
 * Nothing handled `payout.failed` or `transfer.failed`, so the money stopped
 * moving and no side could tell: the merchant's storefront still looked
 * healthy, the publisher's ledger still asserted the transfer had arrived, and
 * Aglyn held nothing to reconcile against.
 *
 * Asserted on the RECORDED STATE — the documents written — never on anything
 * rendered. The two writes answer different questions and are checked apart:
 * the history exists so somebody can ask "has this account failed before", and
 * the profile mirror exists so the surfaces the merchant already reads can say
 * so without opening a second collection.
 */

const docs = new Map<string, Record<string, unknown>>()
const DELETE = Symbol('delete')

function applyFieldValues(
  existing: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
) {
  const next = { ...(existing ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === DELETE) {
      delete next[key]
    } else if (
      value &&
      typeof value === 'object' &&
      (value as { __arrayUnion?: unknown[] }).__arrayUnion
    ) {
      const before = Array.isArray(next[key]) ? (next[key] as unknown[]) : []
      const added = (value as { __arrayUnion: unknown[] }).__arrayUnion.filter(
        (item) => !before.includes(item),
      )
      next[key] = [...before, ...added]
    } else {
      next[key] = value
    }
  }
  return next
}

/** A DocumentReference: what `collection().doc()` hands back. */
function makeRef(path: string) {
  return {
    path,
    id: path.split('/').pop() as string,
    set: async (
      value: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      docs.set(
        path,
        options?.merge ? applyFieldValues(docs.get(path), value) : value,
      )
    },
    update: async (value: Record<string, unknown>) => {
      // `update()` REJECTS a missing document — the property `updateExisting`
      // relies on to avoid resurrecting an erased profile as a stub.
      if (!docs.has(path)) {
        const error = new Error('missing') as Error & { code: number }
        error.code = 5
        throw error
      }
      docs.set(path, applyFieldValues(docs.get(path), value))
    },
  }
}

/** A DocumentSnapshot: what a query hands back. */
function makeSnap(path: string) {
  return {
    id: path.split('/').pop() as string,
    ref: makeRef(path),
    get: (field: string) => docs.get(path)?.[field],
    data: () => docs.get(path),
    exists: docs.has(path),
  }
}

jest.mock('./firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => makeRef(`${name}/${id}`),
          where: (_field: string, _op: string, value: unknown) => ({
            get: async () => ({
              docs: [...docs.keys()]
                .filter(
                  (key) =>
                    key.startsWith(`${name}/`) &&
                    key.split('/').length === 2 &&
                    docs.get(key)?.['stripeAccountId'] === value,
                )
                .map((key) => makeSnap(key)),
            }),
          }),
        }),
      }),
    }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => 'SERVER_TIME',
        delete: () => DELETE,
        arrayUnion: (...items: unknown[]) => ({ __arrayUnion: items }),
      },
    },
  },
}))

import {
  clearConnectPayoutFailure,
  recordConnectPayoutFailure,
} from './connect-payout-failure'

const payout = {
  id: 'po_1',
  amount: 42_000,
  currency: 'usd',
  failure_code: 'account_closed',
  failure_message: 'The bank account has been closed.',
}

beforeEach(() => {
  docs.clear()
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_1',
    stripeChargesEnabled: true,
  })
})

describe('recordConnectPayoutFailure (AGL-2513)', () => {
  it('writes the history record Aglyn had nothing of', async () => {
    await recordConnectPayoutFailure('profiles', {
      kind: 'payout',
      object: payout,
      accountId: 'acct_1',
      livemode: true,
    })

    expect(docs.get('connectPayoutFailures/po_1')).toMatchObject({
      kind: 'payout',
      accountId: 'acct_1',
      amountCents: 42_000,
      failureCode: 'account_closed',
      reason: 'The bank account has been closed.',
      livemode: true,
      boundProfiles: ['profiles/owner-1'],
    })
  })

  it('mirrors the latest failure onto the profile the surfaces already read', async () => {
    await recordConnectPayoutFailure('profiles', {
      kind: 'payout',
      object: payout,
      accountId: 'acct_1',
    })

    expect(docs.get('profiles/owner-1')).toMatchObject({
      lastPayoutFailureId: 'po_1',
      lastPayoutFailureCents: 42_000,
      lastPayoutFailureReason: 'The bank account has been closed.',
    })
    // The mirror must not clobber the document it lands on.
    expect(docs.get('profiles/owner-1')).toMatchObject({
      stripeChargesEnabled: true,
    })
  })

  it('records a failure for an account NOBODY binds', async () => {
    // The case with the least visibility and the most need of a written
    // trace. Making the history conditional on a successful join would lose
    // exactly the failures nobody could otherwise explain.
    const mirrored = await recordConnectPayoutFailure('profiles', {
      kind: 'transfer',
      object: { ...payout, id: 'tr_9' },
      accountId: 'acct_unknown',
    })

    expect(mirrored).toBe(0)
    expect(docs.get('connectPayoutFailures/tr_9')).toMatchObject({
      accountId: 'acct_unknown',
      kind: 'transfer',
    })
  })

  it('converges on a Stripe redelivery rather than duplicating', async () => {
    await recordConnectPayoutFailure('profiles', {
      kind: 'payout',
      object: payout,
      accountId: 'acct_1',
    })
    await recordConnectPayoutFailure('profiles', {
      kind: 'payout',
      object: payout,
      accountId: 'acct_1',
    })

    expect(
      [...docs.keys()].filter((key) => key.startsWith('connectPayoutFailures/')),
    ).toEqual(['connectPayoutFailures/po_1'])
    expect(
      docs.get('connectPayoutFailures/po_1')?.['boundProfiles'],
    ).toEqual(['profiles/owner-1'])
  })

  it('still says something when Stripe states no reason', async () => {
    // An empty warning reads as a rendering fault rather than a problem.
    await recordConnectPayoutFailure('profiles', {
      kind: 'payout',
      object: { id: 'po_2', amount: 100 },
      accountId: 'acct_1',
    })

    expect(docs.get('profiles/owner-1')?.['lastPayoutFailureReason']).toBe(
      'Stripe did not say why',
    )
  })

  it('ignores an event carrying no Stripe id', async () => {
    const mirrored = await recordConnectPayoutFailure('profiles', {
      kind: 'payout',
      object: { amount: 100 },
      accountId: 'acct_1',
    })

    expect(mirrored).toBe(0)
    expect([...docs.keys()]).toEqual(['profiles/owner-1'])
  })
})

describe('clearConnectPayoutFailure (AGL-2513)', () => {
  it('retires the warning when a later payout succeeds', async () => {
    await recordConnectPayoutFailure('profiles', {
      kind: 'payout',
      object: payout,
      accountId: 'acct_1',
    })

    await clearConnectPayoutFailure('profiles', 'acct_1')

    const profile = docs.get('profiles/owner-1') ?? {}
    expect('lastPayoutFailureAtMs' in profile).toBe(false)
    expect('lastPayoutFailureReason' in profile).toBe(false)
    // CONTROL: clearing the warning must not clear the account binding.
    expect(profile['stripeAccountId']).toBe('acct_1')
  })

  it('keeps the history a cleared warning came from', async () => {
    // "Has this account failed before" is the question the record exists to
    // answer, and a resolved warning must not erase the answer.
    await recordConnectPayoutFailure('profiles', {
      kind: 'payout',
      object: payout,
      accountId: 'acct_1',
    })

    await clearConnectPayoutFailure('profiles', 'acct_1')

    expect(docs.get('connectPayoutFailures/po_1')).toMatchObject({
      kind: 'payout',
      amountCents: 42_000,
    })
  })

  it('CONTROL: an ordinary successful payout writes nothing', async () => {
    // Without this the clear would touch every profile on every `payout.paid`,
    // which is a write per account per payout cycle for no reason.
    const before = JSON.stringify(docs.get('profiles/owner-1'))

    const cleared = await clearConnectPayoutFailure('profiles', 'acct_1')

    expect(cleared).toBe(0)
    expect(JSON.stringify(docs.get('profiles/owner-1'))).toBe(before)
  })
})
