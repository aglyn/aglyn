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
 * The sweep against a real Firestore (AGL-4047): the query shape, the field
 * deletes, the transaction, the job's unfiltered collection-group read, and
 * the two places it is wired into: moving a site and erasing one.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns scope-sharing-sweep.emulator
 */

import { sharingFromChoice } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  listScopeSharingCollections,
  registerPluginScopeSharingPatch,
} from '@aglyn/aglyn/plugin-manager/plugin-scope-sharing'
import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore'

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

const ORG = 'e2e-scope-sweep-org'
const OTHER_ORG = 'e2e-scope-sweep-other'
const HOSTS = ['e2e-sweep-a', 'e2e-sweep-b', 'e2e-sweep-c']
const [A, B, C] = HOSTS
const NEW_HOST = 'e2e-sweep-new'
const token = (hostId: string) => `host:${hostId}`
const marked = (visibleTo: string[], except: string[], extra: Record<string, unknown> = {}) => ({
  visibleTo: visibleTo.map(token),
  scopeMode: 'allExcept',
  scopeExcept: except.map(token),
  ...extra,
})

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('keeping all sites except current, on a real Firestore (AGL-4047)', () => {
  let db: Firestore
  let sweep: typeof import('./scope-sharing-sweep')

  const org = () => db.collection('orgs').doc(ORG)
  const cleanup = async () => {
    await db.recursiveDelete(org())
    await db.recursiveDelete(db.collection('orgs').doc(OTHER_ORG))
    for (const hostId of [...HOSTS, NEW_HOST]) {
      await db.recursiveDelete(db.collection('hosts').doc(hostId))
      await db.collection('hostIndex').doc(hostId).delete().catch(() => undefined)
    }
  }
  const seedOrg = async () => {
    await org().set({ name: 'Sweep', hosts: Object.fromEntries(HOSTS.map((id) => [id, true])) })
  }

  beforeAll(async () => {
    db = getFirestore()
    sweep = await import('./scope-sharing-sweep')
    await cleanup()
  }, 120_000)

  beforeEach(async () => {
    await cleanup()
    await seedOrg()
  }, 120_000)

  afterAll(async () => {
    if (EMULATED) await cleanup()
  }, 120_000)

  it('finds a marked document in every declared collection, and only those', async () => {
    registerPluginScopeSharingPatch(['contacts', 'leads', 'companies', 'deals', 'crmTasks'], () => ({ patched: true }), {
      pluginId: 'crm',
    })
    const collections = listScopeSharingCollections()
    expect(collections.length).toBe(11)
    for (const { name } of collections) {
      await org().collection(name).doc('marked').set(marked([B], [A]))
      await org().collection(name).doc('plain').set({ visibleTo: [token(B)] })
      await org().collection(name).doc('wide').set({ visibleTo: ['org'] })
    }
    const result = await sweep.runScopeSharingSweep({ orgId: ORG, firestore: db })
    expect(result).toMatchObject({ marked: 11, changed: 11, failed: 0, complete: true })
    for (const { name, patch } of collections) {
      const row = (await org().collection(name).doc('marked').get()).data()
      expect(row?.['visibleTo']).toEqual([token(B), token(C)])
      expect(row?.['patched']).toBe(patch ? true : undefined)
      expect((await org().collection(name).doc('plain').get()).data()).toEqual({ visibleTo: [token(B)] })
      expect((await org().collection(name).doc('wide').get()).data()).toEqual({ visibleTo: ['org'] })
    }
  }, 60_000)

  it('costs no write and leaves no sweep document when nothing is marked', async () => {
    await org().collection('datasets').doc('plain').set({ visibleTo: ['org'] })
    await sweep.sweepScopeSharingAfterSiteChange({ orgId: ORG, reason: 'site-added', hostId: A, firestore: db })
    expect((await org().collection('scopeSweeps').get()).empty).toBe(true)
    expect(await sweep.resumeScopeSweeps({ firestore: db })).toEqual({ resumed: 0, finished: 0, droppedAfterFailing: 0 })
  })

  it('removes the marker fields outright when the last exclusion has gone', async () => {
    await org().set({ hosts: { [B]: true, [C]: true }, name: 'Sweep' })
    await org().collection('datasets').doc('d').set(marked([B, C], [A], { displayName: 'Menu' }))
    await sweep.runScopeSharingSweep({ orgId: ORG, firestore: db })
    expect((await org().collection('datasets').doc('d').get()).data()).toEqual({ visibleTo: ['org'], displayName: 'Menu' })
  })

  it('the job picks up a left sweep with no index, from its cursor, and deletes it', async () => {
    await org().collection('media').doc('m').set(marked([B], [A]))
    const left = org().collection('scopeSweeps').doc()
    await left.set({ reason: 'site-added', cursor: null, attempts: 0, createdAtMs: 1 })
    expect(await sweep.resumeScopeSweeps({ firestore: db })).toEqual({ resumed: 1, finished: 1, droppedAfterFailing: 0 })
    expect((await left.get()).exists).toBe(false)
    expect((await org().collection('media').doc('m').get()).data()?.['visibleTo']).toEqual([token(B), token(C)])
  })

  /**
   * The race the design leans on. A sharing write reads the org document in
   * its transaction and stores the sites it read; a claim adds a site and then
   * sweeps. Run both at once, many times, in the shape each really has. Whichever
   * commits first, the new site must end up on the document.
   */
  it('a site claimed while a sharing choice commits is never left off', async () => {
    const doc = org().collection('datasets').doc('raced')
    for (let round = 0; round < 25; round += 1) {
      await org().set({ name: 'Sweep', hosts: Object.fromEntries(HOSTS.map((id) => [id, true])) })
      await doc.set({ visibleTo: ['org'] })
      const choose = db.runTransaction(async (tx) => {
        const read = await tx.get(org())
        const hostIds = sweep.orgHostIdsFromDoc(read.data())
        // Hold the read open so the claim lands inside it on some rounds.
        await new Promise((resolve) => setTimeout(resolve, round % 5))
        const { fields } = sharingFromChoice({ mode: 'allExcept', exceptHostIds: [A] }, hostIds)
        tx.update(doc, { ...fields })
      })
      const claim = (async () => {
        await new Promise((resolve) => setTimeout(resolve, (round * 3) % 7))
        await db.runTransaction(async (tx) => {
          tx.set(org(), { hosts: { [NEW_HOST]: true } }, { merge: true })
        })
        await sweep.sweepScopeSharingAfterSiteChange({ orgId: ORG, reason: 'site-added', hostId: NEW_HOST, firestore: db })
      })()
      await Promise.all([choose, claim])
      const stored = (await doc.get()).data()?.['visibleTo'] as string[]
      expect(stored).toContain(token(NEW_HOST))
      expect(stored).not.toContain(token(A))
    }
  }, 120_000)

  it('NEGATIVE CONTROL: with no sweep after the claim, a choice made before it stays without the site', async () => {
    const doc = org().collection('datasets').doc('raced')
    const { fields } = sharingFromChoice({ mode: 'allExcept', exceptHostIds: [A] }, HOSTS)
    await doc.set({ ...fields })
    await org().set({ hosts: { [NEW_HOST]: true } }, { merge: true })
    expect((await doc.get()).get('visibleTo')).not.toContain(token(NEW_HOST))
    await sweep.sweepScopeSharingAfterSiteChange({ orgId: ORG, reason: 'site-added', hostId: NEW_HOST, firestore: db })
    expect((await doc.get()).get('visibleTo')).toContain(token(NEW_HOST))
  })

  it('a site removed while a sweep runs does not come back', async () => {
    const seed = db.batch()
    for (let at = 0; at < 40; at += 1) {
      seed.set(org().collection('media').doc(`m${at}`), marked([A, B, C], [NEW_HOST]))
    }
    await org().set({ hosts: { [NEW_HOST]: true } }, { merge: true })
    await seed.commit()
    const running = sweep.runScopeSharingSweep({ orgId: ORG, firestore: db })
    await org().set({ hosts: { [C]: FieldValue.delete() } }, { merge: true })
    await sweep.sweepScopeSharingAfterSiteChange({ orgId: ORG, reason: 'site-removed', hostId: C, firestore: db })
    await running
    await sweep.runScopeSharingSweep({ orgId: ORG, firestore: db })
    const rows = await org().collection('media').get()
    for (const row of rows.docs) expect(row.get('visibleTo')).not.toContain(token(C))
  }, 60_000)

  it('states its throughput, as the design inferred it', async () => {
    const seed = db.batch()
    const COUNT = 400
    for (let at = 0; at < COUNT; at += 1) {
      seed.set(org().collection('emailCampaigns').doc(`e${at}`), marked([B], [A]))
    }
    await seed.commit()
    const startedAt = Date.now()
    const result = await sweep.runScopeSharingSweep({ orgId: ORG, firestore: db })
    const seconds = (Date.now() - startedAt) / 1000
    console.info(`[scope-sweep] ${COUNT} documents in ${seconds.toFixed(1)}s: ${(COUNT / seconds).toFixed(0)}/s on the emulator`)
    expect(result).toMatchObject({ changed: COUNT, complete: true })
  }, 120_000)

  it('an inline budget hands the rest to the job, which finishes it', async () => {
    const seed = db.batch()
    for (let at = 0; at < 150; at += 1) {
      seed.set(org().collection('automations').doc(`a${String(at).padStart(3, '0')}`), marked([B], [A]))
    }
    await seed.commit()
    const stopped = await sweep.runScopeSharingSweep({ orgId: ORG, firestore: db, budgetMs: 1 })
    expect(stopped.complete).toBe(false)
    await org().collection('scopeSweeps').doc('left').set({ cursor: stopped.cursor, attempts: 0 })
    await sweep.resumeScopeSweeps({ firestore: db })
    const rows = await org().collection('automations').get()
    for (const row of rows.docs) expect(row.get('visibleTo')).toEqual([token(B), token(C)])
    expect((await org().collection('scopeSweeps').get()).empty).toBe(true)
  }, 120_000)

  describe('wired in', () => {
    it('erasing a site takes it off the lists, keeps the document, and drops a spent exclusion', async () => {
      const erase = await import('./erase')
      await db.collection('hosts').doc(B).set({ orgId: ORG, subdomain: 'e2e-sweep-b' })
      await db.collection('hosts').doc(A).set({ orgId: ORG, subdomain: 'e2e-sweep-a' })
      await org().set({ hosts: { [A]: true, [B]: true }, name: 'Sweep' })
      // B is the last site this one reaches: A is excluded.
      await org().collection('datasets').doc('last').set(marked([B], [A], { displayName: 'Menu' }))
      await org().collection('datasets').doc('spent').set(marked([A], [B], { displayName: 'Hours' }))
      await org().collection('datasets').doc('plain').set({ visibleTo: [token(A)], displayName: 'Own' })
      await erase.eraseHost(B, {
        tearDownSendingDomain: async () => ({ outcome: 'removed' as const, detail: null }),
      })
      expect((await org().collection('datasets').doc('last').get()).data()).toEqual(
        marked([], [A], { displayName: 'Menu' }),
      )
      expect((await org().collection('datasets').doc('spent').get()).data()).toEqual({
        visibleTo: ['org'],
        displayName: 'Hours',
      })
      expect((await org().collection('datasets').doc('plain').get()).data()).toEqual({
        visibleTo: [token(A)],
        displayName: 'Own',
      })
    }, 60_000)

    it('moving a site in and out brings both workspaces level', async () => {
      const { transferHost } = await import('./transfer-host')
      await db.collection('orgs').doc(OTHER_ORG).set({ name: 'Other', hosts: { [NEW_HOST]: true } })
      await db.collection('hosts').doc(C).set({ orgId: ORG, subdomain: 'e2e-sweep-c', displayName: 'C' })
      await org().collection('media').doc('from').set(marked([B, C], [A]))
      await db.collection('orgs').doc(OTHER_ORG).collection('media').doc('to').set(marked([], [NEW_HOST]))
      await transferHost({ hostId: C, toOrgId: OTHER_ORG, overrideSiteLimit: true })
      expect((await org().collection('media').doc('from').get()).get('visibleTo')).toEqual([token(B)])
      expect((await db.collection('orgs').doc(OTHER_ORG).collection('media').doc('to').get()).get('visibleTo')).toEqual([token(C)])
    }, 60_000)
  })
})
