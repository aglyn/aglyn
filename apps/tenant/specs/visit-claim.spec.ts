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
 * The visitor-approximation claim (AGL-1844). Two properties carry the whole
 * design: the claim is true exactly once per tab per day, and the ONLY thing
 * ever persisted is the day string — the privacy posture is an assertion
 * here, not a comment.
 */
import { claimDailyVisit } from '../app/[host]/[[...slug]]/visit-claim'

beforeEach(() => {
  window.sessionStorage.clear()
})

it('claims the first visit of a day exactly once', () => {
  expect(claimDailyVisit('2026-08-17')).toBe(true)
  expect(claimDailyVisit('2026-08-17')).toBe(false)
  expect(claimDailyVisit('2026-08-17')).toBe(false)
})

it('rolls over at the day boundary — a new day claims again', () => {
  expect(claimDailyVisit('2026-08-17')).toBe(true)
  expect(claimDailyVisit('2026-08-18')).toBe(true)
  expect(claimDailyVisit('2026-08-18')).toBe(false)
})

it('persists the day string and nothing else — no identifier of any kind', () => {
  claimDailyVisit('2026-08-17')
  expect(window.sessionStorage.length).toBe(1)
  expect(window.sessionStorage.getItem('aglyn-visit-day')).toBe('2026-08-17')
})

it('answers false when storage is unavailable — under-counting, never a throw', () => {
  const getItem = jest
    .spyOn(Storage.prototype, 'getItem')
    .mockImplementation(() => {
      throw new Error('storage disabled')
    })
  try {
    expect(claimDailyVisit('2026-08-17')).toBe(false)
  } finally {
    getItem.mockRestore()
  }
})
