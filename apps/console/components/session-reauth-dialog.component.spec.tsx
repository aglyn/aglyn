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
 * AGL-664. What matters here: the dialog only appears when the console's
 * own auth machinery asked for it; a successful credential sign-in stands
 * it down in place (no navigation); a failure keeps it up; "Not now"
 * degrades rather than ejects and leaves a way back; and the `stale` flow
 * genuinely signs the live user out before signing in — the only heal a
 * stale session accepts — with the interactive markers set so the session
 * hook does the cookie work.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SessionReauthDialog from './session-reauth-dialog.component'
import {
  __resetSessionReauth,
  getSessionReauth,
  requestSessionReauth,
} from '../utils/session-reauth'

const mockUser: { data: unknown } = { data: undefined }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useAuth: () => ({}),
  useUser: () => mockUser,
}))

const mockSignIn = jest.fn()
const mockSignOut = jest.fn()
const mockPopup = jest.fn()
const mockDeleteUser = jest.fn()
const mockRedirectResult = jest.fn()
jest.mock('firebase/auth', () => {
  // The provider stubs carry `setCustomParameters` because the real ones do:
  // every provider is built through `createAuthProvider`, which sets the
  // account-disambiguation parameters (AGL-1415). A stub without it turns a
  // missing chooser into a TypeError, which is a worse way to find out.
  // Declared inside the factory — jest hoists this above the file body, so an
  // out-of-scope class reference would be rejected outright.
  class StubProvider {
    customParameters: Record<string, string> = {}
    setCustomParameters(parameters: Record<string, string>) {
      this.customParameters = parameters
      return this
    }
  }
  return {
    // Real, not stubbed: `shared-data-enums` builds its error tables from
    // these constants at module load, so mocking them away turns any import
    // of the enums lib into a load-time crash (AGL-1417).
    AuthErrorCodes: jest.requireActual('firebase/auth').AuthErrorCodes,
    browserLocalPersistence: {},
    GoogleAuthProvider: class GoogleAuthProvider extends StubProvider {},
    OAuthProvider: class OAuthProvider extends StubProvider {},
    SAMLAuthProvider: class SAMLAuthProvider extends StubProvider {},
    setPersistence: () => Promise.resolve(),
    signInWithEmailAndPassword: (...args: unknown[]) => mockSignIn(...args),
    signInWithPopup: (...args: unknown[]) => mockPopup(...args),
    signInWithRedirect: jest.fn(),
    signOut: (...args: unknown[]) => mockSignOut(...args),
    deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
    getRedirectResult: (...args: unknown[]) => mockRedirectResult(...args),
    // The real one reads a private field of the credential; the stubs carry
    // the answer where a test can set it.
    getAdditionalUserInfo: (credential: { additionalUserInfo?: unknown }) =>
      credential?.additionalUserInfo ?? null,
  }
})

const mockMarkSignIn = jest.fn()
const mockMarkSignOut = jest.fn()
jest.mock('../utils/interactive-signin', () => ({
  markInteractiveSignIn: (...args: unknown[]) => mockMarkSignIn(...args),
  markInteractiveSignOut: (...args: unknown[]) => mockMarkSignOut(...args),
}))

jest.mock('../utils/is-mobile-browser', () => ({
  __esModule: true,
  default: () => false,
}))

const title = /sign in again to verify your device/i
const identity = {
  email: 'user@example.com',
  hasPassword: true,
  providerId: null,
}

