/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom without `Request`/`Response`.
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
 * A per-org grant of `release_native_checkout` reaches the CHECKOUT ROUTE
 * (AGL-2486).
 *
 * The route used to read `getServerReleaseFlagValues()` — the platform-wide
 * Remote Config template — and call `isReleaseFlagOn` itself. That two-step
 * cannot see `orgs/{orgId}.releaseFlags`, so a staff grant was written,
 * confirmed on the document, and then ignored by the one code path that takes
 * money. Measured live before the fix: with the override set to true on
 * `test-org`, Upgrade created a correct `cs_test_…` session and the browser was
 * sent to `checkout.stripe.com` anyway. Native checkout was all-or-nothing
 * platform-wide, on the surface that most needs a single-customer pilot.
 *
 * ## Why this suite does not stub the flag resolver
 *
 * A resolver stub that answers `true` proves the route branches on a boolean —
 * which was never in doubt. The bug was that the boolean came from the wrong
 * source. So the REAL `isServerReleaseFlagOnForOrg` runs here, over the real
 * `parseOrgReleaseFlagOverrides`, the real `isReleaseFlagOnForOrg` and the real
 * template parse; only Firebase itself is faked, at the SDK boundary. The
 * inputs this suite moves are the two things an operator actually edits: the
 * Remote Config parameter, and the `releaseFlags` map on the org document.
 * A route that went back to the platform-wide read would go red on the grant
 * case here, which the stubbed version could not do.
 *
 * NO STRIPE CALL HAPPENS. `fetch` is mocked; the captured session params are
 * the assertion surface. (Localhost carries a LIVE secret key at times — see
 * the Stripe live-vs-test note in the runbook.)
 */

// A module, not a script — without this these consts collide with the other
// billing route specs' identical globals under `tsc`.
export {}

const ORG_ID = 'org-1'
const FLAG = 'release_native_checkout'

/** The raw Remote Config parameter value, as the template stores it. */
let mockTemplateRaw: string | undefined
/** The `orgs/{ORG_ID}` document body, as Firestore returns it. */
let mockOrgData: Record<string, unknown>
/** How many times the org document was read — the override's only source. */
let mockOrgReads: number
/** The session params captured at the `fetch` boundary. */
let capturedBody: URLSearchParams | null

const fakeFirebaseAdmin = {
  app: () => ({
    auth: () => ({
      verifyIdToken: async () => ({
        uid: 'u-1',
        email: 'owner@example.com',
        email_verified: true,
      }),
    }),
    remoteConfig: () => ({
      getTemplate: async () => ({
        parameters:
          mockTemplateRaw === undefined
            ? {}
            : { [FLAG]: { defaultValue: { value: mockTemplateRaw } } },
      }),
    }),
    firestore: () => ({
      collection: () => ({
        doc: () => ({
          get: async () => {
            mockOrgReads += 1
            return {
              // The route reads `slug` off the snapshot; the release-flag
              // resolver reads the whole document. One doc, both shapes —
              // exactly as the real snapshot behaves.
              get: (field: string) => mockOrgData?.[field],
              data: () => mockOrgData,
            }
          },
        }),
      }),
    }),
  }),
}

// The release-flag resolver's OWN Firebase dependency. Mocking it here is what
// lets the real resolver run: `jest.requireActual` below unmocks only the
// module it names, so this fake is still what that module imports.
jest.mock(
  '../../../libs/tenant/data/admin/src/lib/server/firebase-admin',
  () => ({ __esModule: true, firebaseAdmin: fakeFirebaseAdmin }),
)

jest.mock('@aglyn/tenant-data-admin', () => {
  // THE REAL RESOLVER (AGL-2486). Not a stub — see the header.
  const releaseFlags = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/release-flags',
  )
  return {
    __esModule: true,
    firebaseAdmin: fakeFirebaseAdmin,
    isServerReleaseFlagOnForOrg: releaseFlags.isServerReleaseFlagOnForOrg,
    isImpersonationSession: () => false,
    emailUnverifiedResponse: () =>
      Response.json({ error: 'Verify your email' }, { status: 403 }),
    // Inert: the checkout feature lockdown (AGL-1510) has its own specs, and a
    // refusal here would be indistinguishable from the release gate working.
    featureLockdownRefusal: async () => null,
    memberHasOrgPermission: async () => true,
    // No live subscription, so the duplicate-subscription guard (AGL-1715)
    // cannot short-circuit before the gate under test.
    readOrgBilling: async () => ({ stripeCustomerId: 'cus_test_1' }),
    resolveOrgMembership: async () => ({
      orgId: ORG_ID,
      member: { id: 'm-1', role: 'owner' },
    }),
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL module throughout, including every release-flag primitive the
  // resolver above composes — `parseOrgReleaseFlagOverrides`,
  // `isReleaseFlagOnForOrg`, `parseReleaseFlagValue`, `RELEASE_FLAGS`. Replacing
  // any of them with a hand-written double would be re-typing the semantics
  // under test, which is the failure this suite exists to catch.
  ...jest.requireActual('@aglyn/aglyn/server'),
  buildRoute: () => '/acme/manage/billing',
  Route: { MANAGE_BILLING: 'MANAGE_BILLING' },
}))

/** Env without a trace of the developer's own Stripe config (`nx test` leaks the root env). */
const CLEAN_ENV = (() => {
  const clean = { ...process.env }
  for (const key of Object.keys(clean)) {
    if (key.startsWith('STRIPE_') || key.startsWith('NEXT_PUBLIC_STRIPE_')) {
      delete clean[key]
    }
  }
  return clean
})()

