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
 * Deleting a site takes its own import jobs (AGL-4236).
 *
 * `orgs/{orgId}/transferJobs` lives under the workspace and names the site in
 * `hostId`, so the site's tree never reaches it, and a trimmed job is kept for
 * good. Only a job for a site resource (`scope: 'host'`) goes: a workspace
 * resource imported through the site (contacts) and a sibling site's job stay.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns erase-host-transfer-jobs.emulator
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

const deletedPrefixes: string[] = []

/** No Storage emulator, and the default app holds a production credential. */
jest.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      file: () => ({ save: async () => undefined }),
      deleteFiles: async ({ prefix }: { prefix: string }) => {
        deletedPrefixes.push(prefix)
      },
    }),
  }),
}))

/** Two declared resources, one per scope, whatever the generated manifest holds. */
jest.mock('@aglyn/aglyn/plugin-manager/plugin-transfer-resources', () => {
  const actual = jest.requireActual('@aglyn/aglyn/plugin-manager/plugin-transfer-resources')
  const scopes: Record<string, 'host' | 'org'> = { 'commerce.products': 'host', 'crm.contacts': 'org' }
  return {
    ...actual,
    declaredTransferResource: (key: string) =>
      scopes[key] ? { key, label: key, scope: scopes[key], kinds: ['records'], pluginId: key.split('.')[0] } : null,
  }
})

const ORG_ID = 'e2e-erase-transfer-org'
const HOST_ID = 'e2e-erase-transfer-host'
const SIBLING_HOST_ID = 'e2e-erase-transfer-sibling'

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('deleting a site takes its own import jobs (AGL-4236)', () => {
  let db: Firestore
  let erase: typeof import('./erase')

  const jobs = () => db.collection('orgs').doc(ORG_ID).collection('transferJobs')

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

  it('removes the site’s products import with its results and file, and leaves the rest', async () => {
    await db.collection('orgs').doc(ORG_ID).set({
      name: 'Transfer Fixture',
      hosts: { [HOST_ID]: true, [SIBLING_HOST_ID]: true },
    })
    await db.collection('hosts').doc(HOST_ID).set({ orgId: ORG_ID, name: 'Going' })
    await db.collection('hosts').doc(SIBLING_HOST_ID).set({ orgId: ORG_ID, name: 'Staying' })
    await jobs().doc('site-products').set({ resource: 'commerce.products', hostId: HOST_ID, status: 'applied' })
    await jobs().doc('site-products').collection('results').doc('0').set({ rows: [] })
    await jobs().doc('sibling-products').set({ resource: 'commerce.products', hostId: SIBLING_HOST_ID, status: 'applied' })
    await jobs().doc('workspace-contacts').set({ resource: 'crm.contacts', hostId: HOST_ID, status: 'applied' })
    await jobs().doc('undeclared').set({ resource: 'gone.things', hostId: HOST_ID, status: 'applied' })

    await erase.eraseHost(HOST_ID)

    expect((await jobs().doc('site-products').get()).exists).toBe(false)
    expect((await jobs().doc('site-products').collection('results').get()).size).toBe(0)
    expect(deletedPrefixes).toContain(`orgs/${ORG_ID}/transfers/site-products/`)
    expect((await jobs().doc('sibling-products').get()).exists).toBe(true)
    expect((await jobs().doc('workspace-contacts').get()).exists).toBe(true)
    expect((await jobs().doc('undeclared').get()).exists).toBe(true)
    expect(deletedPrefixes).not.toContain(`orgs/${ORG_ID}/transfers/workspace-contacts/`)
  }, 120_000)
})
