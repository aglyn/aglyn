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
 * AGL-4021: a phone Google sign-up's credential is handled even when the
 * redirect hook's effect re-ran while Firebase was answering.
 *
 * Reproduced on the emulator stack: `getRedirectResult` resolved with the
 * brand-new account AFTER the effect's cleanup had run, the `active` guard
 * dropped it, and the re-run stopped at the once-per-mount guard. The account
 * got no acceptance, no acquisition and no workspace, and the auth layout sent
 * it to an empty chooser. Three real sign-ups ended like that on 2026-10-20/21.
 */
import { act, renderHook } from '@testing-library/react'
import type { UserCredential } from 'firebase/auth'

let resolveRedirect: (credential: UserCredential | null) => void = () => {}
const mockGetRedirectResult = jest.fn(
  () =>
    new Promise<UserCredential | null>((resolve) => {
      resolveRedirect = resolve
    }),
)

jest.mock('firebase/auth', () => ({
  __esModule: true,
  getRedirectResult: () => mockGetRedirectResult(),
  GoogleAuthProvider: { credentialFromError: () => null },
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  __esModule: true,
  trackEvent: jest.fn(),
  trackEventBeforeNavigation: jest.fn(async () => undefined),
}))
const auth = { name: 'auth' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useAuth: () => auth,
}))

import useGoogleRedirectResult from '../hooks/use-google-redirect-result'
import { isRedirectLandingInFlight as isGoogleRedirectLandingInFlight } from '../utils/sign-up-landing-hold'

const credential = (): UserCredential =>
  ({ user: { uid: 'new-phone-account' } }) as unknown as UserCredential

describe('useGoogleRedirectResult (AGL-4021)', () => {
  beforeEach(() => mockGetRedirectResult.mockClear())

  it('hands the credential over even when the effect re-ran before Firebase answered', async () => {
    const onCredential = jest.fn(async () => undefined)
    const onSettled = jest.fn()
    const { rerender } = renderHook(
      ({ onError }) =>
        useGoogleRedirectResult(
          'sign_up',
          onError,
          true,
          onCredential,
          undefined,
          onSettled,
        ),
      { initialProps: { onError: jest.fn() } },
    )
    // A dependency changes while the round trip is still resolving: the
    // effect cleans up and re-runs, which is what dropped the credential.
    rerender({ onError: jest.fn() })
    await act(async () => resolveRedirect(credential()))
    expect(onCredential).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(mockGetRedirectResult).toHaveBeenCalledTimes(1)
  })

  it('hands the same credential over once, even to a remounted page', async () => {
    const onCredential = jest.fn(async () => undefined)
    const same = credential()
    const first = renderHook(() =>
      useGoogleRedirectResult('sign_up', jest.fn(), true, onCredential),
    )
    await act(async () => resolveRedirect(same))
    first.unmount()
    // Firebase answers a second caller with the outcome it cached.
    renderHook(() =>
      useGoogleRedirectResult('sign_up', jest.fn(), true, onCredential),
    )
    await act(async () => resolveRedirect(same))
    expect(onCredential).toHaveBeenCalledTimes(1)
  })

  it('reports the landing as in flight until the handler settles', async () => {
    let finish: () => void = () => {}
    const seen: boolean[] = []
    const onCredential = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          seen.push(isGoogleRedirectLandingInFlight())
          finish = resolve
        }),
    )
    renderHook(() =>
      useGoogleRedirectResult('sign_up', jest.fn(), true, onCredential),
    )
    await act(async () => resolveRedirect(credential()))
    expect(seen).toEqual([true])
    await act(async () => finish())
    expect(isGoogleRedirectLandingInFlight()).toBe(false)
  })

  it('settles without a landing when no redirect was pending', async () => {
    const onCredential = jest.fn()
    const onSettled = jest.fn()
    renderHook(() =>
      useGoogleRedirectResult(
        'sign_up',
        jest.fn(),
        true,
        onCredential,
        undefined,
        onSettled,
      ),
    )
    await act(async () => resolveRedirect(null))
    expect(onCredential).not.toHaveBeenCalled()
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(isGoogleRedirectLandingInFlight()).toBe(false)
  })
})