const ORIGINAL_ENV = process.env

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_PRICE_STARTER: 'price_starter_monthly',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_fake',
}

/**
 * The route snapshots `PRICE_ENV` at module load, so env has to be in place
 * BEFORE the require — which is also why this is a require and not an import.
 * `resetModules` additionally hands each case a fresh resolver, so the
 * resolver's 60s template and per-org caches cannot carry a verdict across.
 */
function loadCheckout(env: Record<string, string> = {}) {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...STRIPE_ENV, ...env } as NodeJS.ProcessEnv
  return require('../app/api/billing/checkout/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function checkout(post: (request: Request) => Promise<Response>) {
  return post(
    new Request('https://app.aglyn.com/api/billing/checkout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
        origin: 'https://app.aglyn.com',
        host: 'app.aglyn.com',
      },
      body: JSON.stringify({ plan: 'starter', interval: 'month', orgId: ORG_ID }),
    }),
  )
}

/** True when the created session is the in-page one, per Stripe's own shape. */
function isEmbeddedSession(params: URLSearchParams | null): boolean {
  return params?.get('ui_mode') === 'embedded'
}

beforeEach(() => {
  capturedBody = null
  mockOrgReads = 0
  // The platform-wide value is OFF — the default, and the state the live
  // template was actually in when the grant was measured being ignored.
  mockTemplateRaw = JSON.stringify({ enabled: false })
  mockOrgData = { slug: 'acme', plan: 'free' }
  global.fetch = jest.fn(async (_url: unknown, init: any) => {
    capturedBody = new URLSearchParams(String(init?.body ?? ''))
    return {
      ok: true,
      json: async () => ({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/c/session',
        client_secret: 'cs_test_123_secret',
      }),
    }
  }) as never
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  jest.restoreAllMocks()
})

describe('native checkout honours a PER-ORG grant (AGL-2486)', () => {
  it('CONTROL — platform off and no override sends the hosted redirect', async () => {
    const response = await checkout(loadCheckout())
    expect(response.status).toBe(200)
    expect(isEmbeddedSession(capturedBody)).toBe(false)
    expect(capturedBody?.get('success_url')).toContain('status=success')
    expect(capturedBody?.get('return_url')).toBeNull()
  })

  it('a staff grant on the ORG DOCUMENT mounts checkout in-page', async () => {
    // The exact write that was measured landing on `orgs/hz_KgetqSq` and then
    // being ignored: `{"release_edit_bar":true,"release_native_checkout":true}`.
    mockOrgData = {
      slug: 'acme',
      plan: 'free',
      releaseFlags: { release_edit_bar: true, [FLAG]: true },
    }
    const response = await checkout(loadCheckout())
    expect(response.status).toBe(200)
    expect(isEmbeddedSession(capturedBody)).toBe(true)
    // An embedded session takes a single `return_url` and Stripe REJECTS it
    // alongside the success/cancel pair, so the absence is load-bearing.
    expect(capturedBody?.get('return_url')).toContain(
      'session_id={CHECKOUT_SESSION_ID}',
    )
    expect(capturedBody?.get('success_url')).toBeNull()
    expect(capturedBody?.get('cancel_url')).toBeNull()
    // The override has exactly one source, and it is a document read.
    expect(mockOrgReads).toBeGreaterThan(0)
  })

  it('a per-org KILL switch beats a platform-wide ON', async () => {
    // Half the point of overrides, and the half a grant-only test would miss:
    // one org can be pulled back off native checkout while it ships to
    // everyone else.
    mockTemplateRaw = JSON.stringify({ enabled: true })
    mockOrgData = { slug: 'acme', plan: 'free', releaseFlags: { [FLAG]: false } }
    const response = await checkout(loadCheckout())
    expect(response.status).toBe(200)
    expect(isEmbeddedSession(capturedBody)).toBe(false)
    expect(capturedBody?.get('success_url')).toContain('status=success')
  })

  it('CONTROL — a platform-wide ON still reaches this route', async () => {
    // Without this, the kill-switch case above would pass just as well if the
    // route ignored the flag entirely and always redirected.
    mockTemplateRaw = JSON.stringify({ enabled: true })
    const response = await checkout(loadCheckout())
    expect(response.status).toBe(200)
    expect(isEmbeddedSession(capturedBody)).toBe(true)
  })

  it('a grant WITHOUT a publishable key still redirects', async () => {
    // Both conditions, not just the flag: an embedded session returns a client
    // secret and no `url`, so a browser that cannot boot Stripe.js would get a
    // dead Upgrade button. The worst case of a premature grant stays the
    // redirect we already ship.
    mockOrgData = { slug: 'acme', plan: 'free', releaseFlags: { [FLAG]: true } }
    const post = loadCheckout({ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: '' })
    const response = await checkout(post)
    expect(response.status).toBe(200)
    expect(isEmbeddedSession(capturedBody)).toBe(false)
    expect(capturedBody?.get('success_url')).toContain('status=success')
  })

  it('an unrelated flag granted to the org does NOT open native checkout', async () => {
    // A gate keyed on "any override present" would pass every case above.
    mockOrgData = {
      slug: 'acme',
      plan: 'free',
      releaseFlags: { release_edit_bar: true },
    }
    const response = await checkout(loadCheckout())
    expect(response.status).toBe(200)
    expect(isEmbeddedSession(capturedBody)).toBe(false)
  })
})
