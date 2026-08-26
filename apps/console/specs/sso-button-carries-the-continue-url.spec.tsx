/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
 *
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
 * AGL-2486 — the SSO button keeps the destination.
 *
 * A signed-out deep link sets a continue URL; taking the SSO route must not
 * drop it.
 *
 * `AuthenticatedLayout` sends a session-less deep link to
 * `/signin?continue=…`, and `AuthenticatingLayout` — which wraps the WHOLE
 * `(auth)` group, `/sso` included — reads that param back and routes to it
 * once the user is signed in. The password, Google and passkey paths never
 * leave `/signin`, so the param is still on the URL when they finish. An SSO
 * button carrying a bare `href="/sso"` navigates to a URL with no `continue`
 * on it at all, leaving the layout nothing to read: the enterprise user
 * authenticates perfectly and lands on the dashboard instead of the page they
 * asked for.
 *
 * This drives the real pages and reads the real anchors, because the failure
 * lives ENTIRELY in a rendered href — a unit test of the URL builder is green
 * against a page that drops it. `AppLink` is mocked to a plain `<a>`
 * that FORWARDS href, which the other specs in this suite deliberately do not
 * do; a mock that drops href is exactly the bug, and would report it fixed.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import SignIn from '../app/(auth)/signin/page'
import SsoSignIn from '../app/(auth)/sso/page'

let mockSearch = ''
let mockIsMobile = false

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  usePathname: () => '/signin',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

