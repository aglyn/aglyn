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
 * AGL-1497 — the clickwrap gate, at the doors that create accounts.
 *
 * The checkbox already existed and already blocked the desktop paths. What it
 * did NOT do was leave anything behind: no version, no timestamp, no record at
 * all. A tick that persists nothing cannot answer the only question a dispute
 * ever asks, so these tests treat "the account was created" and "the
 * acceptance was recorded" as one indivisible outcome.
 *
 * The mobile case is the one worth reading twice. `signInWithRedirect` leaves
 * the page, so the component holding `consented` in React state is destroyed
 * before the account exists — the gate was real on desktop and a no-op on
 * phones, which is where a large share of sign-ups happen.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import SignUp from '../app/(auth)/signup/page'
import { LEGAL_DOCUMENT_VERSION } from '../constants/legal-documents'

const mockCreateUser = jest.fn()
const mockPopup = jest.fn()
const mockRedirect = jest.fn()
let mockMobile = false
/** Captures the redirect-completion callback the page hands the hook. */
let mockRedirectCallback:
  | ((credential: unknown) => void | Promise<void>)
  | undefined

const credentialFor = (uid: string) => ({
  user: {
    uid,
    email: 'new@example.com',
    displayName: 'New Person',
    getIdToken: async () => `token-for-${uid}`,
  },
  providerId: 'google.com',
})

