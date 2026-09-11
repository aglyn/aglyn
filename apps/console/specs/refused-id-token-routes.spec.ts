/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, the suite runs on jsdom, and `Response.json` is undefined.
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
 * A refused ID token is a 401 on every shape of console route, and a
 * verification that BROKE keeps the route's own answer (AGL-2796).
 *
 * The wiring guard in `invalid-id-token-response.spec.ts` proves each route
 * consults `invalidIdTokenResponse`. This proves what the route then ANSWERS,
 * for one route per shape of catch: a catch-all 500, a 502, refusal mappers
 * ahead of the fault, a catch with no binding, a verification inside a helper
 * its caller catches, a try around verification alone, a try inside the one
 * doing the work, two verifications in one file, and the routes that already
 * answered 401 by a rule of their own.
 *
 * ## The two halves are paired on purpose
 *
 * A route that answered 401 for everything would pass the first half while
 * hiding an outage — which is exactly what `presence/token` and
 * `auth/handoff/authorize` did for every `auth/` code, and what the
 * verification-only catches did for every throw. So each route also meets a
 * Google certificate outage (reported by firebase-admin under the same code as
 * a forged token) and a failure with no auth code, and must keep its 5xx.
 *
 * ## Why the mocks are open
 *
 * Every refusal here happens at the handler's first awaited verification, so
 * nothing past it runs. The workspace libraries are replaced by modules that
 * hand back an inert `jest.fn()` for any name, which lets one suite load
 * twenty routes without a hand-built factory each. The few names read BEFORE
 * verification get real behavior below, and every case asserts the verifier
 * was reached, so a route refusing for some other reason cannot pass.
 */

const TOKEN = 'caller-id-token'

/** What the wrapped `verifyIdToken` throws for every case below. */
let mockVerifyError: unknown = new Error('unset')
const mockVerifyCalls: unknown[][] = []

async function mockVerifyIdToken(...args: unknown[]): Promise<never> {
  mockVerifyCalls.push(args)
  throw mockVerifyError
}

/**
 * A module whose unnamed exports are inert `jest.fn()`s. `then` stays
 * undefined, so the module is never mistaken for a promise.
 */
function mockOpenModule(named: Record<string, unknown>): Record<string, unknown> {
  const stubs = new Map<string, jest.Mock>()
  return new Proxy(
    { __esModule: true, ...named },
    {
      get(target, key) {
        if (key in target) return target[key as keyof typeof target]
        if (typeof key !== 'string' || key === 'then') return undefined
        if (!stubs.has(key)) stubs.set(key, jest.fn())
        return stubs.get(key)
      },
    },
  )
}

jest.mock('@aglyn/tenant-data-admin', () => {
  // Answers every property and every call with itself. Only reached by code
  // that runs before verification, which reads handles and nothing else.
  const anything: unknown = new Proxy(function anything() {}, {
    get: (_target, key) => (key === 'then' ? undefined : anything),
    apply: () => anything,
  })
  return mockOpenModule({
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
          tenantManager: () => anything,
        }),
        firestore: () => anything,
        storage: () => anything,
      }),
      firestore: anything,
      database: () => anything,
    },
  })
})

// The REAL library: routes and their helpers read its constants at module
// scope (`SELF_SERVE_PLANS.filter` in billing-addons), and the request adapter
// has to parse the body a route validates before it verifies the way
// production parses it. Only the two validators that gate verification on
// input this suite does not care about are pinned open.
jest.mock('@aglyn/aglyn/server', () => ({
  ...(jest.requireActual('@aglyn/aglyn/server') as Record<string, unknown>),
  __esModule: true,
  isValidOrgSlug: () => true,
  isCrmExportResource: () => true,
}))

jest.mock('@aglyn/shared-util-email', () =>
  mockOpenModule({
    isEmailConfigured: () => true,
    sendEmail: async () => ({ sent: true }),
  }),
)

jest.mock('../app/api/_lib/render-system-email', () =>
  mockOpenModule({ renderSystemEmail: async () => null }),
)

