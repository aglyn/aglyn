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
 * AGL-3842 — "Use a different account" on `/auth/native` ends the console
 * session, the same way the console's own sign-out does.
 *
 * It used to call Firebase `signOut` alone and leave the shared `__session`
 * cookie to `useSessionCookie`, which only retires it after the signed-out
 * state has rendered. Signed out, the page sends a `start` visitor straight to
 * its sign-in page, that navigation raced the retiring request, and the next
 * page restored the same account from the cookie that was still alive.
 *
 * Pinned: the DELETE is issued and ANSWERED before Firebase signs out, the
 * sign-out marker is up before either, the sign-in choices come back after,
 * and `/signout` goes through the same helper.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

const order: string[] = []
const mockSignOut = jest.fn(async () => {
  order.push('signOut')
  mockState.signedIn = false
})
const mockState = { signedIn: true }
const mockUser = { uid: 'u-1', email: 'ada@example.com', emailVerified: true }
const mockAuth = { currentUser: mockUser }

jest.mock('firebase/auth', () => ({
  signOut: (...args: unknown[]) => mockSignOut(...(args as [])),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  fbClientAppOptions: { authDomain: 'auth.example.com' },
  useAuth: () => mockAuth,
  useSigninCheck: () => ({
    status: 'success',
    data: { signedIn: mockState.signedIn, user: mockState.signedIn ? mockUser : null },
  }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: jest.fn(),
}))
jest.mock('@aglyn/aglyn/app-utils/platform-brand', () => ({
  PLATFORM_BRAND_NAME: 'Aglyn',
}))
jest.mock('@aglyn/shared-ui-jsx/components/loading-text.component', () => ({
  LoadingTextComponent: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
}))
jest.mock('../components/auth-form.component', () => ({
  __esModule: true,
  default: ({
    headingTop,
    headingBottom,
    children,
  }: {
    headingTop?: ReactNode
    headingBottom?: ReactNode
    children?: ReactNode
  }) => (
    <div>
      <h1>{headingTop}</h1>
      <p>{headingBottom}</p>
      {children}
    </div>
  ),
}))

import NativeHandoff from '../app/auth/native/page'
import SignOut from '../app/(auth)/signout/page'
import { endConsoleSession } from '../utils/end-console-session'
import { consumeInteractiveSignOut } from '../utils/interactive-signin'

jest.mock('../components/layouts/authenticating.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const SIGNOUT_MARKER_KEY = 'aglyn:interactive-signout-at'

/** A DELETE the spec answers by hand, so "before" and "after" are observable. */
function deferredFetch() {
  let answer: () => void = () => undefined
  const fetchMock = jest.fn((url: string, init?: RequestInit) => {
    order.push(`${init?.method ?? 'GET'} ${url}`)
    // The marker must already be up when the session is retired.
    if (window.sessionStorage.getItem(SIGNOUT_MARKER_KEY) === null) {
      order.push('marker-missing')
    }
    return new Promise<Response>((resolve) => {
      answer = () => resolve({ ok: true, status: 200 } as Response)
    })
  })
  return { fetchMock, answer: () => answer() }
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve()
  })
}

beforeEach(() => {
  order.length = 0
  mockState.signedIn = true
  mockSignOut.mockClear()
  window.sessionStorage.clear()
})

afterEach(() => {
  // jsdom has no fetch; each test installs its own.
  delete (global as { fetch?: unknown }).fetch
})

describe('AGL-3842 · endConsoleSession', () => {
  it('marks the sign-out, retires the shared session, THEN signs Firebase out', async () => {
    const { fetchMock, answer } = deferredFetch()
    global.fetch = fetchMock as unknown as typeof fetch
    const done = endConsoleSession(mockAuth as never)
    await flush()
    expect(order).toEqual(['DELETE /api/auth/session'])
    expect(mockSignOut).not.toHaveBeenCalled()
    answer()
    await done
    expect(order).toEqual(['DELETE /api/auth/session', 'signOut'])
    // `useSessionCookie` reads the auth-null emission as a real sign-out.
    expect(consumeInteractiveSignOut()).toBe(true)
  })

  it('still signs Firebase out when the DELETE fails', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('network down')
    }) as unknown as typeof fetch
    await endConsoleSession(mockAuth as never)
    expect(mockSignOut).toHaveBeenCalledTimes(1)
  })
})

describe('AGL-3842 · "Use a different account" on /auth/native', () => {
  it('ends the session before signing out, then shows the sign-in choices', async () => {
    const { fetchMock, answer } = deferredFetch()
    global.fetch = fetchMock as unknown as typeof fetch
    render(<NativeHandoff />)
    await flush()
    expect(screen.getByText('ada@example.com')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Use a different account' }))
    await flush()
    // Red before the fix: Firebase signed out at once, the DELETE came later
    // (from useSessionCookie, after the signed-out render), and a navigation
    // in between could abort it.
    expect(order).toEqual(['DELETE /api/auth/session'])
    expect(mockSignOut).not.toHaveBeenCalled()
    // No button to tap while the session is being ended.
    expect(screen.queryByRole('button', { name: 'Continue in the app' })).toBeNull()

    answer()
    await flush()
    expect(order).toEqual(['DELETE /api/auth/session', 'signOut'])
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Single sign-on (SSO)' })).toBeTruthy()
  })
})

describe('AGL-3842 · /signout uses the same path', () => {
  it('retires the shared session before signing Firebase out', async () => {
    const { fetchMock, answer } = deferredFetch()
    global.fetch = fetchMock as unknown as typeof fetch
    render(<SignOut />)
    await flush()
    expect(order).toEqual(['DELETE /api/auth/session'])
    answer()
    await flush()
    expect(order).toEqual(['DELETE /api/auth/session', 'signOut'])
  })
})
