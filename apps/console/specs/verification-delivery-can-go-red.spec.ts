/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where `Response.json` does not
 * exist and the route cannot answer at all.
 */
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
 * Can the verification-delivery arm actually go red? (AGL-2673)
 *
 * For three days every new account was told "we sent a verification link" and
 * no mail was ever sent (AGL-2667). Every component check stayed green and
 * honestly so — minting worked, the rewrite worked, redemption worked, email
 * was configured — because all of them measure whether a send is POSSIBLE and
 * none of them observes a mail. So the constraint on the check that closes
 * that is the same constraint the door itself shipped under: a proof it fails
 * under the condition it exists to catch, driven with no network and no admin
 * credential, because a green that cannot be shown to go red is the exact
 * shape of the ones that slept through it.
 *
 * Three halves, and the middle one is the trap this check is most likely to
 * fall into rather than a failure it reports:
 *
 *  - the pure verdict, through every branch it can take;
 *  - the pure window and eligibility rule, which decides the DENOMINATOR — a
 *    drought detector with the wrong denominator is `/api/health/signups`
 *    all over again (AGL-2583), green precisely when nobody is being served;
 *  - the real route, in-process, required to answer a real 503 — because a
 *    verdict that goes red inside a function nothing calls reports into
 *    nothing.
 */

import {
  accountsOwedVerificationMail,
  type ProbeAccountRecord,
} from '../app/api/health/auth-doors/auth-doors-probe'
import {
  MIN_ACCOUNTS_FOR_DELIVERY_VERDICT,
  VERIFICATION_DELIVERY_SETTLE_MINUTES,
  VERIFICATION_DELIVERY_WINDOW_MINUTES,
  verificationDeliveryHealth,
} from '../app/api/health/auth-doors/auth-doors-verdict'
import { healthHttpStatus, healthStatus } from '@aglyn/aglyn/server'

const CONSOLE_ORIGIN = 'https://app.aglyn.com'
const PROJECT_ID = 'aglyn-probe-project'

/** The listing the accounts query answers with. Null makes the call fail. */
let mockAccountRecords: ProbeAccountRecord[] | null
/** Delivery rows by address, so a test can give one person mail and not another. */
let mockDeliveryRows: Record<string, { context: string | null }[]>
/** Addresses whose delivery read FAILS rather than comes back empty. */
let mockDeliveryFailures: Set<string>
/** Whether the admin app carries a credential at all. */
let mockCredentialPresent: boolean
let mockToolkitReplies: Record<string, { status: number; body: unknown }>
let mockAddressesRead: string[]

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        generateEmailVerificationLink: () => {
          const error = new Error('no user') as Error & { code: string }
          error.code = 'auth/user-not-found'
          return Promise.reject(error)
        },
        tenantManager: () => ({
          listTenants: async () => ({ tenants: [] }),
          authForTenant: () => ({
            listProviderConfigs: async () => ({ providerConfigs: [] }),
          }),
        }),
      }),
    }),
  },
  // `_lib/passkeys` reaches for this at import time; nothing here stores a
  // challenge, so it is never called.
  consumeOnce: jest.fn(),
  consumeVerifyEmailAutoSend: async () => ({ allowed: true }),
}))

/**
 * The delivery log is mocked at the LEAF, the way its other callers are
 * mocked, and not through the barrel: the barrel factory above would
 * otherwise decide what the delivery reader is, and a stub chosen there is a
 * false green on the one fact this whole file exists to establish.
 */
jest.mock('@aglyn/tenant-data-admin/server/email-delivery-log', () => ({
  __esModule: true,
  readEmailDeliveryHistory: async (address: string) => {
    mockAddressesRead.push(address)
    if (mockDeliveryFailures.has(address)) {
      return { lookupFailed: true, rows: [] }
    }
    return { lookupFailed: false, rows: mockDeliveryRows[address] ?? [] }
  },
}))

jest.mock('firebase-admin/app', () => ({
  __esModule: true,
  getApp: () => ({
    options: {
      projectId: PROJECT_ID,
      ...(mockCredentialPresent
        ? { credential: { getAccessToken: async () => ({ access_token: 'probe-admin-token' }) } }
        : {}),
    },
  }),
}))