describe('SessionReauthDialog (AGL-664)', () => {
  beforeEach(() => {
    __resetSessionReauth()
    mockUser.data = undefined
    mockSignIn.mockReset().mockResolvedValue({})
    mockSignOut.mockReset().mockResolvedValue(undefined)
    mockPopup.mockReset().mockResolvedValue({})
    mockDeleteUser.mockReset().mockResolvedValue(undefined)
    mockRedirectResult.mockReset().mockResolvedValue(null)
    mockMarkSignIn.mockReset()
    mockMarkSignOut.mockReset()
  })
  afterEach(() => __resetSessionReauth())

  it('renders nothing until the console itself asks for it', () => {
    render(<SessionReauthDialog />)
    expect(screen.queryByText(title)).toBeNull()
  })

  it('detection raises the modal over the current route', () => {
    render(<SessionReauthDialog />)
    act(() => requestSessionReauth('revoked', identity))
    expect(screen.getByText(title)).toBeTruthy()
    expect(screen.getByText('user@example.com')).toBeTruthy()
    expect(screen.getByLabelText(/password/i)).toBeTruthy()
  })

  it('a successful password sign-in stands the prompt down in place', async () => {
    render(<SessionReauthDialog />)
    act(() => requestSessionReauth('idle', identity))
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'hunter2' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(getSessionReauth().reason).toBeNull())
    expect(mockSignIn).toHaveBeenCalledWith({}, 'user@example.com', 'hunter2')
    // The marker is what makes the session hook MINT the shared cookie on
    // the sign-in emission instead of validating a stale one (AGL-463).
    expect(mockMarkSignIn).toHaveBeenCalled()
    expect(screen.queryByText(title)).toBeNull()
  })

  it('a wrong password keeps the modal up with an error', async () => {
    mockSignIn.mockRejectedValue({ code: 'auth/wrong-password' })
    render(<SessionReauthDialog />)
    act(() => requestSessionReauth('idle', identity))
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'nope' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(await screen.findByText(/password is not right/i)).toBeTruthy()
    expect(getSessionReauth().reason).toBe('idle')
    expect(screen.getByText(title)).toBeTruthy()
  })

  it('"Not now" degrades instead of ejecting, and leaves a way back', () => {
    render(<SessionReauthDialog />)
    act(() => requestSessionReauth('signed-out', identity))
    fireEvent.click(screen.getByRole('button', { name: /not now/i }))
    // The dialog is gone but the request survives — the layout keeps the
    // route mounted off this same state — and a slim banner offers the way
    // back in.
    expect(screen.queryByText(title)).toBeNull()
    expect(getSessionReauth().reason).toBe('signed-out')
    expect(getSessionReauth().dismissed).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(screen.getByText(title)).toBeTruthy()
  })

  it('the stale flow signs the live user out before signing in', async () => {
    // AGL-1062: a stale session only heals through a full sign-out/sign-in;
    // an in-place refresh provably does not clear the denied reads.
    mockUser.data = { uid: 'u1' }
    render(<SessionReauthDialog />)
    act(() => requestSessionReauth('stale', identity))
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'hunter2' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(getSessionReauth().reason).toBeNull())
    expect(mockMarkSignOut).toHaveBeenCalled()
    expect(mockSignOut).toHaveBeenCalled()
    expect(mockSignOut.mock.invocationCallOrder[0]).toBeLessThan(
      mockSignIn.mock.invocationCallOrder[0],
    )
  })

  it('a federated account gets its provider ceremony, never a silent revival', async () => {
    render(<SessionReauthDialog />)
    act(() =>
      requestSessionReauth('revoked', {
        email: 'sso@acme.com',
        hasPassword: false,
        providerId: 'google.com',
      }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: /continue with google/i }),
    )
    await waitFor(() => expect(getSessionReauth().reason).toBeNull())
    expect(mockPopup).toHaveBeenCalled()
  })

  it('the session returning by itself (another tab restored it) stands down a signed-out prompt', async () => {
    render(<SessionReauthDialog />)
    act(() => requestSessionReauth('idle', identity))
    expect(screen.getByText(title)).toBeTruthy()
    mockUser.data = { uid: 'u1' }
    act(() => requestSessionReauth('idle', identity)) // re-render trigger
    await waitFor(() => expect(getSessionReauth().reason).toBeNull())
  })

  describe('re-auth never creates or swaps an account (AGL-3425)', () => {
    const googleIdentity = {
      email: 'ada@acme.com',
      hasPassword: false,
      providerId: 'google.com',
      uid: 'u-ada',
    }
    const clickGoogle = () =>
      fireEvent.click(
        screen.getByRole('button', { name: /continue with google/i }),
      )

    it('deletes an account the Google chooser created, and keeps the prompt up', async () => {
      // A Google identity nobody registered: `signInWithPopup` is a sign-UP
      // for it, with no Terms shown and nobody meaning to sign up.
      const created = { uid: 'u-stranger', email: 'stranger@gmail.com' }
      mockPopup.mockResolvedValue({
        user: created,
        additionalUserInfo: { isNewUser: true },
      })
      render(<SessionReauthDialog />)
      act(() => requestSessionReauth('revoked', googleIdentity))
      clickGoogle()

      expect(await screen.findByText(/isn.t registered/i)).toBeTruthy()
      expect(mockDeleteUser).toHaveBeenCalledWith(created)
      // The session hook clears whatever cookie the brief sign-in minted.
      expect(mockMarkSignOut).toHaveBeenCalled()
      expect(getSessionReauth().reason).toBe('revoked')
      expect(screen.getByText(title)).toBeTruthy()
    })

    it('signs out of a different registered account, deleting nothing', async () => {
      mockPopup.mockResolvedValue({
        user: { uid: 'u-grace', email: 'grace@acme.com' },
        additionalUserInfo: { isNewUser: false },
      })
      render(<SessionReauthDialog />)
      act(() => requestSessionReauth('revoked', googleIdentity))
      clickGoogle()

      expect(await screen.findByText(/different account/i)).toBeTruthy()
      expect(mockSignOut).toHaveBeenCalled()
      expect(mockDeleteUser).not.toHaveBeenCalled()
      expect(getSessionReauth().reason).toBe('revoked')
    })

    it('falls back to signing out when the new account cannot be deleted', async () => {
      mockDeleteUser.mockRejectedValue({ code: 'auth/network-request-failed' })
      mockPopup.mockResolvedValue({
        user: { uid: 'u-stranger' },
        additionalUserInfo: { isNewUser: true },
      })
      render(<SessionReauthDialog />)
      act(() => requestSessionReauth('revoked', googleIdentity))
      clickGoogle()

      expect(await screen.findByText(/isn.t registered/i)).toBeTruthy()
      expect(mockSignOut).toHaveBeenCalled()
    })

    it('stands down for the same account', async () => {
      mockPopup.mockResolvedValue({
        user: { uid: 'u-ada', email: 'ada@acme.com' },
        additionalUserInfo: { isNewUser: false },
      })
      render(<SessionReauthDialog />)
      act(() => requestSessionReauth('revoked', googleIdentity))
      clickGoogle()

      await waitFor(() => expect(getSessionReauth().reason).toBeNull())
      expect(mockDeleteUser).not.toHaveBeenCalled()
      expect(mockSignOut).not.toHaveBeenCalled()
    })

    it('checks the account a mobile redirect brings back, and deletes one it created', async () => {
      const created = { uid: 'u-stranger' }
      mockRedirectResult.mockResolvedValue({
        user: created,
        additionalUserInfo: { isNewUser: true },
      })
      render(<SessionReauthDialog />)
      act(() =>
        requestSessionReauth('revoked', googleIdentity, {
          resumedFromRedirect: true,
        }),
      )
      mockUser.data = created
      act(() => requestSessionReauth('revoked', googleIdentity)) // re-render

      expect(await screen.findByText(/isn.t registered/i)).toBeTruthy()
      expect(mockDeleteUser).toHaveBeenCalledWith(created)
      expect(getSessionReauth().reason).toBe('revoked')
    })

    it('stands a redirect-resumed prompt down when the right account comes back', async () => {
      render(<SessionReauthDialog />)
      act(() =>
        requestSessionReauth('revoked', googleIdentity, {
          resumedFromRedirect: true,
        }),
      )
      mockUser.data = { uid: 'u-ada' }
      act(() => requestSessionReauth('revoked', googleIdentity)) // re-render

      await waitFor(() => expect(getSessionReauth().reason).toBeNull())
      expect(mockSignOut).not.toHaveBeenCalled()
      expect(mockDeleteUser).not.toHaveBeenCalled()
    })
  })
})
