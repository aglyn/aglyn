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
 *
 * AGL-3384 adds the other half: a click that WORKED says so. The tab a mail
 * client opens lands on a success page and moves on only when asked, while
 * the tab the person signed up in carries on by itself.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import VerifyEmail from '../app/(auth)/verify-email/page'
import AuthenticatingLayout from '../components/layouts/authenticating.layout'

const mockApplyActionCode = jest.fn()
const mockReplace = jest.fn()
const mockPush = jest.fn()
const mockAssign = jest.fn()
const mockPushContinued = jest.fn()

/**
 * The raw `continue` value on the URL (AGL-1730). Deliberately UNFILTERED —
 * the hook's own safety predicate is bypassed here so the page's fallback is
 * the thing under test, not the hook's.
 */
let mockContinueUrl = ''

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
// The hooks are stubbed, but `isSafeContinueUrl` is the REAL predicate: the
// open-redirect refusal is one of the things under test here, and a hand-rolled
// double of it would fabricate a green.
jest.mock('@aglyn/shared-util-next', () => ({
  ...jest.requireActual('@aglyn/shared-util-next'),
  continueParam: (value: string) => `continue=${value}`,
  useContinueUrl: () => ['', '', mockPushContinued],
  useContinueUrlDecoded: () => [mockContinueUrl, mockPushContinued],
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
  mockContinueUrl = ''
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

    // Once the apply RESOLVES, the page says so, and the navigation is the
    // person's to ask for.
    await act(async () => resolveApply())
    await flush()
    expect(screen.getByText('Email verified')).toBeTruthy()
    expect(mockAssign).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText(/Continue to/))
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
    expect(screen.getByText(/expired or was already used/)).toBeTruthy()
    // A used link is the common case, and it means the address IS verified.
    expect(screen.getByText(/your email is verified/)).toBeTruthy()
    // The only useful next step for a signed-out visitor.
    expect(screen.getByText('Sign in')).toBeTruthy()
  })

  it('a failed apply under a verified session says it is verified, and waits to be asked (AGL-3384)', async () => {
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
    // Where they stand leads, not a red error: the production report was a
    // person who had opened their own link twice.
    expect(screen.getByText('You’re already verified')).toBeTruthy()
    expect(screen.getByText('session@example.com')).toBeTruthy()
    expect(screen.queryByText(/new one below/)).toBeNull()
    // The rarer story still has a way out.
    expect(screen.getByText(/different account/)).toBeTruthy()

    fireEvent.click(screen.getByText(/Continue to/))
    await flush()
    expect(mockAssign).toHaveBeenCalledWith('/')
  })

  it('the signed-in unverified click applies, reloads, and shows the success page', async () => {
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
    expect(screen.getByText('Email verified')).toBeTruthy()
    expect(screen.getByText(/close this one/)).toBeTruthy()
    expect(screen.getByText('Signed in as session@example.com')).toBeTruthy()

    fireEvent.click(screen.getByText(/Continue to/))
    await flush()
    expect(mockAssign).toHaveBeenCalledWith('/')
  })

  it('a signed-out click whose apply succeeds shows the success page with sign-in (AGL-3384)', async () => {
    mockCurrentUser = null
    mockSigninCheck = { status: 'success', data: { signedIn: false, user: null } }
    mockApplyActionCode.mockResolvedValue(undefined)

    render(<VerifyEmail />)
    await flush()

    // Before: a bare /signin that said nothing about the verification — the
    // "it went nowhere" in the production report.
    expect(mockReplace).not.toHaveBeenCalled()
    expect(screen.getByText('Email verified')).toBeTruthy()
    expect(
      screen.getByText('Sign in to continue').closest('a')?.getAttribute('href'),
    ).toBe('/signin')
  })

  it('the success page stays put while the signed-in check still reads unverified', async () => {
    // The apply resolved, but the session the hook reports has not caught up
    // yet. Neither the mount send (whose `alreadyVerified` answer navigates)
    // nor the poll may carry the person off the success page.
    jest.useFakeTimers()
    try {
      const sessionUser = makeUser(false)
      mockCurrentUser = sessionUser
      mockSigninCheck = {
        status: 'success',
        data: { signedIn: true, user: { ...sessionUser } },
      }
      sessionUser.reload = jest.fn(async () => {
        sessionUser.emailVerified = true
        return undefined
      })
      mockApplyActionCode.mockResolvedValue(undefined)

      render(<VerifyEmail />)
      await flush()
      await act(async () => {
        jest.advanceTimersByTime(20_000)
      })
      await flush()

      expect(screen.getByText('Email verified')).toBeTruthy()
      expect(global.fetch).not.toHaveBeenCalled()
      expect(mockAssign).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('AGL-3384 · the tab the person signed up in carries on by itself', () => {
  /** A same-process stand-in: jsdom does not provide BroadcastChannel. */
  class FakeBroadcastChannel {
    static open: FakeBroadcastChannel[] = []
    onmessage: ((event: { data: unknown }) => void) | null = null
    constructor(public name: string) {
      FakeBroadcastChannel.open.push(this)
    }
    postMessage(data: unknown) {
      for (const other of FakeBroadcastChannel.open)
        if (other !== this && other.name === this.name) other.onmessage?.({ data })
    }
    close() {
      FakeBroadcastChannel.open = FakeBroadcastChannel.open.filter(
        (channel) => channel !== this,
      )
    }
  }

  const originalChannel = (globalThis as { BroadcastChannel?: unknown })
    .BroadcastChannel
  beforeEach(() => {
    FakeBroadcastChannel.open = []
    ;(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      FakeBroadcastChannel
    setLocation('')
  })
  afterEach(() => {
    ;(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel =
      originalChannel
  })

  const waitingTab = () => {
    const sessionUser = makeUser(false)
    mockCurrentUser = sessionUser
    mockSigninCheck = {
      status: 'success',
      data: { signedIn: true, user: { ...sessionUser } },
    }
    // Verified elsewhere: the next reload sees it.
    sessionUser.reload = jest.fn(async () => {
      sessionUser.emailVerified = true
      return undefined
    })
    return sessionUser
  }

  it('a redeemed link in another tab moves the waiting tab into the app at once', async () => {
    waitingTab()
    render(<VerifyEmail />)
    await flush()
    expect(mockAssign).not.toHaveBeenCalled()

    // What the redeeming tab's `announceVerified` sends.
    await act(async () => {
      new FakeBroadcastChannel('aglyn:email-verified').postMessage('verified')
    })
    await flush()

    expect(mockAssign).toHaveBeenCalledWith('/')
  })

  it('returning to the tab re-checks at once instead of waiting for a poll tick', async () => {
    waitingTab()
    render(<VerifyEmail />)
    await flush()
    expect(mockAssign).not.toHaveBeenCalled()

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await flush()

    expect(mockAssign).toHaveBeenCalledWith('/')
    expect(screen.getByText(/Taking you to/)).toBeTruthy()
  })

  it('the redeeming tab announces the verification', async () => {
    const listener = new FakeBroadcastChannel('aglyn:email-verified')
    const heard = jest.fn()
    listener.onmessage = heard
    setLocation('?mode=verifyEmail&oobCode=CODE123')
    mockCurrentUser = null
    mockSigninCheck = { status: 'success', data: { signedIn: false, user: null } }
    mockApplyActionCode.mockResolvedValue(undefined)

    render(<VerifyEmail />)
    await flush()

    expect(heard).toHaveBeenCalledTimes(1)
  })
})

describe('AGL-1730 · a verified account lands where it was sent from', () => {
  const signedInUnverified = () => {
    const sessionUser = makeUser(false)
    mockCurrentUser = sessionUser
    mockSigninCheck = {
      status: 'success',
      data: { signedIn: true, user: sessionUser },
    }
    return sessionUser
  }

  it('the applied code lands on the continue destination, not /', async () => {
    mockContinueUrl = '/acme/billing?plan=pro&interval=year'
    signedInUnverified()
    mockApplyActionCode.mockResolvedValue(undefined)

    render(<VerifyEmail />)
    await flush()
    fireEvent.click(screen.getByText(/Continue to/))
    await flush()

    expect(mockAssign).toHaveBeenCalledWith(
      '/acme/billing?plan=pro&interval=year',
    )
  })

  it('an unsafe continue value falls back to / (never an open redirect)', async () => {
    mockContinueUrl = 'https://evil.example.com/harvest'
    signedInUnverified()
    mockApplyActionCode.mockResolvedValue(undefined)

    render(<VerifyEmail />)
    await flush()
    fireEvent.click(screen.getByText(/Continue to/))
    await flush()

    expect(mockAssign).toHaveBeenCalledWith('/')
  })

  it('a continue pointing back at the auth wall falls back to / (no loop)', async () => {
    // `/verify-email` as the destination is an address-bar loop: the page
    // re-mounts, reads the same continue, and hard-navigates to itself again.
    mockContinueUrl = '/verify-email?continue=%2Fverify-email'
    signedInUnverified()
    mockApplyActionCode.mockResolvedValue(undefined)

    render(<VerifyEmail />)
    await flush()
    fireEvent.click(screen.getByText(/Continue to/))
    await flush()

    expect(mockAssign).toHaveBeenCalledWith('/')
  })

  it('the “I’ve verified” button honours continue', async () => {
    setLocation('?continue=%2Facme%2Fbilling')
    mockContinueUrl = '/acme/billing'
    const sessionUser = signedInUnverified()
    // Verified in the other tab: the reload picks it up.
    sessionUser.reload = jest.fn(async () => {
      sessionUser.emailVerified = true
      return undefined
    })

    render(<VerifyEmail />)
    await flush()

    fireEvent.click(screen.getByText(/I’ve verified/))
    await flush()

    expect(mockAssign).toHaveBeenCalledWith('/acme/billing')
  })

  it('the alreadyVerified resend answer honours continue', async () => {
    setLocation('?continue=%2Facme%2Fbilling')
    mockContinueUrl = '/acme/billing'
    signedInUnverified()
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ alreadyVerified: true }),
    })) as unknown as typeof fetch

    render(<VerifyEmail />)
    await flush()

    expect(mockAssign).toHaveBeenCalledWith('/acme/billing')
  })

  it('a verified session that should not be here honours continue', async () => {
    setLocation('?continue=%2Facme%2Fbilling')
    mockContinueUrl = '/acme/billing'
    const sessionUser = makeUser(true)
    mockCurrentUser = sessionUser
    mockSigninCheck = {
      status: 'success',
      data: { signedIn: true, user: sessionUser },
    }

    render(<VerifyEmail />)
    await flush()

    expect(mockAssign).toHaveBeenCalledWith('/acme/billing')
  })

  it('a continue value does NOT unhold the mid-apply redirect (AGL-1524 stands)', async () => {
    mockContinueUrl = '/acme/billing'
    const sessionUser = makeUser(true)
    mockCurrentUser = sessionUser
    mockSigninCheck = {
      status: 'success',
      data: { signedIn: true, user: sessionUser },
    }
    let resolveApply!: () => void
    mockApplyActionCode.mockImplementation(
      () => new Promise<void>((resolve) => (resolveApply = resolve)),
    )

    render(<VerifyEmail />)
    await flush()

    expect(mockAssign).not.toHaveBeenCalled()
    expect(sessionUser.getIdToken).not.toHaveBeenCalled()

    await act(async () => resolveApply())
    await flush()
    expect(mockAssign).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText(/Continue to/))
    await flush()
    expect(mockAssign).toHaveBeenCalledWith('/acme/billing')
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

  it('an unverified session on /verify-email is not pushed onto the page it is on (AGL-3384)', async () => {
    const sessionUser = makeUser(false)
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

    // Re-ran on every poll's reload: a page refetch each tick, and the
    // `?continue=` destination dropped on the first.
    expect(mockPush).not.toHaveBeenCalled()
    expect(mockPushContinued).not.toHaveBeenCalled()
  })
})