jest.mock('firebase-admin/app-check', () => ({
  __esModule: true,
  getAppCheck: () => ({
    createToken: async () => ({ token: 'probe-app-check-token' }),
  }),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  sendEmail: jest.fn(),
}))

/** The replies that keep the six sibling doors green while this arm is graded. */
function healthyReplies(): Record<string, { status: number; body: unknown }> {
  return {
    'accounts:createAuthUri': {
      status: 200,
      body: {
        authUri:
          'https://accounts.google.com/o/oauth2/auth?response_type=id_token&client_id=probe.apps.googleusercontent.com',
      },
    },
    'accounts:signInWithPassword': {
      status: 400,
      body: { error: { message: 'EMAIL_NOT_FOUND' } },
    },
    'accounts:resetPassword': {
      status: 400,
      body: { error: { message: 'INVALID_OOB_CODE' } },
    },
    'accounts:update': {
      status: 400,
      body: { error: { message: 'INVALID_OOB_CODE' } },
    },
  }
}

/** The admin listing's path, as the fetch stub below keys replies by. */
const ACCOUNTS_QUERY = `projects/${PROJECT_ID}/accounts:query`

/** One account record, positioned relative to now. */
function account(options: {
  minutesAgo: number
  email: string
  providers?: string[]
}): ProbeAccountRecord {
  return {
    // A STRING, the way the provider sends it, so the parsing is exercised
    // rather than assumed.
    createdAt: String(Date.now() - options.minutesAgo * 60_000),
    email: options.email,
    providerUserInfo: (options.providers ?? ['password']).map((providerId) => ({
      providerId,
    })),
  }
}

/** An account created safely inside the graded window. */
const INSIDE_WINDOW = VERIFICATION_DELIVERY_SETTLE_MINUTES + 60

beforeEach(() => {
  jest.resetModules()
  process.env['NEXT_PUBLIC_CONSOLE_URL'] = CONSOLE_ORIGIN
  process.env['NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY'] = 'probe-web-api-key'
  process.env['NEXT_PUBLIC_FIREBASE_APP_ID'] = '1:1:web:probe'
  process.env['RESEND_WEBHOOK_SECRET'] = 'whsec_probe'
  delete process.env['AUTH_ACTION_ALLOWED_ORIGINS']
  delete process.env['VERIFICATION_DELIVERY_MIN_ACCOUNTS']
  mockCredentialPresent = true
  mockAccountRecords = []
  mockDeliveryRows = {}
  mockDeliveryFailures = new Set()
  mockAddressesRead = []
  mockToolkitReplies = healthyReplies()
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(
    async (url: string) => {
      const method = String(url).split('/v1/')[1]?.split('?')[0] ?? ''
      if (method === ACCOUNTS_QUERY) {
        if (mockAccountRecords === null) {
          return { ok: false, status: 503, json: async () => ({}) }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ userInfo: mockAccountRecords }),
        }
      }
      const reply = mockToolkitReplies[method]
      if (!reply) throw new Error(`unexpected call to ${method}`)
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json: async () => reply.body,
      }
    },
  )
})

/*==========================================
 * THE VERDICT, PURE.
 *=========================================*/

/** Everything healthy: three accounts, every one of them with its mail. */
function healthyFacts() {
  return {
    accountListingConfigured: true,
    deliveryFeedConfigured: true,
    accountsCreated: 3,
    accountsSampled: 3,
    withVerificationDelivery: 3,
    withAnyDelivery: 3,
    deliveryLogUnreadable: false,
    minimumAccounts: MIN_ACCOUNTS_FOR_DELIVERY_VERDICT,
    windowMinutes: VERIFICATION_DELIVERY_WINDOW_MINUTES,
    settleMinutes: VERIFICATION_DELIVERY_SETTLE_MINUTES,
  }
}

