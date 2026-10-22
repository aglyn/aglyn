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
  MOVE_BUDGET_MS,
  MOVE_MAX_ASSETS_PER_REQUEST,
  moveAssetsWithinBudget,
} from './media-move'

/** A clock the spec advances, so no test waits on a real budget. */
function fakeClock(step: number) {
  let now = 0
  return {
    now: () => now,
    tick: () => {
      now += step
    },
  }
}

describe('moveAssetsWithinBudget', () => {
  const ids = (count: number) =>
    Array.from({ length: count }, (_, index) => `m${index + 1}`)

  it('moves everything and reports done when the work fits', async () => {
    const clock = fakeClock(10)
    const result = await moveAssetsWithinBudget({
      mediaIds: ids(19),
      now: clock.now,
      moveOne: async () => {
        clock.tick()
      },
    })
    expect(result.movedIds).toHaveLength(19)
    expect(result.failedIds).toEqual([])
    expect(result.remainingIds).toEqual([])
    expect(result.done).toBe(true)
  })

  /**
   * The whole of AGL-1469. Nineteen assets do not fit in one invocation, so
   * the request has to STOP and say where it stopped rather than being cut
   * off mid-loop by the platform — which is what produced a 504, an
   * unparseable body, and a red "Move failed" over seven assets that had
   * already been copied to a new prefix.
   */
  it('stops on the time budget and hands back the untouched tail', async () => {
    const clock = fakeClock(MOVE_BUDGET_MS / 4)
    const result = await moveAssetsWithinBudget({
      mediaIds: ids(19),
      now: clock.now,
      moveOne: async () => {
        clock.tick()
      },
    })
    expect(result.done).toBe(false)
    expect(result.movedIds.length).toBeGreaterThan(0)
    expect(result.movedIds.length).toBeLessThan(19)
    // Every id is accounted for exactly once — the property the snackbar's
    // "7 of 19" depends on, and the one a partial failure used to break.
    expect([
      ...result.movedIds,
      ...result.failedIds,
      ...result.remainingIds,
    ].sort()).toEqual(ids(19).sort())
  })

  /**
   * A budget smaller than one asset must still move one asset. A request
   * that yields having done nothing makes the client loop forever.
   */
  it('always makes progress, even when one asset outlasts the whole budget', async () => {
    const clock = fakeClock(MOVE_BUDGET_MS * 10)
    const result = await moveAssetsWithinBudget({
      mediaIds: ids(5),
      now: clock.now,
      moveOne: async () => {
        clock.tick()
      },
    })
    expect(result.movedIds).toEqual(['m1'])
    expect(result.remainingIds).toEqual(['m2', 'm3', 'm4', 'm5'])
  })

  /**
   * One asset failing is not the request failing. The loop used to `throw`,
   * which discarded the count of everything already moved — the delete path's
   * old shape (AGL-1461), one verb along.
   */
  it('keeps going past a failed asset and reports both halves', async () => {
    const clock = fakeClock(1)
    const result = await moveAssetsWithinBudget({
      mediaIds: ids(4),
      now: clock.now,
      moveOne: async (id) => {
        clock.tick()
        if (id === 'm2') throw new Error('storage said no')
      },
    })
    expect(result.movedIds).toEqual(['m1', 'm3', 'm4'])
    expect(result.failedIds).toEqual(['m2'])
    expect(result.done).toBe(true)
  })

  it('caps one request and returns the overflow rather than dropping it', async () => {
    const clock = fakeClock(0)
    const result = await moveAssetsWithinBudget({
      mediaIds: ids(MOVE_MAX_ASSETS_PER_REQUEST + 7),
      now: clock.now,
      moveOne: async () => undefined,
    })
    expect(result.movedIds).toHaveLength(MOVE_MAX_ASSETS_PER_REQUEST)
    expect(result.remainingIds).toHaveLength(7)
    expect(result.done).toBe(false)
  })
})
