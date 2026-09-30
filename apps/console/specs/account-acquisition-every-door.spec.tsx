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
 * Where an account came from is recorded by EVERY door that can create one
 * (AGL-3289), not only by the doors that are called "sign up" (AGL-3355).
 *
 * "Sign in with Google" on /signin creates an account when the Google
 * identity is new to Aglyn. That account is stood down for want of consent
 * and bounced to /signup (AGL-1497), so /signup's Google door, popup or
 * redirect, meets it as an account that ALREADY exists. The server records
 * only inside a window measured from the auth record's creation time, so:
 *
 *  - the mobile redirect door skipped the record outright — it returned on
 *    "not a new account" before it ever asked;
 *  - the desktop popup door asked, but a person who took longer than the
 *    window to consent was already too old to count;
 *  - a person who never came back left an account with no record at all.
 *
 * The /signin stand-down is the account's creation, so it records there, and
 * the /signup redirect door asks whatever the credential says, as the popup
 * door always has. Whether the account still counts as new is the server's
 * decision, made from the auth record — never this page's.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import SignIn from '../app/(auth)/signin/page'
import SignUp from '../app/(auth)/signup/page'

/** What happened, in order: `acquisition:<uid>` and `signOut`. */
const mockSteps: string[] = []
const mockRememberAcquisition = jest.fn(
  async (user: { uid: string } | null | undefined) => {
    mockSteps.push(`acquisition:${user?.uid}`)
  },
)
const mockSignOut = jest.fn(async (..._args: unknown[]) => {
  mockSteps.push('signOut')
})
const mockPopup = jest.fn()
const mockSendToGate = jest.fn()
let mockIsNewUser = false
let mockRedirectCallback:
  | ((credential: unknown) => void | Promise<unknown>)
  | undefined

const googleCredential = {
  user: {
    uid: 'u-google',
    email: 'ada@example.com',
    displayName: 'Ada Lovelace',
    emailVerified: true,
    getIdToken: async () => 'token-for-u-google',
  },
  providerId: 'google.com',
}

jest.mock('../utils/account-acquisition', () => ({
  rememberAccountAcquisition: (user: { uid: string } | null | undefined) =>
    mockRememberAcquisition(user),
}))
jest.mock('firebase/auth', () => ({
  browserLocalPersistence: {},
  createUserWithEmailAndPassword: jest.fn(),
  GoogleAuthProvider: { credentialFromError: () => null },
  setPersistence: () => Promise.resolve(),
  signInWithEmailAndPassword: jest.fn(),
  signInWithPopup: (...args: unknown[]) => mockPopup(...args),
  signInWithRedirect: jest.fn(() => new Promise(() => undefined)),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  updateProfile: jest.fn(async () => undefined),
  getAdditionalUserInfo: () => ({ isNewUser: mockIsNewUser }),
}))
jest.mock('firebase/analytics', () => ({ logEvent: jest.fn() }))
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  setDoc: jest.fn(async () => undefined),
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  trackEvent: jest.fn(),
  trackEventBeforeNavigation: jest.fn(async () => undefined),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useAnalytics: () => ({}),
  useAuth: () => ({}),
  useFirestore: () => ({}),
  useSigninCheck: () => ({ data: { signedIn: false } }),
}))
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('consent=required'),
}))
jest.mock('@aglyn/aglyn', () => {
  const campaign = jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/utm-attribution',
  )
  return {
    PLAN_LABELS: {},
    PLATFORM_BRAND_NAME: 'Aglyn',
    generateOrgSlug: (value: string) => value.toLowerCase(),
    onboardingDestination: (slug: string) => `/${slug}`,
    parseOnboardingPlanIntent: () => null,
    utmEventParams: campaign.utmEventParams,
    parseUtmAttribution: campaign.parseUtmAttribution,
    utmAttributionQuery: campaign.utmAttributionQuery,
  }
})
jest.mock('@aglyn/shared-data-forms', () => ({
  FIELD_SCHEMA_EMAIL: { name: 'email' },
  FIELD_SCHEMA_FIRST_NAME: { name: 'firstName' },
  FIELD_SCHEMA_LAST_NAME: { name: 'lastName' },
  FIELD_SCHEMA_ORGANIZATION_NAME: { name: 'organizationName', validate: [] },
  FIELD_SCHEMA_PASSWORD: { name: 'password' },
  FIELD_SCHEMA_PASSWORD_CONFIRM: { name: 'passwordConfirm' },
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
  FormRenderer: () => null,
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
    _event: unknown,
    _onError: unknown,
    _enabled: unknown,
    onCredential?: (credential: unknown) => void | Promise<unknown>,
  ) => {
    mockRedirectCallback = onCredential
  },
}))
/**
 * The real `isNewAccount` (it reads the mocked `getAdditionalUserInfo`), with
 * the navigation and the network halves stubbed.
 */
