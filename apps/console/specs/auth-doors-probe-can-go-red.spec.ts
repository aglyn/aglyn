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
 * Can the auth-doors probe actually go red? (AGL-2586)
 *
 * The first design constraint on the issue is that every check ships with a
 * proof it fails under the condition it exists to catch. A green that cannot
 * go red is what let signup stay dead for three days while every board stayed
 * calm, so this file is not coverage for its own sake — it IS the deliverable.
 *
 * Two halves. The first drives the pure verdicts through every named failure
 * with no network and no admin credential, so the proof is one anybody can
 * run. The second drives the REAL route in-process and requires a real 503
 * out of it, once per door — because a verdict that goes red inside a
 * function nothing calls is exactly the shape of a check that reports into
 * nothing.
 *
 * The route half uses the real health helpers, the real link-rewriting, the
 * real relying-party gate and the real WebAuthn library, mocking only what
 * leaves the process: Firebase Admin, App Check, the email configuration
 * flag, and `fetch`.
 *
 * The health helpers are deliberately NOT mocked. A mocked `healthHttpStatus`
 * would let this route pass while wired to nothing, which is the exact shape
 * of the failure the whole issue is about.
 *
 * Each test imports the route FRESH (`jest.resetModules` + dynamic import):
 * the probes are module-level memos with a five-minute TTL, so a shared
 * module would serve every test the first test's answers.
 */

import {
  AUTH_DOOR_PROBE_ADDRESS,
  classifyIdentityToolkitFailure,
  emailVerificationDoorHealth,
  googleOauthDoorHealth,
  passkeyDoorHealth,
  PASSWORD_SIGN_IN_EXPECTED_REFUSALS,
  passwordResetDoorHealth,
  passwordSignInDoorHealth,
  ssoDoorHealth,
  type PasswordSignInAnswer,
  type RedemptionAnswer,
} from '../app/api/health/auth-doors/auth-doors-verdict'
import { healthHttpStatus, healthStatus } from '@aglyn/aglyn/server'

/** The redemption endpoint behaving: an invalid code refused as invalid. */
const REDEEMS: RedemptionAnswer = {
  answered: true,
  rejectedTheInvalidCode: true,
}

const CONSOLE_ORIGIN = 'https://app.aglyn.com'

/** What `generateEmailVerificationLink` does when the probe asks. */
let mockMintOutcome: () => Promise<string>
/** What `mockListTenants` does. */
let mockListTenants: () => Promise<{ tenants: { tenantId: string }[] }>
let mockProviderConfigs: { enabled: boolean }[]
let mockEmailConfigured: boolean
let mockAppCheckMints: boolean
/** Keyed by Identity Toolkit method, so a route calling the wrong one fails. */
let mockToolkitReplies: Record<string, { status: number; body: unknown }>
let mockRequestedMethods: string[]

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        generateEmailVerificationLink: () => mockMintOutcome(),
        tenantManager: () => ({
          listTenants: () => mockListTenants(),
          authForTenant: () => ({
            listProviderConfigs: async () => ({ providerConfigs: mockProviderConfigs }),
          }),
        }),
      }),
    }),
  },
  // `_lib/passkeys` reaches for this at import time; the probe never calls it
  // because it stores no challenge.
  consumeOnce: jest.fn(),
}))

jest.mock('firebase-admin/app', () => ({
  __esModule: true,
  getApp: () => ({}),
}))

jest.mock('firebase-admin/app-check', () => ({
  __esModule: true,
  getAppCheck: () => ({
    createToken: async () => {
      if (!mockAppCheckMints) throw new Error('no app check')
      return { token: 'probe-app-check-token' }
    },
  }),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => mockEmailConfigured,
  sendEmail: jest.fn(),
}))

const notFound = () => {
  const error = new Error('no user') as Error & { code: string }
  error.code = 'auth/user-not-found'
  return Promise.reject(error)
}

