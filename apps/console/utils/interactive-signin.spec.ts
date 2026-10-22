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
  clearInteractiveSignIn,
  consumeInteractiveSignIn,
  consumeInteractiveSignOut,
  markInteractiveSignIn,
  markInteractiveSignOut,
} from './interactive-signin'

describe('interactive-signin marker', () => {
  afterEach(() => {
    window.sessionStorage.clear()
    jest.restoreAllMocks()
  })

  it('marks then consumes exactly once (mint the session, redirect return)', () => {
    markInteractiveSignIn()
    expect(consumeInteractiveSignIn()).toBe(true)
    // Second read is false — a later restore must not be misread as a
    // fresh sign-in and re-mint over a valid session.
    expect(consumeInteractiveSignIn()).toBe(false)
  })

  it('returns false when no sign-in was initiated (genuine restore)', () => {
    expect(consumeInteractiveSignIn()).toBe(false)
  })

  it('treats a stale marker as expired so abandoned sign-ins self-heal', () => {
    const now = 1_000_000
    jest.spyOn(Date, 'now').mockReturnValue(now)
    markInteractiveSignIn()
    // Past the 2-minute window: an earlier failed/abandoned attempt must
    // not force a mint on an unrelated later restore.
    ;(Date.now as jest.Mock).mockReturnValue(now + 120_001)
    expect(consumeInteractiveSignIn()).toBe(false)
  })

  it('honors a fresh marker inside the window', () => {
    const now = 5_000_000
    jest.spyOn(Date, 'now').mockReturnValue(now)
    markInteractiveSignIn()
    ;(Date.now as jest.Mock).mockReturnValue(now + 3_000)
    expect(consumeInteractiveSignIn()).toBe(true)
  })

  it('clear removes a pending marker (same-tab popup/email path)', () => {
    markInteractiveSignIn()
    clearInteractiveSignIn()
    expect(consumeInteractiveSignIn()).toBe(false)
  })

  it('sign-out marker consumes exactly once (AGL-543)', () => {
    markInteractiveSignOut()
    expect(consumeInteractiveSignOut()).toBe(true)
    // A later SDK-initiated auth drop must not be misread as another
    // explicit sign-out and tombstone the shared session.
    expect(consumeInteractiveSignOut()).toBe(false)
  })

  it('auth drop with no sign-out marker reads as unintentional', () => {
    expect(consumeInteractiveSignOut()).toBe(false)
  })

  it('a stale sign-out marker expires (abandoned signout navigation)', () => {
    const now = 2_000_000
    jest.spyOn(Date, 'now').mockReturnValue(now)
    markInteractiveSignOut()
    ;(Date.now as jest.Mock).mockReturnValue(now + 120_001)
    expect(consumeInteractiveSignOut()).toBe(false)
  })

  it('sign-in and sign-out markers are independent keys', () => {
    markInteractiveSignIn()
    markInteractiveSignOut()
    expect(consumeInteractiveSignOut()).toBe(true)
    expect(consumeInteractiveSignIn()).toBe(true)
  })

  it('survives sessionStorage throwing (private mode) without crashing', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('blocked')
      },
    })
    try {
      expect(() => markInteractiveSignIn()).not.toThrow()
      expect(consumeInteractiveSignIn()).toBe(false)
      expect(() => clearInteractiveSignIn()).not.toThrow()
    } finally {
      if (original) Object.defineProperty(window, 'sessionStorage', original)
    }
  })
})
