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
  AVATAR_COLOURS,
  memberInitials,
} from '../components/member-avatar.component'
import { assignRoomColours, projectRoom } from '../hooks/use-presence'

/**
 * Two sessions are told apart on sight (AGL-2486).
 *
 * Zach, watching two windows of his own account: "sometimes our same user
 * gets the same color. We also seem to have question marks on the avatars."
 * Both are failures of the same promise — an avatar per session, each
 * identifiable — and both were invisible to the suite that shipped them,
 * because the colour was picked per session in isolation and the avatar was
 * rendered from whatever the room happened to contain.
 */

const entry = (over: Record<string, unknown> = {}) => ({
  displayName: 'Zach Gover',
  lastSeenAt: 1_000_000,
  ...over,
})

const NOW = 1_000_000

/**
 * Real keys, CHOSEN BECAUSE THEY COLLIDE under the per-session hash this
 * replaced — `uid` is Zach's own account and the session ids have the shape
 * `createResourceUid` produces.
 *
 * Picking arbitrary keys is what makes a test like this worthless: the first
 * six I wrote happened to hash to six different slots, so the spec passed
 * against the very build that shipped the bug. These six occupy three slots
 * under the old scheme, so a regression to it fails the suite.
 */
const UID = '7AVEMtDa6OR1EuEspeLTx2xj7gg1'
const COLLIDING_KEYS = [
  `${UID}:mzMZanAN0b`,
  `${UID}:Y-mzMZanAN`,
  `${UID}:ivIV8jwJW9`,
  `${UID}:sFS5gtGT6h`,
  `${UID}:KX_lyLY-mz`,
  `${UID}:MZanAN0boB`,
]

describe('no two sessions in a room share a colour', () => {
  it('separates keys that the per-session hash put on one colour', () => {
    // Six sessions of ONE account. Under the scheme that shipped, these took
    // only three of the six colours — which is exactly what Zach photographed.
    const assigned = assignRoomColours(COLLIDING_KEYS)
    expect(new Set(Object.values(assigned)).size).toBe(AVATAR_COLOURS.length)
  })

  it('separates the reported pair: two windows of the same account', () => {
    const [first, second] = COLLIDING_KEYS
    const assigned = assignRoomColours([first, second])
    expect(assigned[first]).not.toBe(assigned[second])
  })

  it('gives every viewer the same answer, whatever order the room arrives in', () => {
    // Two people must be able to say "the purple cursor" and mean one person.
    // `Object.keys` order follows the RTDB snapshot, so the assignment is
    // sorted before it is walked; this is what pins that.
    expect(assignRoomColours(COLLIDING_KEYS)).toEqual(
      assignRoomColours([...COLLIDING_KEYS].reverse()),
    )
  })

  it('keeps a session on the same colour across re-renders', () => {
    expect(assignRoomColours(COLLIDING_KEYS)).toEqual(
      assignRoomColours(COLLIDING_KEYS),
    )
  })

  it('is drawn from the shared palette, not an invented hue', () => {
    // An unconstrained hue lands on yellows that white initials disappear
    // into. Every assigned value must be one the palette vouched for.
    for (const colour of Object.values(assignRoomColours(['a:1', 'b:2']))) {
      expect(AVATAR_COLOURS).toContain(colour)
    }
  })
})

describe('the room hands the avatar something it can draw', () => {
  it('gives each session its own colour end to end', () => {
    const { entries } = projectRoom(
      { u1: { s1: entry(), s2: entry() } } as never,
      'someone-else',
      NOW,
    )
    expect(entries).toHaveLength(2)
    expect(entries[0].colour).not.toBe(entries[1].colour)
  })

  it('never yields an entry whose initials would be a question mark', () => {
    // The `?` Zach saw is what empty initials draw. Anything in the room that
    // cannot produce initials is not a collaborator and must not become an
    // avatar — a phantom that draws a cursor and a selection box is worse
    // than a missing one.
    const { entries } = projectRoom(
      {
        u1: { s1: entry() },
        // A malformed row: the shape an abandoned fixture leaves behind. An
        // agent wrote two `zzTESTCOLLAB` rows into PRODUCTION on 2026-08-22.
        u2: { s1: { lastSeenAt: NOW } },
      } as never,
      'someone-else',
      NOW,
    )
    for (const found of entries) {
      expect(memberInitials(found.displayName)).not.toBe('?')
    }
    expect(entries).toHaveLength(1)
  })

  it('drops a stray scalar under a uid rather than rendering it', () => {
    // `isSessionMap` treats a uid node with no string `displayName` as a map
    // of sessions, so its FIELDS get iterated as if each were a collaborator.
    const { entries } = projectRoom(
      { u1: { lastSeenAt: NOW, colour: '#fff' } } as never,
      'someone-else',
      NOW,
    )
    expect(entries).toEqual([])
  })

  it('still keeps a well-formed legacy entry, which has a name', () => {
    // The pre-session shape sits directly under the uid. It is malformed only
    // when it has no name — the guard must not throw the old clients out.
    const { entries } = projectRoom(
      { u1: entry({ displayName: 'Ada Lovelace' }) } as never,
      'someone-else',
      NOW,
    )
    expect(entries).toHaveLength(1)
    expect(memberInitials(entries[0].displayName)).toBe('AL')
  })
})

describe('initials are meaningful for an account with no picture', () => {
  it('reads two letters from a full name', () => {
    expect(memberInitials('Zach Gover')).toBe('ZG')
  })

  it('falls back to the email for an SSO account asserting no name', () => {
    // `zach@aglyn.com` signs in through `saml.aglyn-workspace`, whose
    // assertion carries no picture and may carry no name. Read from the
    // tenant pool `aglyn-org-y5v14` on 2026-08-22, its `photoURL` is
    // undefined — so initials are the whole avatar for that account.
    expect(memberInitials('', 'zach@aglyn.com')).toBe('Z')
  })

  it('never renders the @ of an address as an initial', () => {
    expect(memberInitials(null, '@weird')).not.toBe('@')
  })
})
