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

import {
  userErasureBlockers,
  type UserErasureCandidateOrg,
} from './erase'

const org = (
  over: Partial<UserErasureCandidateOrg> = {},
): UserErasureCandidateOrg => ({
  orgId: 'o1',
  orgName: 'Acme',
  ownerUid: 'someone-else',
  hasLiveSubscription: false,
  memberCount: 1,
  ...over,
})

describe('userErasureBlockers', () => {
  it('lets a plain member be erased', () => {
    // Belonging to an org is not owning one — the common case must not need
    // a human.
    expect(
      userErasureBlockers('me', [org(), org({ orgId: 'o2' })]),
    ).toEqual([])
  })

  it('blocks on an owned org even with no subscription and no other members', () => {
    // The tempting shortcut is to allow this and cascade into eraseOrg. That
    // deletes a workspace, its sites and its data as a side effect of closing
    // a personal account — consent to the second is not consent to the first.
    const blockers = userErasureBlockers('me', [
      org({ ownerUid: 'me', memberCount: 1, hasLiveSubscription: false }),
    ])
    expect(blockers).toHaveLength(1)
    expect(blockers[0].orgId).toBe('o1')
  })

  it('reports a live subscription so the message can say why', () => {
    const [blocker] = userErasureBlockers('me', [
      org({ ownerUid: 'me', hasLiveSubscription: true }),
    ])
    expect(blocker.hasLiveSubscription).toBe(true)
  })

  it('counts OTHER members, excluding the owner', () => {
    // memberCount includes the owner; reporting it raw would tell someone
    // their solo workspace strands one person.
    const [solo] = userErasureBlockers('me', [
      org({ ownerUid: 'me', memberCount: 1 }),
    ])
    expect(solo.otherMembers).toBe(0)
    const [team] = userErasureBlockers('me', [
      org({ ownerUid: 'me', memberCount: 4 }),
    ])
    expect(team.otherMembers).toBe(3)
  })

  it('never reports a negative member count', () => {
    // A stale or missing count must not produce "-1 other members".
    const [blocker] = userErasureBlockers('me', [
      org({ ownerUid: 'me', memberCount: 0 }),
    ])
    expect(blocker.otherMembers).toBe(0)
  })

  it('names every owned org, not just the first', () => {
    // "Transfer ownership" is useless advice if you do not know which of
    // eleven workspaces is the problem.
    const blockers = userErasureBlockers('me', [
      org({ orgId: 'a', ownerUid: 'me', orgName: 'A' }),
      org({ orgId: 'b', ownerUid: 'other' }),
      org({ orgId: 'c', ownerUid: 'me', orgName: 'C' }),
    ])
    expect(blockers.map((b) => b.orgId)).toEqual(['a', 'c'])
    expect(blockers.map((b) => b.orgName)).toEqual(['A', 'C'])
  })

  it('treats a missing ownerUid as not-owned rather than owned', () => {
    // Failing open here is right: the org doc is the authority, and an org
    // with no recorded owner must not permanently trap an unrelated account.
    expect(userErasureBlockers('me', [org({ ownerUid: null })])).toEqual([])
  })

  it('handles no memberships at all', () => {
    expect(userErasureBlockers('me', [])).toEqual([])
  })
})
