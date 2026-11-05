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
 * `ownsListingHere`: the membership fact AND the install landing in the
 * publishing workspace (AGL-2484, AGL-4047), with the REAL `isPublisherMember`
 * reading the members document.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))

import { memberOfPublisherElsewhere, ownsListingHere } from './own-listing'

/** A Firestore double holding member documents, counting what it reads. */
function firestoreWith(members: readonly string[]) {
  const reads: string[] = []
  const firestore = {
    collection: (orgs: string) => ({
      doc: (orgId: string) => ({
        collection: (sub: string) => ({
          doc: (uid: string) => ({
            get: async () => {
              const path = `${orgs}/${orgId}/${sub}/${uid}`
              reads.push(path)
              return { exists: members.includes(path) }
            },
          }),
        }),
      }),
    }),
  } as unknown as FirebaseFirestore.Firestore
  return { firestore, reads }
}

describe('ownsListingHere (AGL-4047)', () => {
  it('is true for a member of the publisher installing into the publisher’s workspace', async () => {
    const { firestore, reads } = firestoreWith(['orgs/pub/members/u1'])
    await expect(
      ownsListingHere(firestore, { uid: 'u1', publisherOrgId: 'pub', targetOrgId: 'pub' }),
    ).resolves.toBe(true)
    expect(reads).toEqual(['orgs/pub/members/u1'])
  })

  it('is false for that member installing into another workspace, without reading membership', async () => {
    const { firestore, reads } = firestoreWith(['orgs/pub/members/u1'])
    await expect(
      ownsListingHere(firestore, { uid: 'u1', publisherOrgId: 'pub', targetOrgId: 'client' }),
    ).resolves.toBe(false)
    expect(reads).toEqual([])
  })

  it('is false for someone outside the publisher on the publisher’s own site', async () => {
    const { firestore } = firestoreWith([])
    await expect(
      ownsListingHere(firestore, { uid: 'u2', publisherOrgId: 'pub', targetOrgId: 'pub' }),
    ).resolves.toBe(false)
  })

  it('is false for a listing with no publisher, or a caller with no id', async () => {
    const { firestore, reads } = firestoreWith(['orgs/pub/members/u1'])
    await expect(
      ownsListingHere(firestore, { uid: 'u1', publisherOrgId: undefined, targetOrgId: undefined }),
    ).resolves.toBe(false)
    await expect(
      ownsListingHere(firestore, { uid: '', publisherOrgId: 'pub', targetOrgId: 'pub' }),
    ).resolves.toBe(false)
    expect(reads).toEqual([])
  })
})

describe('memberOfPublisherElsewhere (AGL-4047)', () => {
  it('is true for a member of the publisher buying for another workspace', async () => {
    const { firestore, reads } = firestoreWith(['orgs/pub/members/u1'])
    await expect(
      memberOfPublisherElsewhere(firestore, { uid: 'u1', publisherOrgId: 'pub', targetOrgId: 'client' }),
    ).resolves.toBe(true)
    expect(reads).toEqual(['orgs/pub/members/u1'])
  })

  it('is false on the publisher’s own site, without reading membership', async () => {
    const { firestore, reads } = firestoreWith(['orgs/pub/members/u1'])
    await expect(
      memberOfPublisherElsewhere(firestore, { uid: 'u1', publisherOrgId: 'pub', targetOrgId: 'pub' }),
    ).resolves.toBe(false)
    expect(reads).toEqual([])
  })

  it('is false for someone outside the publisher, and for a listing with no publisher', async () => {
    const { firestore, reads } = firestoreWith(['orgs/pub/members/u1'])
    await expect(
      memberOfPublisherElsewhere(firestore, { uid: 'u2', publisherOrgId: 'pub', targetOrgId: 'client' }),
    ).resolves.toBe(false)
    await expect(
      memberOfPublisherElsewhere(firestore, { uid: 'u1', publisherOrgId: undefined, targetOrgId: 'client' }),
    ).resolves.toBe(false)
    expect(reads).toEqual(['orgs/pub/members/u2'])
  })
})
