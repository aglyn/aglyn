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
 * AGL-1562 — enterprise SSO sign-in reports itself.
 *
 * `LoginMethod` has carried an `'sso'` member since AGL-1561 with no call site
 * sending it, so every SAML sign-in read in GA as no sign-in at all. Driving
 * the real page rather than the helper is the point: the taxonomy's own unit
 * tests cannot tell whether anything calls it, and an uncalled event reports
 * zero, which looks exactly like an unused feature.
 *
 * Two behaviours here are decisions, not incidentals, and both have a case:
 * an authenticated user the JIT mapping REFUSES is not a login, and a
 * JIT-provisioned account is never a `sign_up`.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import SsoSignIn from '../app/(auth)/sso/page'

const mockPopup = jest.fn()
const mockRedirect = jest.fn()
const mockRedirectResult = jest.fn()
const mockTrackEvent = jest.fn()
let mockIsMobile = false

const ssoUser = {
  user: { uid: 'uid-sso', getIdToken: async () => 'sso-id-token' },
}

jest.mock('firebase/auth', () => ({
  browserLocalPersistence: {},
  getRedirectResult: (...args: unknown[]) => mockRedirectResult(...args),
  setPersistence: () => Promise.resolve(),
  signInWithPopup: (...args: unknown[]) => mockPopup(...args),
  signInWithRedirect: (...args: unknown[]) => mockRedirect(...args),
}))
// The deep import is what the page uses — mocking the `@aglyn/aglyn` barrel
// would not intercept it.
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
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
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
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
    <button onClick={() => onSubmit({ email: 'person@enterprise.example' })}>
      {'Continue with SSO'}
    </button>
  ),
}))
jest.mock('@mui/material', () => ({
  CircularProgress: () => null,
  Typography: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
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
jest.mock('../utils/interactive-signin', () => ({
  markInteractiveSignIn: jest.fn(),
}))
jest.mock('../utils/is-mobile-browser', () => ({
  __esModule: true,
  default: () => mockIsMobile,
}))
jest.mock('../utils/oauth-providers', () => ({
  createAuthProvider: () => ({}),
}))
jest.mock('../utils/sso-errors', () => ({
  describeSsoError: () => ({ code: 'sso-failed', message: 'failed' }),
}))

const SSO_PENDING_KEY = 'aglyn.sso.pending'

/** Every event of one name that reached the transport. */
const eventsNamed = (name: string) =>
  mockTrackEvent.mock.calls.filter(([eventName]) => eventName === name)

/**
 * The two fetches the page makes, in order: the domain lookup, then the JIT
 * mapping. `jitOk` is the interesting knob — it is the difference between
 * "signed in" and "signed in to somewhere".
 */
function stubFetch(options: { ssoEnabled?: boolean; jitOk?: boolean } = {}) {
  const { ssoEnabled = true, jitOk = true } = options
  globalThis.fetch = jest.fn(async (input: unknown) => {
    if (String(input).includes('sso-lookup')) {
      return {
        ok: true,
        json: async () =>
          ssoEnabled
            ? { ssoEnabled: true, tenantId: 'tenant-1', providerId: 'saml.acme' }
            : {},
      }
    }
    return { ok: jitOk, json: async () => ({ error: 'not authorized' }) }
  }) as unknown as typeof fetch
}

const submit = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Continue with SSO' }))

describe('GA4 login wiring on the real SSO path (AGL-1562)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.sessionStorage.clear()
    mockIsMobile = false
    mockPopup.mockResolvedValue(ssoUser)
    mockRedirect.mockResolvedValue(undefined)
    mockRedirectResult.mockResolvedValue(null)
    stubFetch()
  })

  it('fires login with method "sso" on the desktop popup door', async () => {
    render(<SsoSignIn />)

    submit()

    await waitFor(() => expect(eventsNamed('login')).toHaveLength(1))
    expect(eventsNamed('login')[0][1]).toEqual({ method: 'sso' })
  })

  it('fires it once on the mobile redirect return, where the popup never ran', async () => {
    // The SAML redirect leaves and comes back here; the tenant is stashed
    // across the hop, and this is the only place that half of the flow can
    // be counted.
    window.sessionStorage.setItem(
      SSO_PENDING_KEY,
      JSON.stringify({ tenantId: 'tenant-1' }),
    )
    mockRedirectResult.mockResolvedValue(ssoUser)

    render(<SsoSignIn />)

    await waitFor(() => expect(eventsNamed('login')).toHaveLength(1))
    expect(eventsNamed('login')[0][1]).toEqual({ method: 'sso' })
  })

  it('counts NOTHING when the JIT mapping refuses the account', async () => {
    // Authenticated against the IdP but not authorized for the organization:
    // the console tells them to see their administrator, and they are in
    // nobody's workspace. Counting this would make "logins" and "people who
    // got in" two different numbers wearing one name.
    stubFetch({ jitOk: false })
    render(<SsoSignIn />)

    submit()

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))
    expect(eventsNamed('login')).toHaveLength(0)
  })

  it('counts nothing when no SSO is configured for the domain', async () => {
    stubFetch({ ssoEnabled: false })
    render(<SsoSignIn />)

    submit()

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(mockPopup).not.toHaveBeenCalled()
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('never reports a JIT-provisioned account as a sign_up', async () => {
    // A reporting decision, pinned so it cannot be "fixed" by reflex. JIT
    // creates accounts without passing any of the four AGL-1497 clickwrap
    // doors, deliberately — an enterprise user is covered by their org's
    // negotiated agreement. Feeding them into the self-serve funnel would
    // make "signup → paid conversion" meaningless, because an SSO user
    // arrives already sold.
    render(<SsoSignIn />)

    submit()

    await waitFor(() => expect(eventsNamed('login')).toHaveLength(1))
    expect(eventsNamed('sign_up')).toHaveLength(0)
    expect(eventsNamed('org_created')).toHaveLength(0)
  })
})
