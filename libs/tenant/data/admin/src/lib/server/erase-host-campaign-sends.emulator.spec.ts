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
 * Deleting a site takes the emails it sent (AGL-3273).
 *
 * A send lives on the org (`orgs/{orgId}/campaigns/{sendId}`) and names the
 * site it was sent as in `hostId`, so the `recursiveDelete(hosts/{hostId})`
 * that ends `eraseHost` is blind to it — the AGL-1444 shape, one collection
 * over. `eraseHostOwnedOrgDocuments` is the sweep, driven by Marketing's own
 * `orgCollections` declaration (`siteField: "hostId"`) rather than a name core
 * knows, and a sweep over a shared org collection has exactly one way to go
 * wrong: taking a sibling site's sends. So every assertion here has a
 * bystander twin, and the campaign container — declared with no `siteField`,
 * because it is placed on sites rather than owned by one — must survive.
 *
 * Storage is stubbed for the reason every erasure spec gives: there is no
 * Storage emulator and the admin app holds a production credential.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns erase-host-campaign-sends.emulator
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

const ORG_ID = 'e2e-erase-sends-org'
const HOST_ID = 'e2e-erase-sends-host'
const SIBLING_HOST_ID = 'e2e-erase-sends-sibling'

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('deleting a site takes the emails it sent (AGL-3273)', () => {
  let db: Firestore
  let erase: typeof import('./erase')

  const cleanup = async () => {
    await db.recursiveDelete(db.collection('orgs').doc(ORG_ID))
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

  it('removes the site\'s sends and their reports, and nothing of a sibling\'s', async () => {
    const orgRef = db.collection('orgs').doc(ORG_ID)
    await orgRef.set({ name: 'Sends Fixture', hosts: { [HOST_ID]: true, [SIBLING_HOST_ID]: true } })
    await db.collection('hosts').doc(HOST_ID).set({ orgId: ORG_ID, name: 'Going' })
    await db.collection('hosts').doc(SIBLING_HOST_ID).set({ orgId: ORG_ID, name: 'Staying' })

    const sends = orgRef.collection('campaigns')
    await sends.doc('mine').set({ hostId: HOST_ID, visibleTo: [`host:${HOST_ID}`], emails: ['a@x.test'] })
    await sends.doc('mine').collection('reports').doc('links').set({ links: {} })
    await sends.doc('theirs').set({ hostId: SIBLING_HOST_ID, visibleTo: [`host:${SIBLING_HOST_ID}`] })
    await sends.doc('theirs').collection('reports').doc('links').set({ links: {} })
    await orgRef.collection('emailCampaigns').doc('campaign').set({
      name: 'Placed only on the site being deleted',
      visibleTo: [`host:${HOST_ID}`],
    })

    await erase.eraseHost(HOST_ID)

    expect((await sends.doc('mine').get()).exists).toBe(false)
    expect((await sends.doc('mine').collection('reports').get()).empty).toBe(true)
    expect((await sends.doc('theirs').get()).exists).toBe(true)
    expect((await sends.doc('theirs').collection('reports').get()).size).toBe(1)
    // The campaign is the org's: listed on the org's Marketing page still,
    // where an org-wide member can place it elsewhere or delete it.
    expect((await orgRef.collection('emailCampaigns').doc('campaign').get()).exists).toBe(true)
  }, 120_000)
})
