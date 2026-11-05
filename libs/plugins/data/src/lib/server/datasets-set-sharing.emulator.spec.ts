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
 * `set-sharing` against a real Firestore (AGL-4047): the real field deletes, the
 * transaction with a site being created, the sweep finding what the route wrote,
 * and deleting a site a marked dataset had shrunk to.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. With the emulator up:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/plugins/data/jest.config.ts \
 *       --testPathPatterns datasets-set-sharing.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { runScopeSharingSweep } from '@aglyn/tenant-data-admin/server/scope-sharing-sweep'
import { registerDataDeclarations } from '../declarations'
import { eraseSiteDatasets, previewSiteDatasets } from './dataset-site-erasure'
import { datasetsHandler } from './datasets-route'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
if (EMULATED && !getApps().length) initializeApp({ projectId: 'aglyn-main' })

jest.mock('@aglyn/tenant-data-admin', () => {
  const { getFirestore: real } = jest.requireActual('firebase-admin/firestore')
  return {
    __esModule: true,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'user-1', email_verified: true }) }),
        firestore: () => real(),
      }),
    },
    dataStorageRefusal: async () => null,
    emailUnverifiedResponse: () => Response.json({ error: 'Email unverified' }, { status: 403 }),
    isImpersonationSession: () => false,
    isServerReleaseFlagOnForOrg: async () => true,
    lockdownRefusal: async () => null,
    memberHasOrgPermission: async () => true,
    resolveOrgIdForHost: async () => 'e2e-set-sharing-org',
    resolveOrgMembership: async () => ({ member: { role: 'owner', allHosts: true } }),
  }
})
jest.mock('./announce-dataset-records', () => ({ announceDatasetRecords: async () => true }))

const ORG = 'e2e-set-sharing-org'
const DATASET = 'e2e-set-sharing-dataset'
const [A, B, C, NEW] = ['e2e-share-a', 'e2e-share-b', 'e2e-share-c', 'e2e-share-new']

const suite = EMULATED ? describe : describe.skip

suite('set-sharing against the emulator', () => {
  let db: Firestore
  const setSharing = (choice: Record<string, unknown>) =>
    datasetsHandler(
      new Request('https://console.test/api/orgs/datasets', {
        method: 'POST',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        body: JSON.stringify({ orgId: ORG, action: 'set-sharing', datasetId: DATASET, choice }),
      }),
      { params: {} } as never,
    ) as Promise<Response>

  const dataset = () => db.collection('orgs').doc(ORG).collection('datasets').doc(DATASET)
  const stored = async () => (await dataset().get()).data() as Record<string, unknown>
  const hosts = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, true]))

  beforeAll(() => {
    db = getFirestore()
    registerDataDeclarations()
  })

  beforeEach(async () => {
    await db.recursiveDelete(db.collection('orgs').doc(ORG))
    await db.collection('orgs').doc(ORG).set({ plan: 'pro', hosts: hosts(A, B, C) })
    await dataset().set({ displayName: 'Price list', visibleTo: ['org'] })
    await dataset().collection('records').doc('r1').set({ values: { name: 'Kept' } })
  })

  it('writes the sites in and the marker', async () => {
    expect((await setSharing({ mode: 'allExcept', exceptHostIds: [B] })).status).toBe(200)
    expect(await stored()).toMatchObject({
      visibleTo: [`host:${A}`, `host:${C}`],
      scopeMode: 'allExcept',
      scopeExcept: [`host:${B}`],
    })
  })

  it.each([
    ['All sites', { mode: 'all' }, ['org']],
    ['chosen sites', { mode: 'selected', hostIds: [A] }, [`host:${A}`]],
  ])('moving to %s deletes both marker fields, and stores no null', async (_name, choice, visibleTo) => {
    await setSharing({ mode: 'allExcept', exceptHostIds: [B] })
    expect((await setSharing(choice)).status).toBe(200)
    const after = await stored()
    expect(after['visibleTo']).toEqual(visibleTo)
    expect(Object.keys(after)).not.toContain('scopeMode')
    expect(Object.keys(after)).not.toContain('scopeExcept')
  })

  it('what it writes, the sweep finds, and a new site joins', async () => {
    await setSharing({ mode: 'allExcept', exceptHostIds: [B] })
    await db.collection('orgs').doc(ORG).update({ [`hosts.${NEW}`]: true })

    await runScopeSharingSweep({ orgId: ORG })

    expect(await stored()).toMatchObject({
      visibleTo: [`host:${A}`, `host:${C}`, `host:${NEW}`].sort(),
      scopeExcept: [`host:${B}`],
    })
  })

  it('a site created at the same moment always ends up on the dataset', async () => {
    for (let round = 0; round < 15; round += 1) {
      const site = `e2e-share-race-${round}`
      await dataset().set({ displayName: 'Price list', visibleTo: ['org'] })
      await db.collection('orgs').doc(ORG).set({ plan: 'pro', hosts: hosts(A, B, C) })
      const claim = async () => {
        await db.collection('orgs').doc(ORG).update({ [`hosts.${site}`]: true })
        await runScopeSharingSweep({ orgId: ORG })
      }
      const [response] = await Promise.all([setSharing({ mode: 'allExcept', exceptHostIds: [B] }), claim()])
      expect(response.status).toBe(200)
      expect((await stored())['visibleTo']).toContain(`host:${site}`)
    }
  }, 60_000)

  it('deleting the last site a marked dataset reaches keeps it, records and all', async () => {
    await setSharing({ mode: 'allExcept', exceptHostIds: [B, C] })
    expect((await stored())['visibleTo']).toEqual([`host:${A}`])

    const request = { orgId: ORG, hostId: A }
    const preview = await previewSiteDatasets(request, { firestore: () => db })
    expect(preview.going).toEqual([])
    expect(preview.staying).toBe(1)

    expect(await eraseSiteDatasets(request, { firestore: () => db })).toBe(0)

    expect(await stored()).toMatchObject({ visibleTo: [], scopeMode: 'allExcept' })
    expect((await dataset().collection('records').doc('r1').get()).exists).toBe(true)
  })

  it('THE CONTROL: the same dataset chosen for that site alone goes with it', async () => {
    await setSharing({ mode: 'selected', hostIds: [A] })

    expect(await eraseSiteDatasets({ orgId: ORG, hostId: A }, { firestore: () => db })).toBe(1)

    expect((await dataset().get()).exists).toBe(false)
  })
})
