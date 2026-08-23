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
 * The stale-session watcher (AGL-1063 → AGL-2486).
 *
 * What is worth pinning down is unchanged in spirit and inverted in form:
 * it stays SILENT until the verdict says otherwise — a false "your session
 * is dead" mid-edit is worse than the quiet degradation it replaces — and
 * when the verdict does arrive it OPENS THE FIX rather than describing the
 * problem in a banner. The three `permission-denied` causes that look
 * identical from the client get three different answers, and only one of
 * them is the dialog.
 */

import { act, render, screen } from '@testing-library/react'
import SessionHealthBanner from './session-health-banner.component'
import {
  __resetSessionHealth,
  reportDeniedRead,
  reportSuccessfulRead,
} from '../utils/session-health'
import {
  __resetSessionReauth,
  dismissSessionReauth,
  getSessionReauth,
} from '../utils/session-reauth'

const mockUser: { data: unknown } = { data: undefined }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => mockUser,
  useAuth: () => ({}),
  useFirestore: () => ({}),
}))

const mockProbe = jest.fn()
jest.mock('../utils/probe-public-read', () => ({
  probePublicRead: (...args: unknown[]) => mockProbe(...args),
}))

jest.mock('../utils/interactive-signin', () => ({
  markInteractiveSignOut: jest.fn(),
}))

/** The banner copy that AGL-2486 removed; nothing may bring it back. */
const bannerText = /session needs refreshing/i

/** A live user is required — the probe (and the identity capture) need one. */
const signedIn = () => ({
  uid: 'u1',
  email: 'someone@example.com',
  providerData: [{ providerId: 'password', email: 'someone@example.com' }],
  getIdToken: () => Promise.resolve('t'),
  getIdTokenResult: () => Promise.resolve({}),
})

/** Two DISTINCT collections is the bar; one is a scoped collaborator. */
const goStale = () =>
  act(() => {
    reportDeniedRead('users')
    reportDeniedRead('orgs')
  })

/** The probe is async, so the verdict lands a microtask after the evidence. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('SessionHealthBanner (AGL-1063)', () => {
  beforeEach(() => {
    __resetSessionHealth()
    __resetSessionReauth()
    mockUser.data = signedIn()
    mockProbe.mockReset()
    mockProbe.mockResolvedValue({ outcome: 'ok', hint: 'ok' })
    jest.spyOn(console, 'error').mockImplementation(() => void 0)
  })
  afterEach(() => {
    __resetSessionHealth()
    __resetSessionReauth()
    ;(console.error as jest.Mock).mockRestore?.()
  })

  it('renders nothing, and asks for nothing, on a healthy session', async () => {
    render(<SessionHealthBanner />)
    await settle()
    expect(screen.queryByText(bannerText)).toBeNull()
    expect(getSessionReauth().reason).toBeNull()
  })

  it('stays silent for a single denied collection', async () => {
    // A scoped collaborator hitting something AGL-1041 hides on purpose.
    render(<SessionHealthBanner />)
    act(() => {
      reportDeniedRead('orgs/datasets')
      reportDeniedRead('orgs/datasets')
    })
    await settle()
    expect(getSessionReauth().reason).toBeNull()
  })

  /**
   * The change Zach asked for: the fix, not a description of the problem.
   */
  it('opens the sign-in dialog — and NO banner — once the session is the verdict', async () => {
    render(<SessionHealthBanner />)
    goStale()
    await settle()

    expect(getSessionReauth().reason).toBe('stale')
    expect(getSessionReauth().dismissed).toBe(false)
    expect(screen.queryByText(bannerText)).toBeNull()
    expect(screen.queryByRole('button', { name: /sign in again/i })).toBeNull()
  })

  it('carries the identity the dialog needs to offer the right factor', async () => {
    render(<SessionHealthBanner />)
    goStale()
    await settle()

    // Captured from the LIVE user, before any sign-out: afterwards there is
    // nobody left to ask which factors this account has.
    expect(getSessionReauth().identity.email).toBe('someone@example.com')
    expect(getSessionReauth().identity.hasPassword).toBe(true)
    // The `stale` trigger leaves the user signed in until they submit.
    expect(getSessionReauth().requiresSignIn).toBe(false)
  })

  it('does not reopen on the next failed read after "Not now"', async () => {
    render(<SessionHealthBanner />)
    goStale()
    await settle()
    act(() => dismissSessionReauth())
    expect(getSessionReauth().dismissed).toBe(true)

    // The session is still dead, so reads keep failing. That must not turn
    // into a modal every time a page issues two more queries.
    act(() => {
      reportDeniedRead('hosts')
      reportDeniedRead('media')
    })
    await settle()
    expect(getSessionReauth().dismissed).toBe(true)
  })

  it('stands down when a read reaches the server again', async () => {
    render(<SessionHealthBanner />)
    goStale()
    await settle()
    expect(getSessionReauth().reason).toBe('stale')

    act(() => reportSuccessfulRead())
    await settle()
    expect(getSessionReauth().reason).toBeNull()
  })

  it('prompts again only after the session has demonstrably recovered', async () => {
    render(<SessionHealthBanner />)
    goStale()
    await settle()
    act(() => dismissSessionReauth())

    // Recovery, then a fresh failure: a NEW episode, and the one thing that
    // may re-arm the prompt.
    act(() => reportSuccessfulRead())
    await settle()
    goStale()
    await settle()

    expect(getSessionReauth().reason).toBe('stale')
    expect(getSessionReauth().dismissed).toBe(false)
  })
})

