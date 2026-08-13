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
 * AGL-1497 — the fourth door.
 *
 * "Sign in with Google" is not a sign-in. Firebase's `signInWithPopup` is a
 * sign-in-or-sign-up and does not ask which was meant, so /signin has always
 * been able to mint a brand-new account — and /signin carries only the passive
 * legal notice, because everyone reaching it was assumed to already have a
 * contract. A gate on three doors out of four is not a gate.
 *
 * The returning user must be untouched by this: a consent interruption on
 * every sign-in would be both wrong and infuriating.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import SignIn from '../app/(auth)/signin/page'

const mockPopup = jest.fn()
const mockSendToGate = jest.fn()
const mockSignOut = jest.fn(async (..._args: unknown[]) => undefined)
const mockSignInWithPassword = jest.fn()
let mockIsNewUser = false
let mockRedirectCallback:
  | ((credential: unknown) => void | Promise<void>)
  | undefined

const credential = { user: { uid: 'uid-1' }, providerId: 'google.com' }

jest.mock('firebase/auth', () => ({
  browserLocalPersistence: {},
  GoogleAuthProvider: { credentialFromError: () => null },
  setPersistence: () => Promise.resolve(),
  signInWithEmailAndPassword: (...args: unknown[]) =>
    mockSignInWithPassword(...args),
  signInWithPopup: (...args: unknown[]) => mockPopup(...args),
  signInWithRedirect: jest.fn(() => new Promise(() => undefined)),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  getAdditionalUserInfo: () => ({ isNewUser: mockIsNewUser }),
}))
jest.mock('firebase/analytics', () => ({ logEvent: jest.fn() }))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useAnalytics: () => ({}),
  useAuth: () => ({}),
  useSigninCheck: () => ({ data: { signedIn: false } }),
}))
jest.mock('@aglyn/shared-data-forms', () => ({
  FIELD_SCHEMA_EMAIL: { name: 'email' },
  FIELD_SCHEMA_PASSWORD: { name: 'password' },
}))
jest.mock('@aglyn/shared-data-mdi', () => ({
  mdiFingerprint: { path: 'M0 0' },
  mdiGoogle: { path: 'M0 0' },
  mdiShieldKeyOutline: { path: 'M0 0' },
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  MdiIcon: () => null,
  useLoading: () => ({ queueLoading: () => () => undefined, loading: false }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/loading-text.component', () => ({
  LoadingTextComponent: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
}))
jest.mock('@aglyn/shared-ui-jsx-forms', () => ({
  simpleComponentMapper: {},
  FormRenderer: ({ onSubmit }: { onSubmit: (values: unknown) => void }) => (
    <button
      onClick={() =>
        onSubmit({ email: 'known@example.com', password: 'sup3rsecret!' })
      }
    >
      {'Submit sign in'}
    </button>
  ),
}))
jest.mock('../components/auth-error-alert.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/auth-form-template.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/auth-form.component', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
jest.mock('../components/layouts/authenticating.layout', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
jest.mock('../hooks/use-delegate-workspace-signin', () => ({
  __esModule: true,
  default: () => 'off',
}))
jest.mock('../hooks/use-google-redirect-result', () => ({
  __esModule: true,
  default: (
    _event: string,
    _onError: unknown,
    _enabled: boolean,
    onCredential?: (c: unknown) => void | Promise<void>,
  ) => {
    mockRedirectCallback = onCredential
  },
}))
jest.mock('../utils/oauth-providers', () => ({
  createGoogleOAuthProvider: () => ({}),
}))
jest.mock('../utils/popup-loading-guard', () => ({
  __esModule: true,
  default: () => () => undefined,
}))
jest.mock('../utils/is-mobile-browser', () => ({
  __esModule: true,
  default: () => false,
}))
jest.mock('../utils/interactive-signin', () => ({
  markInteractiveSignIn: jest.fn(),
  markInteractiveSignOut: jest.fn(),
}))
jest.mock('../utils/auth-delegation', () => ({
  authSignInHost: () => 'app.aglyn.com',
}))
/**
 * The real gate logic (`isNewAccount`) with only the NAVIGATION stubbed —
 * jsdom's `location.assign` is read-only, and stubbing the whole module would
 * mean asserting on a mock of the very thing under test.
 */
jest.mock('../utils/legal-consent', () => ({
  ...jest.requireActual('../utils/legal-consent'),
  sendToConsentGate: () => mockSendToGate(),
}))
jest.mock('../utils/passkeys', () => ({
  describePasskeySignInFailure: () => null,
  signInWithPasskey: jest.fn(),
  usePasskeysSupported: () => false,
}))


const clickGoogle = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Google' }))

describe('sign-in never creates an unconsented account', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsNewUser = false
    mockRedirectCallback = undefined
    mockPopup.mockResolvedValue(credential)
    mockSignInWithPassword.mockResolvedValue(credential)
  })

  it('bounces a brand-new Google account to the clickwrap gate', async () => {
    mockIsNewUser = true
    render(<SignIn />)
    await act(async () => {
      clickGoogle()
    })
    // Stood back down: no session, and sent where the Terms actually are.
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled())
    expect(mockSendToGate).toHaveBeenCalled()
  })

  it('leaves a returning Google user completely alone', async () => {
    mockIsNewUser = false
    render(<SignIn />)
    await act(async () => {
      clickGoogle()
    })
    await waitFor(() => expect(mockPopup).toHaveBeenCalled())
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(mockSendToGate).not.toHaveBeenCalled()
  })

  it('bounces the mobile redirect case too', async () => {
    mockIsNewUser = true
    render(<SignIn />)
    await act(async () => {
      await mockRedirectCallback?.(credential)
    })
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled())
    expect(mockSendToGate).toHaveBeenCalled()
  })

  it('does not disturb an email/password sign-in', async () => {
    render(<SignIn />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit sign in' }))
    })
    await waitFor(() => expect(mockSignInWithPassword).toHaveBeenCalled())
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(mockSendToGate).not.toHaveBeenCalled()
  })
})
