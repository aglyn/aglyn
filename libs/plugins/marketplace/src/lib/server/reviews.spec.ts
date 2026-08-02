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

// The module graph behind `@aglyn/tenant-data-admin` reaches undici, which
// does not load under the jest environment. The function under test takes
// its firestore as a parameter, so nothing real is needed here — this only
// stops the import from dragging the admin SDK in.
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({}), firestore: {} },
  notifyOrgAdmins: jest.fn(),
}))

import { isVerifiedInstaller } from './reviews'

/**
 * A firestore stub covering only the shapes this check makes: the caller's
 * org memberships, each org doc (for its `hosts` map), and a batched
 * `getAll` over pin refs. Refs are plain path strings, so a "pin exists"
 * assertion is just membership of the seeded set.
 */
function fakeFirestore(options: {
  orgIds: string[]
  hostsByOrg?: Record<string, string[]>
  pinPaths?: string[]
}) {
  const pins = new Set(options.pinPaths ?? [])
  const collection = (name: string) => ({
    doc: (id: string) => ({
      // users/{uid}/orgs
      collection: (sub: string) => ({
        limit: () => ({
          get: async () => ({
            docs: options.orgIds.map((orgId) => ({ id: orgId })),
          }),
        }),
        doc: (docId: string) => `${name}/${id}/${sub}/${docId}`,
      }),
      get: async () => ({
        get: (field: string) =>
          field === 'hosts'
            ? Object.fromEntries(
                (options.hostsByOrg?.[id] ?? []).map((hostId) => [
                  hostId,
                  true,
                ]),
              )
            : undefined,
      }),
    }),
  })
  return {
    collection,
    getAll: async (...refs: string[]) =>
      refs.map((ref) => ({ exists: pins.has(ref) })),
  } as never
}

/**
 * Rating requires having installed the listing (AGL-655). The check used to
 * read only the ORG pin, on the false premise that a host-scoped install
 * also writes an org mirror — it does not, so per-site installers were
 * refused (AGL-1006). They are the careful ones, scoping a plugin to a
 * single site before rolling it out, and ratings drive ranking.
 */
describe('isVerifiedInstaller (AGL-1006)', () => {
  it('accepts an org-wide pin', async () => {
    const firestore = fakeFirestore({
      orgIds: ['org-1'],
      pinPaths: ['orgs/org-1/installs/listing-1'],
    })
    await expect(
      isVerifiedInstaller(firestore, 'uid-1', 'listing-1'),
    ).resolves.toEqual({ verified: true, orgId: 'org-1' })
  })

  it('accepts a pin on ONE of the org’s sites', async () => {
    const firestore = fakeFirestore({
      orgIds: ['org-1'],
      hostsByOrg: { 'org-1': ['host-a', 'host-b'] },
      // Installed on the second site only, and no org pin anywhere.
      pinPaths: ['hosts/host-b/installs/listing-1'],
    })
    await expect(
      isVerifiedInstaller(firestore, 'uid-1', 'listing-1'),
    ).resolves.toEqual({ verified: true, orgId: 'org-1' })
  })

  it('still refuses someone who never installed it', async () => {
    const firestore = fakeFirestore({
      orgIds: ['org-1'],
      hostsByOrg: { 'org-1': ['host-a'] },
      // A pin for a DIFFERENT listing must not vouch for this one.
      pinPaths: ['hosts/host-a/installs/other-listing'],
    })
    await expect(
      isVerifiedInstaller(firestore, 'uid-1', 'listing-1'),
    ).resolves.toEqual({ verified: false })
  })

  it('looks past an org with no install to one that has it', async () => {
    const firestore = fakeFirestore({
      orgIds: ['org-1', 'org-2'],
      hostsByOrg: { 'org-1': ['host-a'], 'org-2': ['host-b'] },
      pinPaths: ['hosts/host-b/installs/listing-1'],
    })
    await expect(
      isVerifiedInstaller(firestore, 'uid-1', 'listing-1'),
    ).resolves.toEqual({ verified: true, orgId: 'org-2' })
  })
})
