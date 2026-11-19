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
 * Deleting a site takes its waiver definitions, and nothing anyone signed (AGL-4237).
 *
 * A waiver lives on the org (`orgs/{orgId}/waivers/{waiverId}`, with its
 * `versions`) and names its site in `hostId`, so the site's tree never
 * reaches it. The waivers plugin's `orgCollections` declaration
 * (`siteField: "hostId"`) is what `eraseHostOwnedOrgDocuments` sweeps by.
 *
 * Two ways to go wrong, each with a bystander here: taking a sibling site's
 * waiver, and taking a signature. Signatures are their own collection with
 * their own retention, and each stores the text that was signed, so they and
 * the site's retention state must survive the site.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns erase-host-waivers.emulator
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

const ORG_ID = 'e2e-erase-waivers-org'
const HOST_ID = 'e2e-erase-waivers-host'
const SIBLING_HOST_ID = 'e2e-erase-waivers-sibling'

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('deleting a site takes its waiver definitions (AGL-4237)', () => {
  let db: Firestore
  let erase: typeof import('./erase')

  const org = () => db.collection('orgs').doc(ORG_ID)

  const cleanup = async () => {
    await db.recursiveDelete(org())
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

  it('removes the site’s waiver and its versions, and keeps a sibling’s waiver and every signature', async () => {
    await org().set({ name: 'Waivers Fixture', hosts: { [HOST_ID]: true, [SIBLING_HOST_ID]: true } })
    await db.collection('hosts').doc(HOST_ID).set({ orgId: ORG_ID, name: 'Going' })
    await db.collection('hosts').doc(SIBLING_HOST_ID).set({ orgId: ORG_ID, name: 'Staying' })
    await org().collection('waivers').doc('going').set({ hostId: HOST_ID, title: 'Release', version: 1 })
    await org().collection('waivers').doc('going').collection('versions').doc('1').set({ version: 1, body: 'Text' })
    await org().collection('waivers').doc('staying').set({ hostId: SIBLING_HOST_ID, title: 'Release', version: 1 })
    await org()
      .collection('waiverSignatures')
      .doc('signed')
      .set({ hostId: HOST_ID, waiverId: 'going', version: 1, signedText: 'Text' })
    await org().collection('waiverRetention').doc(HOST_ID).set({ orgId: ORG_ID, hostId: HOST_ID, years: 7 })

    await erase.eraseHost(HOST_ID)

    expect((await org().collection('waivers').doc('going').get()).exists).toBe(false)
    expect((await org().collection('waivers').doc('going').collection('versions').get()).size).toBe(0)
    expect((await org().collection('waivers').doc('staying').get()).exists).toBe(true)
    expect((await org().collection('waiverSignatures').doc('signed').get()).exists).toBe(true)
    expect((await org().collection('waiverRetention').doc(HOST_ID).get()).exists).toBe(true)
  }, 120_000)
})