jest.mock('firebase/auth', () => ({
  browserLocalPersistence: {},
  createUserWithEmailAndPassword: (...args: unknown[]) =>
    mockCreateUser(...args),
  GoogleAuthProvider: { credentialFromError: () => null },
  setPersistence: () => Promise.resolve(),
  signInWithPopup: (...args: unknown[]) => mockPopup(...args),
  signInWithRedirect: (...args: unknown[]) => mockRedirect(...args),
  updateProfile: jest.fn(async () => undefined),
  getAdditionalUserInfo: () => ({ isNewUser: true }),
}))
jest.mock('firebase/analytics', () => ({ logEvent: jest.fn() }))
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  setDoc: jest.fn(async () => undefined),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useAnalytics: () => ({}),
  useAuth: () => ({}),
  useFirestore: () => ({}),
  useSigninCheck: () => ({ data: { signedIn: false } }),
}))
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@aglyn/aglyn', () => ({
  PLAN_LABELS: {},
  generateOrgSlug: (value: string) => value.toLowerCase(),
  onboardingDestination: (slug: string) => `/${slug}`,
  parseOnboardingPlanIntent: () => null,
}))
jest.mock('@aglyn/shared-data-forms', () => ({
  FIELD_SCHEMA_EMAIL: { name: 'email' },
  FIELD_SCHEMA_FIRST_NAME: { name: 'firstName' },
  FIELD_SCHEMA_LAST_NAME: { name: 'lastName' },
  FIELD_SCHEMA_ORGANIZATION_NAME: { name: 'organizationName', validate: [] },
  FIELD_SCHEMA_PASSWORD: { name: 'password' },
  FIELD_SCHEMA_PASSWORD_CONFIRM: { name: 'passwordConfirm' },
}))
jest.mock('@aglyn/shared-data-mdi', () => ({ mdiGoogle: { path: 'M0 0' } }))
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
/** A stub form whose only job is to submit the values the real one would. */
jest.mock('@aglyn/shared-ui-jsx-forms', () => ({
  simpleComponentMapper: {},
  FormRenderer: ({ onSubmit }: { onSubmit: (values: unknown) => void }) => (
    <button
      onClick={() =>
        onSubmit({
          email: 'new@example.com',
          password: 'sup3rsecret!',
          firstName: 'New',
          lastName: 'Person',
          organizationName: 'New Co',
        })
      }
    >
      {'Submit sign up'}
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
    onCredential?: (credential: unknown) => void | Promise<void>,
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
  default: () => mockMobile,
}))
jest.mock('../utils/interactive-signin', () => ({
  markInteractiveSignIn: jest.fn(),
  markInteractiveSignOut: jest.fn(),
}))
jest.mock('../utils/auth-delegation', () => ({
  authSignInHost: () => 'app.aglyn.com',
}))

const acceptanceCalls = () =>
  (globalThis.fetch as jest.Mock).mock.calls.filter(
    ([url]) => url === '/api/auth/legal-acceptance',
  )

const tickConsent = () =>
  fireEvent.click(
    screen.getByLabelText('Agree to the Terms of Service and Privacy Policy'),
  )

const clickGoogle = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Google' }))

describe('sign-up clickwrap gate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.sessionStorage.clear()
    mockMobile = false
    mockRedirectCallback = undefined
    mockCreateUser.mockResolvedValue(credentialFor('uid-new'))
    mockPopup.mockResolvedValue(credentialFor('uid-new'))
    // `signInWithRedirect` navigates the browser away, so it never settles.
    // Resolving it would hand the page a credential the real SDK never gives.
    mockRedirect.mockReturnValue(new Promise(() => undefined))
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
      text: async () => '',
    })) as unknown as typeof fetch
  })

  it('does not create an email/password account until the box is ticked', async () => {
    render(<SignUp />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit sign up' }))
    })
    expect(mockCreateUser).not.toHaveBeenCalled()
    expect(acceptanceCalls()).toHaveLength(0)
    expect(
      screen.getByText(
        'Please accept the Terms of Service and Privacy Policy to continue.',
      ),
    ).toBeTruthy()
  })

  it('does not create a Google account until the box is ticked', async () => {
    render(<SignUp />)
    await act(async () => {
      clickGoogle()
    })
    expect(mockPopup).not.toHaveBeenCalled()
    expect(acceptanceCalls()).toHaveLength(0)
  })

  it('records the acceptance WITH THE VERSION once consent is given', async () => {
    render(<SignUp />)
    tickConsent()
    await act(async () => {
      clickGoogle()
    })
    await waitFor(() => expect(mockPopup).toHaveBeenCalled())
    await waitFor(() => expect(acceptanceCalls()).toHaveLength(1))

    const [, request] = acceptanceCalls()[0]
    expect(JSON.parse(request.body)).toEqual({
      version: LEGAL_DOCUMENT_VERSION,
      context: 'signup-google',
    })
    // The record has to be attributable to this account, not just posted.
    expect(request.headers.Authorization).toBe('Bearer token-for-uid-new')
  })

  it('records the email/password sign-up too', async () => {
    render(<SignUp />)
    tickConsent()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit sign up' }))
    })
    await waitFor(() => expect(mockCreateUser).toHaveBeenCalled())
    await waitFor(() => expect(acceptanceCalls()).toHaveLength(1))
    expect(JSON.parse(acceptanceCalls()[0][1].body)).toEqual({
      version: LEGAL_DOCUMENT_VERSION,
      context: 'signup-password',
    })
  })

  /**
   * The mobile hole. The tick happens on a page that no longer exists by the
   * time the account does, so the ONLY thing that can carry it is storage that
   * survives the navigation.
   */
  describe('mobile redirect round-trip', () => {
    beforeEach(() => {
      mockMobile = true
    })

    it('carries the consent across the redirect and records it on return', async () => {
      const { unmount } = render(<SignUp />)
      tickConsent()
      await act(async () => {
        clickGoogle()
      })
      await waitFor(() => expect(mockRedirect).toHaveBeenCalled())
      // Nothing is recorded yet — the account does not exist until Google
      // sends the browser back.
      expect(acceptanceCalls()).toHaveLength(0)

      // Google returns the user to a FRESH mount of the page.
      unmount()
      render(<SignUp />)
      await act(async () => {
        await mockRedirectCallback?.(credentialFor('uid-mobile'))
      })

      await waitFor(() => expect(acceptanceCalls()).toHaveLength(1))
      expect(JSON.parse(acceptanceCalls()[0][1].body)).toEqual({
        version: LEGAL_DOCUMENT_VERSION,
        context: 'signup-google-redirect',
      })
    })

    it('records nothing when a redirect completes with no consent behind it', async () => {
      render(<SignUp />)
      await act(async () => {
        await mockRedirectCallback?.(credentialFor('uid-mobile'))
      })
      expect(acceptanceCalls()).toHaveLength(0)
    })

    it('drops the carried consent when the attempt fails', async () => {
      // The provider rejects (the user closes Google, or it errors). The tick
      // must not be left in storage where the NEXT redirect to land in this
      // tab would pick it up and record an acceptance for a sign-up this
      // person never consented to.
      mockRedirect.mockRejectedValueOnce(new Error('auth/popup-closed-by-user'))
      render(<SignUp />)
      tickConsent()
      await act(async () => {
        clickGoogle()
      })
      await waitFor(() => expect(mockRedirect).toHaveBeenCalled())

      await act(async () => {
        await mockRedirectCallback?.(credentialFor('uid-later'))
      })
      expect(acceptanceCalls()).toHaveLength(0)
    })
  })
})
