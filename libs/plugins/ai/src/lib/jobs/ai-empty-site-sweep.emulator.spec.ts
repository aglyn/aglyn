/**
 * @jest-environment node
 */

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
 * The empty site a cancelled guided start left, removed by the beat against
 * the real Firestore (AGL-3936): the due-marker query, the job read, the
 * other-jobs query, the content and feed reads, and `eraseHost` itself — the
 * routing index, the org's site count and the member's row all go. A twin
 * site with a layout on it, due at the same moment, is kept.
 *
 * The console's `core.site-erase` adds the sending-domain teardown, the
 * cache drop and the record around `eraseHost` (`erase-site.spec.ts`); here
 * the seam is filled with `eraseHost` alone, which is the part that touches
 * Firestore.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/plugins/ai/jest.config.ts \
 *       --testPathPatterns ai-empty-site-sweep.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { registerPluginSiteEraser } from '@aglyn/aglyn/plugin-manager/plugin-site-erase'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { eraseHost } from '@aglyn/tenant-data-admin/server/erase'

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

const ORG = 'e2e-empty-site-org'
const EMPTY_HOST = 'e2e-empty-site-host'
const BUILT_HOST = 'e2e-empty-site-built'
const MEMBER = 'e2e-empty-site-member'
const GRACE_MS = 60 * 60_000

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('the beat removes the empty site a cancelled start left (AGL-3936)', () => {
  let db: Firestore
  let sweep: typeof import('./ai-empty-site-sweep')

  const cleanup = async () => {
    await db.recursiveDelete(db.collection('orgs').doc(ORG))
    await db.recursiveDelete(db.collection('users').doc(MEMBER))
    for (const id of [EMPTY_HOST, BUILT_HOST]) {
      await db.recursiveDelete(db.collection('hosts').doc(id))
      await db.collection('hostIndex').doc(id).delete().catch(() => undefined)
      await db.collection('aiEmptySiteSweeps').doc(id).delete().catch(() => undefined)
    }
  }

  beforeAll(async () => {
    db = getFirestore()
    sweep = await import('./ai-empty-site-sweep')
    await cleanup()
  }, 120_000)

  afterAll(async () => {
    if (EMULATED) await cleanup()
  }, 120_000)

  afterEach(() => resetPluginServicesForTests())

  it('erases the empty one, keeps the one with a layout, and says so on the job', async () => {
    registerPluginSiteEraser(
      {
        erase: async ({ hostId, orgId }) => {
          const host = await db.collection('hosts').doc(hostId).get()
          if (!host.exists) return { erased: false, reason: 'missing' }
          if (host.get('orgId') !== orgId) return { erased: false, reason: 'moved' }
          await eraseHost(hostId)
          return { erased: true }
        },
      },
      { pluginId: 'console' },
    )
    const settled = new Date(Date.now() - GRACE_MS - 60_000)
    await db.collection('orgs').doc(ORG).set({ name: 'Cards', hosts: { [EMPTY_HOST]: true, [BUILT_HOST]: true } })
    for (const [hostId, subdomain] of [
      [EMPTY_HOST, 'e2e-empty-site'],
      [BUILT_HOST, 'e2e-empty-site-built'],
    ] as const) {
      await db.collection('hosts').doc(hostId).set({
        displayName: 'Cards',
        subdomain,
        orgId: ORG,
        screens: {},
        hasCustomDomain: false,
        memberRoles: { [MEMBER]: 'admin' },
      })
      await db.collection('hostIndex').doc(hostId).set({ subdomain, orgId: ORG })
      await db.collection('users').doc(MEMBER).collection('hostMemberships').doc(hostId).set({ orgId: ORG, subdomain })
      await db.collection('hosts').doc(hostId).collection('activity').add({ action: 'Created the site' })
      await db.collection('hosts').doc(hostId).collection('analytics').doc('2026-10-15').set({ visitors: 2 })
      const jobId = `${hostId}-job`
      await db.collection('orgs').doc(ORG).collection('aiJobs').doc(jobId).set({
        orgId: ORG,
        hostId,
        kind: 'site',
        status: 'canceled',
        steps: [
          { name: 'plan', status: 'pending', creditsSpent: 0, attempts: 0 },
          { name: 'generate', status: 'pending', creditsSpent: 0, attempts: 0 },
        ],
        outputs: [],
        creditsSpent: 0,
        cancelRequested: { at: settled, by: MEMBER },
        createdAt: new Date(settled.getTime() - 13_000),
        updatedAt: settled,
      })
      await sweep.scheduleAiEmptySiteSweep(
        db,
        { $id: jobId, orgId: ORG, hostId, kind: 'site', status: 'canceled', outputs: [] },
        settled,
      )
    }
    await db.collection('hosts').doc(BUILT_HOST).collection('layouts').doc('l1').set({ displayName: 'Header' })

    const result = await sweep.sweepAiEmptySites({ firestore: db })
    expect(result).toEqual({ due: 2, removed: 1, kept: 1, later: 0 })

    expect((await db.collection('hosts').doc(EMPTY_HOST).get()).exists).toBe(false)
    expect((await db.collection('hostIndex').doc(EMPTY_HOST).get()).exists).toBe(false)
    expect((await db.collection('users').doc(MEMBER).collection('hostMemberships').doc(EMPTY_HOST).get()).exists).toBe(false)
    const org = (await db.collection('orgs').doc(ORG).get()).data() ?? {}
    expect(Object.keys((org['hosts'] as object) ?? {})).toEqual([BUILT_HOST])
    const removedJob = (await db.collection('orgs').doc(ORG).collection('aiJobs').doc(`${EMPTY_HOST}-job`).get()).data()
    expect(removedJob?.['siteRemoved']).toMatchObject({ name: 'Cards' })

    // The twin with a layout is untouched, and its marker is gone too.
    expect((await db.collection('hosts').doc(BUILT_HOST).get()).exists).toBe(true)
    const keptJob = (await db.collection('orgs').doc(ORG).collection('aiJobs').doc(`${BUILT_HOST}-job`).get()).data()
    expect(keptJob?.['siteRemoved']).toBeUndefined()
    expect((await db.collection('aiEmptySiteSweeps').get()).docs.map((doc) => doc.id)).not.toEqual(
      expect.arrayContaining([EMPTY_HOST, BUILT_HOST]),
    )
  }, 60_000)
})
