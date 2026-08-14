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
 * AGL-1524 — the emailed verification click must ACTUALLY verify.
 *
 * The first production signup clicked a genuine, fresh link and stayed
 * unverified. Mechanism: the click landed in a browser holding a different,
 * already-verified session, and the page's "already verified" bounce — a hard
 * `window.location.assign` — fired while `applyActionCode` was still in
 * flight. A hard navigation aborts in-flight fetches, so the one-shot code
 * was never redeemed, while the user landed in the app looking exactly like
 * success.
 *
 * These tests pin the two invariants that failure taught:
 *  1. while a code is being applied, NOTHING navigates — not the page's own
 *     bounces, not the layout's continue-URL redirect;
 *  2. a failed apply is never silent — the error renders, in every session
 *     state, instead of a success-shaped redirect.
 */

import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import VerifyEmail from '../app/(auth)/verify-email/page'
import AuthenticatingLayout from '../components/layouts/authenticating.layout'

const mockApplyActionCode = jest.fn()
const mockReplace = jest.fn()
const mockPush = jest.fn()
const mockAssign = jest.fn()
const mockPushContinued = jest.fn()

/** What the auth instance holds (the BROWSER's session, not the code's). */
let mockCurrentUser: Record<string, unknown> | null = null
let mockSigninCheck: {
  status: 'loading' | 'success'
  data?: { signedIn: boolean; user: Record<string, unknown> | null }
} = { status: 'loading' }

jest.mock('firebase/auth', () => ({
  applyActionCode: (...args: unknown[]) => mockApplyActionCode(...args),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useAuth: () => ({ currentUser: mockCurrentUser }),
  useSigninCheck: () => mockSigninCheck,
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLoading: () => ({ queueLoading: () => () => undefined, loading: false }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/loading-text.component', () => ({
  LoadingTextComponent: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
}))
jest.mock(
  '@aglyn/shared-ui-jsx/components/background-image.component',
  () => ({
    BackgroundImageComponent: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
  }),
)
jest.mock('@aglyn/shared-ui-theme', () => ({ mergeSxProps: () => ({}) }))
jest.mock('@aglyn/aglyn', () => ({ parseOnboardingPlanIntent: () => null }))
jest.mock('@aglyn/shared-util-next', () => ({
  continueParam: (value: string) => `continue=${value}`,
  useContinueUrl: () => ['', '', mockPushContinued],
}))
// The navigation seam — jsdom's `location.assign` is read-only, so the page
// hard-navigates through this module precisely so specs can observe it.
jest.mock('../utils/hard-navigate', () => ({
  __esModule: true,
  default: (url: string) => mockAssign(url),
  hardNavigate: (url: string) => mockAssign(url),
}))
jest.mock('../components/auth-form.component', () => ({
  __esModule: true,
  default: ({
    headingTop,
    headingBottom,
    paperAfter,
    children,
  }: Record<string, ReactNode>) => (
    <div>
      <div>{headingTop}</div>
      <div>{headingBottom}</div>
      {children}
      {paperAfter}
    </div>
  ),
}))

const flush = async () => {
  // Drain the applyActionCode/getIdToken promise chains.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const makeUser = (emailVerified: boolean) => ({
  uid: 'session-user',
  email: 'session@example.com',
  emailVerified,
  getIdToken: jest.fn(async () => 'token'),
  reload: jest.fn(async () => undefined),
})

const setLocation = (search: string) => {
  window.history.replaceState(null, '', `/verify-email${search}`)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCurrentUser = null
  mockSigninCheck = { status: 'loading' }
  setLocation('?mode=verifyEmail&oobCode=CODE123')
  // The auto-send effect posts to /api/auth/send-verification once the page
  // settles into the signed-in-unverified state.
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  })) as unknown as typeof fetch
})