describe('the verdict', () => {
  it('is green, and says what green means, when the mail is landing', () => {
    const check = verificationDeliveryHealth(healthyFacts(), 12)
    expect(check).toMatchObject({ ok: true, door: 'verification-delivery' })
    expect(check.code).toBeUndefined()
    expect(check.asserts).toContain('verification delivery event')
    // The caveat rides on the green too. A reader who only ever meets this
    // door healthy still has to be able to tell what its silence is worth.
    expect(check.caveat).toContain('not proof that nothing was sent')
  })

  /**
   * THE ALARM, in its strongest form. Other mail to these same accounts is
   * being recorded, so the feed is demonstrably alive and the verification
   * mail in particular is the thing that is missing — which is exactly the
   * AGL-2667 shape, and the one state where this door may say so.
   */
  it('goes red when the feed is live and no verification mail is delivered', () => {
    const check = verificationDeliveryHealth(
      { ...healthyFacts(), withVerificationDelivery: 0, withAnyDelivery: 3 },
      12,
    )
    expect(check).toMatchObject({
      ok: false,
      code: 'verification-delivery-missing',
      accountsSampled: 3,
      withVerificationDelivery: 0,
      withAnyDelivery: 3,
    })
    expect(healthHttpStatus(healthStatus({ check }))).toBe(503)
  })

  /**
   * The same silence with no witness behind it. Still red — a delivery feed
   * that records nothing is an outage of the only thing that can see mail
   * leave the building — but under a code that names the OBSERVATION, so
   * nobody reads a dead webhook as proof that no mail was sent.
   */
  it('goes red under a different code when nothing at all was recorded', () => {
    const check = verificationDeliveryHealth(
      { ...healthyFacts(), withVerificationDelivery: 0, withAnyDelivery: 0 },
      12,
    )
    expect(check).toMatchObject({ ok: false, code: 'no-delivery-events' })
    expect(check.code).not.toBe('verification-delivery-missing')
  })

  it('goes red when the account listing cannot be read', () => {
    const check = verificationDeliveryHealth(
      { ...healthyFacts(), accountsCreated: null, accountsSampled: 0 },
      12,
    )
    expect(check).toMatchObject({ ok: false, code: 'accounts-unavailable' })
  })

  it('goes red when a delivery read failed rather than came back empty', () => {
    // The distinction the delivery log keeps for staff, kept here for the
    // same reason: an unreadable log and an empty one lead to opposite
    // conclusions, and grading a failed read as "no mail" invents an outage.
    const check = verificationDeliveryHealth(
      { ...healthyFacts(), deliveryLogUnreadable: true },
      12,
    )
    expect(check).toMatchObject({ ok: false, code: 'delivery-log-unavailable' })
  })

  /*==========================================
   * THE DENOMINATOR — the AGL-2583 trap.
   *=========================================*/

  it('reports an explicit unknown below the floor rather than a bare green', () => {
    const check = verificationDeliveryHealth(
      {
        ...healthyFacts(),
        accountsCreated: 1,
        accountsSampled: 1,
        withVerificationDelivery: 0,
        withAnyDelivery: 0,
      },
      12,
    )
    // Not red: one person opening a signup page and getting no mail recorded
    // yet is a Tuesday, and an alarm that fires on Tuesdays is a muted alarm.
    expect(check.ok).toBe(true)
    // But never a SILENT green. The code and the counts are both in the body,
    // so a reader can tell "nothing to judge" from "mail is flowing" — the
    // distinction `/api/health/signups` did not carry, which is how zero
    // signups read as its healthiest possible state for three days.
    expect(check.code).toBe('not-enough-accounts')
    expect(check.accountsSampled).toBe(1)
    expect(check.minimumAccounts).toBe(MIN_ACCOUNTS_FOR_DELIVERY_VERDICT)
  })

  it('never reads a window with no signups at all as healthy', () => {
    const check = verificationDeliveryHealth(
      {
        ...healthyFacts(),
        accountsCreated: 0,
        accountsSampled: 0,
        withVerificationDelivery: 0,
        withAnyDelivery: 0,
      },
      12,
    )
    expect(check.code).toBe('not-enough-accounts')
    expect(check.accountsCreated).toBe(0)
  })

  it('grades on the sample, so a flood cannot arm a verdict about a handful', () => {
    // A thousand accounts in the window with only two of them looked up is
    // still two data points, and two is not a ratio.
    const check = verificationDeliveryHealth(
      {
        ...healthyFacts(),
        accountsCreated: 1_000,
        accountsSampled: 2,
        withVerificationDelivery: 0,
        withAnyDelivery: 0,
      },
      12,
    )
    expect(check).toMatchObject({ ok: true, code: 'not-enough-accounts' })
  })

  /*==========================================
   * THE CAVEAT — an absent feed is not a drought.
   *=========================================*/

  it('has no opinion when the delivery feed is not connected', () => {
    // The numbers below are a total outage on their face. They are not one:
    // with nothing recording deliveries, an empty log says nothing about mail
    // at all, and reporting it as a drought would be an alarm that is wrong
    // on every self-host, every preview and every local run.
    const check = verificationDeliveryHealth(
      {
        ...healthyFacts(),
        deliveryFeedConfigured: false,
        withVerificationDelivery: 0,
        withAnyDelivery: 0,
      },
      12,
    )
    expect(check).toMatchObject({
      ok: true,
      code: 'delivery-feed-not-configured',
    })
    expect(check.code).not.toBe('no-delivery-events')
    expect(check.code).not.toBe('verification-delivery-missing')
  })

  it('names the missing feed ahead of a missing listing', () => {
    const check = verificationDeliveryHealth(
      {
        ...healthyFacts(),
        deliveryFeedConfigured: false,
        accountListingConfigured: false,
      },
      12,
    )
    expect(check.code).toBe('delivery-feed-not-configured')
  })

  it('has no opinion on a deployment that cannot list accounts', () => {
    const check = verificationDeliveryHealth(
      {
        ...healthyFacts(),
        accountListingConfigured: false,
        accountsCreated: null,
        accountsSampled: 0,
        withVerificationDelivery: 0,
        withAnyDelivery: 0,
      },
      12,
    )
    expect(check).toMatchObject({
      ok: true,
      code: 'account-listing-not-configured',
    })
  })

  /**
   * The forced-failure lever, and it works the opposite way round from a
   * threshold: dropped to zero, every window is graded, so an ordinary quiet
   * one goes red and the alert path can be proven end to end without breaking
   * mail for anybody.
   */
  it('goes red on a quiet window when the floor is dropped to zero', () => {
    const check = verificationDeliveryHealth(
      {
        ...healthyFacts(),
        minimumAccounts: 0,
        accountsCreated: 0,
        accountsSampled: 0,
        withVerificationDelivery: 0,
        withAnyDelivery: 0,
      },
      12,
    )
    expect(check.ok).toBe(false)
  })
})

