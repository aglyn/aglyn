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

jest.mock('@aglyn/tenant-feature-instance', () => ({
  // No user: the diagnostic effect is skipped, which keeps this test about
  // the banner rather than about token plumbing.
  useUser: () => ({ data: undefined }),
  useAuth: () => ({}),
}))

jest.mock('../utils/interactive-signin', () => ({
  markInteractiveSignOut: jest.fn(),
}))

const bannerText = /session needs refreshing/i

describe('SessionHealthBanner (AGL-1063)', () => {
  beforeEach(() => __resetSessionHealth())
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