/** The healthy reply for each endpoint the route asks about. */
function healthyReplies(): Record<string, { status: number; body: unknown }> {
  return {
    'accounts:createAuthUri': {
      status: 200,
      body: {
        authUri:
          'https://accounts.google.com/o/oauth2/auth?response_type=id_token&client_id=probe.apps.googleusercontent.com',
      },
    },
    // The password door: the refusal IS the green (AGL-2583).
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

beforeEach(() => {
  jest.resetModules()
  process.env['NEXT_PUBLIC_CONSOLE_URL'] = CONSOLE_ORIGIN
  process.env['NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY'] = 'probe-web-api-key'
  process.env['NEXT_PUBLIC_FIREBASE_APP_ID'] = '1:1:web:probe'
  delete process.env['AUTH_ACTION_ALLOWED_ORIGINS']
  mockMintOutcome = notFound
  mockListTenants = async () => ({ tenants: [{ tenantId: 'pool-1' }] })
  mockProviderConfigs = [{ enabled: true }]
  mockEmailConfigured = true
  mockAppCheckMints = true
  mockToolkitReplies = healthyReplies()
  mockRequestedMethods = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(
    async (url: string) => {
      const method = String(url).split('/v1/')[1]?.split('?')[0] ?? ''
      mockRequestedMethods.push(method)
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

async function invoke(): Promise<{ status: number; body: unknown }> {
  const route = await import('../app/api/health/auth-doors/route')
  const response = await route.GET()
  return { status: response.status, body: await response.json() }
}

/** One door's check out of the body. */
function doorOf(body: unknown, name: string) {
  return (body as { checks: Record<string, { ok: boolean; code?: string }> })
    .checks[name]
}

describe('every door open', () => {
  it('answers 200 with a check per door', async () => {
    const { status, body } = await invoke()
    expect(status).toBe(200)
    expect(Object.keys((body as { checks: object }).checks).sort()).toEqual([
      'emailVerification',
      'googleOauth',
      'passkey',
      'passwordReset',
      'passwordSignIn',
      'sso',
    ])
    expect((body as { service: string }).service).toBe('console-auth-doors')
  })

  it('asks the provider the same questions a real sign-in would', async () => {
    await invoke()
    expect(mockRequestedMethods.sort()).toEqual([
      // Google's authorization URL — the browser's first step.
      'accounts:createAuthUri',
      // The verification link's redemption endpoint.
      'accounts:update',
      // The reset link's redemption endpoint.
      'accounts:resetPassword',
      // The password door itself (AGL-2583).
      'accounts:signInWithPassword',
    ].sort())
  })

  it('carries the App Check token the browser handshake also has to present', async () => {
    await invoke()
    const call = (global.fetch as jest.Mock).mock.calls[0]?.[1]
    expect(call.headers['X-Firebase-AppCheck']).toBe('probe-app-check-token')
  })

  /**
   * The body is public. The provider replies this route reads contain an
   * OAuth client id, and the config surface behind them contains a client
   * SECRET and the password-hash signer key.
   */
  it('leaks nothing a provider or a customer supplied', async () => {
    mockListTenants = async () => ({ tenants: [{ tenantId: 'acme-corp-y5v14' }] })
    const { body } = await invoke()
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('acme-corp')
    expect(serialized).not.toContain('googleusercontent')
    expect(serialized).not.toContain('probe-web-api-key')
    expect(serialized).not.toContain('probe-app-check-token')
    expect(serialized).not.toContain('@')
  })

  it('memoises, so a public endpoint cannot be turned into a bill', async () => {
    const route = await import('../app/api/health/auth-doors/route')
    await route.GET()
    const afterFirst = (global.fetch as jest.Mock).mock.calls.length
    await route.GET()
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(afterFirst)
  })
})

describe('google-oauth goes red', () => {
  // A wrong, expired or removed OAuth client id — one of the two failure
  // modes AGL-2586 names. Identity Platform answers OPERATION_NOT_ALLOWED and
  // the sign-in button silently does nothing.
  it('when the provider config is gone', async () => {
    mockToolkitReplies['accounts:createAuthUri'] = {
      status: 400,
      body: {
        error: {
          message:
            'OPERATION_NOT_ALLOWED : The identity provider configuration is not found.',
        },
      },
    }
    const { status, body } = await invoke()
    expect(status).toBe(503)
    expect(doorOf(body, 'googleOauth')).toMatchObject({
      ok: false,
      code: 'provider-not-configured',
    })
  })

  // The other named failure mode: the console origin dropped off the
  // authorized-domain list. Four separate issues found this by hand.
  it('when the console origin is no longer an authorized domain', async () => {
    mockToolkitReplies['accounts:createAuthUri'] = {
      status: 400,
      body: {
        error: { message: 'INVALID_CONTINUE_URI : Invalid OAuth request for google.com' },
      },
    }
    const { status, body } = await invoke()
    expect(status).toBe(503)
    expect(doorOf(body, 'googleOauth')).toMatchObject({
      ok: false,
      code: 'origin-not-authorized',
    })
  })

  // App Check enforcement is on for this project, so the precondition the
  // browser satisfies has to be satisfied here too.
  it('when App Check refuses the call', async () => {
    mockAppCheckMints = false
    mockToolkitReplies['accounts:createAuthUri'] = {
      status: 401,
      body: { error: { message: 'Firebase App Check token is invalid.' } },
    }
    const { status, body } = await invoke()
    expect(status).toBe(503)
    expect(doorOf(body, 'googleOauth')).toMatchObject({
      ok: false,
      code: 'appcheck-rejected',
    })
  })
})

describe('password-sign-in goes red (AGL-2583)', () => {
  // The failure that locks out every customer who uses an email and a
  // password, and the one no endpoint on the platform could report until this
  // door existed. `/api/health/signups` was green through three days of it.
  it('when the password provider is switched off', async () => {
    mockToolkitReplies['accounts:signInWithPassword'] = {
      status: 400,
      body: {
        error: {
          message:
            'OPERATION_NOT_ALLOWED : Password sign-in is disabled for this project.',
        },
      },
    }
    const { status, body } = await invoke()
    expect(status).toBe(503)
    expect(doorOf(body, 'passwordSignIn')).toMatchObject({
      ok: false,
      code: 'provider-not-configured',
    })
  })

  it('when the public API key is rejected', async () => {
    mockToolkitReplies['accounts:signInWithPassword'] = {
      status: 400,
      body: { error: { message: 'API key not valid. Please pass a valid API key.' } },
    }
    const { status, body } = await invoke()
    expect(status).toBe(503)
    expect(doorOf(body, 'passwordSignIn')).toMatchObject({
      ok: false,
      code: 'api-key-rejected',
    })
  })

  // An address in a reserved TLD signing in means whatever answered is not an
  // identity provider behaving correctly. Reading a 200 as healthy is exactly
  // the mistake this issue is about.
  it('when the absent account is ADMITTED', async () => {
    mockToolkitReplies['accounts:signInWithPassword'] = {
      status: 200,
      body: { idToken: 'this-should-be-impossible' },
    }
    const { status, body } = await invoke()
    expect(status).toBe(503)
    expect(doorOf(body, 'passwordSignIn')).toMatchObject({
      ok: false,
      code: 'admitted-absent-account',
    })
    expect(JSON.stringify(body)).not.toContain('this-should-be-impossible')
  })

  // The enumeration-protected refusal is the DEFAULT for projects created
  // since 2023. Reading it as a failure would hold this permanently red on a
  // healthy project — the false alarm that gets a check muted.
  it('but stays green on the enumeration-protected refusal', async () => {
    mockToolkitReplies['accounts:signInWithPassword'] = {
      status: 400,
      body: { error: { message: 'INVALID_LOGIN_CREDENTIALS' } },
    }
    const { status, body } = await invoke()
    expect(status).toBe(200)
    expect(doorOf(body, 'passwordSignIn').ok).toBe(true)
  })

  // The optional credentialed half: with a disposable identity configured the
  // door is opened for real, which also exercises the account pool and any
  // blocking function. The credential never reaches the body.
  it('when the configured probe identity cannot sign in', async () => {
    process.env['AGLYN_SIGNIN_PROBE_EMAIL'] = 'probe@example.test'
    process.env['AGLYN_SIGNIN_PROBE_PASSWORD'] = 'not-a-real-password'
    const replies = { ...mockToolkitReplies }
    let seen = 0
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(
      async (url: string, init: { body: string }) => {
        const method = String(url).split('/v1/')[1]?.split('?')[0] ?? ''
        mockRequestedMethods.push(method)
        if (method === 'accounts:signInWithPassword') {
          seen += 1
          // The second call is the credentialed one; it is refused.
          return {
            ok: false,
            status: 400,
            json: async () => ({
              error: {
                message: seen === 1 ? 'EMAIL_NOT_FOUND' : 'USER_DISABLED',
              },
            }),
          }
        }
        const reply = replies[method]
        if (!reply) throw new Error(`unexpected call to ${method}`)
        return {
          ok: reply.status >= 200 && reply.status < 300,
          status: reply.status,
          json: async () => reply.body,
        }
      },
    )
    const { status, body } = await invoke()
    delete process.env['AGLYN_SIGNIN_PROBE_EMAIL']
    delete process.env['AGLYN_SIGNIN_PROBE_PASSWORD']
    expect(status).toBe(503)
    expect(doorOf(body, 'passwordSignIn')).toMatchObject({
      ok: false,
      code: 'probe-signin-failed',
    })
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('probe@example.test')
    expect(serialized).not.toContain('not-a-real-password')
  })
})

describe('password-reset goes red', () => {
  // Minting a link is not the journey; clicking it is. Nothing asserted the
  // half that happens after the email arrives.
  it('when the reset code can no longer be redeemed', async () => {
    delete mockToolkitReplies['accounts:resetPassword']
    const { status, body } = await invoke()
    expect(status).toBe(503)
    expect(doorOf(body, 'passwordReset')).toMatchObject({
      ok: false,
      code: 'redeem-unreachable',
    })
  })

  // The recovery route logs and answers 200 rather than confirming an address
  // exists, so nothing outside this check can see that no mail is leaving.
  it('when email is not configured, which the route itself must stay quiet about', async () => {
    mockEmailConfigured = false
    const { status, body } = await invoke()
    expect(status).toBe(503)
    expect(doorOf(body, 'passwordReset')).toMatchObject({
      ok: false,
      code: 'email-not-configured',
    })
  })
})

describe('email-verification goes red', () => {
  // The mint path: credentials, network, project, or the Identity Toolkit API.
  it('when the link mint path answers with something other than the expected refusal', async () => {
    mockMintOutcome = () => {
      const error = new Error('boom') as Error & { code: string }
      error.code = 'auth/insufficient-permission'
      return Promise.reject(error)
    }
    const { status, body } = await invoke()
    expect(status).toBe(503)
    expect(doorOf(body, 'emailVerification')).toMatchObject({
      ok: false,
      code: 'mint-error',
    })
  })

  // The probe address is reserved by RFC 2606 and cannot be registered. If it
  // resolves, the probe has stopped being a probe.
  it('when the unclaimable probe address resolves to an account', async () => {
    mockMintOutcome = async () => `${CONSOLE_ORIGIN}/__/auth/action?oobCode=real`
    const { status, body } = await invoke()
    expect(status).toBe(503)
    expect(doorOf(body, 'emailVerification')).toMatchObject({
      ok: false,
      code: 'probe-address-exists',
    })
  })

  // The clause the issue says nothing asserts today: that following the link
  // works.
  it('when the verification code can no longer be redeemed', async () => {
    mockToolkitReplies['accounts:update'] = {
      status: 400,
      body: { error: { message: 'API key not valid. Please pass a valid API key.' } },
    }
    const { status, body } = await invoke()
    expect(status).toBe(503)
    expect(doorOf(body, 'emailVerification')).toMatchObject({
      ok: false,
      code: 'redeem-api-key-rejected',
    })
  })
})

describe('sso goes red', () => {
  // SSO signs into per-org GCIP tenant pools, not the project pool. If the
  // tenant manager stops answering, every enterprise customer is locked out
  // at once and no component check moves.
  it('when the per-org tenant pools cannot be listed', async () => {
    mockListTenants = () => Promise.reject(new Error('permission denied on aglyn-main'))
    const { status, body } = await invoke()
    expect(status).toBe(503)
    expect(doorOf(body, 'sso')).toMatchObject({
      ok: false,
      code: 'pools-unavailable',
    })
    // The rejection named the project. It must not reach the body.
    expect(JSON.stringify(body)).not.toContain('aglyn-main')
  })

  // A provider config deleted or disabled in a console UI — no deploy step,
  // no other trace.
  it('when a pool has no enabled SAML or OIDC provider left', async () => {
    mockProviderConfigs = [{ enabled: false }]
    const { status, body } = await invoke()
    expect(status).toBe(503)
    expect(doorOf(body, 'sso')).toMatchObject({
      ok: false,
      code: 'no-enabled-provider',
    })
  })

  // An install with no SSO customers has no SSO to break. Paging for a
  // feature nobody bought is the false alarm that gets a board ignored.
  it('but is green and says so when the install has no SSO pools', async () => {
    mockListTenants = async () => ({ tenants: [] })
    const { status, body } = await invoke()
    expect(status).toBe(200)
    expect(doorOf(body, 'sso')).toMatchObject({ ok: true, code: 'no-sso-pools' })
  })
})

describe('passkey goes red', () => {
  // The RP id is baked into every stored credential, so a deployment whose
  // workspace domain is wrong 400s every registration and every sign-in —
  // and nothing else in the platform notices.
  it('when the console origin is refused by the relying-party gate', async () => {
    process.env['NEXT_PUBLIC_CONSOLE_URL'] = 'https://console.not-the-workspace.test'
    const { status, body } = await invoke()
    expect(status).toBe(503)
    expect(doorOf(body, 'passkey')).toMatchObject({
      ok: false,
      code: 'rp-origin-rejected',
    })
  })
})

describe('password-reset door', () => {
  it('is green when the origin resolves, email is configured and a code can be redeemed', () => {
    const check = passwordResetDoorHealth(
      { originAllowlisted: true, emailConfigured: true, redemption: REDEEMS },
      12,
    )
    expect(check.ok).toBe(true)
    expect(check.door).toBe('password-reset')
  })

  // RED PROOF: the link resolver stops yielding an allowlisted console
  // origin. Every emailed reset link then points at a host that cannot
  // redeem, while the send itself keeps succeeding — the outage is invisible
  // from every other angle because the route answers 200 by design.
  it('goes red when the reset link would be built on an origin we do not serve', () => {
    const check = passwordResetDoorHealth(
      { originAllowlisted: false, emailConfigured: true, redemption: REDEEMS },
      3,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('origin-not-resolvable')
  })

  // RED PROOF: email transport unconfigured. The recovery route logs and
  // answers 200 rather than confirming an address exists, so nothing outside
  // this check can see that no mail is leaving.
  it('goes red when email is not configured, which the route itself must stay quiet about', () => {
    const check = passwordResetDoorHealth(
      { originAllowlisted: true, emailConfigured: false, redemption: REDEEMS },
      3,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('email-not-configured')
  })

  // RED PROOF: the half of the journey after the click. Minting a link is
  // not the same as the link working, and nothing asserted the second half.
  it('goes red when the redemption endpoint does not answer at all', () => {
    const check = passwordResetDoorHealth(
      {
        originAllowlisted: true,
        emailConfigured: true,
        redemption: { answered: false, rejectedTheInvalidCode: false },
      },
      3,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('redeem-unreachable')
  })

  it('goes red, naming the refusal, when redemption answers with the wrong error', () => {
    const check = passwordResetDoorHealth(
      {
        originAllowlisted: true,
        emailConfigured: true,
        redemption: {
          answered: true,
          rejectedTheInvalidCode: false,
          verdict: 'api-key-rejected',
        },
      },
      3,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('redeem-api-key-rejected')
  })

  // A code that accepted a code that is not a code would be an auth bypass,
  // not a healthy endpoint.
  it('goes red when redemption ACCEPTS the invalid code', () => {
    const check = passwordResetDoorHealth(
      {
        originAllowlisted: true,
        emailConfigured: true,
        redemption: { answered: true, rejectedTheInvalidCode: false },
      },
      3,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('redeem-unexpected')
  })
})

describe('email-verification door', () => {
  const green = {
    mintVerdict: 'expected-refusal' as const,
    linkOnConsoleOrigin: true,
    linkCarriesCode: true,
    redemption: REDEEMS,
  }

  it('is green when the mint refuses a nonexistent address and the rewrite is sound', () => {
    expect(emailVerificationDoorHealth(green, 9).ok).toBe(true)
  })

  // RED PROOF: the mint path is what actually died in the signup incident's
  // neighbourhood — credentials, network, project or the Identity Toolkit
  // API. A refusal proves it works; silence proves nothing works.
  it('goes red when the link mint path cannot be reached', () => {
    const check = emailVerificationDoorHealth(
      { ...green, mintVerdict: 'unreachable' },
      9,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('mint-unreachable')
  })

  it('goes red when the mint answers with something other than the expected refusal', () => {
    const check = emailVerificationDoorHealth(
      { ...green, mintVerdict: 'other-error' },
      9,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('mint-error')
  })

  // The probe address is reserved by RFC 2606 and cannot be registered. If it
  // ever resolves, the probe has stopped being a probe and has minted a live
  // code for somebody — louder than a pass, quieter than a pretend green.
  it('goes red when the deliberately-unclaimable probe address resolves to an account', () => {
    const check = emailVerificationDoorHealth(
      { ...green, mintVerdict: 'unexpected-success' },
      9,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('probe-address-exists')
    expect(AUTH_DOOR_PROBE_ADDRESS.endsWith('.invalid')).toBe(true)
  })

  // RED PROOF: AGL-1112 rebuilds Firebase's link onto our own handler page.
  // A drift there produces a mail whose button lands somewhere that cannot
  // redeem — a dead link visible only to the person who trusted it.
  it('goes red when the rebuilt link leaves the console origin', () => {
    const check = emailVerificationDoorHealth(
      { ...green, linkOnConsoleOrigin: false },
      9,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('link-off-console-origin')
  })

  it('goes red when the rebuilt link carries no code', () => {
    const check = emailVerificationDoorHealth(
      { ...green, linkCarriesCode: false },
      9,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('link-carries-no-code')
  })

  // RED PROOF: "the link actually verifies" is the clause the issue says
  // nothing asserts today.
  it('goes red when the verification code cannot be redeemed', () => {
    const check = emailVerificationDoorHealth(
      {
        ...green,
        redemption: { answered: false, rejectedTheInvalidCode: false },
      },
      9,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('redeem-unreachable')
  })
})

describe('google-oauth door', () => {
  const green = {
    answer: { answered: true, verdict: 'accepted' as const },
    authUriOnGoogle: true,
    carriesClientId: true,
  }

  it('is green when Identity Platform builds a Google URL carrying a client id', () => {
    expect(googleOauthDoorHealth(green, 40).ok).toBe(true)
  })

  // RED PROOF, and the first of the two failure modes AGL-2586 names: a
  // wrong, expired or removed OAuth client id. Identity Platform answers
  // OPERATION_NOT_ALLOWED and the sign-in button silently does nothing.
  it('goes red when the Google provider config is gone', () => {
    const check = googleOauthDoorHealth(
      {
        ...green,
        answer: { answered: true, verdict: 'provider-not-configured' },
      },
      40,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('provider-not-configured')
  })

  // RED PROOF, and the second named failure mode: the console origin dropped
  // off the Identity Platform authorized-domain list. Four separate issues
  // found this class of drift by hand, months apart.
  it('goes red when the console origin is no longer an authorized domain', () => {
    const check = googleOauthDoorHealth(
      { ...green, answer: { answered: true, verdict: 'origin-not-authorized' } },
      40,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('origin-not-authorized')
  })

  it('goes red when the provider does not answer at all', () => {
    const check = googleOauthDoorHealth(
      { ...green, answer: { answered: false, verdict: 'refused' } },
      40,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('provider-unreachable')
  })

  // A 200 is not enough: an authorization URL with no client id on it is a
  // button that lands on a Google error page.
  it('goes red when the authorization URL carries no client id', () => {
    const check = googleOauthDoorHealth({ ...green, carriesClientId: false }, 40)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('auth-uri-has-no-client-id')
  })

  it('goes red when the authorization URL does not point at Google', () => {
    const check = googleOauthDoorHealth({ ...green, authUriOnGoogle: false }, 40)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('auth-uri-not-google')
  })
})

describe('classifyIdentityToolkitFailure', () => {
  it.each([
    [400, 'OPERATION_NOT_ALLOWED : The identity provider configuration is not found.', 'provider-not-configured'],
    [400, 'INVALID_CONTINUE_URI : Invalid OAuth request for google.com', 'origin-not-authorized'],
    [400, 'UNAUTHORIZED_DOMAIN', 'origin-not-authorized'],
    [401, 'Firebase App Check token is invalid.', 'appcheck-rejected'],
    [400, 'API key not valid. Please pass a valid API key.', 'api-key-rejected'],
    [403, 'Requests to this API are blocked.', 'api-key-rejected'],
    [400, 'INVALID_OOB_CODE', 'refused'],
  ])('maps %s %s to %s', (status, message, expected) => {
    expect(classifyIdentityToolkitFailure(status as number, message as string)).toBe(
      expected,
    )
  })

  // The endpoint reporting these is public. Nothing a provider says may
  // travel into the body — the classifier's whole job is to end the string.
  it('never returns anything derived from the message text', () => {
    const verdict = classifyIdentityToolkitFailure(
      500,
      'project aglyn-main service account firebase-adminsdk@example failed',
    )
    expect(verdict).toBe('refused')
  })
})

describe('sso door', () => {
  it('is green when the pools list and a sampled pool still has an enabled provider', () => {
    const check = ssoDoorHealth(
      { poolCount: 3, sampledPools: 3, poolsWithEnabledProvider: 2 },
      20,
    )
    expect(check.ok).toBe(true)
  })

  // RED PROOF: SSO signs into per-org GCIP tenant pools, not the project
  // pool. If the tenant manager stops answering, every enterprise customer is
  // locked out at once and no component check moves.
  it('goes red when the per-org tenant pools cannot be listed', () => {
    const check = ssoDoorHealth(
      { poolCount: null, sampledPools: 0, poolsWithEnabledProvider: 0 },
      20,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('pools-unavailable')
  })

  // RED PROOF: a provider config deleted or disabled in a console UI, which
  // has no deploy step and therefore no other trace.
  it('goes red when no sampled pool has an enabled SAML or OIDC provider', () => {
    const check = ssoDoorHealth(
      { poolCount: 2, sampledPools: 2, poolsWithEnabledProvider: 0 },
      20,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('no-enabled-provider')
  })

  // An install with no SSO customers has no SSO to break. Reporting an
  // outage for a feature nobody bought is the false alarm that teaches
  // people to ignore the board.
  it('is green and says so when the install has no SSO pools', () => {
    const check = ssoDoorHealth(
      { poolCount: 0, sampledPools: 0, poolsWithEnabledProvider: 0 },
      20,
    )
    expect(check.ok).toBe(true)
    expect(check.code).toBe('no-sso-pools')
  })
})

describe('passkey door', () => {
  it('is green when the console origin resolves and a challenge is issued', () => {
    expect(
      passkeyDoorHealth({ rpContextResolved: true, challengeIssued: true }, 2)
        .ok,
    ).toBe(true)
  })

  // RED PROOF: the workspace domain misconfigured on a deployment. The RP id
  // is baked into every stored credential, so the console's own origin
  // failing to resolve 400s every registration and every sign-in.
  it('goes red when the console origin is refused by the relying-party gate', () => {
    const check = passkeyDoorHealth(
      { rpContextResolved: false, challengeIssued: false },
      2,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('rp-origin-rejected')
  })

  it('goes red when no challenge can be issued', () => {
    const check = passkeyDoorHealth(
      { rpContextResolved: true, challengeIssued: false },
      2,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('challenge-unavailable')
  })
})

describe('the doors report through the shared health contract', () => {
  // The status code is the contract — most monitors read nothing else. A door
  // that is shut has to be a 503, not a 200 whose body says so.
  it('turns any shut door into a 503', () => {
    const checks = {
      passwordReset: passwordResetDoorHealth(
        { originAllowlisted: true, emailConfigured: true, redemption: REDEEMS },
        1,
      ),
      googleOauth: googleOauthDoorHealth(
        {
          answer: { answered: true, verdict: 'origin-not-authorized' },
          authUriOnGoogle: false,
          carriesClientId: false,
        },
        1,
      ),
    }
    expect(healthStatus(checks)).toBe('degraded')
    expect(healthHttpStatus(healthStatus(checks))).toBe(503)
  })

  // No check may carry a message, a host, an id or anything else a provider
  // or a customer supplied. Codes are a closed set of literals.
  it('carries nothing but enum codes and fixed prose', () => {
    const shut = [
      passwordResetDoorHealth(
        {
          originAllowlisted: true,
          emailConfigured: true,
          redemption: {
            answered: true,
            rejectedTheInvalidCode: false,
            verdict: 'appcheck-rejected',
          },
        },
        1,
      ),
      ssoDoorHealth(
        { poolCount: null, sampledPools: 0, poolsWithEnabledProvider: 0 },
        1,
      ),
      passkeyDoorHealth({ rpContextResolved: false, challengeIssued: false }, 1),
    ]
    for (const check of shut) {
      expect(check.code).toMatch(/^[a-z0-9-]+$/)
      expect(JSON.stringify(check)).not.toMatch(/aglyn-main|firebase-adminsdk|@/)
    }
  })
})


/**
 * AGL-2583 — the password door, which nothing asserted until this issue.
 *
 * The five doors above were built as "the ways in that are NOT email and
 * password", on the reading that the password door was already watched. It
 * was not: the check named "signups" measures creation VOLUME, and its
 * healthiest reading is zero. Every case below is a way password sign-in
 * breaks for EVERY customer at once, and each one must be a red — a monitor
 * that cannot fail is worth nothing.
 */
describe('password-sign-in door (AGL-2583)', () => {
  const signedInAnswer = (
    over: Partial<PasswordSignInAnswer> = {},
  ): PasswordSignInAnswer => ({
    answer: { answered: true, verdict: 'accepted' },
    refusedTheAbsentAccount: true,
    unexpectedAcceptance: false,
    probe: null,
    ...over,
  })

  it('a refusal of an account that cannot exist is the HEALTHY answer', () => {
    const check = passwordSignInDoorHealth(signedInAnswer(), 12)
    expect(check.ok).toBe(true)
    expect(check.code).toBeUndefined()
    expect(check.door).toBe('password-sign-in')
    expect(check.asserts).toContain('cannot exist')
  })

  it('names the three refusals a healthy project can answer with', () => {
    // `INVALID_LOGIN_CREDENTIALS` is what a project with email-enumeration
    // protection returns — the default since 2023. Reading it as a failure
    // would hold this permanently red on a perfectly healthy project, which
    // is how a check gets muted before it ever catches anything.
    expect(PASSWORD_SIGN_IN_EXPECTED_REFUSALS).toEqual(
      expect.arrayContaining([
        'EMAIL_NOT_FOUND',
        'INVALID_LOGIN_CREDENTIALS',
        'INVALID_PASSWORD',
      ]),
    )
  })

  it('REDS when the password provider is switched off', () => {
    // Every customer with an email and a password is locked out, and until
    // this door existed nothing on the platform would have said so.
    const check = passwordSignInDoorHealth(
      signedInAnswer({
        answer: { answered: true, verdict: 'provider-not-configured' },
        refusedTheAbsentAccount: false,
      }),
      12,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('provider-not-configured')
  })

  it('REDS when the public key or App Check is rejected', () => {
    for (const verdict of ['api-key-rejected', 'appcheck-rejected'] as const) {
      const check = passwordSignInDoorHealth(
        signedInAnswer({
          answer: { answered: true, verdict },
          refusedTheAbsentAccount: false,
        }),
        12,
      )
      expect(check.ok).toBe(false)
      expect(check.code).toBe(verdict)
    }
  })

  it('REDS when nothing answered', () => {
    const check = passwordSignInDoorHealth(
      signedInAnswer({
        answer: { answered: false, verdict: 'refused' },
        refusedTheAbsentAccount: false,
      }),
      5_000,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('provider-unreachable')
  })

  it('REDS when an account that cannot exist is ADMITTED', () => {
    // Grading a 200 as healthy because 200 usually means healthy is the exact
    // shape of mistake this issue exists to stop repeating.
    const check = passwordSignInDoorHealth(
      signedInAnswer({ unexpectedAcceptance: true, refusedTheAbsentAccount: false }),
      12,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('admitted-absent-account')
  })

  it('REDS on an answer it has no rule for, rather than assuming it is fine', () => {
    const check = passwordSignInDoorHealth(
      signedInAnswer({ refusedTheAbsentAccount: false }),
      12,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('unexpected-answer')
  })

  it('REDS when the configured probe identity cannot sign in', () => {
    // The half the anonymous probe is blind to: a blocking function, a
    // disabled account, a pool that refuses real credentials.
    const check = passwordSignInDoorHealth(
      signedInAnswer({ probe: { signedIn: false } }),
      12,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('probe-signin-failed')
    expect(check.asserts).toContain('end to end')
  })

  it('is green when the configured probe identity signs in', () => {
    const check = passwordSignInDoorHealth(
      signedInAnswer({ probe: { signedIn: true } }),
      12,
    )
    expect(check.ok).toBe(true)
  })

  it('an unconfigured probe cannot mute a real red', () => {
    // A deployment with no probe identity must still be graded by the
    // anonymous half. Absence of the optional probe is not a pass.
    const check = passwordSignInDoorHealth(
      signedInAnswer({
        answer: { answered: true, verdict: 'provider-not-configured' },
        refusedTheAbsentAccount: false,
        probe: null,
      }),
      12,
    )
    expect(check.ok).toBe(false)
    expect(check.asserts).toContain('no account used')
  })

  it('carries no address, no token and no message', () => {
    const check = passwordSignInDoorHealth(
      signedInAnswer({ probe: { signedIn: true } }),
      12,
    )
    expect(Object.keys(check).sort()).toEqual(['asserts', 'door', 'ms', 'ok'])
    // The prose names the door, so `password` is expected in it; an address,
    // a token or a credential is not.
    expect(JSON.stringify(check)).not.toMatch(/@|idToken|not-a-credential/i)
  })

  it('shuts the whole endpoint when it is red — the 503 contract', () => {
    const checks = {
      passwordSignIn: passwordSignInDoorHealth(
        signedInAnswer({
          answer: { answered: true, verdict: 'provider-not-configured' },
          refusedTheAbsentAccount: false,
        }),
        12,
      ),
      passkey: passkeyDoorHealth(
        { rpContextResolved: true, challengeIssued: true },
        1,
      ),
    }
    expect(healthStatus(checks)).toBe('degraded')
    expect(healthHttpStatus(healthStatus(checks))).toBe(503)
  })
})
