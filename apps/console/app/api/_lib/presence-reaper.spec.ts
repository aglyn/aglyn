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
  PRESENCE_REAP_AFTER_MS,
  deadSessionKeys,
} from './presence-reaper'

/**
 * The reaper's boundary (AGL-2486).
 *
 * These assert the side of the line each row falls on, at a fixed clock. A
 * live sweep cannot pin this down — you cannot hold a session at exactly 29
 * minutes of staleness and watch — and it is the one thing that must not be
 * wrong: deleting a live row re-creates the "presence keeps disappearing"
 * symptom this whole issue began with.
 */

const NOW = 1_800_000_000_000
const at = (agoMs: number) => ({ lastSeenAt: NOW - agoMs })

describe('a session that could still be alive is never reaped', () => {
  it('keeps a row beating at the throttled background rate', () => {
    // A hidden tab's timers are throttled to about one tick a minute, so ~60s
    // of staleness is the WORST a genuinely open tab produces. This is the
    // case that must never be touched.
    expect(deadSessionKeys({ u: { s: at(60_000) } }, NOW)).toEqual([])
  })

  it('keeps a row that is stale enough to be hidden but not to be deleted', () => {
    // Between the display rule (150s) and the deletion rule (30 min) a row is
    // invisible and still present. That gap is deliberate: it is where a
    // laptop that slept for ten minutes lives, and it comes back.
    expect(deadSessionKeys({ u: { s: at(10 * 60_000) } }, NOW)).toEqual([])
  })

  it('keeps a row one millisecond inside the threshold', () => {
    expect(
      deadSessionKeys({ u: { s: at(PRESENCE_REAP_AFTER_MS - 1) } }, NOW),
    ).toEqual([])
  })

  it('leaves the threshold an order of magnitude above the beat', () => {
    // The margin IS the safety property, so it is asserted rather than left
    // to a comment that a later tune-up could contradict.
    expect(PRESENCE_REAP_AFTER_MS).toBeGreaterThanOrEqual(20 * 60_000)
  })
})

describe('a row that is provably dead is removed', () => {
  it('reaps one that is past the threshold', () => {
    expect(
      deadSessionKeys({ u: { s: at(PRESENCE_REAP_AFTER_MS + 1) } }, NOW),
    ).toEqual(['u/s'])
  })

  it('reaps the four-hour-old rows actually found on production', () => {
    // The measurement that opened this: ~20 dead rows, the oldest four hours.
    expect(deadSessionKeys({ u: { old: at(4 * 3_600_000) } }, NOW)).toEqual([
      'u/old',
    ])
  })

  it('reaps only the dead sessions of a person who also has a live one', () => {
    // The case that would evict somebody if it were keyed on the uid rather
    // than the session: one window open, three long dead.
    const dead = deadSessionKeys(
      {
        zach: {
          live: at(5_000),
          gone1: at(4 * 3_600_000),
          gone2: at(2 * 3_600_000),
        },
      },
      NOW,
    )
    expect(dead.sort()).toEqual(['zach/gone1', 'zach/gone2'])
  })
})

describe('an unmeasurable row is kept, not guessed at', () => {
  it('keeps a row with no timestamp', () => {
    // "Cannot be shown to be dead" is not "is dead". The safe direction is to
    // leave a row that should have gone.
    expect(
      deadSessionKeys({ u: { s: { displayName: 'Zach' } } } as never, NOW),
    ).toEqual([])
  })

  it('keeps a row whose timestamp is not a finite number', () => {
    expect(
      deadSessionKeys(
        { u: { a: { lastSeenAt: 'old' }, b: { lastSeenAt: NaN } } } as never,
        NOW,
      ),
    ).toEqual([])
  })

  it('survives an empty, null or malformed room', () => {
    expect(deadSessionKeys(null, NOW)).toEqual([])
    expect(deadSessionKeys({}, NOW)).toEqual([])
    expect(deadSessionKeys({ u: null } as never, NOW)).toEqual([])
    expect(deadSessionKeys({ u: { s: null } } as never, NOW)).toEqual([])
  })
})
