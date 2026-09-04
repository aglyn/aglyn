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
 * AGL-1731 — campaign attribution is wired into the door a human uses.
 *
 * The parser has its own unit tests in `libs/aglyn`. What those cannot prove
 * is the failure that actually happens to analytics: a perfectly correct
 * helper with no call site. An unattributed signup reports as organic, and
 * organic looks exactly like a campaign that did not work — which is the one
 * conclusion advertising money must not be spent against.
 *
 * So this drives the real signup page with a real campaign URL and asserts
 * BOTH exits: what reached the analytics transport, and what reached
 * `users/{uid}`. The second is the one that matters in September, because the
 * purchase it has to be joined to arrives weeks later from a Stripe webhook
 * that has no session and no URL.
 *
 * The campaign module itself is deliberately NOT mocked here — mocking it
 * would leave the wiring asserted against a fiction, which is the shape this
 * file exists to rule out.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import SignUp from '../app/(auth)/signup/page'

const mockCreateUser = jest.fn()
const mockPopup = jest.fn()
const mockRedirect = jest.fn()
const mockTrackEvent = jest.fn()
/** Every `setDoc` the page made, as `{ path, data, merge }`. */
const mockSetDoc = jest.fn()
let mockSearch = ''

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
  // Enough of a document ref to tell the profile write from the campaign
  // write — they land on the same document, and asserting the wrong one is
  // how this spec would pass without the feature existing.
  doc: (_firestore: unknown, collection: string, id: string) => ({
    path: `${collection}/${id}`,
  }),
  getDoc: jest.fn(async () => ({ data: () => ({}) })),
  setDoc: (ref: { path: string }, data: unknown, options: unknown) =>
    mockSetDoc({ path: ref?.path, data, options }),
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  // The navigation-safe spelling lands in the SAME capture (AGL-2587). These
  // specs assert that an event was emitted, not which door emitted it — the
  // door choice is asserted at source level in
  // `every-funnel-door-is-instrumented.spec.ts`, where the navigation that
  // makes it necessary is visible. Routing both here keeps one assertion per
  // event instead of one per spelling.
  trackEventBeforeNavigation: async (...args: unknown[]) =>
    mockTrackEvent(...args),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useAuth: () => ({}),
  useFirestore: () => ({}),
  useSigninCheck: () => ({ data: { signedIn: false } }),
}))
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}))
jest.mock('@aglyn/aglyn', () => {
  // The REAL campaign contract — the allowlist and the scrub are the thing
  // under test, so a stub here would assert nothing.
  const campaign = jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/campaign-attribution',
  )
  return {
    PLAN_LABELS: {},
    generateOrgSlug: (value: string) => value.toLowerCase(),
    onboardingDestination: (slug: string) => `/${slug}`,
    parseOnboardingPlanIntent: () => null,
    campaignEventParams: campaign.campaignEventParams,
    parseCampaignAttribution: campaign.parseCampaignAttribution,
    campaignAttributionQuery: campaign.campaignAttributionQuery,
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

const signUpEvents = () =>
  mockTrackEvent.mock.calls.filter(([name]) => name === 'sign_up')

/** The writes that carry a `signupCampaign` key, in order. */
const campaignWrites = () =>
  mockSetDoc.mock.calls
    .map(([call]) => call)
    .filter(
      (call: { data?: Record<string, unknown> }) =>
        call?.data && Object.hasOwn(call.data, 'signupCampaign'),
    )

const tickConsent = () =>
  fireEvent.click(
    screen.getByLabelText('Agree to the Terms of Service and Privacy Policy'),
  )

const submitPasswordForm = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Submit sign up' }))

const signUpThroughPasswordDoor = async () => {
  render(<SignUp />)
  tickConsent()
  await act(async () => {
    submitPasswordForm()
  })
  await waitFor(() => expect(mockCreateUser).toHaveBeenCalled())
  await waitFor(() => expect(signUpEvents()).toHaveLength(1))
}

describe('campaign attribution at signup (AGL-1731)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.sessionStorage.clear()
    mockSearch = ''
    mockCreateUser.mockResolvedValue(credentialFor('uid-new'))
    mockPopup.mockResolvedValue(credentialFor('uid-new'))
    mockRedirect.mockReturnValue(new Promise(() => undefined))
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, slug: 'new-co' }),
      text: async () => '',
    })) as unknown as typeof fetch
  })

  it('rides the campaign into the sign_up hit that actually leaves', async () => {
    mockSearch = '?utm_source=google&utm_medium=cpc&utm_campaign=sept-launch'

    await signUpThroughPasswordDoor()

    // The whole payload, not `objectContaining` — a param that is present but
    // empty is the failure mode here, and `objectContaining` would pass on it.
    expect(signUpEvents()[0][1]).toStrictEqual({
      method: 'password',
      campaign_source: 'google',
      campaign_medium: 'cpc',
      campaign_name: 'sept-launch',
    })
  })

  it('records the campaign on users/{uid}, which is where revenue joins it', async () => {
    mockSearch = '?utm_source=google&utm_medium=cpc&utm_campaign=sept-launch'

    await signUpThroughPasswordDoor()

    await waitFor(() => expect(campaignWrites()).toHaveLength(1))
    const write = campaignWrites()[0]
    // The account's own document — not a new collection. A `signupCampaigns`
    // collection would be invisible to the erasure cascade until someone
    // remembered to sweep it, which is exactly the class of gap AGL-1448 had
    // to go and find three of.
    expect(write.path).toBe('users/uid-new')
    expect(write.options).toEqual({ merge: true })
    // Stored as the WIRE form, so the read path can re-parse it through the
    // same allowlist rather than trusting an owner-writable document.
    expect(write.data.signupCampaign.query).toBe(
      'utm_source=google&utm_medium=cpc&utm_campaign=sept-launch',
    )
    expect(typeof write.data.signupCampaign.createdAtMs).toBe('number')
  })

  it('writes NO campaign field for an organic signup', async () => {
    mockSearch = '?plan=pro'

    await signUpThroughPasswordDoor()

    // Not an empty object, not a null — absent. "Arrived from nowhere,
    // confirmed" and "never asked" have to stay distinguishable.
    expect(campaignWrites()).toHaveLength(0)
    expect(signUpEvents()[0][1]).toStrictEqual({ method: 'password' })
  })

  it('never lets an address off the URL reach the hit or the document', async () => {
    // The mail-merge campaign link. `utm_source` is dropped, `utm_campaign`
    // survives — losing the whole campaign to protect a value that is being
    // dropped anyway would be the wrong trade.
    mockSearch = '?utm_source=someone@example.com&utm_campaign=sept-launch'

    await signUpThroughPasswordDoor()

    expect(signUpEvents()[0][1]).toStrictEqual({
      method: 'password',
      campaign_name: 'sept-launch',
    })
    await waitFor(() => expect(campaignWrites()).toHaveLength(1))
    expect(JSON.stringify(campaignWrites()[0].data)).not.toContain('@')
  })

  it('takes only the three allowlisted keys, whatever else the link carried', async () => {
    mockSearch =
      '?utm_source=hn&utm_term=headless+cms&utm_content=variant-b&gclid=xyz&email=someone@example.com'

    await signUpThroughPasswordDoor()

    expect(signUpEvents()[0][1]).toStrictEqual({
      method: 'password',
      campaign_source: 'hn',
    })
    await waitFor(() => expect(campaignWrites()).toHaveLength(1))
    expect(campaignWrites()[0].data.signupCampaign.query).toBe('utm_source=hn')
  })

  it('captures nothing when the clickwrap consent is withheld', async () => {
    mockSearch = '?utm_source=google&utm_medium=cpc&utm_campaign=sept-launch'

    render(<SignUp />)
    // No tick. The gate at the top of `handleSignUp` returns before any
    // account exists, so there is no uid to attribute to in the first place.
    await act(async () => {
      submitPasswordForm()
    })

    expect(mockCreateUser).not.toHaveBeenCalled()
    expect(signUpEvents()).toHaveLength(0)
    expect(campaignWrites()).toHaveLength(0)
  })

  /**
   * ⚠️ This test records the CURRENT posture, and does not endorse it.
   *
   * `app.aglyn.com` has no consent banner, no region gate and no GPC handling
   * — `platform-consent-default.ts` says so outright, and the console's GA has
   * run unconditionally since AGL-118. A visitor who declined analytics on
   * `aglyn.com`, or whose browser sends Global Privacy Control, still has a
   * campaign label written against their account here.
   *
   * That is a legal question, not an engineering one, and it is open on
   * AGL-1731. It is pinned as an executable assertion rather than a comment so
   * that whoever answers it has to come here and change this deliberately —
   * a gate added upstream would otherwise turn this file green while silently
   * changing what the product does.
   */
  it('captures even under GPC, because the console has no gate (AGL-1731, open)', async () => {
    Object.defineProperty(window.navigator, 'globalPrivacyControl', {
      configurable: true,
      value: true,
    })
    mockSearch = '?utm_source=google&utm_medium=cpc&utm_campaign=sept-launch'

    await signUpThroughPasswordDoor()

    await waitFor(() => expect(campaignWrites()).toHaveLength(1))
    expect(campaignWrites()[0].data.signupCampaign.query).toBe(
      'utm_source=google&utm_medium=cpc&utm_campaign=sept-launch',
    )
    expect(signUpEvents()[0][1]).toStrictEqual({
      method: 'password',
      campaign_source: 'google',
      campaign_medium: 'cpc',
      campaign_name: 'sept-launch',
    })

    delete (window.navigator as { globalPrivacyControl?: boolean })
      .globalPrivacyControl
  })
})
