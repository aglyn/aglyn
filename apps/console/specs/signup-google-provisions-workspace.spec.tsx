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
 * AGL-1942 — every sign-up door provisions a workspace, not just the form.
 *
 * AGL-1115 collected an organization name on the sign-up form so a new
 * account would land in a ready workspace instead of an empty chooser. Only
 * the email/password door submits that form, so the Google doors kept the
 * behaviour the issue was filed to remove: an authenticated user, no
 * workspace, and a picker. AGL-1117 later provisioned on the Google popup
 * door too — but ONLY when the visitor had picked a plan on the marketing
 * site, which is a minority of sign-ups, and never on the mobile redirect
 * door at all.
 *
 * Pinned here: the derived name matches what `ensureOrgForUser` derives
 * server-side, all three Google doors provision through the one routine, an
 * account that already existed is NOT handed a surprise second workspace, and
 * a failed derive-name provision does not accuse the person of typing a name
 * they never typed.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import SignUp from '../app/(auth)/signup/page'
import { consumeSignUpOrgFailure } from '../utils/signup-org-failure'

const mockPopup = jest.fn()
const mockRedirect = jest.fn()
const mockCreateUser = jest.fn()
const mockNavigate = jest.fn()
const mockRemember = jest.fn(async (..._args: unknown[]) => undefined)
const mockTrackEvent = jest.fn()

/** Flipped per test — `isNewAccount` is what tells a sign-up from a sign-in. */
let mockIsNewAccount = true
/** The marketing plan CTA, when there was one. */
let mockPlanIntent: { plan: string; interval: string } | null = null
/** The mobile door's completion callback, captured from the redirect hook. */
let redirectOnCredential:
  | ((credential: unknown) => void | Promise<unknown>)
  | undefined

