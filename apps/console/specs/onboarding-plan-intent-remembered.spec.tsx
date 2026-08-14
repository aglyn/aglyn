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
 * AGL-1535, the write half: the plan a visitor picked on the marketing pricing
 * page has to be remembered somewhere that survives an EMAIL ROUND TRIP.
 *
 * Signup carries the intent on the URL all the way to
 * `/{slug}/billing?plan=pro`, and the password door's account is unverified at
 * that exact moment — so the app layout bounces it to /verify-email and the
 * verified return lands on a bare `/`. The click that verifies also routinely
 * happens in a different browser, which is why no browser-local marker can be
 * the answer. These tests pin the account-scoped record and its consumption.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  consumeOnboardingPlanIntent,
  rememberOnboardingPlanIntent,
} from '../utils/onboarding-plan-intent'

const mockCreateUser = jest.fn()
const mockSetDoc = jest.fn(async () => undefined)
let mockStoredUserDoc: Record<string, unknown> = {}

const credential = {
  user: {
    uid: 'u-new',
    email: 'new@example.com',
    displayName: 'New Person',
    getIdToken: async () => 'token-for-u-new',
  },
  providerId: 'password',
}

jest.mock('firebase/auth', () => ({
  browserLocalPersistence: {},
  createUserWithEmailAndPassword: (...args: unknown[]) => mockCreateUser(...args),
  GoogleAuthProvider: { credentialFromError: () => null },
  setPersistence: () => Promise.resolve(),
  signInWithPopup: jest.fn(),
  signInWithRedirect: jest.fn(),
  updateProfile: jest.fn(async () => undefined),
  getAdditionalUserInfo: () => ({ isNewUser: true }),
}))
jest.mock('firebase/analytics', () => ({ logEvent: jest.fn() }))
jest.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: async () => ({ data: () => mockStoredUserDoc }),
  setDoc: (...args: unknown[]) => mockSetDoc(...(args as [])),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useAnalytics: () => ({}),
  useAuth: () => ({}),
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u-new' } }),
  useSigninCheck: () => ({ data: { signedIn: false } }),
}))
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('plan=pro&interval=year'),
}))
// The deep-link contract is the real one — this spec is about what survives
// it, and a stubbed parser would make the assertions about nothing.
jest.mock('@aglyn/aglyn', () => ({
  PLAN_LABELS: { pro: 'Pro' },
  generateOrgSlug: (value: string) => value.toLowerCase().replace(/\s+/g, '-'),
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/onboarding-deep-link',
  ),
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
          organizationName: 'E2E Smoke Workspace',
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
jest.mock('../hooks/use-google-redirect-result', () => ({
  __esModule: true,
  default: () => undefined,
}))
jest.mock('../utils/legal-consent', () => ({
  clearLegalConsent: jest.fn(),
  consumeLegalConsent: jest.fn(() => true),
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
jest.mock('../utils/popup-loading-guard', () => ({
  __esModule: true,
  default: () => () => undefined,
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const SignUp = require('../app/(auth)/signup/page').default

/** The `onboardingPlanIntent` payloads written to `users/{uid}`, in order. */
const intentWrites = () =>
  mockSetDoc.mock.calls
    .filter(
      (call: any) =>
        call[0]?.path === 'users/u-new' &&
        Object.prototype.hasOwnProperty.call(
          call[1] ?? {},
          'onboardingPlanIntent',
        ),
    )
    .map((call: any) => call[1].onboardingPlanIntent)

const submit = async () => {
  fireEvent.click(screen.getByText('consent'))
  await act(async () => {
    fireEvent.click(screen.getByText('submit-form'))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockStoredUserDoc = {}
  mockCreateUser.mockResolvedValue(credential)
  global.fetch = jest.fn(async (url: string) =>
    String(url).includes('/api/orgs/create')
      ? {
          ok: true,
          status: 200,
          json: async () => ({ orgId: 'org-1', slug: 'e2e-smoke-workspace' }),
        }
      : { ok: true, status: 200, json: async () => ({}) },
  ) as unknown as typeof fetch
})

describe('AGL-1535 · signup remembers the plan on the ACCOUNT', () => {
  it('writes the deep-link intent to users/{uid} on the password door', async () => {
    render(<SignUp />)
    await submit()
    // Red before the fix: nothing but firstName/lastName was ever written,
    // and the intent lived only on a URL the verification bounce discarded.
    expect(intentWrites()).toHaveLength(1)
    expect(intentWrites()[0].query).toBe('plan=pro&interval=year')
    expect(typeof intentWrites()[0].createdAtMs).toBe('number')
  })

  it('writes nothing when the visitor did not come from a pricing CTA', async () => {
    // A remembered intent nobody expressed would send an ordinary signup to a
    // billing page they never asked for. `parseOnboardingPlanIntent` answers
    // null for a plain /signup, and null must stay unrecorded.
    await rememberOnboardingPlanIntent({} as any, 'u-new', null)
    expect(intentWrites()).toHaveLength(0)
  })
})

describe('AGL-1535 · the remembered intent is read once and re-validated', () => {
  it('round-trips through the real deep-link contract', async () => {
    await rememberOnboardingPlanIntent({} as any, 'u-new', {
      plan: 'pro',
      interval: 'year',
      intervalStated: true,
      contactSales: false,
    })
    mockStoredUserDoc = { onboardingPlanIntent: intentWrites()[0] }
    expect(await consumeOnboardingPlanIntent({} as any, 'u-new')).toEqual({
      plan: 'pro',
      interval: 'year',
      intervalStated: true,
      contactSales: false,
    })
  })

  it('clears the field with an explicit null, never undefined', async () => {
    // Firestore rejects `undefined`; a consume that threw would leave the
    // intent behind to fire again on the next visit to the jump page.
    mockStoredUserDoc = {
      onboardingPlanIntent: { query: 'plan=pro', createdAtMs: Date.now() },
    }
    await consumeOnboardingPlanIntent({} as any, 'u-new')
    expect(intentWrites()).toEqual([null])
  })

  it('ignores an intent older than the window', async () => {
    mockStoredUserDoc = {
      onboardingPlanIntent: {
        query: 'plan=pro&interval=year',
        createdAtMs: Date.now() - 8 * 24 * 60 * 60 * 1000,
      },
    }
    expect(await consumeOnboardingPlanIntent({} as any, 'u-new')).toBeNull()
  })

  it('refuses a forged plan — the stored value is re-parsed, not trusted', async () => {
    // The field is client-writable (it lives on the user's own doc), so it
    // must not be a second, more trusting route into plan selection.
    mockStoredUserDoc = {
      onboardingPlanIntent: {
        query: 'plan=platinum&interval=year',
        createdAtMs: Date.now(),
      },
    }
    expect(await consumeOnboardingPlanIntent({} as any, 'u-new')).toBeNull()
  })

  it('is null when nothing was ever remembered', async () => {
    mockStoredUserDoc = {}
    expect(await consumeOnboardingPlanIntent({} as any, 'u-new')).toBeNull()
  })
})
