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
 * Where a plugin runs, written against a real Firestore (AGL-4047): the real
 * transaction, the sites' own deny-lists, and a site being created while the
 * choice is saved.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set, so it can never touch
 * production. With an emulator up:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c apps/console/jest.config.ts \
 *       --testPathPatterns plugin-runs-on.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore'
import { isHostPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import { pluginRunsOnOf } from '@aglyn/aglyn/plugin-manager/plugin-site-exclusions'
import { writePluginRunsOn } from './plugin-runs-on'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
if (EMULATED && !getApps().length) initializeApp({ projectId: 'aglyn-main' })

const ORG = 'e2e-plugin-runs-on-org'
const [A, B, C, NEW] = ['e2e-plugin-runs-on-a', 'e2e-plugin-runs-on-b', 'e2e-plugin-runs-on-c', 'e2e-plugin-runs-on-new']
const suite = EMULATED ? describe : describe.skip

suite('where a plugin runs, against the emulator', () => {
  let db: Firestore
  const host = (id: string) => db.collection('hosts').doc(id)
  const stored = async (id: string) => (await host(id).get()).data() as Record<string, unknown>
  const write = (choice: Parameters<typeof writePluginRunsOn>[0]['choice'], pluginId = 'crm', allowed = () => true) =>
    writePluginRunsOn({
      firestore: db as never,
      orgId: ORG,
      pluginId,
      choice,
      mayChangeSite: async () => allowed(),
      refusedOnSite: (name) => `refused on ${name}`,
      now: () => FieldValue.serverTimestamp(),
    })

  beforeAll(() => {
    db = getFirestore()
  })

  beforeEach(async () => {
    await Promise.all([A, B, C, NEW].map((id) => host(id).delete()))
    await db.collection('orgs').doc(ORG).set({
      enabledPlugins: ['crm', 'commerce', 'accounts'],
      hosts: { [A]: true, [B]: true, [C]: true },
    })
    await host(A).set({ orgId: ORG, displayName: 'Bakery', enabledPlugins: ['accounts'] })
    await host(B).set({ orgId: ORG, displayName: 'Cafe', disabledPlugins: ['bookings'] })
    await host(C).set({ orgId: ORG, displayName: 'Deli' })
  })

  afterAll(async () => {
    if (!EMULATED) return
    await Promise.all([A, B, C, NEW].map((id) => host(id).delete()))
    await db.collection('orgs').doc(ORG).delete()
  })

  it('writes the plugin into the deny-lists of the sites left out, keeping their other entries', async () => {
    const answer = await write({ mode: 'allExcept', exceptHostIds: [B, C] })
    expect(answer).toEqual({ ok: true, leftOutHostIds: [B, C], broughtBackHostIds: [] })
    expect((await stored(B))['disabledPlugins']).toEqual(['bookings', 'crm'])
    expect((await stored(C))['disabledPlugins']).toEqual(['crm'])
    expect((await stored(A))['disabledPlugins']).toBeUndefined()
    expect((await stored(B))['updatedAt']).toBeDefined()
  })

  it('All sites takes it back out, and a second save of the same choice writes nothing', async () => {
    await write({ mode: 'allExcept', exceptHostIds: [B] })
    expect(await write({ mode: 'all' })).toEqual({ ok: true, leftOutHostIds: [], broughtBackHostIds: [B] })
    expect((await stored(B))['disabledPlugins']).toEqual(['bookings'])
    expect(await write({ mode: 'all' })).toEqual({ ok: true, leftOutHostIds: [], broughtBackHostIds: [] })
  })

  it('refuses what would strand User Accounts, and writes nothing at all', async () => {
    const answer = await write({ mode: 'allExcept', exceptHostIds: [A, C] }, 'commerce')
    expect(answer).toMatchObject({ ok: false, status: 400 })
    expect((await stored(C))['disabledPlugins']).toBeUndefined()
  })

  it('a site that refuses the member stops the whole write', async () => {
    const answer = await write({ mode: 'allExcept', exceptHostIds: [B, C] }, 'crm', () => false)
    expect(answer).toEqual({ ok: false, status: 403, problem: 'refused on Cafe' })
    expect((await stored(B))['disabledPlugins']).toEqual(['bookings'])
  })

  it('a site created while the choice is saved runs the plugin, whichever lands first', async () => {
    for (let round = 0; round < 5; round += 1) {
      await Promise.all([A, B, C, NEW].map((id) => host(id).set({ orgId: ORG })))
      await db.collection('orgs').doc(ORG).set({ enabledPlugins: ['crm'], hosts: { [A]: true, [B]: true, [C]: true } })
      await Promise.all([
        write({ mode: 'allExcept', exceptHostIds: [B] }),
        db.collection('orgs').doc(ORG).update({ [`hosts.${NEW}`]: true }),
      ])
      const sites = await Promise.all([A, B, C, NEW].map(async (id) => ({ id, ...(await stored(id)) })))
      expect(pluginRunsOnOf('crm', sites)).toEqual({ mode: 'allExcept', exceptHostIds: [B] })
      expect(isHostPluginEnabled({ enabledPlugins: ['crm'] }, await stored(NEW), 'crm')).toBe(true)
    }
  })
})