import * as accountClose from '../app/api/account/close/route'
import * as accountEmails from '../app/api/account/emails/route'
import * as adminRevenue from '../app/api/admin/revenue/route'
import * as runErasures from '../app/api/admin/run-erasures/route'
import * as handoffAuthorize from '../app/api/auth/handoff/authorize/route'
import * as legalAcceptance from '../app/api/auth/legal-acceptance/route'
import * as sendVerification from '../app/api/auth/send-verification/route'
import * as billingSubscription from '../app/api/billing/subscription/route'
import * as usageConfig from '../app/api/billing/usage-config/route'
import * as crmExport from '../app/api/crm/export/route'
import * as domainsStatus from '../app/api/domains/status/route'
import * as editAccessToken from '../app/api/edit-access/token/route'
import * as hostsDelete from '../app/api/hosts/delete/route'
import * as issueReports from '../app/api/issue-reports/route'
import * as mediaFolders from '../app/api/media/folders/route'
import * as orgsCreate from '../app/api/orgs/create/route'
import * as presenceSummary from '../app/api/presence/summary/route'
import * as presenceToken from '../app/api/presence/token/route'
import * as supportTickets from '../app/api/support/tickets/route'

const { IdTokenRevokedError, UserDisabledError } = jest.requireActual(
  '../../../libs/tenant/data/admin/src/lib/server/token-revocation',
) as typeof import('../../../libs/tenant/data/admin/src/lib/server/token-revocation')

/** Thrown the way firebase-admin throws: an `Error` carrying a string `code`. */
const authError = (code: string, message: string) =>
  Object.assign(new Error(message), { code })

