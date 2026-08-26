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
 * Two sessions of one account sharing a colour, and a chip drawing a question
 * mark, are failures of the same promise: an avatar per session, each
 * identifiable. Both are invisible to a suite that picks a colour per session
 * in isolation and renders an avatar from whatever the room happens to
 * contain, which is why the cases below work over a whole room.
 */

const entry = (over: Record<string, unknown> = {}) => ({
  displayName: 'Zach Gover',
  lastSeenAt: 1_000_000,
  ...over,
})

const NOW = 1_000_000

/**
 * Real keys, CHOSEN BECAUSE THEY COLLIDE under a per-session hash: a real
 * account uid, and session ids in the shape `createResourceUid` produces.
 *
 * Picking arbitrary keys is what makes a test like this worthless — six keys
 * drawn at random are likely to hash to six different slots, and the spec
 * then passes against a build that collides in practice. These six occupy
 * three slots under a per-session hash, so a regression to one fails here.
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
    // Six sessions of ONE account. Under a per-session hash these take only
    // three of the six colours, so three pairs of sessions are indistinguishable
    // on the canvas.
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

describe('no two LIVE sessions in a room share a colour', () => {
  /**
   * DISJOINTNESS, not determinism (AGL-2486).
   *
   * The previous round moved colour from a per-session hash to a room-wide
   *
   * The allocation WAS disjoint. Its INPUT was every row in the room,
   * including reaped ones, and his room held 15 rows against a palette of 6.
   * Once six colours are taken the probe has nowhere to go and the remaining
   * keys fall back to their raw hash, so the handful of sessions actually
   * drawn were a subset of a pool that had already collided. Measured over
   * 2000 seeded rooms of 5 live + 10 dead rows, the pre-fix allocation
   * collided on 86.1% of them — 12.3% at two live sessions, 98.3% at six.
   *
   * "Deterministic and room-wide" only says a session KEEPS its colour. It
   * says nothing about two sessions DIFFERING, which is the property the
   * screen needs. So this asserts the property over many rooms rather than
   * over one hand-picked one: the first version of this test used tidy
   * synthetic keys, and it passed against the broken code because those keys
   * happened not to clash.
   */
  const NOW_L = 2_000_000_000_000
  const live = (n: number) => ({
    displayName: 'Zach Gover',
    lastSeenAt: NOW_L - 1_000 * n,
  })
  const dead = (n: number) => ({
    displayName: 'Zach Gover',
    lastSeenAt: NOW_L - 3_600_000 - n,
  })

  /** Seeded, so a failure is reproducible rather than a Heisenbug. */
  function makeRandom(seed: number) {
    let state = seed >>> 0
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0
      return state / 4294967296
    }
  }
  const ALPHABET =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'

  for (let liveCount = 2; liveCount <= AVATAR_COLOURS.length; liveCount += 1) {
    it(`keeps ${liveCount} live sessions on ${liveCount} colours across 300 rooms`, () => {
      const random = makeRandom(1000 + liveCount)
      const sessionId = () => {
        let out = ''
        for (let i = 0; i < 10; i += 1) {
          out += ALPHABET[Math.floor(random() * ALPHABET.length)]
        }
        return out
      }
      const collided: string[] = []
      for (let room = 0; room < 300; room += 1) {
        const sessions: Record<string, unknown> = {}
        for (let i = 0; i < liveCount; i += 1) sessions[sessionId()] = live(i)
        // Reaped rows, which is what a real room accumulates between sweeps.
        // On the pre-fix tree these ate the palette before a single visible
        // session was allocated anything.
        for (let i = 0; i < 10; i += 1) sessions[sessionId()] = dead(i)
        const { entries } = projectRoom(
          { u1: sessions } as never,
          'viewer',
          NOW_L,
        )
        const colours = entries.map((entry) => entry.colour)
        if (new Set(colours).size !== liveCount) collided.push(colours.join(','))
      }
      expect(collided).toEqual([])
    })
  }

  it('agrees between two viewers looking at the same room', () => {
    // Every viewer must compute the same colour for the same session, or the
    // ring beside a name in one window will not match the cursor in the
    // other. The allocation is therefore taken over the whole LIVE room, not
    // over the subset a given viewer happens to draw.
    const room = {
      a: { s1: live(1) },
      b: { s2: live(2), s3: live(3) },
      c: { s4: live(4) },
    } as never
    const byA = projectRoom(room, 'a', NOW_L)
    const byB = projectRoom(room, 'b', NOW_L)
    const colourOf = (result: { entries: { key: string; colour?: string }[] }) =>
      Object.fromEntries(result.entries.map((e) => [e.key, e.colour]))
    const a = colourOf(byA)
    const b = colourOf(byB)
    const shared = Object.keys(a).filter((key) => key in b)
    expect(shared.length).toBeGreaterThan(0)
    for (const key of shared) expect(b[key]).toBe(a[key])
  })

  it('does not repaint the survivors when a session is reaped', () => {
    // The reaper removes rows underneath a live room, and a departure must
    // not reshuffle everyone — that is disjoint and horrible to look at.
    // Holds because each key keeps its own hashed colour unless an
    // EARLIER-SORTED session already holds it.
    const before = projectRoom(
      { u: { s1: live(1), s2: live(2), s3: live(3) } } as never,
      'viewer',
      NOW_L,
    )
    const after = projectRoom(
      { u: { s1: live(1), s3: live(3) } } as never,
      'viewer',
      NOW_L,
    )
    const colourOf = (
      result: { entries: { key: string; colour?: string }[] },
      key: string,
    ) => result.entries.find((entry) => entry.key === key)?.colour
    expect(colourOf(after, 'u:s1')).toBe(colourOf(before, 'u:s1'))
    expect(colourOf(after, 'u:s3')).toBe(colourOf(before, 'u:s3'))
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
    // Empty initials draw a `?` disc. Anything in the room that cannot
    // produce initials is not a collaborator and must not become an avatar —
    // a phantom that draws a cursor and a selection box is worse than a
    // missing one.
    const { entries } = projectRoom(
      {
        u1: { s1: entry() },
        // A malformed row: the shape an abandoned fixture leaves behind in
        // the database, with no `displayName` under the session key.
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
    // A SAML account signs in through a tenant pool whose assertion carries
    // no picture and may carry no name: `photoURL` and `displayName` both
    // arrive undefined, so initials are the whole avatar for that account.
    expect(memberInitials('', 'zach@aglyn.com')).toBe('Z')
  })

  it('never renders the @ of an address as an initial', () => {
    expect(memberInitials(null, '@weird')).not.toBe('@')
  })
})
