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
 * The banner is the half of AGL-1063 the user actually sees, so what is
 * worth pinning down is that it stays SILENT until the verdict says
 * otherwise — a false "your session is dead" mid-edit is worse than the
 * quiet degradation it replaces — and that it is genuinely subscribed, not
 * merely written (`feedback_verify_control_is_wired`).
 */

import { act, render, screen } from '@testing-library/react'
import SessionHealthBanner from './session-health-banner.component'
import {
  __resetSessionHealth,
  reportDeniedRead,
  reportSuccessfulRead,
} from '../utils/session-health'

const mockUser: { data: unknown } = { data: undefined }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  // No user by default: the diagnostic effect is skipped, which keeps most
  // of these about the banner rather than about token plumbing. The
  // AGL-1143 cases below supply one, because the probe runs inside it.
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

const bannerText = /session needs refreshing/i

describe('SessionHealthBanner (AGL-1063)', () => {
  beforeEach(() => {
    __resetSessionHealth()
    mockUser.data = undefined
    mockProbe.mockReset()
    mockProbe.mockResolvedValue({ outcome: 'ok', hint: 'ok' })
  })
  afterEach(() => __resetSessionHealth())

  it('renders nothing on a healthy session', () => {
    render(<SessionHealthBanner />)
    expect(screen.queryByText(bannerText)).toBeNull()
  })

  it('stays silent for a single denied collection', () => {
    // A scoped collaborator hitting something AGL-1041 hides on purpose.
    render(<SessionHealthBanner />)
    act(() => {
      reportDeniedRead('orgs/datasets')
      reportDeniedRead('orgs/datasets')
    })
    expect(screen.queryByText(bannerText)).toBeNull()
  })

  it('appears — with a way back in — once two collections are denied', () => {
    render(<SessionHealthBanner />)
    act(() => {
      reportDeniedRead('orgs/media')
      reportDeniedRead('orgs/members')
    })
    expect(screen.getByText(bannerText)).toBeTruthy()
    expect(screen.getByRole('button', { name: /sign in again/i })).toBeTruthy()
  })

  it('says nothing has been deleted, because that is the first fear', () => {
    render(<SessionHealthBanner />)
    act(() => {
      reportDeniedRead('orgs/media')
      reportDeniedRead('hostIndex')
    })
    expect(screen.getByText(/nothing has been deleted/i)).toBeTruthy()
  })

  it('withdraws itself when a server read succeeds again', () => {
    render(<SessionHealthBanner />)
    act(() => {
      reportDeniedRead('orgs/media')
      reportDeniedRead('orgs/members')
    })
    expect(screen.getByText(bannerText)).toBeTruthy()
    act(() => reportSuccessfulRead())
    expect(screen.queryByText(bannerText)).toBeNull()
  })
})

/**
 * AGL-1143. `permission-denied` is what Firestore returns both for a rules
 * verdict and for an App Check rejection. The banner used to assume the
 * former and always offer "Sign in again"; when the refusal is in front of
 * the rules that advice is wrong, and following it destroys the evidence.
 */
describe('when even a public read is denied (AGL-1143)', () => {
  const goStale = () =>
    act(() => {
      reportDeniedRead('users')
      reportDeniedRead('orgs')
    })

  beforeEach(() => {
    __resetSessionHealth()
    mockUser.data = {
      uid: 'u1',
      getIdToken: () => Promise.resolve('t'),
      getIdTokenResult: () => Promise.resolve({}),
    }
    mockProbe.mockReset()
  })
  afterEach(() => __resetSessionHealth())

  it('withholds the sign-in button, because it would not help', async () => {
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
    expect(screen.queryByRole('button', { name: /sign in again/i })).toBeNull()
  })

  it('still offers it when the public read succeeds', async () => {
    // The session really is the problem — the original behaviour, which must
    // survive the new branch.
    mockProbe.mockResolvedValue({ outcome: 'ok', hint: 'ID token' })
    render(<SessionHealthBanner />)
    goStale()
    expect(
      await screen.findByRole('button', { name: /sign in again/i }),
    ).toBeTruthy()
    expect(screen.queryByText(/will not help/i)).toBeNull()
  })

  it('offers it when the probe cannot reach the network either', async () => {
    // `error` is not evidence about App Check. Falling back to the ordinary
    // advice is right: it is the more common cause and it is harmless.
    mockProbe.mockResolvedValue({ outcome: 'error', code: 'unavailable', hint: 'offline' })
    render(<SessionHealthBanner />)
    goStale()
    expect(
      await screen.findByRole('button', { name: /sign in again/i }),
    ).toBeTruthy()
  })
})
