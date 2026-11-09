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
 * A CRM grant shared with all sites except some, against a real Firestore
 * (AGL-4047): what a share stores, the `sharing.hasExcept` query a site change
 * runs (real indexes), a site added later joining, the site left out never
 * joining, and the site that captured the person keeping them.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. With the emulator up:
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8082 \
 *     npx jest -c libs/plugins/crm/jest.config.ts \
 *       --testPathPatterns crm-sharing-except.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { sharingFromChoice } from '@aglyn/aglyn/app-utils/scope-tokens'
import { CRM_SHARING_MAX_INCLUDED, crmOrgHostIds, withManualExceptShare } from '../model/crm-sharing'
import { crmSharingRulesOf, forgetCrmSharingRules, recomputeRecordSharing } from './crm-sharing'
import { crmSharingAfterSiteChange, CRM_SHARING_RUNS_COLLECTION } from './crm-sharing-runs'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
if (EMULATED && !getApps().length) initializeApp({ projectId: 'aglyn-main' })

const ORG = 'e2e-crm-except-org'
const [A, B, C, D] = ['e2e-crm-a', 'e2e-crm-b', 'e2e-crm-c', 'e2e-crm-d']
const token = (id: string) => `host:${id}`

const suite = EMULATED ? describe : describe.skip

suite('a CRM grant on all sites except some, against the emulator', () => {
  let db: Firestore
  const org = () => db.collection('orgs').doc(ORG)
  const lead = () => org().collection('leads').doc('l1')

  beforeAll(() => {
    db = getFirestore()
  })

  beforeEach(async () => {
    forgetCrmSharingRules()
    await db.recursiveDelete(org())
    await org().set({ hosts: { [A]: true, [B]: true, [C]: true } })
    await lead().set({
      email: 'p@acme.test',
      hostId: A,
      capturedByHostIds: [A],
      visibleTo: [token(A)],
      status: 'new',
    })
  })

  async function shareAllExcept(...left: string[]) {
    const orgHostIds = crmOrgHostIds((await org().get()).data())
    const shared = sharingFromChoice({ mode: 'allExcept', exceptHostIds: left }, orgHostIds, {
      maxIncluded: CRM_SHARING_MAX_INCLUDED,
    })
    if (!shared.fields) throw new Error(shared.problem)
    const { rules } = await crmSharingRulesOf(db, ORG, { fresh: true })
    return recomputeRecordSharing({
      firestore: db,
      orgId: ORG,
      object: 'leads',
      id: 'l1',
      rules,
      fresh: true,
      atMs: 1,
      manual: (grants) =>
        withManualExceptShare(
          grants,
          { tokens: shared.fields.visibleTo, except: shared.fields.scopeExcept ?? [] },
          'read',
          { uid: 'u1', name: 'Dana' },
          1,
        ),
    })
  }

  it('stores the sites it reaches, and keeps the capturing site though it is left out', async () => {
    expect(await shareAllExcept(A, C)).toBe('changed')
    const stored = (await lead().get()).data() ?? {}
    expect(stored['visibleTo']).toEqual([token(A), token(B)])
    expect(stored['sharing']).toMatchObject({ added: [token(B)], hasExcept: true })
    // What a list on C asks finds nothing; on B it finds the lead.
    const onC = await org().collection('leads').where('visibleTo', 'array-contains-any', ['org', token(C)]).get()
    const onB = await org().collection('leads').where('visibleTo', 'array-contains-any', ['org', token(B)]).get()
    expect(onC.size).toBe(0)
    expect(onB.size).toBe(1)
  }, 60_000)

  it('a site added later joins once the site change runs; the one left out still doesn’t', async () => {
    await shareAllExcept(C)
    await org().update({ [`hosts.${D}`]: true })
    await crmSharingAfterSiteChange({ orgId: ORG, reason: 'site-added', hostId: D, budgetMs: 10_000, firestore: db })
    const stored = (await lead().get()).data() ?? {}
    expect(stored['visibleTo']).toEqual([token(A), token(B), token(D)])
    expect(stored['visibleTo']).not.toContain(token(C))
    // Finished inline: nothing left for the job.
    expect((await org().collection(CRM_SHARING_RUNS_COLLECTION).get()).size).toBe(0)
  }, 60_000)

  it('a workspace that never shared this way pays one query per kind of record and writes nothing', async () => {
    await crmSharingAfterSiteChange({ orgId: ORG, reason: 'site-added', hostId: D, budgetMs: 10_000, firestore: db })
    expect((await lead().get()).data()?.['visibleTo']).toEqual([token(A)])
    expect((await org().collection(CRM_SHARING_RUNS_COLLECTION).get()).size).toBe(0)
  }, 60_000)
})
