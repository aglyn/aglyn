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
 *
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @jest-environment node
 */

/**
 * The CRM default "All sites except…" against a real Firestore (AGL-4047):
 * a new record the default stamped gets its marker and nothing else; an older
 * record is never marked; "Apply to existing records" brings every kind of
 * record to the default, keeps the capturing site and the grants, writes the
 * marker the sweep then widens to a site added later, resumes from its
 * cursor, and stops when the default changes under it.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. With the emulator up:
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8082 \
 *     npx jest -c libs/plugins/crm/jest.config.ts \
 *       --testPathPatterns crm-default-sharing.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore'
import {
  registerPluginScopeSharingPatch,
  resetScopeSharingPatchesForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-scope-sharing'
import { runScopeSharingSweep } from '@aglyn/tenant-data-admin/server/scope-sharing-sweep'
import { readCrmDefaultApplyRun } from '../model/crm-sharing'
import { forgetCrmSharingRules } from './crm-sharing'
import {
  advanceDefaultApply,
  CRM_SHARING_RUNS_COLLECTION,
  markRecordUnderDefault,
  startDefaultApply,
} from './crm-default-sharing'
import { crmScopeSharingPatch } from './scope-sharing-patch'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
if (EMULATED && !getApps().length) initializeApp({ projectId: 'aglyn-main' })

const ORG = 'e2e-crm-default-org'
const [A, B, C, D] = ['e2e-cd-a', 'e2e-cd-b', 'e2e-cd-c', 'e2e-cd-d']
const token = (id: string) => `host:${id}`
const SINCE = Timestamp.fromMillis(1_000_000)

const suite = EMULATED ? describe : describe.skip

suite('the CRM default all sites except some, against the emulator', () => {
  let db: Firestore
  const org = () => db.collection('orgs').doc(ORG)
  const read = async (collection: string, id: string) =>
    ((await org().collection(collection).doc(id).get()).data() ?? {}) as Record<string, unknown>

  beforeAll(() => {
    db = getFirestore()
    registerPluginScopeSharingPatch(
      ['contacts', 'leads', 'companies', 'deals', 'crmTasks'],
      crmScopeSharingPatch,
      { pluginId: 'crm' },
    )
  })

  afterAll(() => resetScopeSharingPatchesForTests())

  beforeEach(async () => {
    forgetCrmSharingRules()
    await db.recursiveDelete(org())
    await org().set({
      hosts: { [A]: true, [B]: true, [C]: true },
      crm: { defaultRecordScope: 'host', defaultRecordExcept: [C], defaultRecordExceptAt: SINCE },
    })
  })

  it('marks a record the default stamped, created since it was chosen, and moves none of its sites', async () => {
    await org().collection('companies').doc('new').set({
      name: 'New',
      hostId: A,
      visibleTo: [token(A), token(B)],
      createdAt: Timestamp.fromMillis(2_000_000),
    })
    await org().collection('companies').doc('old').set({
      name: 'Old',
      hostId: A,
      visibleTo: [token(A), token(B)],
      createdAt: Timestamp.fromMillis(500_000),
    })
    await org().collection('companies').doc('narrowed').set({
      name: 'Narrowed',
      hostId: A,
      visibleTo: [token(A)],
      createdAt: Timestamp.fromMillis(2_000_000),
    })
    const orgData = (await org().get()).data() ?? {}
    expect(await markRecordUnderDefault(db, ORG, 'companies', 'new', orgData)).toBe(true)
    expect(await markRecordUnderDefault(db, ORG, 'companies', 'old', orgData)).toBe(false)
    expect(await markRecordUnderDefault(db, ORG, 'companies', 'narrowed', orgData)).toBe(false)
    expect(await read('companies', 'new')).toMatchObject({
      visibleTo: [token(A), token(B)],
      scopeMode: 'allExcept',
      scopeExcept: [token(C)],
    })
    expect(await read('companies', 'old')).not.toHaveProperty('scopeMode')
  }, 60_000)

  it('applies to every kind of record, keeps the capturing site and the grants, and a new site then joins', async () => {
    const seed = {
      contacts: { c1: { email: 'p@acme.test', hostId: C, capturedByHostIds: [C], visibleTo: ['org'] } },
      leads: { l1: { email: 'l@acme.test', hostId: A, visibleTo: ['org'], status: 'new' } },
      companies: { co1: { name: 'Acme', hostId: A, visibleTo: [token(A)] } },
      deals: { d1: { title: 'Renewal', hostId: B, visibleTo: ['org'] } },
      crmTasks: { t1: { title: 'Call', hostId: A, visibleTo: ['org'] } },
      crmActivities: { a1: { kind: 'note', body: 'x', hostId: A, visibleTo: ['org'] } },
    }
    for (const [collection, docs] of Object.entries(seed)) {
      for (const [id, data] of Object.entries(docs)) await org().collection(collection).doc(id).set(data)
    }
    // A hand share with C on the company: it stays on top of the default.
    await org()
      .collection('companies')
      .doc('co1')
      .update({
        visibleTo: [token(A), token(C)],
        writeTo: [token(A)],
        sharing: {
          grants: {
            [`manual_${C}`]: { source: 'manual', tokens: [token(C)], access: 'read', atMs: 1 },
          },
          tokens: [token(C)],
          added: [token(C)],
          ruleIds: [],
          orgWideHeldBy: [],
        },
      })

    const started = await startDefaultApply(db, ORG, { uid: 'u1' })
    if (started.ok === false) throw new Error(started.error)
    const pass = await advanceDefaultApply(db, ORG, started.runId, Date.now() + 30_000)
    expect(pass.more).toBe(false)
    expect(pass.run).toMatchObject({ status: 'done', processed: 6, changed: 6, capped: 0 })
    expect(readCrmDefaultApplyRun((await org().get()).data())).toMatchObject({ status: 'done', changed: 6 })
    expect((await org().collection(CRM_SHARING_RUNS_COLLECTION).get()).size).toBe(0)

    // Captured on C, which is left out: C keeps the person.
    expect(await read('contacts', 'c1')).toMatchObject({
      visibleTo: [token(A), token(B), token(C)],
      scopeMode: 'allExcept',
      scopeExcept: [token(C)],
    })
    expect(await read('leads', 'l1')).toMatchObject({ visibleTo: [token(A), token(B)], scopeMode: 'allExcept' })
    expect(await read('deals', 'd1')).toMatchObject({ visibleTo: [token(A), token(B)] })
    expect(await read('crmTasks', 't1')).toMatchObject({ visibleTo: [token(A), token(B)] })
    expect(await read('crmActivities', 'a1')).toMatchObject({ visibleTo: [token(A), token(B)] })
    // The hand share is still on top of the default.
    const company = await read('companies', 'co1')
    expect(company['visibleTo']).toEqual([token(A), token(B), token(C)])
    expect((company['sharing'] as Record<string, unknown>)['added']).toEqual([token(C)])

    // A site added later joins through the sweep; C still doesn't, except where it holds.
    await org().update({ [`hosts.${D}`]: true })
    const swept = await runScopeSharingSweep({ orgId: ORG, firestore: db })
    expect(swept.failed).toBe(0)
    expect((await read('leads', 'l1'))['visibleTo']).toEqual([token(A), token(B), token(D)])
    expect((await read('crmActivities', 'a1'))['visibleTo']).toEqual([token(A), token(B), token(D)])
  }, 120_000)

  it('resumes from its cursor when a pass runs out of time', async () => {
    for (let index = 0; index < 3; index += 1) {
      await org().collection('leads').doc(`l${index}`).set({ hostId: A, visibleTo: ['org'] })
    }
    const started = await startDefaultApply(db, ORG, { uid: 'u1' })
    if (started.ok === false) throw new Error(started.error)
    // Out of time before the first page.
    const first = await advanceDefaultApply(db, ORG, started.runId, Date.now() - 1)
    expect(first.more).toBe(true)
    expect((await read('leads', 'l0'))['visibleTo']).toEqual(['org'])
    const again = await startDefaultApply(db, ORG, { uid: 'u1' })
    expect(again).toEqual({ ok: true, runId: started.runId })
    const second = await advanceDefaultApply(db, ORG, started.runId, Date.now() + 30_000)
    expect(second.run).toMatchObject({ status: 'done', changed: 3 })
  }, 60_000)

  it('is refused unless the default leaves sites out, and stops if the default changes under it', async () => {
    await org().update({ 'crm.defaultRecordScope': 'org' })
    expect(await startDefaultApply(db, ORG, { uid: 'u1' })).toEqual({
      ok: false,
      error: 'Choose All sites except… for new records and save it first.',
    })
    await org().update({ 'crm.defaultRecordScope': 'host' })
    await org().collection('leads').doc('l1').set({ hostId: A, visibleTo: ['org'] })
    const started = await startDefaultApply(db, ORG, { uid: 'u1' })
    if (started.ok === false) throw new Error(started.error)
    await org().update({ 'crm.defaultRecordExcept': [] })
    const pass = await advanceDefaultApply(db, ORG, started.runId, Date.now() + 30_000)
    expect(pass.run).toMatchObject({ status: 'failed' })
    expect((await read('leads', 'l1'))['visibleTo']).toEqual(['org'])
    expect((await org().collection(CRM_SHARING_RUNS_COLLECTION).get()).size).toBe(0)
  }, 60_000)
})
