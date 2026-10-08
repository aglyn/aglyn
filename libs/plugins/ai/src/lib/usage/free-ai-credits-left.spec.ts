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
 * What a Free workspace has left before it spends (AGL-3660): the less of its
 * own band and its owner's allowance, which every Free workspace the owner
 * holds draws on — the two walls the reservation refuses at.
 */

jest.mock('@aglyn/tenant-data-admin/server/staff-alert-email', () => ({
  __esModule: true,
  sendStaffAlertEmail: async () => undefined,
}))
jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  __esModule: true,
  addAdminAudit: async () => undefined,
}))

import { FREE_AI_TASTE_CREDITS_PER_MONTH } from '../plan-entitlements'
import { aiFreeSiteCreditEstimate, aiFreeSiteShortfall } from '../model/ai-site-job'
import { assistUsdFromCredits } from './assist-credits'
import { freeAiCreditsLeftFrom, readFreeAiCreditsLeft } from './free-ai-credits-left'

const NOW = new Date('2026-10-08T15:00:00.000Z')
const MONTH = '2026-10'

/** Documents by path, read through the `collection().doc()` chain the reader walks. */
function fakeFirestore(docs: Record<string, Record<string, unknown>>): FirebaseFirestore.Firestore {
  const doc = (path: string): unknown => ({
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => ({ get: (field: string) => docs[path]?.[field] }),
  })
  const collection = (path: string) => ({ doc: (id: string) => doc(`${path}/${id}`) })
  return { collection } as unknown as FirebaseFirestore.Firestore
}

const owner = 'uid-owner'
const free = (orgId: string) => ({ plan: 'free', ownerUid: owner, orgId })

describe('freeAiCreditsLeftFrom', () => {
  it('is the less of the workspace’s band and the owner’s allowance, never below zero', () => {
    expect(freeAiCreditsLeftFrom({ accountSpentUsd: assistUsdFromCredits(230), orgSpentUsd: assistUsdFromCredits(10), orgBandCredits: 300 })).toBe(70)
    expect(freeAiCreditsLeftFrom({ accountSpentUsd: assistUsdFromCredits(20), orgSpentUsd: assistUsdFromCredits(250), orgBandCredits: 300 })).toBe(50)
    expect(freeAiCreditsLeftFrom({ accountSpentUsd: assistUsdFromCredits(313), orgSpentUsd: 0, orgBandCredits: 300 })).toBe(0)
    // No owner on the org: its own band is the only wall.
    expect(freeAiCreditsLeftFrom({ accountSpentUsd: null, orgSpentUsd: assistUsdFromCredits(40), orgBandCredits: 300 })).toBe(260)
  })
})

describe('readFreeAiCreditsLeft — two Free workspaces of one owner', () => {
  // Workspace A spent 230 of the owner's month; workspace B, new, spent nothing
  // of its own band. The owner's account month holds both.
  const docs = {
    [`orgs/org-a/assistUsage/${MONTH}`]: { estCostUsd: assistUsdFromCredits(230) },
    [`users/${owner}/aiUsage/${MONTH}`]: { estCostUsd: assistUsdFromCredits(230) },
  }

  it('tells the new workspace what the owner has left, not the 300 a fresh band shows', async () => {
    const left = await readFreeAiCreditsLeft(fakeFirestore(docs), { orgId: 'org-b', org: free('org-b'), now: NOW })
    expect(left).toEqual({ left: 70, total: FREE_AI_TASTE_CREDITS_PER_MONTH, resetsOn: '2026-11-01' })
    // A two-page start's quoted figure is past it, so the start is refused;
    // a give-back that reopens the owner's month admits it again.
    expect(aiFreeSiteShortfall(left, 2)).toEqual({ needed: aiFreeSiteCreditEstimate(2), left: 70 })
    const returned = {
      ...docs,
      [`users/${owner}/aiUsage/${MONTH}`]: { estCostUsd: assistUsdFromCredits(230), returnedUsd: assistUsdFromCredits(230) },
    }
    const after = await readFreeAiCreditsLeft(fakeFirestore(returned), { orgId: 'org-b', org: free('org-b'), now: NOW })
    expect(after?.left).toBe(FREE_AI_TASTE_CREDITS_PER_MONTH)
    expect(aiFreeSiteShortfall(after, 2)).toBeNull()
  })

  it('reads the workspace that spent as limited by both walls', async () => {
    const left = await readFreeAiCreditsLeft(fakeFirestore(docs), { orgId: 'org-a', org: free('org-a'), now: NOW })
    expect(left?.left).toBe(70)
  })

  it('reads a new month as whole again: last month’s spend is not this month’s', async () => {
    const left = await readFreeAiCreditsLeft(fakeFirestore(docs), {
      orgId: 'org-b',
      org: free('org-b'),
      now: new Date('2026-11-01T00:00:00.000Z'),
    })
    expect(left).toEqual({ left: FREE_AI_TASTE_CREDITS_PER_MONTH, total: FREE_AI_TASTE_CREDITS_PER_MONTH, resetsOn: '2026-12-01' })
  })

  it('answers null for a paid workspace and for a read that fails', async () => {
    expect(await readFreeAiCreditsLeft(fakeFirestore(docs), { orgId: 'org-p', org: { plan: 'pro', billingStatus: 'active' }, now: NOW })).toBeNull()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken = { collection: () => { throw new Error('unreachable') } } as unknown as FirebaseFirestore.Firestore
    expect(await readFreeAiCreditsLeft(broken, { orgId: 'org-b', org: free('org-b'), now: NOW })).toBeNull()
  })
})
