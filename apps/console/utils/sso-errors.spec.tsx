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

import { render, screen } from '@testing-library/react'
import { AuthAppErrorCodes, AuthErrorIgnore } from '@aglyn/shared-data-enums'
import AuthErrorAlertComponent from '../components/auth-error-alert.component'
import { describeSsoError } from './sso-errors'

/**
 * AGL-1416.
 *
 * The assertions that matter are about REACHING THE USER, not about mapping.
 * `AuthErrorAlertComponent` renders nothing unless `error.code` is set, so a
 * classifier that returned a lovely message and no code would still be
 * invisible — which is precisely the bug. Every case is therefore checked by
 * rendering the real alert and reading the screen.
 */

/** The failure as Firebase hands it over, wrapped around Google's verdict. */
const notConfigured = Object.assign(new Error('Firebase: Error (auth/internal-error).'), {
  code: 'auth/internal-error',
  customData: {
    _tokenResponse: { error: { message: 'app_not_configured_for_user' } },
  },
})

describe('describeSsoError (AGL-1416)', () => {
  it('names the wrong-account cause, not the administrator', () => {
    const failure = describeSsoError(notConfigured)

    expect(failure.code).toBe(AuthAppErrorCodes.SSO_ACCOUNT_MISMATCH)
    // The whole point: Google's own text sends the reader to their admin.
    expect(failure.message.toLowerCase()).not.toContain('administrator')
    expect(failure.message.toLowerCase()).not.toContain('not configured')
  })

  it('matches the verdict however it is spelled', () => {
    for (const message of [
      'app_not_configured_for_user',
      'This app was not configured for the user.',
      'APP-NOT-CONFIGURED-FOR-USER',
    ]) {
      expect(describeSsoError({ code: 'auth/internal-error', message }).code).toBe(
        AuthAppErrorCodes.SSO_ACCOUNT_MISMATCH,
      )
    }
  })

  it('never returns a code the alert would suppress', () => {
    for (const caught of [
      notConfigured,
      { code: 'auth/popup-closed-by-user' },
      { code: 'auth/network-request-failed' },
      new Error('something we have never seen'),
      undefined,
      null,
    ]) {
      const failure = describeSsoError(caught)
      expect(failure.code).toBeTruthy()
      expect(AuthErrorIgnore[failure.code]).toBeFalsy()
      expect(failure.message.length).toBeGreaterThan(0)
    }
  })

  it('surfaces a closed IdP window instead of swallowing it', () => {
    // Elsewhere a closed popup is a plain cancel and is deliberately silent.
    // On the SSO path it is just as likely to be Google's refusal page, which
    // the user closed — so this one must speak.
    const failure = describeSsoError({ code: 'auth/popup-closed-by-user' })

    expect(failure.code).toBe(AuthAppErrorCodes.SSO_INCOMPLETE)
    expect(AuthErrorIgnore['auth/popup-closed-by-user']).toBe(true)
    expect(AuthErrorIgnore[failure.code]).toBeFalsy()
  })
})

describe('the classified failure actually reaches the user', () => {
  it('renders the cause AND a next step for the wrong-account case', () => {
    render(<AuthErrorAlertComponent error={describeSsoError(notConfigured) as never} />)

    expect(screen.getByText(/different account/i)).toBeTruthy()
    // The caption must carry the action. Falling through to the generic
    // "contact the system administrator" line would reproduce the bug.
    expect(screen.getByText(/private window/i)).toBeTruthy()
    expect(screen.queryByText(/contact the system administrator/i)).toBeNull()
  })

  it('renders something for every failure shape', () => {
    for (const caught of [
      notConfigured,
      { code: 'auth/popup-closed-by-user' },
      new Error('unclassifiable'),
      null,
    ]) {
      const { container, unmount } = render(
        <AuthErrorAlertComponent error={describeSsoError(caught) as never} />,
      )
      expect(container.textContent.trim().length).toBeGreaterThan(0)
      unmount()
    }
  })
})
