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
 * AGL-3843 — one sign-in mints one console session and one device row.
 *
 * One SSO sign-in in iPhone Safari left four "Safari on iOS" rows under
 * `users/{uid}/devices` within seconds. Mobile sign-in runs on the auth origin
 * and hands back to an absolute `continue` URL, so `AuthenticatingLayout`
 * mints before navigating. That effect re-ran on every ID-token emission, its
 * own forced refresh is one, and each run cancelled the previous run's
 * navigation and minted again. `useSessionCookie` minted on the same landing
 * too. Every POST sent before the first answered carried no `aglyn_device`
 * cookie, so the route recorded each one as a new device.
 *
 * Pinned: concurrent mints for one account share one request (sequential ones
 * still each ask), and the layout hands off once per sign-in however many
 * times the token emits.
 */

import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockAuthorizedFetch = jest.fn()
const mockReplace = jest.fn()
const mockPushContinued = jest.fn()
const CONTINUE = 'https://app.example.com/sites'

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
}))
jest.mock('@aglyn/shared-data-enums', () => ({
  __esModule: true,
  FIREBASE_AUTH_EMULATOR_ENABLED: false,
}))
jest.mock('firebase/auth', () => ({
  __esModule: true,
  signOut: jest.fn(),
  signInWithCustomToken: jest.fn(),
}))

const account = (uid: string, tenantId: string | null = null) => ({
  uid,
  tenantId,
  getIdToken: async () => `id-token-${uid}`,
  getIdTokenResult: async () => ({ claims: { email_verified: true } }),
})
const mockSession = { user: account('u-sso', 'tenant-a') as ReturnType<typeof account> | null }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useAuth: () => ({
    get currentUser() {
      return mockSession.user
    },
  }),
  useUser: () => ({ data: undefined }),
  // A NEW result object on every render, as the real hook sets one per
  // ID-token emission — the identity change that re-ran the effect.
  useSigninCheck: () => ({
    status: 'success',
    data: { signedIn: mockSession.user !== null, user: mockSession.user },
  }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@aglyn/shared-ui-jsx/components/background-image.component', () => ({
  BackgroundImageComponent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}))
jest.mock('@aglyn/shared-ui-theme', () => ({ mergeSxProps: () => ({}) }))
jest.mock('@aglyn/aglyn', () => ({ parseOnboardingPlanIntent: () => null }))
jest.mock('@aglyn/shared-util-next', () => ({
  ...jest.requireActual('@aglyn/shared-util-next'),
  continueParam: (value: string) => `continue=${value}`,
  useContinueUrl: () => [CONTINUE, CONTINUE, mockPushContinued],
}))
jest.mock('../components/visitor-consent.component', () => ({
  VisitorConsentPill: () => null,
}))

import AuthenticatingLayout from '../components/layouts/authenticating.layout'
import { mintSession } from '../hooks/use-session-cookie'

/** A POST the spec answers by hand, so overlapping mints are observable. */
function pendingMints() {
  const answers: Array<() => void> = []
  mockAuthorizedFetch.mockImplementation(
    () =>
      new Promise((resolve) => {
        answers.push(() => resolve({ ok: true, status: 200, json: async () => ({}) }))
      }),
  )
  return () => answers.splice(0).forEach((answer) => answer())
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
  })
}

beforeEach(() => {
  mockAuthorizedFetch.mockReset()
  mockReplace.mockReset()
  mockPushContinued.mockReset()
  mockSession.user = account('u-sso', 'tenant-a')
  // jsdom does not navigate; the hand-off's `location.assign` only logs.
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('AGL-3843 · mintSession shares a mint already in flight', () => {
  it('sends ONE request for concurrent mints of the same account', async () => {
    const answerAll = pendingMints()
    const user = account('u-1')
    const first = { current: null as string | null }
    const second = { current: null as string | null }
    const a = mintSession(user, first)
    const b = mintSession(user, second, { forceRefresh: true })
    await flush()
    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1)
    answerAll()
    await expect(Promise.all([a, b])).resolves.toEqual([true, true])
    // Each caller still learns the outcome on its own ref.
    expect(first.current).toBe('u-1')
    expect(second.current).toBe('u-1')
  })

  it('CONTROL — a mint after the last one answered asks again', async () => {
    mockAuthorizedFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    const user = account('u-1')
    await mintSession(user, { current: null })
    await mintSession(user, { current: null })
    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(2)
  })

  it('CONTROL — different accounts, or one uid in two pools, never share', async () => {
    const answerAll = pendingMints()
    const minting = [
      mintSession(account('u-1'), { current: null }),
      mintSession(account('u-2'), { current: null }),
      mintSession(account('u-1', 'tenant-a'), { current: null }),
    ]
    await flush()
    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(3)
    answerAll()
    await Promise.all(minting)
  })

  it('forces a token refresh only when asked', async () => {
    mockAuthorizedFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    await mintSession(account('u-1'), { current: null }, { forceRefresh: true })
    expect(mockAuthorizedFetch).toHaveBeenLastCalledWith(
      expect.objectContaining({ uid: 'u-1' }),
      '/api/auth/session',
      { method: 'POST' },
      { forceRefresh: true },
    )
  })
})

describe('AGL-3843 · the delegated hand-off mints once per sign-in', () => {
  it('re-renders on token emissions without minting again', async () => {
    const answerAll = pendingMints()
    const view = render(
      <AuthenticatingLayout>
        <div>{'page'}</div>
      </AuthenticatingLayout>,
    )
    await flush()
    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1)
    // The forced refresh and the sign-in's own emissions each re-render with
    // a fresh sign-in check. Red before the fix: one mint per render.
    for (let i = 0; i < 3; i += 1) {
      view.rerender(
        <AuthenticatingLayout>
          <div>{`page ${i}`}</div>
        </AuthenticatingLayout>,
      )
      await flush()
    }
    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1)
    answerAll()
    await flush()
    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1)
  })

  it('joins the mint useSessionCookie already started on the same landing', async () => {
    const answerAll = pendingMints()
    const hookMint = mintSession(mockSession.user!, { current: null })
    render(
      <AuthenticatingLayout>
        <div>{'page'}</div>
      </AuthenticatingLayout>,
    )
    await flush()
    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1)
    answerAll()
    await hookMint
    await flush()
  })

  it('still sends an unverified account to /verify-email, without minting', async () => {
    mockSession.user = {
      ...account('u-new'),
      getIdTokenResult: async () => ({ claims: { email_verified: false } }),
    }
    render(
      <AuthenticatingLayout>
        <div>{'page'}</div>
      </AuthenticatingLayout>,
    )
    await flush()
    expect(mockAuthorizedFetch).not.toHaveBeenCalled()
    expect(mockReplace).toHaveBeenCalledWith(
      `/verify-email?continue=${encodeURIComponent(CONTINUE)}`,
    )
  })
})
