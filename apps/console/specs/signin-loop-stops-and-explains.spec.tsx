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

/**
 * The app ↔ `/signin` volley terminates (AGL-2486).
 *
 * Zach, on production `v1.0.0-beta.8`: opening an org "redirected a few
 * times then asked me to sign in again, then redirected a few times from the
 * auth/signin page then brought me back to the org with no sites loaded".
 * `AuthenticatedLayout` pushes to `/signin` on every session-less mount and
 * `AuthenticatingLayout` pushes straight back on every signed-in one, so a
 * flapping session drives that pair forever and nothing counted.
 *
 * The unit spec beside `signin-bounce.ts` proves the COUNTER. This proves
 * the JOIN — that the layout consults it, stops navigating, and asks for
 * credentials in place — because a counter nothing reads is the shape this
 * repo has been burned by before (`feedback_written_but_never_read`).
 *
 * The last case is the one that keeps this honest: a fresh signed-out visit
 * must still redirect exactly as it always has.
 */

import { render } from '@testing-library/react'
import AuthenticatedLayout from '../components/layouts/authenticated.layout'
import {
  __resetSessionReauth,
  getSessionReauth,
} from '../utils/session-reauth'
import { SIGNIN_BOUNCE_LIMIT } from '../utils/signin-bounce'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  useLoading: () => ({ queueLoading: false }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/splash-screen', () => ({
  SplashScreen: () => null,
}))
jest.mock('@aglyn/shared-util-next', () => ({
  continueParam: () => 'continue=%2F',
  useContinueUrl: () => ['/'],
}))

const mockSigninCheck: { status: string; data: unknown } = {
  status: 'success',
  data: { signedIn: false },
}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useSigninCheck: () => mockSigninCheck,
}))

jest.mock('../hooks/use-idle-logout', () => ({
  __esModule: true,
  default: () => undefined,
}))

// The three children the layout renders are each covered by their own spec;
// what is under test here is the redirect decision, not their markup.
jest.mock('../components/impersonation-banner.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/session-health-banner.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/session-reauth-dialog.component', () => ({
  __esModule: true,
  default: () => null,
}))

/** One volley = one mount of the app layout that found no session. */
function volley() {
  const view = render(<AuthenticatedLayout>{'page'}</AuthenticatedLayout>)
  view.unmount()
}

describe('the app ↔ /signin volley stops and explains itself', () => {
  beforeEach(() => {
    mockPush.mockClear()
    window.sessionStorage.clear()
    __resetSessionReauth()
    mockSigninCheck.status = 'success'
    mockSigninCheck.data = { signedIn: false }
  })

  it('a signed-out visit still redirects to /signin', () => {
    volley()
    expect(mockPush).toHaveBeenCalledTimes(1)
    expect(String(mockPush.mock.calls[0][0])).toContain('/signin')
    expect(getSessionReauth().reason).toBeNull()
  })

  it('stops redirecting once the budget is spent, and asks in place', () => {
    for (let i = 0; i < SIGNIN_BOUNCE_LIMIT; i++) volley()
    expect(mockPush).toHaveBeenCalledTimes(SIGNIN_BOUNCE_LIMIT)
    expect(getSessionReauth().reason).toBeNull()

    mockPush.mockClear()
    volley()
    // The volley ends HERE: no further navigation, and the console says what
    // happened instead.
    expect(mockPush).not.toHaveBeenCalled()
    expect(getSessionReauth().reason).toBe('unstable')
  })

  it('the prompt it raises still demands a real sign-in', () => {
    for (let i = 0; i < SIGNIN_BOUNCE_LIMIT + 1; i++) volley()
    // Not a softer outcome than the redirect it replaced: a revoked or
    // expired session is asked for credentials either way. Trading the
    // redirect for a prompt that trusted the dead session would be the
    // security regression this fix must not be.
    expect(getSessionReauth().requiresSignIn).toBe(true)
  })

  it('holds the route once a prompt is up, without spending more budget', () => {
    for (let i = 0; i < SIGNIN_BOUNCE_LIMIT + 1; i++) volley()
    mockPush.mockClear()
    volley()
    volley()
    expect(mockPush).not.toHaveBeenCalled()
    expect(getSessionReauth().reason).toBe('unstable')
  })

  it('never redirects while auth is still loading', () => {
    mockSigninCheck.status = 'loading'
    mockSigninCheck.data = undefined
    volley()
    volley()
    volley()
    volley()
    expect(mockPush).not.toHaveBeenCalled()
    expect(getSessionReauth().reason).toBeNull()
  })
})
