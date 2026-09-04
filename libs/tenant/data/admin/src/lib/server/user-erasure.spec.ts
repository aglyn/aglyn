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
  sharedAddressBlockers,
  userErasureBlockers,
  type UserErasureCandidateOrg,
} from './erase'
import type { AccountAddress } from './account-addresses'

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

/*==========================================
 * THE SHARED-ADDRESS REFUSAL.
 *
 * Pure policy, tested without Firestore for the same reason the org blockers
 * are: what to DO about an address two accounts hold is the arguable part.
 * Whether the delete loop deletes is mechanical, and covered where it lives.
 *=========================================*/

const address = (over: Partial<AccountAddress> = {}): AccountAddress => ({
  address: 'someone@example.test',
  sources: ['primary'],
  key: 'k1',
  shared: false,
  indexConflict: false,
  ...over,
})

describe('sharedAddressBlockers', () => {
  it('does not block the ordinary account, whose addresses are its own', () => {
    // The common case must not need a human. A refusal that fired on every
    // erasure would be trained around within a week.
    expect(
      sharedAddressBlockers({
        addresses: [address(), address({ key: 'k2', sources: ['stored'] })],
      }),
    ).toEqual([])
  })

  it('blocks on an address a second account also holds', () => {
    const blockers = sharedAddressBlockers({
      addresses: [address(), address({ key: 'k2', shared: true })],
    })
    expect(blockers).toHaveLength(1)
    expect(blockers[0].key).toBe('k2')
  })

  it('blocks on a shared PRIMARY, not only a shared alias', () => {
    // The live shape is an account whose federated provider address is
    // another account's primary, so the shared one is often the address the
    // person signs in with.
    const blockers = sharedAddressBlockers({
      addresses: [address({ shared: true, sources: ['primary'] })],
    })
    expect(blockers).toHaveLength(1)
    expect(blockers[0].sources).toEqual(['primary'])
  })

  it('never hands back the address itself', () => {
    // `emailDeliveries` is hashed precisely so we keep no readable list of
    // who we mail, and this refusal is ABOUT a second customer. A blocker
    // carrying their address in the clear would disclose the person the
    // refusal exists to protect.
    const blockers = sharedAddressBlockers({
      addresses: [
        address({ address: 'shared-mailbox@example.test', shared: true }),
      ],
    })
    expect(JSON.stringify(blockers)).not.toContain('shared-mailbox')
    expect(JSON.stringify(blockers)).not.toContain('@')
  })

  it('reports every shared address, not just the first', () => {
    // The operator has to resolve all of them; a list that stopped at one
    // would send them round the loop once per address.
    const blockers = sharedAddressBlockers({
      addresses: [
        address({ key: 'k1', shared: true }),
        address({ key: 'k2' }),
        address({ key: 'k3', shared: true }),
      ],
    })
    expect(blockers.map((entry) => entry.key)).toEqual(['k1', 'k3'])
  })

  it('does not block an account with no addresses at all', () => {
    expect(sharedAddressBlockers({ addresses: [] })).toEqual([])
  })
})