/*==========================================
 * THE DENOMINATOR'S OWN RULE.
 *=========================================*/

describe('which accounts were owed a verification mail', () => {
  const NOW = Date.parse('2026-09-07T12:00:00.000Z')
  const at = (minutesAgo: number) => String(NOW - minutesAgo * 60_000)

  const record = (
    minutesAgo: number,
    email: string,
    providers: string[] = ['password'],
  ): ProbeAccountRecord => ({
    createdAt: at(minutesAgo),
    email,
    providerUserInfo: providers.map((providerId) => ({ providerId })),
  })

  it('counts a password account inside the window', () => {
    expect(
      accountsOwedVerificationMail([record(120, 'a@example.com')], NOW),
    ).toEqual(['a@example.com'])
  })

  it('leaves the newest signups ungraded until the feed has had time', () => {
    // A row is written by a provider webhook. An account created a minute ago
    // has none yet, and grading it would report an outage every time somebody
    // signs up.
    expect(
      accountsOwedVerificationMail(
        [record(VERIFICATION_DELIVERY_SETTLE_MINUTES - 1, 'fresh@example.com')],
        NOW,
      ),
    ).toEqual([])
  })

  it('drops accounts older than the window', () => {
    expect(
      accountsOwedVerificationMail(
        [
          record(
            VERIFICATION_DELIVERY_WINDOW_MINUTES +
              VERIFICATION_DELIVERY_SETTLE_MINUTES +
              1,
            'ancient@example.com',
          ),
        ],
        NOW,
      ),
    ).toEqual([])
  })

  it('drops an account that was never owed a link at all', () => {
    // Google arrives already verified and SSO lives in a per-org pool this
    // project-level listing never returns. Counting either would manufacture
    // a drought out of mail that was correctly never sent.
    expect(
      accountsOwedVerificationMail(
        [record(120, 'google@example.com', ['google.com'])],
        NOW,
      ),
    ).toEqual([])
  })

  it('keeps an account that added Google on top of its password', () => {
    expect(
      accountsOwedVerificationMail(
        [record(120, 'both@example.com', ['google.com', 'password'])],
        NOW,
      ),
    ).toEqual(['both@example.com'])
  })

  it('drops a record with nothing to key the delivery log by', () => {
    expect(
      accountsOwedVerificationMail(
        [
          { createdAt: at(120), providerUserInfo: [{ providerId: 'password' }] },
          { email: 'no-date@example.com', providerUserInfo: [{ providerId: 'password' }] },
          {
            createdAt: 'not-a-number',
            email: 'corrupt@example.com',
            providerUserInfo: [{ providerId: 'password' }],
          },
        ],
        NOW,
      ),
    ).toEqual([])
  })

  it('answers newest first, so the sample is the freshest evidence', () => {
    expect(
      accountsOwedVerificationMail(
        [
          record(600, 'older@example.com'),
          record(60, 'newer@example.com'),
          record(300, 'middle@example.com'),
        ],
        NOW,
      ),
    ).toEqual([
      'newer@example.com',
      'middle@example.com',
      'older@example.com',
    ])
  })

  it('survives a listing that is null or empty', () => {
    expect(accountsOwedVerificationMail(null, NOW)).toEqual([])
    expect(accountsOwedVerificationMail([], NOW)).toEqual([])
  })
})

