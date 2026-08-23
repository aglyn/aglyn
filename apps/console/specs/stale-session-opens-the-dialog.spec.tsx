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
 * A stale session opens the DIALOG, not a banner (AGL-2486).
 *
 * The two components each have their own unit spec, and each one passing
 * proves only its own half: the watcher writes a store, the dialog reads
 * one. What Zach asked for is the JOIN — "just automatically show the sign
 * in again dialog" — and a join is exactly the kind of thing that can be
 * written and never read (`feedback_written_but_never_read`). So this
 * mounts the pair the way `AuthenticatedLayout` does and looks at the
 * rendered document.
 *
 * The negative half is load-bearing too: the old banner must be GONE, not
 * merely joined by a dialog, or the same fact is now told three times.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import SessionHealthBanner from '../components/session-health-banner.component'
import SessionReauthDialog from '../components/session-reauth-dialog.component'
import {
  __resetSessionHealth,
  reportDeniedRead,
  reportSuccessfulRead,
} from '../utils/session-health'
import { __resetSessionReauth } from '../utils/session-reauth'

const mockUser: { data: unknown } = { data: undefined }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useAuth: () => ({}),
  useUser: () => mockUser,
  useFirestore: () => ({}),
}))

const mockProbe = jest.fn()
jest.mock('../utils/probe-public-read', () => ({
  probePublicRead: (...args: unknown[]) => mockProbe(...args),
}))

jest.mock('firebase/auth', () => ({
  AuthErrorCodes: jest.requireActual('firebase/auth').AuthErrorCodes,
  browserLocalPersistence: {},
  GoogleAuthProvider: class GoogleAuthProvider {},
  OAuthProvider: class OAuthProvider {},
  SAMLAuthProvider: class SAMLAuthProvider {},
  setPersistence: () => Promise.resolve(),
  signInWithEmailAndPassword: jest.fn(() => Promise.resolve({})),
  signInWithPopup: jest.fn(() => Promise.resolve({})),
  signInWithRedirect: jest.fn(),
  signOut: jest.fn(() => Promise.resolve()),
}))

jest.mock('../utils/interactive-signin', () => ({
  markInteractiveSignIn: jest.fn(),
  markInteractiveSignOut: jest.fn(),
}))

jest.mock('../utils/is-mobile-browser', () => ({
  __esModule: true,
  default: () => false,
}))

jest.mock('../utils/passkeys', () => ({
  usePasskeysSupported: () => false,
  signInWithPasskey: jest.fn(),
  describePasskeySignInFailure: (error: unknown) => error,
}))

/** The layout renders the watcher above the dialog; so does this. */
const Shell = () => (
  <>
    <SessionHealthBanner />
    <SessionReauthDialog />
  </>
)

const DIALOG_TITLE = /sign in again to verify your device/i
const OLD_BANNER = /session needs refreshing/i

const goStale = () =>
  act(() => {
    reportDeniedRead('users')
    reportDeniedRead('orgs')
  })

const settle = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('a session that can no longer read gets the dialog, not a banner', () => {
  beforeEach(() => {
    __resetSessionHealth()
    __resetSessionReauth()
    mockUser.data = {
      uid: 'u1',
      email: 'owner@example.com',
      providerData: [{ providerId: 'password', email: 'owner@example.com' }],
      getIdToken: () => Promise.resolve('t'),
      getIdTokenResult: () => Promise.resolve({}),
    }
    mockProbe.mockReset().mockResolvedValue({ outcome: 'ok', hint: 'ok' })
    jest.spyOn(console, 'error').mockImplementation(() => void 0)
  })
  afterEach(() => {
    __resetSessionHealth()
    __resetSessionReauth()
    ;(console.error as jest.Mock).mockRestore?.()
  })

  it('shows neither until the evidence arrives', async () => {
    render(<Shell />)
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(OLD_BANNER)).toBeNull()
  })

  it('opens the dialog on screen and renders NO banner', async () => {
    render(<Shell />)
    goStale()
    await settle()

    // The rendered document, not a store read: a real dialog with the real
    // title and the account's own factor offered inside it.
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    expect(screen.getByText(DIALOG_TITLE)).toBeTruthy()
    expect(screen.getByText('owner@example.com')).toBeTruthy()
    expect(screen.getByLabelText(/password/i)).toBeTruthy()

    // And the thing this replaced is gone from the document entirely.
    expect(screen.queryByText(OLD_BANNER)).toBeNull()
    expect(document.querySelectorAll('.MuiAlert-root')).toHaveLength(0)
  })

  it('"Not now" closes it and nothing brings it back on the next denial', async () => {
    render(<Shell />)
    goStale()
    await settle()

    fireEvent.click(screen.getByRole('button', { name: /not now/i }))
    expect(screen.queryByRole('dialog')).toBeNull()

    // The session is still dead; every page keeps issuing reads that fail.
    act(() => {
      reportDeniedRead('hosts')
      reportDeniedRead('media')
    })
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    // Nor does the `stale` flow leave a banner behind on dismissal — the
    // signed-out flows do, this one deliberately does not.
    expect(document.querySelectorAll('.MuiAlert-root')).toHaveLength(0)
  })

  it('takes itself off screen when the session comes back', async () => {
    render(<Shell />)
    goStale()
    await settle()
    expect(screen.getByRole('dialog')).toBeTruthy()

    act(() => reportSuccessfulRead())
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the App Check banner and NO dialog when even a public read is denied', async () => {
    mockProbe.mockResolvedValue({
      outcome: 'denied',
      code: 'permission-denied',
      hint: 'App Check',
    })
    render(<Shell />)
    goStale()

    expect(
      await screen.findByText(/signing in again will not help/i),
    ).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows nothing at all for an offline blip', async () => {
    mockProbe.mockResolvedValue({
      outcome: 'error',
      code: 'unavailable',
      hint: 'offline',
    })
    render(<Shell />)
    goStale()
    await settle()

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelectorAll('.MuiAlert-root')).toHaveLength(0)
  })
})