describe('AGL-1524 · the apply owns the page while a code is present', () => {
  it('a different VERIFIED session must not navigate away mid-apply (the production failure)', async () => {
    // The browser the mail client opened: signed in as somebody who is
    // already verified — NOT the account the code belongs to.
    const sessionUser = makeUser(true)
    mockCurrentUser = sessionUser
    mockSigninCheck = {
      status: 'success',
      data: { signedIn: true, user: sessionUser },
    }
    // The apply is in flight — deliberately unresolved.
    let resolveApply!: () => void
    mockApplyActionCode.mockImplementation(
      () => new Promise<void>((resolve) => (resolveApply = resolve)),
    )

    render(<VerifyEmail />)
    await flush()

    // The code is still being redeemed: the "already verified" bounce and
    // every other hard navigation must hold. This is the line that was red:
    // the bounce fired, aborted the in-flight apply, and the click silently
    // verified nothing. (`getIdToken` is the bounce's first step — if it ran,
    // the bounce started.)
    expect(mockAssign).not.toHaveBeenCalled()
    expect(sessionUser.getIdToken).not.toHaveBeenCalled()
    expect(mockApplyActionCode).toHaveBeenCalledWith(
      expect.anything(),
      'CODE123',
    )

    // Once the apply RESOLVES, the navigation is welcome.
    await act(async () => resolveApply())
    await flush()
    expect(mockAssign).toHaveBeenCalledWith('/')
  })

  it('a signed-out click whose apply fails sees the error — not a silent /signin bounce', async () => {
    mockCurrentUser = null
    mockSigninCheck = { status: 'success', data: { signedIn: false, user: null } }
    mockApplyActionCode.mockRejectedValue(
      Object.assign(new Error('expired'), { code: 'auth/expired-action-code' }),
    )

    render(<VerifyEmail />)
    await flush()

    // Red before the fix: the page redirected to /signin the moment the
    // apply settled, discarding the failure entirely.
    expect(mockReplace).not.toHaveBeenCalledWith('/signin')
    expect(screen.getByText(/didn’t work/)).toBeTruthy()
    expect(screen.getByText(/expired or was already used/)).toBeTruthy()
    // The only useful next step for a signed-out visitor.
    expect(screen.getByText('Sign in')).toBeTruthy()
  })

  it('a failed apply under a verified session stays on the error, not the app', async () => {
    const sessionUser = makeUser(true)
    mockCurrentUser = sessionUser
    mockSigninCheck = {
      status: 'success',
      data: { signedIn: true, user: sessionUser },
    }
    mockApplyActionCode.mockRejectedValue(
      Object.assign(new Error('invalid'), { code: 'auth/invalid-action-code' }),
    )

    render(<VerifyEmail />)
    await flush()

    expect(mockAssign).not.toHaveBeenCalled()
    expect(screen.getByText(/didn’t work/)).toBeTruthy()
    // Says why this browser's state is confusing, and offers the app.
    expect(screen.getByText(/different account/)).toBeTruthy()
  })

  it('the signed-in unverified click still applies, reloads, and lands in the app', async () => {
    const sessionUser = makeUser(false)
    mockCurrentUser = sessionUser
    mockSigninCheck = {
      status: 'success',
      data: { signedIn: true, user: sessionUser },
    }
    mockApplyActionCode.mockResolvedValue(undefined)

    render(<VerifyEmail />)
    await flush()

    expect(mockApplyActionCode).toHaveBeenCalledWith(
      expect.anything(),
      'CODE123',
    )
    expect(sessionUser.reload).toHaveBeenCalled()
    expect(mockAssign).toHaveBeenCalledWith('/')
  })

  it('a signed-out click whose apply succeeds goes to /signin?verified=1', async () => {
    mockCurrentUser = null
    mockSigninCheck = { status: 'success', data: { signedIn: false, user: null } }
    mockApplyActionCode.mockResolvedValue(undefined)

    render(<VerifyEmail />)
    await flush()

    expect(mockReplace).toHaveBeenCalledWith('/signin?verified=1')
  })
})

describe('AGL-1524 · the layout holds its redirects while a code is on the URL', () => {
  it('holdRedirects suspends the verified-session continue bounce', async () => {
    const sessionUser = makeUser(true)
    mockCurrentUser = sessionUser
    mockSigninCheck = {
      status: 'success',
      data: { signedIn: true, user: sessionUser },
    }

    render(
      <AuthenticatingLayout requireEmailVerification holdRedirects>
        <div>{'page'}</div>
      </AuthenticatingLayout>,
    )
    await flush()

    expect(mockPushContinued).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('without holdRedirects the verified session still continues on (AGL-479 unchanged)', async () => {
    const sessionUser = makeUser(true)
    mockCurrentUser = sessionUser
    mockSigninCheck = {
      status: 'success',
      data: { signedIn: true, user: sessionUser },
    }

    render(
      <AuthenticatingLayout requireEmailVerification>
        <div>{'page'}</div>
      </AuthenticatingLayout>,
    )
    await flush()

    expect(mockPushContinued).toHaveBeenCalledWith('/')
  })
})
