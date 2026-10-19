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
 * A workspace born with its comp (AGL-3952): the REAL `createOrganization`
 * against a REAL Firestore, with `planComp` set.
 *
 * What it holds: the org document carries `entitlements.planComp` in the
 * shape the override route writes, so `readOrgPlanComp` resolves it and
 * `describeOrgPlan` says the comp decides; one `org.override` audit row
 * lands in the same commit, stamped for the audit page's filters; and a
 * creation without the option writes neither.
 *
 * Skipped unless `FIRESTORE_EMULATOR_HOST` is set, so an ordinary `jest` run
 * is unaffected and this can never reach production. Main Gate does not run
 * `*.emulator.spec.ts`; `npm run test:emulator-guards` does.
 */

import { describeOrgPlan, readOrgPlanComp } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

const describeEmulated = EMULATED ? describe : describe.skip
const RUN = Date.now().toString(36)

describeEmulated('a workspace born with its comp (emulator)', () => {
  let db: Firestore
  let organizations: typeof import('./organizations')

  beforeAll(async () => {
    db = getFirestore()
    organizations = await import('./organizations')
  }, 60_000)

  const auditRowsFor = async (orgId: string) =>
    (
      await db
        .collection('adminAudit')
        .where('target', '==', `orgs/${orgId}`)
        .get()
    ).docs.map((row) => row.data())

  it('writes the comp on the org and its audit row in the same commit', async () => {
    const staffUid = `staff-${RUN}`
    const orgId = await organizations.createOrganization({
      name: 'Booth Build',
      slug: `booth-build-${RUN}`,
      ownerUid: staffUid,
      bypassFreeWorkspaceCap: true,
      ownerStaffSeat: true,
      planComp: {
        plan: 'starter',
        reason: 'trial',
        note: 'Round 4, owner at the table',
        grantedBy: staffUid,
      },
    })
    const org = (await db.doc(`orgs/${orgId}`).get()).data() ?? {}
    // The resolver's reading, not the raw map: this is what every plan gate
    // on the platform asks.
    expect(readOrgPlanComp(org as never)).toMatchObject({
      plan: 'starter',
      uncapped: false,
      reason: 'trial',
      note: 'Round 4, owner at the table',
      grantedBy: staffUid,
    })
    expect(describeOrgPlan(org as never)).toMatchObject({
      effectivePlan: 'starter',
      decidedBy: 'comp',
      compInForce: true,
      uncapped: false,
    })
    const rows = await auditRowsFor(orgId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      action: 'org.override',
      actorUid: staffUid,
      reason: 'trial',
      note: 'Round 4, owner at the table',
      planEffect: {
        after: { effectivePlan: 'starter', decidedBy: 'comp', compInForce: true },
        compChange: 'granted',
      },
      // Stamped at the door, so the audit page's filters find it.
      actionGroup: expect.any(String),
      searchTokens: expect.any(Array),
    })
  }, 60_000)

  it('a creation without the option writes neither', async () => {
    const orgId = await organizations.createOrganization({
      name: 'Plain',
      slug: `plain-${RUN}`,
      ownerUid: `owner-${RUN}`,
      bypassFreeWorkspaceCap: true,
    })
    const org = (await db.doc(`orgs/${orgId}`).get()).data() ?? {}
    expect(org).not.toHaveProperty('entitlements')
    expect(readOrgPlanComp(org as never)).toBeNull()
    expect(await auditRowsFor(orgId)).toHaveLength(0)
  }, 60_000)
})