function request(method: string, path: string, body?: unknown): Request {
  return new Request(`https://app.aglyn.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      origin: 'https://app.aglyn.com',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

/** Refusals of the caller's own credential, each built as production builds it. */
const REFUSED: [string, () => unknown][] = [
  // The production throw behind the AGL-2785 page: the wrapper's revocation
  // check found no user record behind a well-formed, unexpired token.
  ['a deleted account', () => new IdTokenRevokedError('The user record no longer exists.')],
  ['a revoked token', () => new IdTokenRevokedError()],
  ['a disabled account', () => new UserDisabledError()],
  ['an expired token', () => authError('auth/id-token-expired', 'Firebase ID token has expired.')],
  [
    'an account firebase-admin cannot find',
    () =>
      authError(
        'auth/user-not-found',
        'There is no user record corresponding to the provided identifier.',
      ),
  ],
  [
    'a forged signature',
    () => authError('auth/argument-error', 'Firebase ID token has invalid signature.'),
  ],
]

/** Verifications that could not run at all. None is a statement about the caller. */
const BROKEN: [string, () => unknown][] = [
  [
    'the Google certificate endpoint is unreachable',
    () =>
      authError(
        'auth/argument-error',
        'Error fetching public keys for Google certs: connect ETIMEDOUT',
      ),
  ],
  ['a failure that carries no auth code', () => new Error('14 UNAVAILABLE: No connection established')],
]

interface RouteCase {
  label: string
  send: () => Promise<Response>
  /** What a verification that could not run answers: the route's own fault. */
  broken: number
  /** The refusal body, when the route keeps a documented one of its own. */
  refusal?: Record<string, unknown>
}

const ROUTES: RouteCase[] = [
  {
    label: 'hosts/delete, a catch-all 500',
    send: () => hostsDelete.POST(request('POST', '/api/hosts/delete', { hostId: 'host-1' })),
    broken: 500,
  },
  {
    label: 'billing/subscription, a catch-all 502',
    send: () =>
      billingSubscription.POST(
        request('POST', '/api/billing/subscription', { orgId: 'org-1', action: 'cancel' }),
      ),
    broken: 502,
  },
  {
    label: 'orgs/create, refusal mappers ahead of the 500',
    send: () =>
      orgsCreate.POST(
        request('POST', '/api/orgs/create', { name: 'Acme Studio', slug: 'acme-studio' }),
      ),
    broken: 500,
  },
  {
    label: 'account/close, a peek then a tenant re-verification',
    send: () => accountClose.POST(request('POST', '/api/account/close', {})),
    broken: 500,
  },
  {
    label: 'account/emails, verification inside a helper its caller catches',
    send: () => accountEmails.GET(request('GET', '/api/account/emails')),
    broken: 500,
  },
  {
    label: 'edit-access/token',
    send: () =>
      editAccessToken.POST(request('POST', '/api/edit-access/token', { hostId: 'host-1' })),
    broken: 500,
  },
  {
    label: 'support/tickets',
    send: () => supportTickets.GET(request('GET', '/api/support/tickets')),
    broken: 500,
  },
  {
    label: 'crm/export, a catch with no binding',
    send: () => crmExport.GET(request('GET', '/api/crm/export?orgId=org-1&resource=contacts')),
    broken: 500,
  },
  {
    label: 'media/folders',
    send: () => mediaFolders.POST(request('POST', '/api/media/folders', { action: 'rename' })),
    broken: 500,
  },
  {
    label: 'auth/send-verification, the route in the drained 5xx',
    send: () => sendVerification.POST(request('POST', '/api/auth/send-verification', {})),
    broken: 500,
  },
  {
    label: 'auth/handoff/authorize, which answered 401 for every auth/ code',
    send: () =>
      handoffAuthorize.POST(
        request('POST', '/api/auth/handoff/authorize', { handoff: 'rid-1' }),
      ),
    broken: 500,
  },
  {
    label: 'presence/token, which keeps the refusal body the editor reads',
    send: () => presenceToken.POST(request('POST', '/api/presence/token', { hostId: 'host-1' })),
    broken: 500,
    refusal: { error: 'Your sign-in is no longer valid' },
  },
  {
    label: 'presence/summary, which fails soft rather than failing the list',
    send: () =>
      presenceSummary.POST(request('POST', '/api/presence/summary', { hostId: 'host-1' })),
    broken: 200,
    refusal: { error: 'Your sign-in is no longer valid' },
  },
  {
    label: 'domains/status, a try around verification alone',
    send: () => domainsStatus.GET(request('GET', '/api/domains/status?hostId=host-1')),
    broken: 500,
  },
  {
    label: 'auth/legal-acceptance POST, the first of two verifications',
    send: () => legalAcceptance.POST(request('POST', '/api/auth/legal-acceptance', {})),
    broken: 500,
  },
  {
    label: 'auth/legal-acceptance GET, the second',
    send: () => legalAcceptance.GET(request('GET', '/api/auth/legal-acceptance')),
    broken: 500,
  },
  {
    label: 'issue-reports, a verification try inside the working one',
    send: () => issueReports.POST(request('POST', '/api/issue-reports', {})),
    broken: 500,
  },
  {
    label: 'billing/usage-config, verification and nothing else',
    send: () => usageConfig.GET(request('GET', '/api/billing/usage-config')),
    broken: 500,
  },
  {
    label: 'admin/revenue, an admin route verifying in a try of its own',
    send: () => adminRevenue.GET(request('GET', '/api/admin/revenue?period=2026-Q3')),
    broken: 500,
  },
  {
    label: 'admin/run-erasures, a cron door that also takes a staff token',
    send: () => runErasures.GET(request('GET', '/api/admin/run-erasures')),
    broken: 500,
  },
]

const ENV_KEYS = ['STRIPE_SECRET_KEY', 'CRON_SECRET'] as const
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  // Both routes answer 501 before verifying when unconfigured.
  process.env.STRIPE_SECRET_KEY = 'sk_test_refused_token_spec'
  process.env.CRON_SECRET = 'cron-secret-the-caller-does-not-send'
})

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

beforeEach(() => {
  mockVerifyCalls.length = 0
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe.each(ROUTES)('$label (AGL-2796)', ({ send, broken, refusal }) => {
  it.each(REFUSED)('answers 401 for %s', async (_label, makeError) => {
    mockVerifyError = makeError()
    const response = await send()
    expect(mockVerifyCalls[0]?.[0]).toBe(TOKEN)
    expect(response.status).toBe(401)
    const body = await response.json()
    if (refusal) {
      expect(body).toMatchObject(refusal)
    } else {
      // The body a missing header gets: nothing says WHICH check refused.
      expect(body).toEqual({ error: 'Unauthenticated' })
    }
  })

  it.each(BROKEN)('keeps its own answer when %s', async (_label, makeError) => {
    mockVerifyError = makeError()
    const response = await send()
    expect(mockVerifyCalls[0]?.[0]).toBe(TOKEN)
    expect(response.status).toBe(broken)
  })
})