jest.mock('../utils/legal-consent', () => ({
  ...jest.requireActual('../utils/legal-consent'),
  consumeLegalConsent: jest.fn(() => true),
  postLegalAcceptance: jest.fn(async () => true),
  sendToConsentGate: () => mockSendToGate(),
}))
jest.mock('../utils/interactive-signin', () => ({
  markInteractiveSignIn: jest.fn(),
  markInteractiveSignOut: jest.fn(),
}))
jest.mock('../utils/is-mobile-browser', () => ({
  __esModule: true,
  default: () => false,
}))
jest.mock('../utils/auth-delegation', () => ({
  authSignInHost: () => 'app.aglyn.com',
}))
jest.mock('../utils/oauth-providers', () => ({
  createGoogleOAuthProvider: () => ({}),
}))
jest.mock('../utils/popup-loading-guard', () => ({
  __esModule: true,
  default: () => () => undefined,
}))
jest.mock('../utils/passkeys', () => ({
  describePasskeySignInFailure: () => null,
  signInWithPasskey: jest.fn(),
  usePasskeysSupported: () => false,
}))
jest.mock('../utils/hard-navigate', () => ({
  __esModule: true,
  default: jest.fn(),
  hardNavigate: jest.fn(),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockSteps.length = 0
  mockIsNewUser = false
  mockRedirectCallback = undefined
  mockPopup.mockResolvedValue(googleCredential)
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
  })) as unknown as typeof fetch
})

describe('/signin records the account its Google button creates', () => {
  it('records a brand-new Google account BEFORE standing it down (popup)', async () => {
    mockIsNewUser = true
    render(<SignIn />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Google' }))
    })

    await waitFor(() => expect(mockSendToGate).toHaveBeenCalled())
    // Before the sign-out: afterwards there is no user left to mint the
    // token the record is authorized by.
    expect(mockSteps).toEqual(['acquisition:u-google', 'signOut'])
  })

  it('records it on the mobile redirect too', async () => {
    mockIsNewUser = true
    render(<SignIn />)
    await act(async () => {
      await mockRedirectCallback?.(googleCredential)
    })

    expect(mockSendToGate).toHaveBeenCalled()
    expect(mockSteps).toEqual(['acquisition:u-google', 'signOut'])
  })

  it('asks nothing for a returning Google user', async () => {
    render(<SignIn />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Google' }))
    })

    await waitFor(() => expect(mockPopup).toHaveBeenCalled())
    expect(mockRememberAcquisition).not.toHaveBeenCalled()
  })
})

describe('/signup asks for the bounced account whatever the credential says', () => {
  it('records on the mobile redirect door for an account /signin already created', async () => {
    // By the time the person consents here, Firebase has known the account
    // since /signin — the credential is not "new", and the door used to
    // return on that before it ever asked.
    mockIsNewUser = false
    render(<SignUp />)
    expect(mockRedirectCallback).toBeDefined()
    await act(async () => {
      await mockRedirectCallback?.(googleCredential)
    })

    expect(mockRememberAcquisition).toHaveBeenCalledWith(googleCredential.user)
  })

  it('still records on the mobile redirect door for a brand-new account', async () => {
    mockIsNewUser = true
    render(<SignUp />)
    await act(async () => {
      await mockRedirectCallback?.(googleCredential)
    })

    expect(mockRememberAcquisition).toHaveBeenCalledWith(googleCredential.user)
  })
})
