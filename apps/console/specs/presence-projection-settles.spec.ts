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
 * @jest-environment jsdom
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createCursorTracker,
  createRoomProjector,
  CURSOR_THROTTLE_MS,
  PRESENCE_STALE_MS,
  TAB_SESSION_ID,
  type PresenceEntry,
  type RoomProjection,
} from '../hooks/use-presence'

/**
 * The presence projection has to SETTLE (AGL-2486).
 *
 * Without the guard this file pins, the besigner takes a
 * `Maximum update depth exceeded` — React bailing out, not warning. The stack,
 * innermost first:
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
    // `clearCursor` is the frame in the stack, and it is the one path in
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

/**
 * The second half of the same bill: work presence does per POINTER MOVE.
 *
 * `onMove` stamped its throttle clock only on the path that WRITES a
 * position, so every path that declined to write left the gate open for the
 * very next `pointermove`. The gate throttled the write; it did not throttle
 * the measuring in front of it — `getCanvasRoot()`,
 * `getBoundingClientRect()`, and, for a pointer inside the box but occluded,
 * `document.elementFromPoint()` plus `pointerIsOnCanvas`. Two forced layouts
 * per move on the besigner's hottest path.
 *
 * Both collaborators are injected here precisely so they can be COUNTED —
 * "how many times was the hit test run" is the whole claim, and it is not
 * observable any other way.
 */
describe('the pointer hit test is throttled, not just the write', () => {
  const BOX = { left: 0, top: 0, width: 1000, height: 1000 }

  function harness() {
    const root = document.createElement('div')
    const insideCanvas = document.createElement('span')
    root.append(insideCanvas)
    const overlappingPanel = document.createElement('div')
    document.body.append(root, overlappingPanel)
    root.getBoundingClientRect = () => BOX as DOMRect

    let occluded = false
    const counts = { getRoot: 0, hitTest: 0 }
    const tracker = createCursorTracker({
      getRoot: () => {
        counts.getRoot += 1
        return root
      },
      elementAt: () => {
        counts.hitTest += 1
        return occluded ? overlappingPanel : insideCanvas
      },
    })
    return {
      tracker,
      counts,
      occlude: () => {
        occluded = true
      },
      reveal: () => {
        occluded = false
      },
    }
  }

  /** Real epoch values: the gate compares against a clock that starts at 0. */
  const T0 = 1_756_000_000_000
  const MOVES = 40
  /** 8 ms apart — well under the throttle, which is the point. */
  const STEP = 8
  const SPAN = (MOVES - 1) * STEP
  /** One per interval, plus the one that opens the window. */
  const CEILING = Math.ceil(SPAN / CURSOR_THROTTLE_MS) + 1

  it('does not hit-test on every move while the pointer is OCCLUDED', () => {
    const { tracker, counts, occlude } = harness()
    occlude()

    for (let move = 0; move < MOVES; move += 1) {
      // A real pointer path: inside the canvas box, but under a panel.
      tracker.move(400 + move, 400 + move, T0 + move * STEP)
    }

    expect(counts.hitTest).toBeGreaterThan(0)
    expect(counts.hitTest).toBeLessThanOrEqual(CEILING)
    expect(counts.getRoot).toBeLessThanOrEqual(CEILING)
    // The mutation this is really guarding: 40 moves, 40 hit tests.
    expect(counts.hitTest).toBeLessThan(MOVES)
  })

  it('does not re-measure on every move while the pointer RESTS', () => {
    // A hand lying still on the mouse — the `CURSOR_MIN_DELTA` bail-out,
    // which also never stamped the clock.
    const { tracker, counts } = harness()

    for (let move = 0; move < MOVES; move += 1) {
      tracker.move(400, 400, T0 + move * STEP)
    }

    expect(counts.getRoot).toBeGreaterThan(0)
    expect(counts.getRoot).toBeLessThanOrEqual(CEILING)
    expect(counts.getRoot).toBeLessThan(MOVES)
  })

  it('does not re-measure on every move while the pointer is OFF the box', () => {
    // Off-box returns before the hit test, so `getRoot` is what counts here.
    const { tracker, counts } = harness()

    for (let move = 0; move < MOVES; move += 1) {
      tracker.move(-50, -50, T0 + move * STEP)
    }

    expect(counts.getRoot).toBeGreaterThan(0)
    expect(counts.getRoot).toBeLessThan(MOVES)
  })
})

