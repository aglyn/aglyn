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
 * An org automation on all sites except some, against a real Firestore
 * (AGL-4047): what the manage door's writes store, the real field deletes, the
 * sweep finding what they wrote when a site is added, and the engine's own
 * query running it on the new site and never on the one left out.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. With the emulator up:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/plugins/workflows/jest.config.ts \
 *       --testPathPatterns org-automations-all-except.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { runScopeSharingSweep } from '@aglyn/tenant-data-admin/server/scope-sharing-sweep'
import {
  findOrgAutomationsForEvent,
  resetOrgAutomationLookupsForTests,
} from '../engine/run-org-automations'
import { readOrgAutomation, type OrgAutomationFields } from '../model/org-automations'
import { createOrgAutomationRecord, updateOrgAutomationRecord } from './org-automations-routes'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
if (EMULATED && !getApps().length) initializeApp({ projectId: 'aglyn-main' })

const ORG = 'e2e-auto-except-org'
const ID = 'e2e-auto-except'
const [A, B, NEW] = ['e2e-auto-except-a', 'e2e-auto-except-b', 'e2e-auto-except-new']
const EVENT = 'formSubmission'

const suite = EMULATED ? describe : describe.skip

/** The fields the manage door would store for this sharing choice. */
function fields(sharing: Record<string, unknown>): OrgAutomationFields {
  const read = readOrgAutomation({
    name: 'Everywhere but A',
    trigger: { event: EVENT },
    steps: [{ type: 'customEvent', eventName: 'welcomed' }],
    sharing,
  })
  if (read.ok === false) throw new Error(read.problem)
  return read.value
}

suite('an org automation on all sites except some, against the emulator', () => {
  let db: Firestore
  const org = () => db.collection('orgs').doc(ORG)
  const stored = async () => (await org().collection('automations').doc(ID).get()).data() as Record<string, unknown>
  const runsOn = async (hostId: string) => {
    resetOrgAutomationLookupsForTests()
    return ((await findOrgAutomationsForEvent(hostId, EVENT))?.docs ?? []).map((doc) => doc.id)
  }

  beforeAll(() => {
    db = getFirestore()
  })

  beforeEach(async () => {
    await db.recursiveDelete(org())
    for (const hostId of [A, B, NEW]) await db.collection('hostIndex').doc(hostId).set({ orgId: ORG })
    await org().set({ plan: 'pro', hosts: { [A]: true, [B]: true } })
  })

  it('stores the sites in and the marker, and runs nowhere it leaves out', async () => {
    const written = await createOrgAutomationRecord(db, {
      orgId: ORG,
      id: ID,
      fields: fields({ mode: 'allExcept', exceptHostIds: [A] }),
      actorUid: 'user-1',
    })
    expect(written).toEqual({ ok: true, id: ID })
    const after = await stored()
    expect(after).toMatchObject({ visibleTo: [`host:${B}`], scopeMode: 'allExcept', scopeExcept: [`host:${A}`] })
    expect(after).not.toHaveProperty('sharing')

    expect(await runsOn(A)).toEqual([])
    expect(await runsOn(B)).toEqual([ID])
  }, 60_000)

  it('a site added later gets it once the sweep runs; the one left out still doesn’t', async () => {
    await createOrgAutomationRecord(db, {
      orgId: ORG,
      id: ID,
      fields: fields({ mode: 'allExcept', exceptHostIds: [A] }),
      actorUid: 'user-1',
    })
    await org().update({ [`hosts.${NEW}`]: true })
    expect(await runsOn(NEW)).toEqual([])

    const swept = await runScopeSharingSweep({ orgId: ORG, firestore: db })
    expect(swept).toMatchObject({ complete: true, changed: 1, failed: 0 })

    expect((await stored())['visibleTo']).toEqual([`host:${B}`, `host:${NEW}`])
    expect(await runsOn(NEW)).toEqual([ID])
    expect(await runsOn(A)).toEqual([])
  }, 60_000)

  it('leaving a paused site out drops its pause; moving back to every site deletes the marker fields', async () => {
    await createOrgAutomationRecord(db, { orgId: ORG, id: ID, fields: fields({ mode: 'all' }), actorUid: 'user-1' })
    await org().collection('automations').doc(ID).update({ pausedHostIds: [A, B] })

    await updateOrgAutomationRecord(db, {
      orgId: ORG,
      id: ID,
      fields: fields({ mode: 'allExcept', exceptHostIds: [A] }),
      actorUid: 'user-1',
    })
    expect(await stored()).toMatchObject({ visibleTo: [`host:${B}`], pausedHostIds: [B] })

    await updateOrgAutomationRecord(db, { orgId: ORG, id: ID, fields: fields({ mode: 'all' }), actorUid: 'user-1' })
    const after = await stored()
    expect(after['visibleTo']).toEqual(['org'])
    expect(Object.keys(after)).not.toContain('scopeMode')
    expect(Object.keys(after)).not.toContain('scopeExcept')
  }, 60_000)
})
