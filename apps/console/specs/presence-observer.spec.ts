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

/**
 * The two invariants that make a WATCHER safe (AGL-2486).
 *
 * `use-presence.ts` talks to a live Realtime Database through a brokered
 * second Firebase app, so these are asserted against the SOURCE rather than by
 * driving the hook — there is no RTDB harness in this app, and a fake faithful
 * enough to prove anything here would be most of the SDK. That is a real limit
 * on what these tests prove, so they are written to fail on the specific
 * mutations that would reintroduce each defect, and both were shown red first.
 *
 * The behavioural half — that a detail page actually asks for `observeOnly` —
 * is in `document-presence-detail.spec.tsx`, where it can be driven properly.
 */

const source = readFileSync(
  join(__dirname, '..', 'hooks', 'use-presence.ts'),
  'utf8',
)

/** The body of effect 2's cleanup — from its `return () => {` to its close. */
function roomEffectCleanup(): string {
  const marker = source.indexOf('meRefHolder.current = observeOnly')
  expect(marker).toBeGreaterThan(-1)
  const start = source.indexOf('return () => {', marker)
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('\n    }', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

/**
 * A watcher must not become a participant.
 *
 * Every RTDB write in the room effect is reached through
 * `meRefHolder.current`, which observe-only pins to null, or is guarded
 * directly. If a future write is added that does neither, this is the test
 * that should notice — so it checks the pin exists rather than merely that
 * the option is accepted.
 */
describe('observing a room without joining it', () => {
  it('pins the write handle to null, which is what suppresses every write', () => {
    expect(source).toContain('meRefHolder.current = observeOnly ? null : meRef')
  })

  it('never announces, so no row is written for a page that is only looking', () => {
    // The announce is driven solely by `.info/connected`; an observer must not
    // subscribe to it at all, or the callback would write a row.
    expect(source).toContain('const unsubscribeConnected = observeOnly')
  })

  it('writes no heartbeat, because it has no session to keep alive', () => {
    const heartbeat = source.slice(
      source.indexOf('const heartbeat = setInterval'),
      source.indexOf('meRefHolder.current = observeOnly'),
    )
    expect(heartbeat).toContain('if (observeOnly) return')
    // It still re-projects: staleness is a function of the clock, so a room
    // nobody writes to must still fade rather than freeze on screen.
    expect(heartbeat).toContain('project()')
  })

  it('removes nothing on unmount — there is nothing of its own to remove', () => {
    const cleanup = roomEffectCleanup()
    expect(cleanup).toContain('if (observeOnly) return')
    expect(cleanup.indexOf('if (observeOnly) return')).toBeLessThan(
      cleanup.indexOf('remove(meRef)'),
    )
  })

  it('is a real option on the hook, defaulted OFF so every editor is unchanged', () => {
    expect(source).toContain('observeOnly?: boolean')
    expect(source).toContain('observeOnly = false')
  })
})

/**
 * The `.info/connected` listener has to be torn down with the room.
 *
 * It was created and never unsubscribed. Because effect 2 re-runs on `docId`
 * and `versionId`, moving between documents left one live listener per room
 * visited, each still closed over the `meRef` of a room already left — so the
 * next reconnection re-announced the OLD row and put the user back into a
 * document they had navigated away from, until the reaper swept it.
 *
 * The removal on cleanup did not save it: `remove()` is a one-shot and the
 * listener outlives it.
 */
describe('leaving a room', () => {
  it('unsubscribes the connection listener that re-announces', () => {
    expect(roomEffectCleanup()).toContain('unsubscribeConnected()')
  })

  it('does so for an observer too, before the observe-only early return', () => {
    // An observer's listener is inert, but an early return placed above this
    // would leak it for the participant case as well the moment the two
    // branches were reordered.
    const cleanup = roomEffectCleanup()
    expect(cleanup.indexOf('unsubscribeConnected()')).toBeLessThan(
      cleanup.indexOf('if (observeOnly) return'),
    )
  })
})
