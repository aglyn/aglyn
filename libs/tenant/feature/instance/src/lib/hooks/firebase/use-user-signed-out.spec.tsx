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
 *
 * @jest-environment jsdom
 */

/**
 * AGL-1261: `useUser()` has THREE states, and "signed out" is not "loading".
 *
 * `setUser(nextUser ?? undefined)` collapsed the emitted `null` into the same
 * value the hook starts with, so for a signed-out visitor the hook never left
 * its initial "auth has not resolved" state. Nothing renders differently for
 * that on most pages — which is why it survived — but `useSessionCookie`
 * opens with `if (user === undefined) return`, so its entire body, including
 * the cross-subdomain silent restore from the shared `__session` cookie,
 * could never run. Measured on a signed-out load: the restore's
 * `fetch('/api/auth/session')` was never issued, while calling the same
 * endpoint by hand from the same page returned a valid custom token.
 *
 * Asserted through the real provider so the emitted value is the one
 * consumers see, not a re-implementation of the mapping.
 */

import { act, render } from '@testing-library/react'
import { useEffect, useRef } from 'react'

let emit: ((user: unknown) => void) | undefined

jest.mock('firebase/app', () => ({
  __esModule: true,
  getApps: () => [],
  initializeApp: () => ({ name: 'test' }),
}))
jest.mock('firebase/auth', () => ({
  __esModule: true,
  // `@aglyn/shared-data-enums` indexes into this at module scope.
  AuthErrorCodes: {
    USER_CANCELLED: 'auth/user-cancelled',
    REDIRECT_CANCELLED_BY_USER: 'auth/cancelled-popup-request',
    POPUP_CLOSED_BY_USER: 'auth/popup-closed-by-user',
  },
  getAuth: () => ({ currentUser: null }),
  connectAuthEmulator: jest.fn(),
  onIdTokenChanged: (_auth: unknown, next: (user: unknown) => void) => {
    emit = next
    return () => undefined
  },
}))
jest.mock('firebase/firestore', () => ({
  __esModule: true,
  getFirestore: () => ({}),
  initializeFirestore: () => ({}),
  connectFirestoreEmulator: jest.fn(),
  persistentLocalCache: jest.fn(),
  persistentMultipleTabManager: jest.fn(),
}))
jest.mock('firebase/database', () => ({
  __esModule: true,
  getDatabase: () => ({}),
  connectDatabaseEmulator: jest.fn(),
}))
jest.mock('firebase/storage', () => ({ __esModule: true, getStorage: () => ({}) }))
jest.mock('firebase/analytics', () => ({
  __esModule: true,
  getAnalytics: () => ({}),
}))
jest.mock('firebase/app-check', () => ({
  __esModule: true,
  initializeAppCheck: jest.fn(),
  ReCaptchaV3Provider: jest.fn(),
}))
jest.mock('firebase/remote-config', () => ({
  __esModule: true,
  getRemoteConfig: () => ({ settings: {} }),
}))

import { FirebaseServicesProvider, useUser } from './firebase-services'

/** Records every distinct value the hook has published, in order. */
function Probe({ seen }: { seen: string[] }) {
  const { data } = useUser()
  const last = useRef<string | undefined>(undefined)
  const token = data === undefined ? 'undefined' : data === null ? 'null' : 'user'
  useEffect(() => {
    if (last.current !== token) {
      last.current = token
      seen.push(token)
    }
  })
  return null
}

function renderProbe(seen: string[]) {
  return render(
    <FirebaseServicesProvider firebaseConfig={{}} appName="test">
      <Probe seen={seen} />
    </FirebaseServicesProvider>,
  )
}

describe('useUser signed-out state (AGL-1261)', () => {
  afterEach(() => {
    emit = undefined
  })

  it('publishes null — not undefined — when auth resolves to signed out', () => {
    const seen: string[] = []
    renderProbe(seen)
    expect(seen).toEqual(['undefined'])

    act(() => emit?.(null))

    // The bug: this stayed `undefined`, indistinguishable from "auth has not
    // answered yet", and `useSessionCookie` waits on exactly that value.
    expect(seen).toEqual(['undefined', 'null'])
  })

  it('still publishes the user when one signs in', () => {
    const seen: string[] = []
    renderProbe(seen)
    act(() => emit?.({ uid: 'u1' }))
    expect(seen).toEqual(['undefined', 'user'])
  })

  it('CONTROL — the probe can tell the three states apart', () => {
    const seen: string[] = []
    renderProbe(seen)
    act(() => emit?.(null))
    act(() => emit?.({ uid: 'u1' }))
    expect(seen).toEqual(['undefined', 'null', 'user'])
  })
})
