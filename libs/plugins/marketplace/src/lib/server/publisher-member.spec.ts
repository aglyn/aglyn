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
 * @jest-environment node
 */

/**
 * "Is this person part of the workspace that published the listing" is a
 * fact, not a permission (AGL-4047). The free own installs, the refusal to
 * sell a listing to its own publisher and the refusal of a self-review all
 * ask it. It is any member, in any role, and nothing a member's permissions
 * say moves it: an admin whose publisher keys are refused still published
 * the listing, so must still be unable to buy or rate it.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))

import { isPublisherMember } from './publisher-profile'

const members: Record<string, Record<string, unknown>> = {
  'orgs/acme/members/owner': { role: 'owner' },
  'orgs/acme/members/admin': { role: 'admin' },
  'orgs/acme/members/editor': { role: 'editor' },
  'orgs/acme/members/viewer': { role: 'viewer' },
  'orgs/acme/members/site-collaborator': { role: 'editor', allHosts: false, hostAccess: { 'site-1': 'author' } },
  'orgs/acme/members/refused-admin': {
    role: 'admin',
    permissions: {
      'marketplace.publisherProfile': false,
      'marketplace.manageListings': false,
      'marketplace.payouts': false,
    },
  },
}

const reads: string[] = []

/** A Firestore that answers each member document from `members`. */
const firestore = {
  collection: (orgs: string) => ({
    doc: (orgId: string) => ({
      collection: (sub: string) => ({
        doc: (uid: string) => ({
          get: async () => {
            const path = `${orgs}/${orgId}/${sub}/${uid}`
            reads.push(path)
            return { exists: path in members, data: () => members[path] }
          },
        }),
      }),
    }),
  }),
} as unknown as FirebaseFirestore.Firestore

beforeEach(() => {
  reads.length = 0
})

describe('isPublisherMember (AGL-4047)', () => {
  it.each(['owner', 'admin', 'editor', 'viewer', 'site-collaborator'])(
    'a workspace %s belongs to the publisher',
    async (uid) => {
      expect(await isPublisherMember(firestore, uid, 'acme')).toBe(true)
    },
  )

  it('an admin refused every publisher key still belongs to it', async () => {
    expect(await isPublisherMember(firestore, 'refused-admin', 'acme')).toBe(true)
  })

  it('a stranger, another workspace, and a missing uid or org do not', async () => {
    expect(await isPublisherMember(firestore, 'stranger', 'acme')).toBe(false)
    expect(await isPublisherMember(firestore, 'owner', 'other-org')).toBe(false)
    expect(await isPublisherMember(firestore, '', 'acme')).toBe(false)
    expect(await isPublisherMember(firestore, 'owner', undefined)).toBe(false)
    expect(await isPublisherMember(firestore, 'owner', '')).toBe(false)
  })

  it('reads the member document of the PUBLISHING org, and nothing when either id is missing', async () => {
    await isPublisherMember(firestore, 'editor', 'acme')
    expect(reads).toEqual(['orgs/acme/members/editor'])
    reads.length = 0
    await isPublisherMember(firestore, '', 'acme')
    await isPublisherMember(firestore, 'editor', null)
    expect(reads).toEqual([])
  })
})
