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
 * A locked publisher leaves browse, and the lift puts back exactly what the
 * lock took (AGL-3365).
 *
 * The listings run through the REAL query-field derivation, so "out of
 * browse" is asserted on the field browse queries by (`browseAudience`),
 * not on a flag nobody reads.
 */

const DELETE = { __delete: true }
const STAMP = 'SERVER_TIMESTAMP'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (by: number) => ({ __increment: by }) },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => {
      throw new Error('the spec passes its own firestore')
    },
    firestore: {
      FieldValue: {
        serverTimestamp: () => 'SERVER_TIMESTAMP',
        delete: () => ({ __delete: true }),
      },
    },
  },
}))

import { isListingBrowsable } from '@aglyn/aglyn/app-utils/marketplace-listing-visibility'
import { publisherPayoutAccounts, setPublisherListingsLocked } from './publisher-lockdown'
import { applyPublisherPayoutPolicy } from './sale-risk'

let docs: Map<string, Record<string, unknown>>

function snapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    ref: docRef(path),
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function docRef(path: string): any {
  return {
    path,
    get: async () => snapshot(path),
    set: async (value: Record<string, unknown>, options?: { merge?: boolean }) => {
      const next: Record<string, unknown> = options?.merge ? { ...(docs.get(path) ?? {}) } : {}
      for (const [key, entry] of Object.entries(value)) {
        if (entry && typeof entry === 'object' && (entry as { __delete?: boolean }).__delete) {
          delete next[key]
        } else if (entry && typeof entry === 'object' && '__increment' in (entry as object)) {
          next[key] = Number(next[key] ?? 0) + (entry as { __increment: number }).__increment
        } else {
          next[key] = entry
        }
      }
      docs.set(path, next)
    },
  }
}

function query(path: string, filters: Array<[string, unknown]>): any {
  return {
    where: (field: string, _op: string, value: unknown) => query(path, [...filters, [field, value]]),
    limit: (n: number) => ({
      get: async () => ({
        docs: [...docs.keys()]
          .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
          .map(snapshot)
          .filter((doc) => filters.every(([field, value]) => doc.get(field) === value))
          .slice(0, n),
      }),
    }),
  }
}

const firestore = {
  collection: (path: string) => ({
    doc: (id: string) => docRef(`${path}/${id}`),
    where: (field: string, op: string, value: unknown) => query(path, []).where(field, op, value),
  }),
} as any

const listing = (id: string) => docs.get(`marketplaceListings/${id}`) as Record<string, any>
const everyone = (id: string) => (listing(id)['browseAudience'] as string[] | undefined)?.includes('*')

beforeEach(() => {
  docs = new Map<string, Record<string, unknown>>([
    ['marketplaceListings/live', { profileId: 'org-pub', displayName: 'Live One', artifactType: 'component', deletedAt: null }],
    ['marketplaceListings/unpublished', { profileId: 'org-pub', displayName: 'Old One', artifactType: 'component', deletedAt: 1 }],
    ['marketplaceListings/private', { profileId: 'org-pub', displayName: 'Mine', artifactType: 'plugin', visibility: 'private' }],
    ['marketplaceListings/taken-down', { profileId: 'org-pub', displayName: 'Bad', artifactType: 'component', hiddenAt: 5 }],
    ['marketplaceListings/other', { profileId: 'org-else', displayName: 'Theirs', artifactType: 'component' }],
  ])
})

describe('a locked publisher leaves browse (AGL-3365)', () => {
  it("takes the workspace's listings out of browse, search and their pages — and nobody else's", async () => {
    expect(isListingBrowsable(listing('live'))).toBe(true)

    const result = await setPublisherListingsLocked(firestore, 'org-pub', true)
    expect(result).toMatchObject({ changed: 4, total: 4, truncated: false })
    expect(listing('live')['workspaceLockedAt']).toBe(STAMP)
    expect(everyone('live')).toBe(false)
    expect(isListingBrowsable(listing('live'))).toBe(false)
    // The publisher still sees its own listing, as it does one in review.
    expect(listing('live')['browseAudience']).toEqual(['org-pub', 'org-pub|org-pub'])
    expect(listing('other')['workspaceLockedAt']).toBeUndefined()
  })

  it('the lift restores exactly what was visible, and publishes nothing that was not', async () => {
    await setPublisherListingsLocked(firestore, 'org-pub', true)
    const result = await setPublisherListingsLocked(firestore, 'org-pub', false)
    expect(result.changed).toBe(4)
    for (const id of ['live', 'unpublished', 'private', 'taken-down']) {
      expect(listing(id)['workspaceLockedAt']).toBeUndefined()
    }
    expect(everyone('live')).toBe(true)
    // Unpublished, private and taken down stay exactly that.
    expect(listing('unpublished')['browseAudience']).toEqual([])
    expect(listing('private')['browseAudience']).toEqual([])
    expect(everyone('taken-down')).toBe(false)
    expect(listing('taken-down')['hiddenAt']).toBe(5)
  })

  it('is idempotent: a second lock or lift changes nothing', async () => {
    await setPublisherListingsLocked(firestore, 'org-pub', true)
    expect((await setPublisherListingsLocked(firestore, 'org-pub', true)).changed).toBe(0)
    await setPublisherListingsLocked(firestore, 'org-pub', false)
    expect((await setPublisherListingsLocked(firestore, 'org-pub', false)).changed).toBe(0)
  })
})

describe("the publisher's payout account (AGL-3365)", () => {
  it('is declared for the lock to pause, when the publisher has one', async () => {
    docs.set('publisherProfiles/org-pub', { stripeAccountId: 'acct_pub' })
    expect(await publisherPayoutAccounts(firestore, 'org-pub')).toEqual([
      { accountId: 'acct_pub', label: 'marketplace publisher' },
    ])
    expect(await publisherPayoutAccounts(firestore, 'org-none')).toEqual([])
  })

  it("is never moved by the young-publisher policy while a lock holds it", async () => {
    docs.set('publisherProfiles/org-pub', { stripeAccountId: 'acct_pub', payoutDelayDays: 14 })
    docs.set('lockdownBillingPauses/payout_acct_pub', { kind: 'payouts', holders: ['org:org-pub'] })
    const fetchMock = jest.fn()
    global.fetch = fetchMock as never
    // Aged out mid-lock: the policy would drop the delay, and must wait.
    expect(
      await applyPublisherPayoutPolicy({
        firestore,
        publisherOrgId: 'org-pub',
        ageDays: 45,
        stripeKey: 'sk_test_spec_only',
      }),
    ).toBe('held-by-lock')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(docs.get('publisherProfiles/org-pub')).toMatchObject({ payoutDelayDays: 14 })
  })
})
