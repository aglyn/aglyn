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
 * The marketplace's required org eraser (AGL-1970, AGL-3080), against an
 * in-memory Firestore double. The end-to-end proof against the emulator —
 * through `eraseOrg` and the console's boot manifest — is
 * `apps/console/specs/erase-publisher-identity.emulator.spec.ts`; this holds
 * the branches cheaply: delete vs tombstone, the handles, the plan.
 */

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => ({}) }) },
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

import { createPublisherIdentityEraser } from './publisher-erasure'

type Row = Record<string, unknown>

function fakeFirestore(seed: {
  handles?: Record<string, Row>
  profiles?: Record<string, Row>
  listings?: Record<string, Row>
}) {
  const handles = new Map(Object.entries(seed.handles ?? {}))
  const profiles = new Map(Object.entries(seed.profiles ?? {}))
  const listings = new Map(Object.entries(seed.listings ?? {}))
  const stores: Record<string, Map<string, Row>> = {
    publisherHandles: handles,
    publisherProfiles: profiles,
    marketplaceListings: listings,
  }
  const docRef = (collection: string, id: string) => ({
    id,
    path: `${collection}/${id}`,
    get: async () => ({
      exists: stores[collection].has(id),
      ref: docRef(collection, id),
      data: () => stores[collection].get(id),
    }),
    set: async (data: Row) => void stores[collection].set(id, data),
  })
  const firestore = {
    collection: (name: string) => ({
      doc: (id: string) => docRef(name, id),
      where: (field: string, _op: string, value: unknown) => ({
        get: async () => {
          const docs = [...stores[name].entries()]
            .filter(([, row]) => row[field] === value)
            .map(([id]) => ({ id, ref: docRef(name, id) }))
          return { size: docs.length, docs }
        },
      }),
    }),
    batch: () => {
      const deletes: string[] = []
      return {
        delete: (ref: { path: string }) => void deletes.push(ref.path),
        commit: async () => {
          for (const path of deletes) {
            const [collection, id] = path.split('/')
            stores[collection].delete(id)
          }
        },
      }
    },
    recursiveDelete: async (ref: { path: string }) => {
      const [collection, id] = ref.path.split('/')
      stores[collection].delete(id)
    },
  }
  return {
    firestore: firestore as unknown as FirebaseFirestore.Firestore,
    handles,
    profiles,
    listings,
  }
}

const PROFILE = {
  handle: 'acme',
  displayName: 'Acme',
  stripeAccountId: 'acct_1',
}

describe('the marketplace’s org eraser', () => {
  it('deletes the profile and every handle the org holds when no listing survives', async () => {
    const store = fakeFirestore({
      handles: {
        acme: { orgId: 'org-1' },
        'acme-old': { orgId: 'org-1', movedTo: 'acme' },
        other: { orgId: 'org-2' },
      },
      profiles: { 'org-1': PROFILE, 'org-2': { handle: 'other' } },
    })
    const report = await createPublisherIdentityEraser(() => store.firestore)({
      orgId: 'org-1',
      dryRun: false,
    })
    expect(report).toEqual({
      publisherHandles: 2,
      publisherProfileDeleted: true,
      publisherProfileTombstoned: false,
      listingsRetained: 0,
    })
    expect([...store.handles.keys()]).toEqual(['other'])
    expect(store.profiles.has('org-1')).toBe(false)
    expect(store.profiles.get('org-2')).toEqual({ handle: 'other' })
  })

  it('leaves a tombstone with no content when a listing outlives the org', async () => {
    const store = fakeFirestore({
      profiles: { 'org-1': PROFILE },
      listings: { l1: { profileId: 'org-1' } },
    })
    const report = await createPublisherIdentityEraser(() => store.firestore)({
      orgId: 'org-1',
      dryRun: false,
    })
    expect(report).toMatchObject({
      publisherProfileTombstoned: true,
      listingsRetained: 1,
    })
    // No handle, no name, no payout identifier: only that the erasure happened.
    expect(store.profiles.get('org-1')).toEqual({
      erased: true,
      erasedAt: 'SERVER_TIMESTAMP',
    })
  })

  it('counts on a plan and changes nothing', async () => {
    const store = fakeFirestore({
      handles: { acme: { orgId: 'org-1' } },
      profiles: { 'org-1': PROFILE },
    })
    const report = await createPublisherIdentityEraser(() => store.firestore)({
      orgId: 'org-1',
      dryRun: true,
    })
    expect(report).toMatchObject({
      publisherHandles: 1,
      publisherProfileDeleted: true,
    })
    expect(store.handles.has('acme')).toBe(true)
    expect(store.profiles.get('org-1')).toEqual(PROFILE)
  })

  it('reports an org with no profile as neither deleted nor tombstoned', async () => {
    const store = fakeFirestore({})
    expect(
      await createPublisherIdentityEraser(() => store.firestore)({
        orgId: 'org-1',
        dryRun: false,
      }),
    ).toEqual({
      publisherHandles: 0,
      publisherProfileDeleted: false,
      publisherProfileTombstoned: false,
      listingsRetained: 0,
    })
  })
})