/*==========================================
 * THE ROUTE, IN PROCESS.
 *=========================================*/

async function invoke(): Promise<{ status: number; body: unknown }> {
  const route = await import('../app/api/health/auth-doors/route')
  const response = await route.GET()
  return { status: response.status, body: await response.json() }
}

function deliveryCheck(body: unknown) {
  return (
    body as {
      checks: Record<
        string,
        { ok: boolean; code?: string; accountsSampled?: number }
      >
    }
  ).checks['verificationDelivery']
}

describe('the route', () => {
  it('reports the arm beside the six doors', async () => {
    mockAccountRecords = [
      account({ minutesAgo: INSIDE_WINDOW, email: 'one@example.com' }),
      account({ minutesAgo: INSIDE_WINDOW, email: 'two@example.com' }),
      account({ minutesAgo: INSIDE_WINDOW, email: 'three@example.com' }),
    ]
    mockDeliveryRows = {
      'one@example.com': [{ context: 'email-verification' }],
      'two@example.com': [{ context: 'email-verification' }],
      'three@example.com': [{ context: 'email-verification' }],
    }
    const { status, body } = await invoke()
    expect(status).toBe(200)
    expect(deliveryCheck(body)).toMatchObject({ ok: true, accountsSampled: 3 })
    expect(mockAddressesRead.sort()).toEqual([
      'one@example.com',
      'three@example.com',
      'two@example.com',
    ])
  })

  /** The whole point: a real 503 out of the real route. */
  it('answers 503 when accounts were created and their mail is missing', async () => {
    mockAccountRecords = [
      account({ minutesAgo: INSIDE_WINDOW, email: 'one@example.com' }),
      account({ minutesAgo: INSIDE_WINDOW, email: 'two@example.com' }),
      account({ minutesAgo: INSIDE_WINDOW, email: 'three@example.com' }),
    ]
    // Every one of them has mail on record — a receipt, an invite, anything —
    // and not one has the verification event. The feed is alive; the link is
    // not arriving.
    mockDeliveryRows = {
      'one@example.com': [{ context: 'order-receipt' }],
      'two@example.com': [{ context: 'invite' }],
      'three@example.com': [{ context: null }],
    }
    const { status, body } = await invoke()
    expect(status).toBe(503)
    expect(deliveryCheck(body)).toMatchObject({
      ok: false,
      code: 'verification-delivery-missing',
      withAnyDelivery: 3,
      withVerificationDelivery: 0,
    })
  })

  it('answers 503 when the delivery log itself cannot be read', async () => {
    mockAccountRecords = [
      account({ minutesAgo: INSIDE_WINDOW, email: 'one@example.com' }),
      account({ minutesAgo: INSIDE_WINDOW, email: 'two@example.com' }),
      account({ minutesAgo: INSIDE_WINDOW, email: 'three@example.com' }),
    ]
    mockDeliveryFailures = new Set(['two@example.com'])
    const { status, body } = await invoke()
    expect(status).toBe(503)
    expect(deliveryCheck(body)).toMatchObject({
      code: 'delivery-log-unavailable',
    })
  })

  it('answers 503 when the account listing is refused', async () => {
    mockAccountRecords = null
    const { status, body } = await invoke()
    expect(status).toBe(503)
    expect(deliveryCheck(body)).toMatchObject({ code: 'accounts-unavailable' })
  })

  it('stays 200 and spends no delivery read with the feed unconnected', async () => {
    delete process.env['RESEND_WEBHOOK_SECRET']
    mockAccountRecords = [
      account({ minutesAgo: INSIDE_WINDOW, email: 'one@example.com' }),
      account({ minutesAgo: INSIDE_WINDOW, email: 'two@example.com' }),
      account({ minutesAgo: INSIDE_WINDOW, email: 'three@example.com' }),
    ]
    const { status, body } = await invoke()
    expect(status).toBe(200)
    expect(deliveryCheck(body)).toMatchObject({
      code: 'delivery-feed-not-configured',
    })
    expect(mockAddressesRead).toEqual([])
  })

  it('stays 200 on a deployment with no admin credential to list with', async () => {
    mockCredentialPresent = false
    const { status, body } = await invoke()
    expect(status).toBe(200)
    expect(deliveryCheck(body)).toMatchObject({
      code: 'account-listing-not-configured',
    })
  })

  it('goes red on a quiet window when the floor knob is dropped to zero', async () => {
    // The forced-failure lever, proven through the real route: the alert path
    // can be exercised end to end without breaking mail for anybody.
    process.env['VERIFICATION_DELIVERY_MIN_ACCOUNTS'] = '0'
    mockAccountRecords = []
    const { status, body } = await invoke()
    expect(status).toBe(503)
    expect(deliveryCheck(body)).toMatchObject({ code: 'no-delivery-events' })
    delete process.env['VERIFICATION_DELIVERY_MIN_ACCOUNTS']
  })

  /**
   * The body is public. The listing behind this arm answers with every
   * account's address and password hash, and none of it may travel.
   */
  it('leaks no address, no uid and no provider message', async () => {
    mockAccountRecords = [
      account({ minutesAgo: INSIDE_WINDOW, email: 'someone@customer.example' }),
    ]
    const { body } = await invoke()
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('someone')
    expect(serialized).not.toContain('customer.example')
    expect(serialized).not.toContain('probe-admin-token')
    expect(serialized).not.toContain('@')
  })

  it('memoises, so a public endpoint cannot be turned into a bill', async () => {
    mockAccountRecords = [
      account({ minutesAgo: INSIDE_WINDOW, email: 'one@example.com' }),
    ]
    const route = await import('../app/api/health/auth-doors/route')
    await route.GET()
    const afterFirst = mockAddressesRead.length
    await route.GET()
    expect(mockAddressesRead.length).toBe(afterFirst)
  })

  it('answers HEAD with exactly the status GET would', async () => {
    mockAccountRecords = [
      account({ minutesAgo: INSIDE_WINDOW, email: 'one@example.com' }),
      account({ minutesAgo: INSIDE_WINDOW, email: 'two@example.com' }),
      account({ minutesAgo: INSIDE_WINDOW, email: 'three@example.com' }),
    ]
    mockDeliveryRows = {
      'one@example.com': [{ context: 'invite' }],
      'two@example.com': [{ context: 'invite' }],
      'three@example.com': [{ context: 'invite' }],
    }
    const route = await import('../app/api/health/auth-doors/route')
    const head = await route.HEAD()
    expect(head.status).toBe(503)
  })
})
