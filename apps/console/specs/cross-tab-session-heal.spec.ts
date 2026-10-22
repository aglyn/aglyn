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
 * The tab nobody re-authenticated in.
 *
 * `watchSessionHeal` covers the tab holding the dialog. The tab people
 * actually complain about is the sibling on the second monitor: it never
 * faulted, so it never heals, and its listeners stay refused while
 * `browserLocalPersistence` quietly hands it a working user again.
 *
 * The whole design rests on answering a uid TRANSITION and nothing else — the
 * hourly token refresh must not reopen every listener in the console, which
 * is the listener storm `session-heal` exists to avoid.
 */
import { renderHook } from '@testing-library/react'

let mockAuth: object | null = { name: 'auth' }
/** The `onIdTokenChanged` callback the hook registered. */
let mockEmit: ((user: { uid: string } | null) => void) | null = null
const mockUnsubscribe = jest.fn()
const mockHeal = jest.fn()

jest.mock('firebase/auth', () => ({
  onIdTokenChanged: (
    _auth: unknown,
    callback: (user: { uid: string } | null) => void,
  ) => {
    mockEmit = callback
    return mockUnsubscribe
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useAuth: () => mockAuth,
  reportFirestoreSessionHeal: () => mockHeal(),
}))

import { useCrossTabSessionHeal } from '../hooks/use-cross-tab-session-heal'

const emit = (uid: string | null) => mockEmit?.(uid ? { uid } : null)

beforeEach(() => {
  mockAuth = { name: 'auth' }
  mockEmit = null
  mockHeal.mockClear()
  mockUnsubscribe.mockClear()
})

describe('useCrossTabSessionHeal', () => {
  it('says nothing on the FIRST observation', () => {
    // The listeners are subscribing against this very user right now. A heal
    // here would reopen every one of them on every page load.
    renderHook(() => useCrossTabSessionHeal())
    emit('user-1')
    expect(mockHeal).not.toHaveBeenCalled()
  })

  it('says nothing on an ordinary token refresh', () => {
    // Firebase re-mints roughly hourly and fires this every time. Same uid,
    // no fault — answering it is the listener storm, on a schedule.
    renderHook(() => useCrossTabSessionHeal())
    emit('user-1')
    emit('user-1')
    emit('user-1')
    expect(mockHeal).not.toHaveBeenCalled()
  })

  it('HEALS when the session comes back under the same account', () => {
    // The reported case: the other tab signed out and back in, and this one
    // sat there authenticated with refused listeners nobody reopened.
    renderHook(() => useCrossTabSessionHeal())
    emit('user-1')
    emit(null)
    expect(mockHeal).not.toHaveBeenCalled()
    emit('user-1')
    expect(mockHeal).toHaveBeenCalledTimes(1)
  })

  it('HEALS when the account is swapped underneath it', () => {
    renderHook(() => useCrossTabSessionHeal())
    emit('user-1')
    emit('user-2')
    expect(mockHeal).toHaveBeenCalledTimes(1)
  })

  it('does NOT heal on a sign-out', () => {
    // The layout and the re-auth prompt own that path. Telling refused
    // listeners to retry against no session spends reads on certain denials.
    renderHook(() => useCrossTabSessionHeal())
    emit('user-1')
    emit(null)
    expect(mockHeal).not.toHaveBeenCalled()
  })

  it('unsubscribes, and does nothing without an auth instance', () => {
    const { unmount } = renderHook(() => useCrossTabSessionHeal())
    unmount()
    expect(mockUnsubscribe).toHaveBeenCalled()

    mockAuth = null
    mockEmit = null
    renderHook(() => useCrossTabSessionHeal())
    expect(mockEmit).toBeNull()
  })
})
