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
 * AGL-3578 — a sign-up that is still landing holds the auth layout.
 *
 * `AuthenticatingLayout` pushes a signed-in visitor to `/` the moment the
 * credential lands. On a phone that push reached the server before the
 * session cookie did, came back as a full reload of /signin, and killed the
 * Google redirect door after it recorded the Terms and before it recorded
 * acquisition or created the workspace. Three phone sign-ups in a row
 * (2026-10-03 to 10-05) landed with neither.
 *
 * Pinned here: the hold store's contract, the layout waiting while a hold is
 * up and moving on when it is released or lapses, and the same-commit case,
 * where the page raises the hold in an effect that runs after the layout
 * rendered but before the layout's effect.
 */

import { act, render } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import AuthenticatingLayout from '../components/layouts/authenticating.layout'
import {
  holdSignUpLanding,
  isSignUpLandingHeld,
  releaseSignUpLanding,
  SIGN_UP_LANDING_HOLD_MAX_MS,
} from '../utils/sign-up-landing-hold'

const mockPush = jest.fn()
const mockPushContinued = jest.fn()
const sessionUser = { uid: 'u-1', emailVerified: true }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useAuth: () => ({ currentUser: sessionUser }),
  useSigninCheck: () => ({
    status: 'success',
    data: { signedIn: true, user: sessionUser },
  }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
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
  ...jest.requireActual('@aglyn/shared-util-next'),
  continueParam: (value: string) => `continue=${value}`,
  useContinueUrl: () => ['', '', mockPushContinued],
}))

const KEY = 'spec:landing'

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve()
  })
}

/** Raises the hold the way the sign-up page does: in a mount effect. */
function PageThatHoldsOnMount() {
  useEffect(() => {
    holdSignUpLanding(KEY)
  }, [])
  return <div>{'page'}</div>
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useRealTimers()
  releaseSignUpLanding(KEY)
  releaseSignUpLanding('spec:other')
})

describe('AGL-3578 · the hold store', () => {
  it('is idempotent per key, so one release clears a hold raised twice', () => {
    holdSignUpLanding(KEY)
    holdSignUpLanding(KEY)
    expect(isSignUpLandingHeld()).toBe(true)
    releaseSignUpLanding(KEY)
    expect(isSignUpLandingHeld()).toBe(false)
  })

  it('keeps holding while another key is still up', () => {
    holdSignUpLanding(KEY)
    holdSignUpLanding('spec:other')
    releaseSignUpLanding(KEY)
    expect(isSignUpLandingHeld()).toBe(true)
    releaseSignUpLanding('spec:other')
    expect(isSignUpLandingHeld()).toBe(false)
  })

  it('lapses on its own, so nobody is left on a spinner', () => {
    jest.useFakeTimers()
    holdSignUpLanding(KEY)
    jest.advanceTimersByTime(SIGN_UP_LANDING_HOLD_MAX_MS - 1)
    expect(isSignUpLandingHeld()).toBe(true)
    jest.advanceTimersByTime(1)
    expect(isSignUpLandingHeld()).toBe(false)
  })

  it('treats releasing a key nobody holds as a no-op', () => {
    expect(() => releaseSignUpLanding('spec:never')).not.toThrow()
    expect(isSignUpLandingHeld()).toBe(false)
  })
})

describe('AGL-3578 · the auth layout waits for a landing sign-up', () => {
  it('does not push a signed-in visitor while a sign-up is landing', async () => {
    holdSignUpLanding(KEY)
    render(
      <AuthenticatingLayout>
        <div>{'page'}</div>
      </AuthenticatingLayout>,
    )
    await flush()
    expect(mockPushContinued).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('moves on as soon as the sign-up releases it', async () => {
    holdSignUpLanding(KEY)
    render(
      <AuthenticatingLayout>
        <div>{'page'}</div>
      </AuthenticatingLayout>,
    )
    await flush()
    act(() => releaseSignUpLanding(KEY))
    await flush()
    expect(mockPushContinued).toHaveBeenCalledWith('/')
  })

  it('holds when the page raises the hold in the same commit', async () => {
    // Red without the live read in the layout's effect: the layout rendered
    // before the page's effect raised the hold, so its render-time state
    // said "not held" and it pushed in the same commit.
    render(
      <AuthenticatingLayout>
        <PageThatHoldsOnMount />
      </AuthenticatingLayout>,
    )
    await flush()
    expect(mockPushContinued).not.toHaveBeenCalled()
  })

  it('still pushes when nothing is landing (unchanged behavior)', async () => {
    render(
      <AuthenticatingLayout>
        <div>{'page'}</div>
      </AuthenticatingLayout>,
    )
    await flush()
    expect(mockPushContinued).toHaveBeenCalledWith('/')
  })
})