jest.mock('firebase/auth', () => ({
  browserLocalPersistence: {},
  GoogleAuthProvider: { credentialFromError: () => null },
  getAdditionalUserInfo: () => ({ isNewUser: false }),
  getRedirectResult: jest.fn(async () => null),
  setPersistence: () => Promise.resolve(),
  signInWithEmailAndPassword: jest.fn(),
  signInWithPopup: jest.fn(),
  signInWithRedirect: jest.fn(() => new Promise(() => undefined)),
  signOut: jest.fn(),
}))
jest.mock('firebase/analytics', () => ({ logEvent: jest.fn() }))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  trackEvent: jest.fn(),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useAnalytics: () => ({}),
  useAuth: () => ({ tenantId: null }),
  useSigninCheck: () => ({ data: { signedIn: false } }),
}))
jest.mock('@aglyn/shared-data-enums', () => ({
  AuthAppErrorCodes: {
    SSO_NOT_AUTHORIZED: 'sso-not-authorized',
    SSO_NOT_CONFIGURED: 'sso-not-configured',
    SSO_INPUT_REQUIRED: 'sso-input-required',
  },
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
// Href IS the subject — a mock that swallows it makes this spec unable to
// fail, which is the trap the rest of the suite's `AppLink` mocks fall into.
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children, href }: { children: ReactNode; href?: string }) => (
    <a href={href}>{children}</a>
  ),
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
    <button onClick={() => onSubmit({ email: 'ada@enterprise.example' })}>
      {'Submit the form'}
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
  default: ({
    children,
    paperAfter,
  }: {
    children?: ReactNode
    paperAfter?: ReactNode
  }) => (
    <div>
      {children}
      {paperAfter}
    </div>
  ),
}))
jest.mock('../components/auth-legal-consent.component', () => ({
  AuthLegalNotice: () => null,
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
jest.mock('../utils/auth-delegation', () => ({
  authSignInHost: () => 'auth.aglyn.com',
}))
jest.mock('../utils/interactive-signin', () => ({
  markInteractiveSignIn: jest.fn(),
  markInteractiveSignOut: jest.fn(),
}))
jest.mock('../utils/is-mobile-browser', () => ({
  __esModule: true,
  default: () => mockIsMobile,
}))
jest.mock('../utils/legal-consent', () => ({
  isNewAccount: () => false,
  sendToConsentGate: jest.fn(),
}))
jest.mock('../utils/oauth-providers', () => ({
  createAuthProvider: () => ({}),
  createGoogleOAuthProvider: () => ({}),
}))
jest.mock('../utils/passkeys', () => ({
  describePasskeySignInFailure: () => null,
  signInWithPasskey: jest.fn(),
  usePasskeysSupported: () => false,
}))
jest.mock('../utils/popup-loading-guard', () => ({
  __esModule: true,
  default: () => () => undefined,
}))
jest.mock('../utils/sso-errors', () => ({
  describeSsoError: () => ({ code: 'sso-failed', message: 'failed' }),
}))

const DEEP_LINK = '/orgs/acme/sites/homepage?tab=pages'

const ssoButtonHref = () =>
  screen.getByRole('link', { name: /Single sign-on/ }).getAttribute('href')

const backToSignInHref = () =>
  screen.getByRole('link', { name: /Back to sign in/ }).getAttribute('href')

beforeEach(() => {
  mockSearch = ''
  mockIsMobile = false
})

describe('the SSO button carries the continue URL', () => {
  it('forwards the deep link the signed-out user was sent from', () => {
    mockSearch = `continue=${encodeURIComponent(DEEP_LINK)}`
    render(<SignIn />)
    const href = ssoButtonHref() ?? ''
    expect(href.startsWith('/sso?')).toBe(true)
    expect(
      new URL(`https://auth.aglyn.com${href}`).searchParams.get('continue'),
    ).toBe(DEEP_LINK)
  })

  /**
   * The enterprise case end to end. An org workspace subdomain cannot run
   * OAuth, so `buildDelegatedSignInUrl` sends the user to
   * `auth.aglyn.com/signin?continue=https://acme.aglyn.com/…` — an ABSOLUTE
   * same-site return (AGL-465). That is the value an SSO customer's deep
   * link actually carries, and it has to reach `/sso` intact and encoded
   * exactly once, or the layout's cross-origin hand-off has nothing to
   * hand off to.
   */
  it('carries a same-site absolute return from a workspace subdomain', () => {
    const delegated = 'https://acme.aglyn.com/sites/homepage'
    mockSearch = `continue=${encodeURIComponent(delegated)}`
    render(<SignIn />)
    const href = ssoButtonHref() ?? ''
    expect(
      new URL(`https://auth.aglyn.com${href}`).searchParams.get('continue'),
    ).toBe(delegated)
  })

  it('stays a plain /sso link when there is nothing to carry', () => {
    render(<SignIn />)
    expect(ssoButtonHref()).toBe('/sso')
  })

  it.each([
    ['//evil.com'],
    ['https://evil.com/steal'],
    ['javascript:alert(1)'],
    ['/\\evil.com'],
  ])('refuses to forward %s onto the SSO page', (hostile) => {
    mockSearch = `continue=${encodeURIComponent(hostile)}`
    render(<SignIn />)
    // Not merely "does not equal the hostile value" — the param must be
    // ABSENT, so nothing downstream can read a rejected value back.
    expect(ssoButtonHref()).toBe('/sso')
  })
})

describe('the escape hatch off the SSO page keeps it too', () => {
  it('returns to /signin still pointed at the deep link', () => {
    mockSearch = `continue=${encodeURIComponent(DEEP_LINK)}`
    render(<SsoSignIn />)
    const href = backToSignInHref() ?? ''
    expect(
      new URL(`https://auth.aglyn.com${href}`).searchParams.get('continue'),
    ).toBe(DEEP_LINK)
  })

  it('is a plain /signin link with nothing to carry', () => {
    render(<SsoSignIn />)
    expect(backToSignInHref()).toBe('/signin')
  })

  it('does not forward a hostile continue back either', () => {
    mockSearch = `continue=${encodeURIComponent('//evil.com')}`
    render(<SsoSignIn />)
    expect(backToSignInHref()).toBe('/signin')
  })
})

/**
 * The mobile leg leaves the browser, so the URL is not the only thing that
 * has to survive — and what comes back is untrusted no matter who wrote it.
 */
describe('the SAML redirect brings the continue URL back', () => {
  const SSO_PENDING_KEY = 'aglyn.sso.pending'

  const stash = (pending: Record<string, unknown>) =>
    window.sessionStorage.setItem(SSO_PENDING_KEY, JSON.stringify(pending))

  const continueOnUrl = () =>
    new URL(window.location.href).searchParams.get('continue')

  beforeEach(() => {
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/sso')
  })

  it('restores the destination when the IdP did not hand the query back', () => {
    stash({ tenantId: 'aglyn-org-y5v14', continueUrl: DEEP_LINK })
    expect(continueOnUrl()).toBeNull() // precondition: it really is gone
    render(<SsoSignIn />)
    expect(continueOnUrl()).toBe(DEEP_LINK)
  })

  it.each([
    ['//evil.com'],
    ['https://evil.com/steal'],
    ['javascript:alert(1)'],
    ['/\\evil.com'],
    [''],
  ])('refuses to restore %s from the stash', (hostile) => {
    stash({ tenantId: 'aglyn-org-y5v14', continueUrl: hostile })
    render(<SsoSignIn />)
    expect(continueOnUrl()).toBeNull()
  })

  it('leaves a continue that DID survive alone, stale stash or not', () => {
    window.history.replaceState({}, '', `/sso?continue=${encodeURIComponent(DEEP_LINK)}`)
    stash({ tenantId: 'aglyn-org-y5v14', continueUrl: '/somewhere/else' })
    render(<SsoSignIn />)
    expect(continueOnUrl()).toBe(DEEP_LINK)
  })

  it('writes the continue INTO the stash when the redirect starts', async () => {
    // The write side of the same hop, driven through the real form: whatever
    // is on the URL when the user leaves for the IdP has to be waiting for
    // them when they come back. Asserting only the read side would pass
    // against a stash nothing ever fills.
    mockIsMobile = true
    window.history.replaceState(
      {},
      '',
      `/sso?continue=${encodeURIComponent(DEEP_LINK)}`,
    )
    const fetchMock = jest.fn(async () => ({
      json: async () => ({
        ssoEnabled: true,
        tenantId: 'aglyn-org-y5v14',
        providerId: 'saml.aglyn-workspace',
      }),
    }))
    ;(global as any).fetch = fetchMock
    render(<SsoSignIn />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit the form' }))
    })
    await waitFor(() =>
      expect(window.sessionStorage.getItem(SSO_PENDING_KEY)).toBeTruthy(),
    )
    expect(
      JSON.parse(window.sessionStorage.getItem(SSO_PENDING_KEY) as string),
    ).toEqual({ tenantId: 'aglyn-org-y5v14', continueUrl: DEEP_LINK })
  })
})
