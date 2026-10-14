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
 * Deleting a site takes the notifications about it, in every inbox (AGL-3719).
 *
 * `users/{uid}/notifications` names the site in `hostId` and links into it,
 * and nothing else collects those rows, so each one outlived its site as a
 * link to a 404. The sweep is a collection-group query, which has one way to
 * go wrong: taking a notification about a sibling site, or one with no site
 * at all. Each assertion has a bystander twin.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns erase-host-notifications.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

delete process.env.STRIPE_SECRET_KEY
delete process.env.VERCEL_TOKEN
delete process.env.VERCEL_CONSOLE_PROJECT_ID

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

/** No Storage emulator, and the default app holds a production credential. */
jest.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      file: () => ({ save: async () => undefined }),
      deleteFiles: async () => undefined,
    }),
  }),
}))

const ORG_ID = 'e2e-erase-notifs-org'
const HOST_ID = 'e2e-erase-notifs-host'
const SIBLING_HOST_ID = 'e2e-erase-notifs-sibling'
const MEMBER_UID = 'e2e-erase-notifs-member'
const STAFF_UID = 'e2e-erase-notifs-staff'

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('deleting a site takes the notifications about it (AGL-3719)', () => {
  let db: Firestore
  let erase: typeof import('./erase')

  const cleanup = async () => {
    await db.recursiveDelete(db.collection('orgs').doc(ORG_ID))
    for (const uid of [MEMBER_UID, STAFF_UID]) {
      await db.recursiveDelete(db.collection('users').doc(uid))
    }
    for (const id of [HOST_ID, SIBLING_HOST_ID]) {
      await db.recursiveDelete(db.collection('hosts').doc(id))
      await db.collection('hostIndex').doc(id).delete().catch(() => undefined)
    }
  }

  beforeAll(async () => {
    db = getFirestore()
    erase = await import('./erase')
    await cleanup()
  }, 120_000)

  afterAll(async () => {
    if (EMULATED) await cleanup()
  }, 120_000)

  it('removes them from members and staff alike, and nothing about a sibling', async () => {
    await db.collection('orgs').doc(ORG_ID).set({
      name: 'Notifications Fixture',
      hosts: { [HOST_ID]: true, [SIBLING_HOST_ID]: true },
    })
    await db.collection('hosts').doc(HOST_ID).set({ orgId: ORG_ID, name: 'Going' })
    await db.collection('hosts').doc(SIBLING_HOST_ID).set({ orgId: ORG_ID, name: 'Staying' })

    const member = db.collection('users').doc(MEMBER_UID).collection('notifications')
    const staff = db.collection('users').doc(STAFF_UID).collection('notifications')
    await member.doc('live').set({ type: 'content.aiJobDone', hostId: HOST_ID, link: `/${HOST_ID}/ai-jobs/j1` })
    await staff.doc('alert').set({ type: 'system.operatorAlert', hostId: HOST_ID })
    await member.doc('sibling').set({ type: 'content.aiJobDone', hostId: SIBLING_HOST_ID })
    await member.doc('account').set({ type: 'account.notice', orgId: ORG_ID })

    await erase.eraseHost(HOST_ID)

    expect((await member.doc('live').get()).exists).toBe(false)
    expect((await staff.doc('alert').get()).exists).toBe(false)
    expect((await member.doc('sibling').get()).exists).toBe(true)
    expect((await member.doc('account').get()).exists).toBe(true)
  }, 120_000)
})
