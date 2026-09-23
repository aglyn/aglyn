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
 * AGL-3185 — the product-updates opt-in at the doors that create accounts.
 *
 * The properties, each the opposite of a plausible shortcut: the box is
 * unticked until the person ticks it, and an untouched box records NOTHING —
 * not a refusal; it is never required, so a sign-up without it still creates
 * the account; a ticked box records a grant naming the sign-up door and the
 * wording version, on every door including the mobile redirect that unmounts
 * the page before the account exists; and a failed attempt drops the carried
 * tick rather than opting in whoever signs up next in the tab.
 *
 * The mocks are the clickwrap spec's, because the doors are the same doors.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import SignUp from '../app/(auth)/signup/page'
import { PLATFORM_MARKETING_CONSENT_TEXT_VERSION } from '@aglyn/aglyn/app-utils/platform-marketing-consent'

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
  FormRenderer: ({
    onSubmit,
    FormTemplateProps,
  }: {
    onSubmit: (values: unknown) => void
    FormTemplateProps?: { beforeSubmit?: ReactNode }
  }) => (
    <>
      {/* The real template draws the page's before-submit block —
          the consent checkboxes — above its button (AGL-3291). */}
      {FormTemplateProps?.beforeSubmit}
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
    </>
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
  authSignInHost: () => 'console.example.com',
}))

const marketingCalls = () =>
  (globalThis.fetch as jest.Mock).mock.calls.filter(
    ([url]) => url === '/api/auth/marketing-consent',
  )
const acceptanceCalls = () =>
  (globalThis.fetch as jest.Mock).mock.calls.filter(
    ([url]) => url === '/api/auth/legal-acceptance',
  )

const tickLegal = () =>
  fireEvent.click(
    screen.getByLabelText('Agree to the Terms of Service and Privacy Policy'),
  )
const marketingBox = () =>
  screen.getByLabelText('Send me product updates') as HTMLInputElement
const tickMarketing = () => fireEvent.click(marketingBox())
const clickGoogle = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Google' }))
const submitForm = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Submit sign up' }))

const GRANT_BODY = {
  decision: 'granted',
  source: 'console-signup',
  textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
}

describe('sign-up product-updates opt-in (AGL-3185)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.sessionStorage.clear()
    mockMobile = false
    mockRedirectCallback = undefined
    mockCreateUser.mockResolvedValue(credentialFor('uid-new'))
    mockPopup.mockResolvedValue(credentialFor('uid-new'))
    // `signInWithRedirect` navigates the browser away, so it never settles.
    mockRedirect.mockReturnValue(new Promise(() => undefined))
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
      text: async () => '',
    })) as unknown as typeof fetch
  })

  it('renders the box unticked, below the required acceptance', () => {
    render(<SignUp />)
    expect(marketingBox().checked).toBe(false)
    expect(marketingBox().required).toBe(false)
    // Two separate controls: the terms are one act, this is another.
    const legal = screen.getByLabelText(
      'Agree to the Terms of Service and Privacy Policy',
    )
    expect(legal).not.toBe(marketingBox())
    expect(
      legal.compareDocumentPosition(marketingBox()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('is not required: an untouched box still creates the account and records NOTHING', async () => {
    render(<SignUp />)
    tickLegal()
    await act(async () => {
      submitForm()
    })
    await waitFor(() => expect(mockCreateUser).toHaveBeenCalled())
    await waitFor(() => expect(acceptanceCalls()).toHaveLength(1))
    // Absence, not refusal: no request of any kind about marketing.
    expect(marketingCalls()).toHaveLength(0)
  })

  it('does not opt anybody in when the terms gate refuses the attempt', async () => {
    render(<SignUp />)
    tickMarketing()
    await act(async () => {
      submitForm()
    })
    expect(mockCreateUser).not.toHaveBeenCalled()
    expect(marketingCalls()).toHaveLength(0)
    // …and no marker is left for a later attempt to pick up.
    expect(window.sessionStorage.getItem('aglyn:marketing-opt-in-at')).toBeNull()
  })

  it('records a grant naming the sign-up door and the wording version on the password door', async () => {
    render(<SignUp />)
    tickLegal()
    tickMarketing()
    await act(async () => {
      submitForm()
    })
    await waitFor(() => expect(mockCreateUser).toHaveBeenCalled())
    await waitFor(() => expect(marketingCalls()).toHaveLength(1))
    const [, request] = marketingCalls()[0]
    expect(JSON.parse(request.body)).toEqual(GRANT_BODY)
    // Attributable to THIS account, not merely posted.
    expect(request.headers.Authorization).toBe('Bearer token-for-uid-new')
    // Nothing left behind for the next attempt in this tab.
    expect(window.sessionStorage.getItem('aglyn:marketing-opt-in-at')).toBeNull()
  })

  it('records the grant on the Google popup door too', async () => {
    render(<SignUp />)
    tickLegal()
    tickMarketing()
    await act(async () => {
      clickGoogle()
    })
    await waitFor(() => expect(mockPopup).toHaveBeenCalled())
    await waitFor(() => expect(marketingCalls()).toHaveLength(1))
    expect(JSON.parse(marketingCalls()[0][1].body)).toEqual(GRANT_BODY)
  })

  describe('mobile redirect round-trip', () => {
    beforeEach(() => {
      mockMobile = true
    })

    it('carries the tick across the redirect and records it on return', async () => {
      const { unmount } = render(<SignUp />)
      tickLegal()
      tickMarketing()
      await act(async () => {
        clickGoogle()
      })
      await waitFor(() => expect(mockRedirect).toHaveBeenCalled())
      expect(marketingCalls()).toHaveLength(0)

      // Google returns the user to a FRESH mount of the page.
      unmount()
      render(<SignUp />)
      await act(async () => {
        await mockRedirectCallback?.(credentialFor('uid-mobile'))
      })

      await waitFor(() => expect(marketingCalls()).toHaveLength(1))
      const [, request] = marketingCalls()[0]
      expect(JSON.parse(request.body)).toEqual(GRANT_BODY)
      expect(request.headers.Authorization).toBe('Bearer token-for-uid-mobile')
    })

    it('records nothing on return when the box was left alone', async () => {
      const { unmount } = render(<SignUp />)
      tickLegal()
      await act(async () => {
        clickGoogle()
      })
      await waitFor(() => expect(mockRedirect).toHaveBeenCalled())
      unmount()
      render(<SignUp />)
      await act(async () => {
        await mockRedirectCallback?.(credentialFor('uid-mobile'))
      })
      await waitFor(() => expect(acceptanceCalls()).toHaveLength(1))
      expect(marketingCalls()).toHaveLength(0)
    })

    it('drops the carried tick when the attempt fails', async () => {
      mockRedirect.mockRejectedValueOnce(new Error('auth/popup-closed-by-user'))
      render(<SignUp />)
      tickLegal()
      tickMarketing()
      await act(async () => {
        clickGoogle()
      })
      await waitFor(() => expect(mockRedirect).toHaveBeenCalled())
      await waitFor(() =>
        expect(window.sessionStorage.getItem('aglyn:marketing-opt-in-at')).toBeNull(),
      )
      // A later sign-up in this tab must not inherit the tick.
      window.sessionStorage.setItem('aglyn:legal-consent-at', String(Date.now()))
      await act(async () => {
        await mockRedirectCallback?.(credentialFor('uid-later'))
      })
      expect(marketingCalls()).toHaveLength(0)
    })
  })
})