/**
 * AGL-1143. `permission-denied` is what Firestore returns both for a rules
 * verdict and for an App Check rejection. The banner used to assume the
 * former and always offer "Sign in again"; when the refusal is in front of
 * the rules that advice is wrong, and following it destroys the evidence.
 * Since AGL-2486 the stakes are higher, because the wrong branch would now
 * put a modal in front of someone it cannot help.
 */
describe('when even a public read is denied (AGL-1143)', () => {
  beforeEach(() => {
    __resetSessionHealth()
    __resetSessionReauth()
    mockUser.data = signedIn()
    mockProbe.mockReset()
    jest.spyOn(console, 'error').mockImplementation(() => void 0)
  })
  afterEach(() => {
    __resetSessionHealth()
    __resetSessionReauth()
    ;(console.error as jest.Mock).mockRestore?.()
  })

  it('says so in a banner and opens NO dialog, because it would not help', async () => {
    mockProbe.mockResolvedValue({
      outcome: 'denied',
      code: 'permission-denied',
      hint: 'App Check',
    })
    render(<SessionHealthBanner />)
    goStale()

    expect(
      await screen.findByText(/signing in again will not help/i),
    ).toBeTruthy()
    expect(getSessionReauth().reason).toBeNull()
  })

  it('opens no dialog for an offline blip either', async () => {
    // `error` is not evidence about App Check, and it is not evidence about
    // the session. Interrupting an edit with a sign-in modal over a dropped
    // connection is the false positive this whole mechanism is tuned against.
    mockProbe.mockResolvedValue({
      outcome: 'error',
      code: 'unavailable',
      hint: 'offline',
    })
    render(<SessionHealthBanner />)
    goStale()
    await settle()

    expect(getSessionReauth().reason).toBeNull()
    expect(screen.queryByText(bannerText)).toBeNull()
  })

  it('never prompts while the probe is still unsettled', async () => {
    // An unsettled value must not answer the question (the AGL-1179 shape).
    let release: (value: unknown) => void = () => void 0
    mockProbe.mockReturnValue(new Promise((resolve) => (release = resolve)))
    render(<SessionHealthBanner />)
    goStale()
    await settle()

    expect(getSessionReauth().reason).toBeNull()

    await act(async () => {
      release({ outcome: 'ok', hint: 'ok' })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(getSessionReauth().reason).toBe('stale')
  })
})
