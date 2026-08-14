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
 * AGL-1561 — the GA4 events fire on the REAL code paths, with the real params.
 *
 * The taxonomy's own unit tests live beside it in `libs/aglyn`. What they
 * cannot prove is the thing that actually goes wrong with analytics: that the
 * call is wired into the path a human takes. An event helper with perfect
 * types and no call sites reports zero, and zero looks exactly like "nobody
 * signed up".
 *
 * So these drive the signup page itself and assert what reached the transport.
 * The two `method` cases matter most — `method` was reading
 * `credential.providerId`, which the Identity Toolkit leaves undefined on the
 * password response, so the commonest door was reporting `method: null`.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import SignUp from '../app/(auth)/signup/page'

const mockCreateUser = jest.fn()
const mockPopup = jest.fn()
const mockRedirect = jest.fn()
const mockTrackEvent = jest.fn()
let mockConsentParam = ''

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
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  setDoc: jest.fn(async () => undefined),
}))
// The deep import is what the page uses — mocking the `@aglyn/aglyn` barrel
// would not intercept it.
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useAuth: () => ({}),
  useFirestore: () => ({}),
  useSigninCheck: () => ({ data: { signedIn: false } }),
}))
jest.mock('next/navigation', () => ({
  useSearchParams: () =>
    new URLSearchParams(mockConsentParam ? { consent: mockConsentParam } : {}),
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
  default: () => undefined,
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

/** Every event of one name that reached the transport. */
const eventsNamed = (name: string) =>
  mockTrackEvent.mock.calls.filter(([eventName]) => eventName === name)

const tickConsent = () =>
  fireEvent.click(
    screen.getByLabelText('Agree to the Terms of Service and Privacy Policy'),
  )

const clickGoogle = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Google' }))

const submitPasswordForm = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Submit sign up' }))

describe('GA4 event wiring on the real signup path (AGL-1561)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.sessionStorage.clear()
    mockConsentParam = ''
    mockCreateUser.mockResolvedValue(credentialFor('uid-new'))
    mockPopup.mockResolvedValue(credentialFor('uid-new'))
    mockRedirect.mockReturnValue(new Promise(() => undefined))
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, slug: 'new-co' }),
      text: async () => '',
    })) as unknown as typeof fetch
  })

  it('fires sign_up with method "password" on the email/password door', async () => {
    render(<SignUp />)
    tickConsent()
    await act(async () => {
      submitPasswordForm()
    })
    await waitFor(() => expect(mockCreateUser).toHaveBeenCalled())
    await waitFor(() => expect(eventsNamed('sign_up')).toHaveLength(1))

    // The regression this pins: `credential.providerId` is undefined on the
    // Identity Toolkit password response, so this param used to be null.
    expect(eventsNamed('sign_up')[0][1]).toEqual({ method: 'password' })
  })

  it('fires sign_up with method "google_popup" on the desktop Google door', async () => {
    render(<SignUp />)
    tickConsent()
    await act(async () => {
      clickGoogle()
    })
    await waitFor(() => expect(mockPopup).toHaveBeenCalled())
    await waitFor(() => expect(eventsNamed('sign_up')).toHaveLength(1))

    expect(eventsNamed('sign_up')[0][1]).toEqual({ method: 'google_popup' })
  })

  it('distinguishes the /signin bounce door — counted here, once, not at the bounce', async () => {
    // AGL-1497's fourth door: the account was created by "Sign in with
    // Google", stood down for want of consent, and sent here.
    mockConsentParam = 'required'
    render(<SignUp />)
    tickConsent()
    await act(async () => {
      clickGoogle()
    })
    await waitFor(() => expect(eventsNamed('sign_up')).toHaveLength(1))

    expect(eventsNamed('sign_up')[0][1]).toEqual({ method: 'google_signin' })
  })

  it('fires org_created when the signup workspace is actually provisioned', async () => {
    render(<SignUp />)
    tickConsent()
    await act(async () => {
      submitPasswordForm()
    })
    await waitFor(() => expect(eventsNamed('org_created')).toHaveLength(1))
  })

  it('does NOT count an org that failed to provision', async () => {
    // A 409 means the slug was taken and no org was created. Counting it
    // would make the activation denominator disagree with reality.
    globalThis.fetch = jest.fn(async (url: string) => ({
      ok: url !== '/api/orgs/create',
      status: url === '/api/orgs/create' ? 409 : 200,
      json: async () => ({ error: 'taken' }),
      text: async () => '',
    })) as unknown as typeof fetch

    render(<SignUp />)
    tickConsent()
    await act(async () => {
      submitPasswordForm()
    })
    await waitFor(() => expect(eventsNamed('sign_up')).toHaveLength(1))
    expect(eventsNamed('org_created')).toHaveLength(0)
  })

  it('never puts an email, a name or an org name in any payload', async () => {
    render(<SignUp />)
    tickConsent()
    await act(async () => {
      submitPasswordForm()
    })
    await waitFor(() => expect(mockTrackEvent).toHaveBeenCalled())

    // The form above submitted all three. None may appear anywhere.
    const serialized = JSON.stringify(mockTrackEvent.mock.calls)
    expect(serialized).not.toContain('new@example.com')
    expect(serialized).not.toContain('New Person')
    expect(serialized).not.toContain('New Co')
  })
})