describe('throttling the hit test did not mute the cursor', () => {
  const BOX = { left: 0, top: 0, width: 1000, height: 1000 }
  const T0 = 1_756_000_000_000

  function harness() {
    const root = document.createElement('div')
    const insideCanvas = document.createElement('span')
    root.append(insideCanvas)
    const overlappingPanel = document.createElement('div')
    document.body.append(root, overlappingPanel)
    root.getBoundingClientRect = () => BOX as DOMRect
    let occluded = false
    let hitTests = 0
    const tracker = createCursorTracker({
      getRoot: () => root,
      elementAt: () => {
        hitTests += 1
        return occluded ? overlappingPanel : insideCanvas
      },
    })
    return {
      tracker,
      hits: () => hitTests,
      occlude: () => {
        occluded = true
      },
      reveal: () => {
        occluded = false
      },
    }
  }

  it('registers a genuine move, at the position it always sent', () => {
    const { tracker } = harness()
    // Normalised against the box — the payload contract peers read.
    expect(tracker.move(250, 750, T0)).toEqual({ x: 0.25, y: 0.75 })
  })

  it('keeps the write rate: one move per interval still writes', () => {
    const { tracker } = harness()
    let written = 0
    for (let move = 0; move < 10; move += 1) {
      const intent = tracker.move(
        100 + move * 50,
        100 + move * 50,
        T0 + move * CURSOR_THROTTLE_MS,
      )
      if (typeof intent === 'object') written += 1
    }
    expect(written).toBe(10)
  })

  it('runs the FIRST move after the throttle window, having skipped inside it', () => {
    const { tracker, occlude, reveal } = harness()
    expect(tracker.move(250, 250, T0)).toEqual({ x: 0.25, y: 0.25 })

    occlude()
    expect(tracker.move(300, 300, T0 + CURSOR_THROTTLE_MS)).toBe('withdraw')
    expect(tracker.withdraw()).toBe(true)
    // Inside the window, nothing is decided at all.
    expect(tracker.move(400, 400, T0 + CURSOR_THROTTLE_MS + 5)).toBe('skip')

    reveal()
    expect(tracker.move(400, 400, T0 + CURSOR_THROTTLE_MS * 2)).toEqual({
      x: 0.4,
      y: 0.4,
    })
  })

  it('withdraws a cursor once, not on every move that finds it gone', () => {
    const { tracker, occlude } = harness()
    tracker.move(250, 250, T0)
    occlude()
    expect(tracker.move(260, 260, T0 + CURSOR_THROTTLE_MS)).toBe('withdraw')
    expect(tracker.withdraw()).toBe(true)
    expect(tracker.withdraw()).toBe(false)
    expect(tracker.move(270, 270, T0 + CURSOR_THROTTLE_MS * 2)).toBe('skip')
  })

  it('leaves the focus re-check UNTHROTTLED, which is what AGL-2486 fixed', () => {
    // A panel opening while the hand is still generates no pointermove. The
    // re-check is triggered by focus, not by pointer traffic, so the throttle
    // must not reach it — a stale cursor on a colleague's screen is the bug.
    const { tracker, hits, occlude } = harness()
    tracker.move(250, 250, T0)
    const afterMove = hits()

    occlude()
    expect(tracker.recheck()).toBe('withdraw')
    expect(tracker.recheck()).toBe('withdraw')
    // Both re-checks really hit-tested, inside one throttle window.
    expect(hits()).toBe(afterMove + 2)
  })
})

describe('the hook actually routes through the cursor tracker', () => {
  const source = readFileSync(
    join(__dirname, '..', 'hooks', 'use-presence.ts'),
    'utf8',
  )
  const hookBody = source.slice(source.indexOf('export function usePresence'))

  it('builds a tracker and asks it what a move means', () => {
    expect(hookBody).toContain('createCursorTracker(')
    expect(hookBody).toContain('tracker.move(')
  })

  it('no longer runs the hit test inline in the move handler', () => {
    // If somebody re-inlines `pointerIsOnCanvas` into `onMove`, it escapes
    // the throttle again and this is the only thing that would notice.
    expect(hookBody).not.toContain('pointerIsOnCanvas(')
  })
})
