/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this suite needs `Request`/`Response`.
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
 * The console plugin API dispatcher answers to the email-verification gate
 * (AGL-479, brought here by AGL-2589).
 *
 * `apps/console/app/api/[...pluginApi]/route.ts` is the single door in front
 * of every plugin's console handler — marketplace installs and purchases,
 * gift cards, POS orders, refunds, the email list writes — and it already
 * decoded the caller's ID token, for `staff` and `uid`. It asked nothing
 * about the address behind it, while roughly 135 NAMED routes beside it did.
 *
 * **The assertion surface is `runLegacyHandler`, not the status code.** A 403
 * on its own would not prove the handler stopped running, and "the handler
 * never runs" is the whole claim: the handler is what installs the plugin,
 * charges the card or writes the list.
 *
 * The other half is the one that makes this a gate rather than a wall. This
 * dispatcher shares ONE route registry with the tenant dispatcher, so the
 * paths it resolves include storefront handlers a shop visitor calls with no
 * Firebase identity at all. A tokenless request must still reach its handler
 * and be answered by that handler's own rules — the sentence is "an account
 * that has not verified is not a caller", not "everyone is refused".
 */

/** Requests that reached the plugin handler. */
let mockHandlerCalls: number
/** Whether the lockdown verdict was consulted — the gate runs ahead of it. */
let mockLockdownChecks: number
/** Whether the rate limiter opened its counter — likewise. */
let mockRateLimitChecks: number
/** What `verifyIdToken` answers with, keyed by the bearer string. */
const mockTokens = new Map<string, Record<string, unknown>>()

jest.mock('@aglyn/tenant-data-admin', () => {
  // The verification trio, REAL. A stubbed predicate on a security control
  // would make every assertion here a test of the stub.
  const gate = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/firebase-admin',
  )
  return {
    __esModule: true,
    emailUnverifiedResponse: gate.emailUnverifiedResponse,
    isEmailVerified: gate.isEmailVerified,
    isImpersonationSession: gate.isImpersonationSession,
    filterEnabledPluginsByReleaseFlags: jest.fn(async (ids: string[]) => [
      ...ids,
    ]),
    featureLockdownRefusal: jest.fn(async () => null),
    lockdownRefusal: jest.fn(async () => {
      mockLockdownChecks += 1
      return null
    }),
    getHostDisabledPlugins: jest.fn(async () => []),
    getHostDocAdmin: jest.fn(async () => ({ id: 'host-1' })),
    getOrgForHost: jest.fn(async () => ({
      orgId: 'org-1',
      org: { enabledPlugins: ['email', 'marketing'] },
    })),
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async (token: string) => {
            const decoded = mockTokens.get(token)
            // A plugin key or any non-Firebase credential: the dispatcher
            // treats the throw as "no uid, no bypass" and carries on.
            if (!decoded) throw new Error('not a token')
            return decoded
          },
        }),
      }),
    },
    consoleApiRateLimitRefusal: jest.fn(async () => {
      mockRateLimitChecks += 1
      return null
    }),
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  lockdownFeaturesForPluginApiPath: jest.fn(() => []),
  pluginIdForRegisteredApiPath: jest.fn(() => 'email'),
  resolveHostEnabledPlugins: jest.fn(() => ['email', 'marketing']),
  resolvePluginApiRoute: jest.fn(() => ({ path: 'email/list-members-add' })),
  runLegacyHandler: jest.fn(async () => {
    mockHandlerCalls += 1
    return Response.json({ ok: true }, { status: 200 })
  }),
}))

jest.mock('../utils/remote-server-bundles', () => ({
  __esModule: true,
  ensureRemoteServerBundles: jest.fn(async () => undefined),
}))

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: {
    ensureAll: jest.fn(async () => undefined),
    pluginIdForApiPath: jest.fn(() => 'email'),
  },
}))

import { POST } from '../app/api/[...pluginApi]/route'

const params = Promise.resolve({ pluginApi: ['email', 'list-members-add'] })

/** A console write, optionally carrying a bearer token. */
function post(bearer?: string) {
  return new Request('https://app.aglyn.com/api/email/list-members-add', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({ hostId: 'host-1', listId: 'list-1' }),
  })
}

beforeEach(() => {
  mockHandlerCalls = 0
  mockLockdownChecks = 0
  mockRateLimitChecks = 0
  mockTokens.clear()
  mockTokens.set('verified', { uid: 'uid-1', staff: false, email_verified: true })
  mockTokens.set('unverified', { uid: 'uid-2', staff: false, email_verified: false })
  // Some custom-token sign-ins carry no claim at all. The gate fails closed
  // on that, exactly as `verifyConsoleIdToken` does.
  mockTokens.set('claimless', { uid: 'uid-3', staff: false })
  mockTokens.set('impersonated', {
    uid: 'uid-2',
    staff: false,
    email_verified: false,
    impersonatedBy: 'uid-staff',
  })
})

describe('the console plugin API dispatcher refuses an unverified account', () => {
  it('refuses before the handler runs, and says why', async () => {
    const response = await POST(post('unverified'), { params })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'Verify your email to continue',
      reason: 'email-unverified',
    })
    expect(mockHandlerCalls).toBe(0)
  })

  it('treats a MISSING email_verified claim as unverified', async () => {
    const response = await POST(post('claimless'), { params })
    expect(response.status).toBe(403)
    expect(mockHandlerCalls).toBe(0)
  })

  it('spends no lockdown read and no rate-limit write on the refusal', async () => {
    // Placement, asserted rather than described: an unverified caller must
    // not be able to make the platform pay for a document read or a counter
    // increment on the way to being refused.
    await POST(post('unverified'), { params })
    expect(mockLockdownChecks).toBe(0)
    expect(mockRateLimitChecks).toBe(0)
  })

  it('lets a VERIFIED account through, so this is a gate and not a wall', async () => {
    const response = await POST(post('verified'), { params })
    expect(response.status).toBe(200)
    expect(mockHandlerCalls).toBe(1)
  })

  it('exempts a staff impersonation session (AGL-480)', async () => {
    const response = await POST(post('impersonated'), { params })
    expect(response.status).toBe(200)
    expect(mockHandlerCalls).toBe(1)
  })
})

describe('a request carrying no Firebase account is not an unverified one', () => {
  /*
   * The design decision this dispatcher differs on, and why it is not a
   * softening. It shares its route registry with the tenant dispatcher, so
   * the paths it can resolve include `commerce/cart`, `commerce/catalog`,
   * `membership/login` and `bookings/slots` — handlers a shop visitor calls
   * with no Firebase identity. Refusing a tokenless request here would break
   * those instead of letting each handler answer its own question about who
   * may call it.
   */
  it('carries a tokenless request to its handler', async () => {
    const response = await POST(post(), { params })
    expect(response.status).toBe(200)
    expect(mockHandlerCalls).toBe(1)
  })

  it('carries a non-Firebase credential to its handler too', async () => {
    // A plugin key: the decode throws, the dispatcher records no uid, and the
    // handler is left to authenticate it however it does.
    const response = await POST(post('a-plugin-key'), { params })
    expect(response.status).toBe(200)
    expect(mockHandlerCalls).toBe(1)
  })
})
