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
import { aiFreeSiteCreditRange, aiFreeSitePrompt } from '../model/ai-site-job'
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
    expect(left).toMatchObject({ left: 70, total: FREE_AI_TASTE_CREDITS_PER_MONTH, resetsOn: '2026-11-01' })
    // Both meters ride along for the usage strip (AGL-3722).
    expect(left?.used).toMatchObject({ account: 230, org: 0, state: 'ok' })
    // A two-page start's p90 is past it, so the start asks first (AGL-3722);
    // a give-back that reopens the owner's month admits it with no prompt.
    expect(aiFreeSitePrompt(left, 2)).toMatchObject({ ...aiFreeSiteCreditRange(2), left: 70 })
    const returned = {
      ...docs,
      [`users/${owner}/aiUsage/${MONTH}`]: { estCostUsd: assistUsdFromCredits(230), returnedUsd: assistUsdFromCredits(230) },
    }
    const after = await readFreeAiCreditsLeft(fakeFirestore(returned), { orgId: 'org-b', org: free('org-b'), now: NOW })
    expect(after?.left).toBe(FREE_AI_TASTE_CREDITS_PER_MONTH)
    expect(aiFreeSitePrompt(after, 2)).toBeNull()
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
    expect(left).toMatchObject({ left: FREE_AI_TASTE_CREDITS_PER_MONTH, total: FREE_AI_TASTE_CREDITS_PER_MONTH, resetsOn: '2026-12-01' })
  })

  it('answers null for a paid workspace and for a read that fails', async () => {
    expect(await readFreeAiCreditsLeft(fakeFirestore(docs), { orgId: 'org-p', org: { plan: 'pro', billingStatus: 'active' }, now: NOW })).toBeNull()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken = { collection: () => { throw new Error('unreachable') } } as unknown as FirebaseFirestore.Firestore
    expect(await readFreeAiCreditsLeft(broken, { orgId: 'org-b', org: free('org-b'), now: NOW })).toBeNull()
  })
})

describe('readFreeAiCreditsLeft — a plan step’s own spend, counted once (AGL-3722)', () => {
  // zachary1748, 2026-10-10: the chat turn's 31 credits were on both meters
  // (183 used, 117 left) when the build's plan step asked, and the plan's own
  // 46 were not yet — the machine meters a step after it returns.
  const before = {
    [`orgs/org-a/assistUsage/${MONTH}`]: { estCostUsd: assistUsdFromCredits(183) },
    [`users/${owner}/aiUsage/${MONTH}`]: { estCostUsd: assistUsdFromCredits(183) },
  }
  const after = {
    [`orgs/org-a/assistUsage/${MONTH}`]: { estCostUsd: assistUsdFromCredits(229) },
    [`users/${owner}/aiUsage/${MONTH}`]: { estCostUsd: assistUsdFromCredits(229) },
  }

  it('reads 117 before the plan, and 71 from inside the plan step net of its 46', async () => {
    const firestore = fakeFirestore(before)
    expect((await readFreeAiCreditsLeft(firestore, { orgId: 'org-a', org: free('org-a'), now: NOW }))?.left).toBe(117)
    const inside = await readFreeAiCreditsLeft(firestore, {
      orgId: 'org-a',
      org: free('org-a'),
      now: NOW,
      pendingUsd: assistUsdFromCredits(46),
    })
    expect(inside).toMatchObject({ left: 71, used: { account: 229, org: 229 } })
  })

  it('reads the same 71 once the machine has metered the plan, which is what the strip then shows', async () => {
    const metered = await readFreeAiCreditsLeft(fakeFirestore(after), { orgId: 'org-a', org: free('org-a'), now: NOW })
    expect(metered).toMatchObject({ left: 71, used: { account: 229, org: 229 } })
  })
})
