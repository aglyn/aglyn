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
 * Deleting a site takes its POS customer-display rows (AGL-4214).
 *
 * `posDisplayStates`, `posDisplayPairings` and `posDisplayTokens` are
 * top-level, name the site in `hostId` and name no workspace, so neither the
 * site's tree nor a sweep by `orgId` reaches them. The sweep has one way to go
 * wrong: taking a row of another site. Each collection has a sibling twin.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns erase-host-pos-display.emulator
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

const ORG_ID = 'e2e-erase-pos-org'
const HOST_ID = 'e2e-erase-pos-host'
const SIBLING_HOST_ID = 'e2e-erase-pos-sibling'
const COLLECTIONS = ['posDisplayStates', 'posDisplayPairings', 'posDisplayTokens']

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('deleting a site takes its POS display rows (AGL-4214)', () => {
  let db: Firestore
  let erase: typeof import('./erase')

  const cleanup = async () => {
    await db.recursiveDelete(db.collection('orgs').doc(ORG_ID))
    for (const id of [HOST_ID, SIBLING_HOST_ID]) {
      await db.recursiveDelete(db.collection('hosts').doc(id))
      await db.collection('hostIndex').doc(id).delete().catch(() => undefined)
    }
    for (const name of COLLECTIONS) {
      for (const id of ['going', 'staying']) {
        await db.collection(name).doc(id).delete()
      }
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

  it('removes the site’s row in each collection and leaves a sibling’s', async () => {
    await db.collection('orgs').doc(ORG_ID).set({
      name: 'POS Display Fixture',
      hosts: { [HOST_ID]: true, [SIBLING_HOST_ID]: true },
    })
    await db.collection('hosts').doc(HOST_ID).set({ orgId: ORG_ID, name: 'Going' })
    await db.collection('hosts').doc(SIBLING_HOST_ID).set({ orgId: ORG_ID, name: 'Staying' })
    for (const name of COLLECTIONS) {
      await db.collection(name).doc('going').set({ hostId: HOST_ID, registerId: 'r1' })
      await db.collection(name).doc('staying').set({ hostId: SIBLING_HOST_ID, registerId: 'r1' })
    }

    await erase.eraseHost(HOST_ID)

    for (const name of COLLECTIONS) {
      expect((await db.collection(name).doc('going').get()).exists).toBe(false)
      expect((await db.collection(name).doc('staying').get()).exists).toBe(true)
    }
  }, 120_000)
})
