/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
 *
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
  clearSignInBounces,
  recordSignInBounce,
  SIGNIN_BOUNCE_LIMIT,
  SIGNIN_BOUNCE_WINDOW_MS,
} from './signin-bounce'

describe('signin bounce breaker (AGL-2486)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    jest.restoreAllMocks()
  })

  it('allows the budget, then refuses', () => {
    const verdicts = Array.from({ length: SIGNIN_BOUNCE_LIMIT + 2 }, () =>
      recordSignInBounce(),
    )
    expect(verdicts.slice(0, SIGNIN_BOUNCE_LIMIT)).toEqual(
      Array(SIGNIN_BOUNCE_LIMIT).fill(true),
    )
    // Every attempt past the cap stays refused — the breaker latches for the
    // rest of the window rather than re-arming on the next redirect.
    expect(verdicts.slice(SIGNIN_BOUNCE_LIMIT)).toEqual([false, false])
  })

  it('re-arms once the window has passed', () => {
    const start = Date.now()
    const clock = jest.spyOn(Date, 'now')
    clock.mockReturnValue(start)
    for (let i = 0; i < SIGNIN_BOUNCE_LIMIT; i++) recordSignInBounce()
    expect(recordSignInBounce()).toBe(false)

    clock.mockReturnValue(start + SIGNIN_BOUNCE_WINDOW_MS + 1)
    // A user who signs out and back in an hour later is not in a loop.
    expect(recordSignInBounce()).toBe(true)
  })

  it('a real sign-in clears the evidence', () => {
    for (let i = 0; i < SIGNIN_BOUNCE_LIMIT; i++) recordSignInBounce()
    expect(recordSignInBounce()).toBe(false)
    clearSignInBounces()
    expect(recordSignInBounce()).toBe(true)
  })

  it('fails OPEN when sessionStorage throws', () => {
    jest
      .spyOn(window.sessionStorage.__proto__, 'getItem')
      .mockImplementation(() => {
        throw new Error('denied')
      })
    // A hardened profile must still be able to reach the sign-in page; an
    // uncounted redirect is the behaviour that shipped before this existed.
    for (let i = 0; i < SIGNIN_BOUNCE_LIMIT + 3; i++) {
      expect(recordSignInBounce()).toBe(true)
    }
  })

  it('a corrupt record does not wedge the breaker shut', () => {
    window.sessionStorage.setItem('aglyn:signin-bounces', 'not json')
    // Unparseable evidence is no evidence: the catch returns true, so the
    // redirect still happens rather than a dialog appearing out of nowhere.
    expect(recordSignInBounce()).toBe(true)
  })
})
