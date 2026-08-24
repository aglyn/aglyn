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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createRoomProjector,
  PRESENCE_STALE_MS,
  TAB_SESSION_ID,
  type PresenceEntry,
  type RoomProjection,
} from '../hooks/use-presence'

/**
 * The presence projection has to SETTLE (AGL-2486).
 *
 * Zach hit `Maximum update depth exceeded` in the besigner on 2026-08-24 —
 * React bailing out, not warning. The stack read, innermost first:
 *
 *   at usePresence.useEffect.project      (setEntries)
 *   at usePresence.useEffect.unsubscribe  (the room onValue callback)
 *   at usePresence.useEffect.clearCursor  (the update() that withdraws a cursor)
 *   at usePresence.useEffect.onMove       (a pointermove)
 *
 * — one JS stack, because `@firebase/database` raises a local write's events
 * SYNCHRONOUSLY inside `update()` (`eventQueueRaiseQueuedEventsMatchingPredicate`,
 * whose own doc comment says so). So this tab's every write re-enters its own
 * room listener, and `project()` answered each one with three `setState`s
 * carrying brand-new arrays.
 *
 * The tests below drive that exact shape: the same room, re-projected while
 * only THIS TAB'S OWN row changes and the clock advances. `projectRoom` skips
 * this tab's own session, so the drawn projection cannot have changed — and
 * the projector must therefore commit nothing.
 *
 * Every test here fails if the bail-out in `createRoomProjector` is removed
 * (verified by deleting the `key === committed` guard: 3 of the 5 redden, and
 * the two that stay green are the ones that assert a change DOES commit).
 */

const ME = 'zach'
const NOW = 1_756_000_000_000

function peer(overrides: Partial<PresenceEntry> = {}): PresenceEntry {
  return {
    displayName: 'Robin Peer',
    lastSeenAt: NOW,
    colour: '#1a73e8',
    ...overrides,
  } as PresenceEntry
}

/** A room with one live peer and this tab's own row in it. */
function room(
  ownOverrides: Partial<PresenceEntry> = {},
  peerOverrides: Partial<PresenceEntry> = {},
): Record<string, Record<string, PresenceEntry>> {
  return {
    peerUid: { tabOne: peer(peerOverrides) },
    [ME]: {
      [TAB_SESSION_ID]: peer({
        displayName: 'Zach Gover',
        ...ownOverrides,
      }),
    },
  }
}

function projector() {
  const commits: RoomProjection[] = []
  const instance = createRoomProjector(ME, (projected) =>
    commits.push(projected),
  )
  return { ...instance, commits }
}

describe('a write of our own must not commit a projection', () => {
  it('does not commit again when only our own cursor moves', () => {
    const { project, commits } = projector()

    expect(project(room(), NOW)).toBe(true)
    expect(commits).toHaveLength(1)
    expect(commits[0].entries).toHaveLength(1)

    // 40 cursor writes at the broadcast ceiling. Each one is a real RTDB
    // write, each one re-enters the room listener synchronously, and not one
    // of them changes anything anybody draws.
    let committedAgain = false
    for (let tick = 1; tick <= 40; tick += 1) {
      const at = NOW + tick * 60
      const changed = project(
        room({ cursorX: tick / 100, cursorY: tick / 100, lastSeenAt: at }),
        at,
      )
      committedAgain = committedAgain || changed
    }

    expect(committedAgain).toBe(false)
    expect(commits).toHaveLength(1)
  })

  it('does not commit when our own cursor is WITHDRAWN', () => {
    // `clearCursor` is the frame in Zach's stack, and it is the one path in
    // `onMove` that never stamps the throttle — so it can fire on every
    // single pointermove.
    const { project, commits } = projector()
    project(room({ cursorX: 0.4, cursorY: 0.4 }), NOW)
    expect(commits).toHaveLength(1)

    for (let tick = 1; tick <= 40; tick += 1) {
      const at = NOW + tick * 8
      project(room({ cursorX: undefined, cursorY: undefined }), at)
    }
    expect(commits).toHaveLength(1)
  })

  it('does not commit on our own heartbeat', () => {
    const { project, commits } = projector()
    project(room(), NOW)
    expect(commits).toHaveLength(1)

    for (let beat = 1; beat <= 5; beat += 1) {
      const at = NOW + beat * 20_000
      project(room({ lastSeenAt: at }), at)
    }
    expect(commits).toHaveLength(1)
  })
})

describe('the bail-out is not a blanket mute', () => {
  it('commits when a PEER moves their cursor', () => {
    const { project, commits } = projector()
    project(room(), NOW)
    expect(commits).toHaveLength(1)

    expect(project(room({}, { cursorX: 0.5, cursorY: 0.5 }), NOW + 60)).toBe(
      true,
    )
    expect(commits).toHaveLength(2)
    expect(commits[1].entries[0].cursorX).toBe(0.5)
  })

  it('commits when a peer goes stale, which only the CLOCK can tell us', () => {
    // The heartbeat re-projects on a timer precisely because a room nobody is
    // writing to still has to fade. That must survive the bail-out: the room
    // payload here never changes, only `now` does.
    const { project, commits } = projector()
    const fixed = room()
    project(fixed, NOW)
    expect(commits[0].entries).toHaveLength(1)

    expect(project(fixed, NOW + PRESENCE_STALE_MS + 1)).toBe(true)
    expect(commits).toHaveLength(2)
    expect(commits[1].entries).toHaveLength(0)
  })

  it('commits an identical projection again after a reset', () => {
    // The room-read refusal blanks the state itself; without the reset the
    // next projection would be compared against a screen that no longer
    // shows it, and skipped.
    const { project, reset, commits } = projector()
    project(room(), NOW)
    expect(commits).toHaveLength(1)
    expect(project(room(), NOW)).toBe(false)

    reset()
    expect(project(room(), NOW)).toBe(true)
    expect(commits).toHaveLength(2)
  })
})

describe('the hook actually routes through the projector', () => {
  /**
   * A bail-out nothing calls is worth nothing. `createRoomProjector` is a
   * pure function, so every test above would stay green if the room listener
   * went back to calling `projectRoom` and `setEntries` directly — which is
   * exactly the code this replaced.
   */
  const source = readFileSync(
    join(__dirname, '..', 'hooks', 'use-presence.ts'),
    'utf8',
  )

  it('leaves no unguarded projectRoom call inside the hook', () => {
    const hookBody = source.slice(source.indexOf('export function usePresence'))
    expect(hookBody).toContain('createRoomProjector(')
    expect(hookBody).not.toContain('projectRoom(')
  })

  it('resets the projector on the room refusal path', () => {
    expect(source).toContain('projector.reset()')
  })
})
