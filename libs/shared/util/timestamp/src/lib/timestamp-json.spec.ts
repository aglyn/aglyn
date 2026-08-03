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

import { Timestamp } from './timestamp'
import { TIMESTAMP_JSON_TYPE, timestampNowJson } from './timestamp-json'

/**
 * `timestampNowJson()` exists only to produce what `Timestamp.now().toJSON()`
 * produced, without dragging the Firestore client in behind it (AGL-1151).
 * The equivalence IS the contract, so it is asserted against the real class
 * rather than against a hand-copied literal — a hand-copied expectation would
 * keep passing if the class's shape ever changed underneath it.
 */
describe('timestampNowJson', () => {
  it('matches the shape of Timestamp.now().toJSON()', () => {
    expect(Object.keys(timestampNowJson()).sort()).toEqual(
      Object.keys(Timestamp.now().toJSON()).sort(),
    )
  })

  it('carries the same wire type tag as the class', () => {
    expect(timestampNowJson().type).toBe(Timestamp.now().toJSON().type)
    expect(timestampNowJson().type).toBe(TIMESTAMP_JSON_TYPE)
  })

  it('agrees with the class on the same instant', () => {
    const spy = jest.spyOn(Date, 'now').mockReturnValue(1_754_180_000_123)
    try {
      expect(timestampNowJson()).toEqual(Timestamp.now().toJSON())
    } finally {
      spy.mockRestore()
    }
  })

  it('splits milliseconds into whole-millisecond nanoseconds', () => {
    const spy = jest.spyOn(Date, 'now').mockReturnValue(1_754_180_000_123)
    try {
      // 123ms past the second, expressed in nanoseconds. Firestore truncates to
      // microseconds on write anyway, so millisecond resolution here loses
      // nothing that would have survived the round trip.
      expect(timestampNowJson()).toEqual({
        seconds: 1_754_180_000,
        nanoseconds: 123_000_000,
        type: TIMESTAMP_JSON_TYPE,
      })
    } finally {
      spy.mockRestore()
    }
  })
})