const googleUser = (over: Record<string, unknown> = {}) => ({
  user: {
    uid: 'u-google',
    email: 'ada@example.com',
    displayName: 'Ada Lovelace',
    getIdToken: async () => 'token-for-u-google',
    ...over,
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
  getAdditionalUserInfo: () => ({ isNewUser: mockIsNewAccount }),
}))
jest.mock('firebase/analytics', () => ({ logEvent: jest.fn() }))
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  setDoc: jest.fn(async () => undefined),
}))
// The deep import is what the page uses — mocking the barrel would not
// intercept it.
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
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
  PLAN_LABELS: { pro: 'Pro' },
  PLATFORM_BRAND_NAME: 'Aglyn',
  generateOrgSlug: (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, ''),
  onboardingDestination: (slug: string, intent: unknown) =>
    intent ? `/${slug}/billing` : `/${slug}`,
  parseOnboardingPlanIntent: () => mockPlanIntent,
  // AGL-1731. The REAL contract rather than a stub: the signup page parses a
  // campaign off the same `useSearchParams` these cases already drive, and a
  // stub that invented params would change what this file's assertions see.
  // These URLs name no campaign, so the honest answer is "none".
  parseCampaignAttribution: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/campaign-attribution',
  ).parseCampaignAttribution,
  campaignEventParams: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/campaign-attribution',
  ).campaignEventParams,
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
          organizationName: 'Typed Workspace',
        })
      }
    >
      {'submit-form'}
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
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('../components/auth-legal-consent.component', () => ({
  AuthConsentCheckbox: ({ onChange }: { onChange: (next: boolean) => void }) => (
    <button onClick={() => onChange(true)}>{'consent'}</button>
  ),
}))
jest.mock('../components/layouts/authenticating.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('../hooks/use-delegate-workspace-signin', () => ({
  __esModule: true,
  default: () => 'off',
}))
// Capture the mobile door's completion callback so the redirect round-trip
// can be driven the way Google drives it.
jest.mock('../hooks/use-google-redirect-result', () => ({
  __esModule: true,
  default: (
    _event: unknown,
    _onError: unknown,
    _enabled: unknown,
    onCredential?: (credential: unknown) => void | Promise<unknown>,
  ) => {
    redirectOnCredential = onCredential
  },
}))
jest.mock('../utils/legal-consent', () => ({
  clearLegalConsent: jest.fn(),
  consumeLegalConsent: jest.fn(() => true),
  isNewAccount: () => mockIsNewAccount,
  markLegalConsent: jest.fn(),
  postLegalAcceptance: jest.fn(async () => undefined),
}))
jest.mock('../utils/interactive-signin', () => ({
  markInteractiveSignIn: jest.fn(),
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
jest.mock('../utils/onboarding-plan-intent', () => ({
  rememberOnboardingPlanIntent: (...args: unknown[]) => mockRemember(...args),
}))
jest.mock('../utils/popup-loading-guard', () => ({
  __esModule: true,
  default: () => () => undefined,
}))
// The navigation seam — jsdom's `location.assign` is read-only, so the page
// hard-navigates through this module precisely so specs can observe it.
jest.mock('../utils/hard-navigate', () => ({
  __esModule: true,
  default: (url: string) => mockNavigate(url),
  hardNavigate: (url: string) => mockNavigate(url),
}))

/** Every POST the page made to the org-create endpoint. */
const orgCreateBodies = () =>
  (global.fetch as jest.Mock).mock.calls
    .filter(([url]) => String(url).includes('/api/orgs/create'))
    .map(([, init]) => JSON.parse(String(init?.body ?? '{}')))

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

const clickGoogle = async () => {
  fireEvent.click(screen.getByText('consent'))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Google' }))
    await settle()
  })
}

const submitForm = async () => {
  fireEvent.click(screen.getByText('consent'))
  await act(async () => {
    fireEvent.click(screen.getByText('submit-form'))
    await settle()
  })
}

const okFetch = (slug = 'ada-lovelace') =>
  jest.fn(async (url: string) =>
    String(url).includes('/api/orgs/create')
      ? { ok: true, status: 200, json: async () => ({ orgId: 'o-1', slug }) }
      : { ok: true, status: 200, json: async () => ({}) },
  ) as unknown as typeof fetch

beforeEach(() => {
  jest.clearAllMocks()
  window.sessionStorage.clear()
  mockIsNewAccount = true
  mockPlanIntent = null
  redirectOnCredential = undefined
  mockPopup.mockResolvedValue(googleUser())
  mockCreateUser.mockResolvedValue(googleUser({ uid: 'u-password' }))
  global.fetch = okFetch()
})

describe('AGL-1942 · a Google sign-up gets a ready workspace', () => {
  it('provisions on the desktop popup door with no plan intent at all', async () => {
    render(<SignUp />)
    await clickGoogle()

    // Red before the fix: the Google door only provisioned when a marketing
    // plan CTA had been clicked, so an ordinary visitor got the picker.
    expect(orgCreateBodies()).toEqual([{ name: 'Ada Lovelace' }])
    expect(mockNavigate).toHaveBeenCalledWith('/ada-lovelace')
  })

  it('falls back to the email local part when Google sent no display name', async () => {
    mockPopup.mockResolvedValue(googleUser({ displayName: null }))
    global.fetch = okFetch('ada')
    render(<SignUp />)
    await clickGoogle()

    // The same derivation `ensureOrgForUser` uses server-side, so the two
    // cannot disagree about what a personal workspace is called.
    expect(orgCreateBodies()).toEqual([{ name: 'ada' }])
    expect(mockNavigate).toHaveBeenCalledWith('/ada')
  })

  it('provisions on the mobile redirect door too', async () => {
    render(<SignUp />)
    expect(redirectOnCredential).toBeDefined()
    await act(async () => {
      await redirectOnCredential?.(googleUser())
      await settle()
    })

    // Red before the fix: the mobile door recorded the legal acceptance and
    // nothing else — it never provisioned, even WITH a plan intent.
    expect(orgCreateBodies()).toEqual([{ name: 'Ada Lovelace' }])
    expect(mockNavigate).toHaveBeenCalledWith('/ada-lovelace')
  })

  it('carries the plan the visitor picked into the new workspace', async () => {
    mockPlanIntent = { plan: 'pro', interval: 'year' }
    render(<SignUp />)
    await clickGoogle()

    expect(mockNavigate).toHaveBeenCalledWith('/ada-lovelace/billing')
  })

  it('remembers the plan intent on the mobile door, like the desktop one', async () => {
    mockPlanIntent = { plan: 'pro', interval: 'year' }
    render(<SignUp />)
    await act(async () => {
      await redirectOnCredential?.(googleUser())
      await settle()
    })

    // Red before the fix: the account-side record that survives a bounce was
    // written on desktop only.
    expect(mockRemember).toHaveBeenCalledWith({}, 'u-google', mockPlanIntent)
  })

  it('leaves an account that ALREADY existed alone', async () => {
    // "Sign in with Google" and "sign up with Google" are the same call, so
    // an existing customer who lands on /signup and clicks Google must not
    // be handed a surprise second workspace.
    mockIsNewAccount = false
    mockPlanIntent = { plan: 'pro', interval: 'year' }
    render(<SignUp />)
    await clickGoogle()

    expect(orgCreateBodies()).toEqual([])
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('does not accuse the person of typing a name they never typed', async () => {
    // The AGL-1523 picker notice quotes the name back — which only makes
    // sense for the form door. A derived name that fails falls through to
    // the picker silently, exactly as it did before.
    mockPlanIntent = { plan: 'pro', interval: 'year' }
    global.fetch = jest.fn(async (url: string) =>
      String(url).includes('/api/orgs/create')
        ? {
            ok: false,
            status: 409,
            json: async () => ({ error: 'That workspace URL is taken' }),
          }
        : { ok: true, status: 200, json: async () => ({}) },
    ) as unknown as typeof fetch

    render(<SignUp />)
    await clickGoogle()

    expect(consumeSignUpOrgFailure()).toBeNull()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('still provisions the name the form door collected, unchanged', async () => {
    global.fetch = okFetch('typed-workspace')
    render(<SignUp />)
    await submitForm()

    expect(orgCreateBodies()).toEqual([{ name: 'Typed Workspace' }])
    expect(mockNavigate).toHaveBeenCalledWith('/typed-workspace')
  })

  it('still quotes a TYPED name back when the form door fails to provision', async () => {
    global.fetch = jest.fn(async (url: string) =>
      String(url).includes('/api/orgs/create')
        ? {
            ok: false,
            status: 409,
            json: async () => ({ error: 'That workspace URL is taken' }),
          }
        : { ok: true, status: 200, json: async () => ({}) },
    ) as unknown as typeof fetch

    render(<SignUp />)
    await submitForm()

    expect(consumeSignUpOrgFailure()).toEqual({
      name: 'Typed Workspace',
      error: 'That workspace URL is taken',
    })
  })
})
