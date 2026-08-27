/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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

/**
 * Clicking the provider button must not send the reader to /signin.
 *
 * The re-auth dialog signs the user out BEFORE the credential ceremony — a
 * stale session's denied reads survive an in-place token refresh (AGL-1062) —
 * and on a browser taking the redirect path that ceremony is a full
 * navigation. `isMobileBrowser` is true for any Mac reporting touch points,
 * so this is not only phones.
 *
 * So the tab returns signed out, with the prompt that was holding the page
 * erased by the reload, while Firebase is still resolving the redirect result.
 * The layout reads "not signed in, nothing pending" and bounces — all the way
 * back, from the one dialog whose promise is that you stay where you are.
 *
 * `jest.resetModules()` is the reload: fresh module state, same
 * `sessionStorage`. No React here, so it is safe — the store is a plain
 * module.
 */

type Store = typeof import('../utils/session-reauth')

const load = (): Store => {
  jest.resetModules()
  return require('../utils/session-reauth')
}

/** A tab that has navigated away and come back. */
const reload = load

beforeEach(() => {
  sessionStorage.clear()
})

describe('a re-auth that leaves the page', () => {
  it('restores the prompt the reload erased', () => {
    const before = load()
    before.requestSessionReauth('revoked', {
      email: 'someone@example.test',
      hasPassword: false,
      providerId: 'google.com',
    })
    before.markSessionReauthRedirect()

    const after = reload()
    // The reload really did lose it — otherwise the restore below would be
    // testing nothing.
    expect(after.getSessionReauth().reason).toBeNull()

    expect(after.restoreSessionReauthRedirect()).toBe(true)
    const state = after.getSessionReauth()
    expect(state.reason).toBe('revoked')
    expect(state.requiresSignIn).toBe(true)
    // The identity is what lets the dialog offer the right provider button
    // rather than falling back to the full sign-in page.
    expect(state.identity.providerId).toBe('google.com')
    expect(state.identity.email).toBe('someone@example.test')
  })

  it('a FRESH unauthenticated load still has nothing to restore', () => {
    // The property the module-state store was chosen for, and the one this
    // must not soften: a deep link or cleared storage bounces to /signin
    // exactly as before. Only a ceremony THIS tab started holds the page.
    const fresh = load()
    expect(fresh.restoreSessionReauthRedirect()).toBe(false)
    expect(fresh.getSessionReauth().reason).toBeNull()
  })

  it('marks nothing when no prompt is up', () => {
    // Otherwise any later reload of this tab would raise a dialog nobody
    // asked for.
    const store = load()
    store.markSessionReauthRedirect()
    expect(sessionStorage.length).toBe(0)
    expect(reload().restoreSessionReauthRedirect()).toBe(false)
  })

  it('will not hold a tab open for a ceremony nobody is running', () => {
    // A stamp, so a tab resumed hours later from bfcache is not held by a
    // redirect that was abandoned.
    const before = load()
    before.requestSessionReauth('signed-out')
    before.markSessionReauthRedirect()

    const key = sessionStorage.key(0) as string
    const stored = JSON.parse(sessionStorage.getItem(key) as string)
    stored.atMs = Date.now() - 16 * 60 * 1000 // past the 15-minute window
    sessionStorage.setItem(key, JSON.stringify(stored))

    const after = reload()
    expect(after.restoreSessionReauthRedirect()).toBe(false)
    // …and it cleans up after itself rather than being re-read every render.
    expect(sessionStorage.length).toBe(0)
  })

  it('clearing the prompt clears the breadcrumb with it', () => {
    const store = load()
    store.requestSessionReauth('idle')
    store.markSessionReauthRedirect()
    expect(sessionStorage.length).toBe(1)

    store.clearSessionReauth()
    expect(sessionStorage.length).toBe(0)
    expect(reload().restoreSessionReauthRedirect()).toBe(false)
  })

  it('survives unreadable storage rather than throwing', () => {
    // Private mode, or storage denied. The redirect still works; the tab
    // just lands on /signin as it did before — the old behaviour, not a new
    // failure.
    const store = load()
    store.requestSessionReauth('revoked')
    const getItem = jest
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('denied')
      })
    const setItem = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('denied')
      })
    expect(() => store.markSessionReauthRedirect()).not.toThrow()
    expect(store.restoreSessionReauthRedirect()).toBe(false)
    getItem.mockRestore()
    setItem.mockRestore()
  })
})
