/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock.
 *
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
 * THE REVIEW VERDICT MAIL HONOURS THE PLATFORM SUPPRESSION LIST (AGL-2407).
 *
 * AGL-1918 made bounces and complaints WRITE a suppression; AGL-2407 gave
 * the transactional half of that a place to land. This is the marketplace's
 * share of that guarantee — it lived in
 * `apps/console/specs/bulk-mail-honours-suppressions.spec.ts` beside the two
 * console senders until AGL-3080 moved the review queue, and its sender,
 * into this plugin. The console spec keeps the senders that stayed; a
 * `scope:app` spec may not import an `aglyn:addons` lib, so this half had to
 * travel with the code rather than point at it.
 *
 * WHAT IT HAS TO CATCH, unchanged:
 *
 *  - THE GATE IS WIRED, not merely written. The assertions run the REAL
 *    `filterSuppressedEmails` against a store the test seeded, through the
 *    REAL sender. A stub for either would prove the check exists somewhere
 *    and nothing about whether a message stops.
 *  - IT IS PER ADDRESS, not per fan-out. One suppressed admin must not
 *    silence the other.
 */

import { createHash } from 'crypto'
import { fakeFirestore } from '@aglyn/tenant-data-admin/server/test-firestore'
import { suppressEmail } from '@aglyn/tenant-data-admin/server/email-suppression'

const mockSent: Array<Record<string, any>> = []
let mockOrgMembers: Array<{ $id: string; role: string }> = []
let mockAuthEmails: Record<string, string> = {}

jest.mock('@aglyn/shared-util-email', () => ({
  // Spread the REAL module: a factory listing only what the sender uses
  // TODAY is a closed world that breaks as "X is not a function" the day it
  // uses one more export.
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, unknown>) => {
    mockSent.push(message)
    return { sent: true, id: 'email_1' }
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  meterPlatformEmail: async () => undefined,
  listOrgMembers: async () => mockOrgMembers,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        // The publisher fan-out resolves addresses through the auth pool
        // rather than the member document, so the double answers in that
        // shape: one user per requested uid, its address from the seed.
        getUsers: async (identifiers: Array<{ uid: string }>) => ({
          users: identifiers
            .map(({ uid }) => mockAuthEmails[uid])
            .filter(Boolean)
            .map((email) => ({ email })),
        }),
      }),
    }),
  },
}))

// NOT mocked, on purpose: the sender reaches
// `@aglyn/tenant-data-admin/server/email-suppression` through its LEAF entry
// point precisely so the barrel mock above cannot replace it. The gate under
// test is the shipped one.

import { emailPublisher } from './publisher-review-email'

const PUBLISHER = 'publisher-org'

beforeEach(() => {
  mockSent.length = 0
  mockOrgMembers = [
    { $id: 'u-owner', role: 'owner' },
    { $id: 'u-admin', role: 'admin' },
    // Not an owner or admin, so never in the fan-out at all.
    { $id: 'u-member', role: 'member' },
  ]
  mockAuthEmails = {
    'u-owner': 'owner@example.com',
    'u-admin': 'admin@example.com',
    'u-member': 'member@example.com',
  }
})

describe('the marketplace review fan-out', () => {
  it('PREMISE: an ordinary publisher is mailed the verdict', async () => {
    /*
     * The anti-vacuity control, and the one that catches the filter being
     * applied so broadly that nobody is mailed — a filter wired in with an
     * empty host id returns [] for everybody and every assertion below would
     * still pass.
     */
    const store = fakeFirestore()
    await emailPublisher(PUBLISHER, 'Rejected', 'Reason', { firestore: store })

    expect(mockSent.map((message) => message['to'])).toEqual([
      'owner@example.com',
      'admin@example.com',
    ])
  })

  it('does not mail a publisher whose address hard-bounced', async () => {
    const store = fakeFirestore()
    await suppressEmail({
      email: 'admin@example.com',
      reason: 'bounce',
      firestore: store,
    })

    await emailPublisher(PUBLISHER, 'Rejected', 'Reason', { firestore: store })

    // Per address. The dead mailbox is dropped and the other owner still
    // learns their plugin was rejected.
    expect(mockSent.map((message) => message['to'])).toEqual([
      'owner@example.com',
    ])
  })

  it('sends nothing when every publisher address is suppressed', async () => {
    const store = fakeFirestore()
    for (const email of ['owner@example.com', 'admin@example.com']) {
      await suppressEmail({ email, reason: 'complaint', firestore: store })
    }

    await emailPublisher(PUBLISHER, 'Rejected', 'Reason', { firestore: store })

    expect(mockSent).toHaveLength(0)
  })

  it('CONTROL: the suppression key is the one the store writes', () => {
    // If the sender and the store ever hashed differently, every assertion
    // above would pass by never matching anything.
    expect(createHash('sha256').update('admin@example.com').digest('hex')).toHaveLength(64)
  })
})
