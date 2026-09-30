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
 * An account /signin bounced for consent lands in a workspace when it signs
 * up on /signup, exactly as a fresh Google sign-up does (AGL-3424).
 *
 * "Sign in with Google" on /signin creates the account when the identity is
 * new, and stands it down to /signup for consent (AGL-1497). By then Firebase
 * already knows it, so the credential /signup gets back says "not new" — and
 * both Google doors there provision a workspace only for a new account, so
 * that an existing customer clicking Google on /signup is not handed a second
 * one. The bounced person, who is signing up, got the empty chooser instead.
 *
 * /signin now marks the account it bounced, by uid, and /signup honours the
 * mark for that account alone.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
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
const mockCreateWorkspace = jest.fn()
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
  // The real template draws the page's before-submit block — the consent
  // checkbox the Google door is gated on — above its button (AGL-3291).
  FormRenderer: ({
    FormTemplateProps,
  }: {
    FormTemplateProps?: { beforeSubmit?: ReactNode }
  }) => <>{FormTemplateProps?.beforeSubmit}</>,
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
jest.mock('../components/auth-marketing-opt-in.component', () => ({
  AuthMarketingOptIn: () => null,
}))
jest.mock('../components/auth-legal-consent.component', () => ({
  AuthLegalNotice: () => null,
  AuthConsentCheckbox: ({ onChange }: { onChange: (next: boolean) => void }) => (
    <button onClick={() => onChange(true)}>{'consent'}</button>
  ),
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
jest.mock('../utils/signup-workspace', () => ({
  ...jest.requireActual('../utils/signup-workspace'),
  createSignUpWorkspace: (...args: unknown[]) => mockCreateWorkspace(...args),
}))
jest.mock('../utils/hard-navigate', () => ({
  __esModule: true,
  default: jest.fn(),
  hardNavigate: jest.fn(),
}))

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  mockSteps.length = 0
  mockIsNewUser = false
  mockRedirectCallback = undefined
  mockPopup.mockResolvedValue(googleCredential)
  mockCreateWorkspace.mockResolvedValue({ slug: 'ada-lovelace', error: null })
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
  })) as unknown as typeof fetch
})

/** Walk /signin's Google button for a brand-new identity: created, then bounced. */
async function bounceThroughSignIn() {
  mockIsNewUser = true
  const view = render(<SignIn />)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Google' }))
  })
  await waitFor(() => expect(mockSendToGate).toHaveBeenCalled())
  view.unmount()
  // Back on /signup, Firebase has known the account since the click above.
  mockIsNewUser = false
  mockRedirectCallback = undefined
}

/** Tick the consent box and press /signup's Google button. */
async function signUpWithGooglePopup() {
  render(<SignUp />)
  fireEvent.click(screen.getByRole('button', { name: 'consent' }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Google' }))
  })
}

describe('the /signin consent bounce lands in a workspace on /signup', () => {
  it('provisions on the desktop popup door', async () => {
    await bounceThroughSignIn()
    await signUpWithGooglePopup()

    await waitFor(() => expect(mockCreateWorkspace).toHaveBeenCalledTimes(1))
    expect(mockCreateWorkspace.mock.calls[0][1]).toBe('Ada Lovelace')
  })

  it('provisions on the mobile redirect door', async () => {
    await bounceThroughSignIn()
    render(<SignUp />)
    await act(async () => {
      await mockRedirectCallback?.(googleCredential)
    })

    expect(mockCreateWorkspace).toHaveBeenCalledTimes(1)
  })

  it('answers once: the same account signing up again is not handed a second workspace', async () => {
    await bounceThroughSignIn()
    await signUpWithGooglePopup()
    await waitFor(() => expect(mockCreateWorkspace).toHaveBeenCalledTimes(1))
    cleanup()

    await signUpWithGooglePopup()
    await waitFor(() => expect(mockPopup).toHaveBeenCalledTimes(3))
    expect(mockCreateWorkspace).toHaveBeenCalledTimes(1)
  })

  it('never provisions for an existing customer who clicks Google on /signup', async () => {
    await signUpWithGooglePopup()
    await waitFor(() => expect(mockPopup).toHaveBeenCalled())
    expect(mockCreateWorkspace).not.toHaveBeenCalled()
  })

  it('a bounce for one account does not make another account look new', async () => {
    await bounceThroughSignIn()
    mockPopup.mockResolvedValue({
      ...googleCredential,
      user: { ...googleCredential.user, uid: 'u-someone-else' },
    })
    await signUpWithGooglePopup()
    await waitFor(() => expect(mockPopup).toHaveBeenCalledTimes(2))
    expect(mockCreateWorkspace).not.toHaveBeenCalled()
  })
})
