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
 * AGL-1523, the write side: when the signup-time org create fails, the page
 * must leave the marker the workspace picker reads — `console.error` into a
 * console nobody is watching is how the first production signup's typed
 * workspace name vanished without a trace.
 *
 * (The read side — the picker's alert and the prefilled dialog — is pinned in
 * `signup-org-failure-surfaced.spec.tsx`; the marker itself is unit-tested
 * there too.)
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import SignUp from '../app/(auth)/signup/page'
import { consumeSignUpOrgFailure } from '../utils/signup-org-failure'

const mockCreateUser = jest.fn()

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
  createUserWithEmailAndPassword: (...args: unknown[]) =>
    mockCreateUser(...args),
  GoogleAuthProvider: { credentialFromError: () => null },
  setPersistence: () => Promise.resolve(),
  signInWithPopup: jest.fn(),
  signInWithRedirect: jest.fn(),
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
  generateOrgSlug: (value: string) => value.toLowerCase().replace(/\s+/g, '-'),
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
  AuthConsentCheckbox: ({
    onChange,
  }: {
    onChange: (next: boolean) => void
  }) => (
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
  window.sessionStorage.clear()
  mockCreateUser.mockResolvedValue(credential)
})

describe('AGL-1523 · a failed signup org create leaves the marker', () => {
  it('a refused create (e.g. slug taken) is marked with the server reason', async () => {
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
    await submit()

    // Red before the fix: the failure went to console.error and nothing else.
    expect(consumeSignUpOrgFailure()).toEqual({
      name: 'E2E Smoke Workspace',
      error: 'That workspace URL is taken',
    })
  })

  it('a network failure is marked too, with no reason to show', async () => {
    global.fetch = jest.fn(async (url: string) => {
      if (String(url).includes('/api/orgs/create')) throw new Error('offline')
      return { ok: true, status: 200, json: async () => ({}) }
    }) as unknown as typeof fetch

    render(<SignUp />)
    await submit()

    expect(consumeSignUpOrgFailure()).toEqual({
      name: 'E2E Smoke Workspace',
      error: null,
    })
  })

  it('a successful create leaves NO marker', async () => {
    global.fetch = jest.fn(async (url: string) =>
      String(url).includes('/api/orgs/create')
        ? {
            ok: true,
            status: 200,
            json: async () => ({ orgId: 'org-1', slug: 'e2e-smoke-workspace' }),
          }
        : { ok: true, status: 200, json: async () => ({}) },
    ) as unknown as typeof fetch

    render(<SignUp />)
    await submit()

    expect(consumeSignUpOrgFailure()).toBeNull()
  })
})
