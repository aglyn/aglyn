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
  deadDocumentPaths,
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

describe('sweeping a DOCUMENT clears both room shapes (AGL-2486)', () => {
  const NOW2 = 1_800_000_000_000
  const at2 = (agoMs: number) => ({ lastSeenAt: NOW2 - agoMs })
  const DEAD = PRESENCE_REAP_AFTER_MS + 1

  it('reaps a dead row inside a version-scoped room', () => {
    expect(
      deadDocumentPaths({ v: { ver1: { u1: { s1: at2(DEAD) } } } }, NOW2),
    ).toEqual(['v/ver1/u1/s1'])
  })

  it('reaps LEGACY document-scoped rows an older client left behind', () => {
    // Nothing reads these once a client is version-scoped, so without this
    // they would sit there until something else happened to look.
    expect(deadDocumentPaths({ u1: { s1: at2(DEAD) } }, NOW2)).toEqual([
      'u1/s1',
    ])
  })

  it('reaps both shapes in one pass, which is the point of sweeping the document', () => {
    const dead = deadDocumentPaths(
      {
        v: { ver1: { u1: { s1: at2(DEAD) } }, ver2: { u2: { s2: at2(DEAD) } } },
        u3: { s3: at2(DEAD) },
      },
      NOW2,
    )
    expect(dead.sort()).toEqual(['u3/s3', 'v/ver1/u1/s1', 'v/ver2/u2/s2'])
  })

  it('sweeps versions the joining caller is NOT in', () => {
    // A version nobody reopens would otherwise keep its dead rows forever;
    // the join read already has them in hand.
    expect(
      deadDocumentPaths({ v: { other: { u1: { s1: at2(DEAD) } } } }, NOW2),
    ).toEqual(['v/other/u1/s1'])
  })

  it('leaves a LIVE session alone in either shape', () => {
    expect(
      deadDocumentPaths(
        { v: { ver1: { u1: { s1: at2(1_000) } } }, u2: { s2: at2(1_000) } },
        NOW2,
      ),
    ).toEqual([])
  })

  it('never mistakes the literal `v` segment for a uid', () => {
    // `v` is a path literal; a Firebase uid is 28 characters and is never it.
    // Reading it as a uid would build `v/{versionId}` as a session path and
    // delete a whole version room.
    const dead = deadDocumentPaths({ v: { ver1: { u1: { s1: at2(DEAD) } } } }, NOW2)
    expect(dead).not.toContain('v/ver1')
    expect(dead.every((path) => path.split('/').length === 4)).toBe(true)
  })

  it('survives an empty or malformed document node', () => {
    expect(deadDocumentPaths(null, NOW2)).toEqual([])
    expect(deadDocumentPaths({}, NOW2)).toEqual([])
    expect(deadDocumentPaths({ v: null } as never, NOW2)).toEqual([])
    expect(deadDocumentPaths({ v: { ver1: null } } as never, NOW2)).toEqual([])
  })
})
