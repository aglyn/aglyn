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

import type {
  PluginPersonErasureReport,
  PluginPersonErasureRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { loyaltyDb, loyaltyRefs } from './db'

/**
 * Erasing a person from a workspace's rewards (AGL-3640). Every site's
 * membership for the address goes — the member, their rewards and referral
 * codes, a friend's referral claim — so the address and the codes that
 * spend for it leave the store. The ledger rows stay: they name the member
 * by a hash of the address and carry no address, and they are the store's
 * record of a liability it paid out.
 */
export async function eraseLoyaltyPerson(request: PluginPersonErasureRequest): Promise<PluginPersonErasureReport> {
  const email = String(request.email ?? '').trim().toLowerCase()
  if (!email || !request.orgId) return { members: 0 }
  const members = await loyaltyRefs.members(request.orgId).where('email', '==', email).limit(200).get()
  if (request.dryRun) return { members: members.size }
  let erased = 0
  for (const doc of members.docs) {
    const hostId = String(doc.get('hostId') ?? '')
    const memberKey = String(doc.get('memberKey') ?? '')
    if (!hostId || !memberKey) continue
    const batch = loyaltyDb().batch()
    for (const code of [doc.get('rewardsCode'), doc.get('referralCode')]) {
      if (typeof code === 'string' && code) batch.delete(loyaltyRefs.code(request.orgId, hostId, code))
    }
    batch.delete(loyaltyRefs.referralClaim(request.orgId, hostId, memberKey))
    batch.delete(doc.ref)
    await batch.commit()
    erased += 1
  }
  return { members: erased }
}
