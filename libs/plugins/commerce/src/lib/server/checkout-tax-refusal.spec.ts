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
 * A shopper refused for unfinished sales tax tells the store's managers once
 * per store until it is fixed (AGL-4245), not once per shopper.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => ({}) }) },
  hostDisplayName: (data: { name?: string } | undefined, hostId: string) => data?.name ?? hostId,
  notifyHostManagers: jest.fn(),
  raiseOperatorAlert: jest.fn(),
}))

import { COMMERCE_CHECKOUT_TAX_SETUP_REFUSED } from '../constants/operator-alerts'
import {
  CHECKOUT_TAX_REFUSAL_RETELL_MS,
  type CheckoutTaxRefusalDeps,
  clearCheckoutTaxRefusal,
  isNewCheckoutTaxRefusal,
  readCheckoutTaxRefusal,
  reportCheckoutTaxRefusal,
} from './checkout-tax-refusal'

/** One in-memory document store, keyed by path, with a transaction that runs inline. */
function fakeFirestore(seed: Record<string, Record<string, unknown>> = {}) {
  const docs = new Map<string, Record<string, unknown>>(Object.entries(seed))
  const ref = (path: string) => ({
    path,
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
    get: async () => snap(path),
    delete: async () => void docs.delete(path),
  })
  const snap = (path: string) => ({
    exists: docs.has(path),
    data: () => docs.get(path),
  })
  const firestore = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async <T>(run: (transaction: unknown) => Promise<T>) =>
      run({
        get: async (target: { path: string }) => snap(target.path),
        set: (target: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
          docs.set(target.path, options?.merge ? { ...(docs.get(target.path) ?? {}), ...data } : { ...data })
        },
      }),
  }
  return { firestore: firestore as unknown as FirebaseFirestore.Firestore, docs }
}

const MARKER = 'hosts/host-1/settings/taxCheckoutRefusal'

function depsFor(firestore: FirebaseFirestore.Firestore, nowMs: number) {
  const notifyManagers = jest.fn().mockResolvedValue(undefined)
  const raiseAlert = jest.fn().mockResolvedValue({ outcome: 'queued', type: 'x' })
  const deps: CheckoutTaxRefusalDeps = {
    firestore: () => firestore,
    notifyManagers: notifyManagers as never,
    raiseAlert: raiseAlert as never,
    now: () => nowMs,
  }
  return { deps, notifyManagers, raiseAlert }
}

describe('reportCheckoutTaxRefusal (AGL-4245)', () => {
  it('tells the managers and the operator on the first refusal, pointing to Products → Taxes', async () => {
    const { firestore, docs } = fakeFirestore({ 'hosts/host-1': { name: 'Trail Shop' } })
    const { deps, notifyManagers, raiseAlert } = depsFor(firestore, 1_000)

    await expect(reportCheckoutTaxRefusal('host-1', 'stripe-tax-not-active', deps)).resolves.toBe('told')

    expect(notifyManagers).toHaveBeenCalledTimes(1)
    const [hostId, payload] = notifyManagers.mock.calls[0]
    expect(hostId).toBe('host-1')
    expect(payload).toMatchObject({ type: 'content.order', level: 'warning', link: '/host-1/products/taxes' })
    expect(payload.body).toContain('Stripe Tax')
    expect(raiseAlert).toHaveBeenCalledWith(
      COMMERCE_CHECKOUT_TAX_SETUP_REFUSED,
      expect.objectContaining({
        hostId: 'host-1',
        dedupeKey: 'host-1:stripe-tax-not-active:1000',
        context: expect.objectContaining({ site: 'Trail Shop (host-1)' }),
      }),
    )
    expect(docs.get(MARKER)).toEqual({ reason: 'stripe-tax-not-active', firstAtMs: 1_000, lastAtMs: 1_000, count: 1 })
  })

  it('only counts every later refusal for the same reason', async () => {
    const { firestore, docs } = fakeFirestore()
    const first = depsFor(firestore, 1_000)
    await reportCheckoutTaxRefusal('host-1', 'tax-undecided', first.deps)
    const later = depsFor(firestore, 5_000)

    await expect(reportCheckoutTaxRefusal('host-1', 'tax-undecided', later.deps)).resolves.toBe('counted')
    await reportCheckoutTaxRefusal('host-1', 'tax-undecided', later.deps)

    expect(later.notifyManagers).not.toHaveBeenCalled()
    expect(later.raiseAlert).not.toHaveBeenCalled()
    expect(docs.get(MARKER)).toMatchObject({ firstAtMs: 1_000, lastAtMs: 5_000, count: 3 })
  })

  it('tells again for a different reason, after the marker is cleared, or after a long quiet', async () => {
    const { firestore } = fakeFirestore()
    await reportCheckoutTaxRefusal('host-1', 'tax-undecided', depsFor(firestore, 1_000).deps)

    const otherReason = depsFor(firestore, 2_000)
    await expect(reportCheckoutTaxRefusal('host-1', 'stripe-tax-not-active', otherReason.deps)).resolves.toBe('told')

    await clearCheckoutTaxRefusal(firestore, 'host-1')
    await expect(readCheckoutTaxRefusal(firestore, 'host-1')).resolves.toBeNull()
    const afterClear = depsFor(firestore, 3_000)
    await expect(reportCheckoutTaxRefusal('host-1', 'stripe-tax-not-active', afterClear.deps)).resolves.toBe('told')

    const quiet = depsFor(firestore, 3_000 + CHECKOUT_TAX_REFUSAL_RETELL_MS)
    await expect(reportCheckoutTaxRefusal('host-1', 'stripe-tax-not-active', quiet.deps)).resolves.toBe('told')
  })

  it('never throws: a failed write reads as failed and tells nobody', async () => {
    const firestore = {
      collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({}) }) }) }),
      runTransaction: async () => {
        throw new Error('unavailable')
      },
    } as unknown as FirebaseFirestore.Firestore
    const { deps, notifyManagers } = depsFor(firestore, 1_000)
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(reportCheckoutTaxRefusal('host-1', 'tax-undecided', deps)).resolves.toBe('failed')
      expect(notifyManagers).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })
})

describe('isNewCheckoutTaxRefusal (AGL-4245)', () => {
  it('starts an episode for no marker, another reason, or a marker quiet for the retell window', () => {
    expect(isNewCheckoutTaxRefusal(null, 'tax-undecided', 10)).toBe(true)
    expect(isNewCheckoutTaxRefusal({ reason: 'stripe-tax-not-active', lastAtMs: 5 }, 'tax-undecided', 10)).toBe(true)
    expect(isNewCheckoutTaxRefusal({ reason: 'tax-undecided', lastAtMs: 5 }, 'tax-undecided', 10)).toBe(false)
    expect(
      isNewCheckoutTaxRefusal({ reason: 'tax-undecided', lastAtMs: 5 }, 'tax-undecided', 5 + CHECKOUT_TAX_REFUSAL_RETELL_MS),
    ).toBe(true)
  })
})
