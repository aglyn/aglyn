/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * `/api/billing/email-ceiling` — who may read it, and what it says.
 *
 * The route hands a browser two numbers that live in `rateLimits`, a
 * collection the security rules deny to every client. Once an endpoint reads
 * on a client's behalf out of a collection the client cannot reach, its
 * authorization IS the rule — no second evaluation happens behind it, because
 * the Admin SDK evaluates none.
 *
 * ## The load-bearing case is the SITE COLLABORATOR
 *
 * A collaborator is an `orgs/{id}/members` document like any other:
 * `allHosts: false` plus a `hostAccess` map. Every sibling billing route gates
 * on a permission alone, and a permission answers *what kind of action*, never
 * *which resources* — which is how `/api/resources/erase` came to admit
 * collaborators to org-wide deletes (AGL-1046). This is a number about the
 * WHOLE organization's sending, so org-wide membership is checked as well, and
 * the test below grants the collaborator `billing.view` outright to prove the
 * second clause is doing the work rather than riding on the first.
 *
 * ## And the payload is a CONTRACT
 *
 * Asserted key-for-key, in both directions. Two failures it pins at once: a
 * field that stops being sent silently blanks the surface, and a field that
 * starts being sent (the live platform ramp, an operator control) leaks
 * platform capacity to every customer who opens Billing.
 */

export {}

import { isOrgWideMember } from '@aglyn/aglyn/app-utils/organizations'
import type { AglynOrgMember } from '@aglyn/aglyn/foundation'

const mockVerifyIdToken = jest.fn()
const mockResolveOrgMembership = jest.fn()
const mockMemberHasOrgPermission = jest.fn()
/** The live platform ramp the ceilings are derived from. */
let mockRateConfig: { perHour: number; enabled: boolean }
/** Org ids `readOrgEmailSendWindow` was asked about, in order. */
const mockWindowReads: string[] = []
let mockWindow: { windowStartMs: number; resetMs: number; used: number }

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json(
      { error: 'Verify your email to continue', reason: 'email-unverified' },
      { status: 403 },
    ),
  resolveOrgMembership: (...args: unknown[]) =>
    mockResolveOrgMembership(...args),
  memberHasOrgPermission: (...args: unknown[]) =>
    mockMemberHasOrgPermission(...args),
  readEmailSendRateConfig: async () => mockRateConfig,
  readOrgEmailSendWindow: async (options: { orgId: string }) => {
    mockWindowReads.push(options.orgId)
    return mockWindow
  },
}))

/*
 * THE REAL PREDICATE, reached through a static import.
 *
 * A stubbed `isOrgWideMember` would make the collaborator test green having
 * proved nothing — a clamp that passes because the thing it clamps was
 * replaced is the stubbed-resolver failure this repo has already paid for.
 *
 * `jest.requireActual` inside the factory below would have been the obvious
 * way to get it, and it is the one thing that must not happen: a deferred
 * first-party specifier registers a DYNAMIC nx graph edge on the whole
 * project, nx then calls `@aglyn/aglyn` lazy-loaded, and
 * `@nx/enforce-module-boundaries` rejects every STATIC import of it across
 * every project that reaches it — hundreds of errors on files that did not
 * change (AGL-949, AGL-1329, AGL-2282/AGL-2313). The factory may not close
 * over an import, so the value is bound to a `mock`-prefixed const and the
 * factory calls THROUGH it.
 */
const mockOrgWide = isOrgWideMember

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  isOrgWideMember: (...args: unknown[]) =>
    (mockOrgWide as (...a: unknown[]) => boolean)(...args),
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: {
        authorization: request.headers.get('authorization') ?? undefined,
      },
    }
  },
}))

import {
  EMAIL_MAX_RECIPIENTS_PER_SEND,
  EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
  deliverableMonthlyCeiling,
  orgHourlyCampaignCeiling,
} from '@aglyn/shared-util-email'
import { GET as emailCeiling } from '../app/api/billing/email-ceiling/route'

const ORG = 'org-1'

function get(options: { token?: string; orgId?: string | null } = {}) {
  const orgId = options.orgId === undefined ? ORG : options.orgId
  const url =
    'https://app.aglyn.com/api/billing/email-ceiling' +
    (orgId ? `?orgId=${encodeURIComponent(orgId)}` : '')
  return emailCeiling(
    new Request(url, {
      headers: options.token
        ? { authorization: `Bearer ${options.token}` }
        : undefined,
    }),
  )
}

/** An org-wide manager: no `allHosts` field and no scoping map. */
const MANAGER: Partial<AglynOrgMember> = { $id: 'u1', role: 'admin' }
/**
 * A SITE COLLABORATOR: an org member document scoped to one host. The role is
 * `editor` and `allHosts` is explicitly false — the exact shape the invite
 * flow writes.
 */
const COLLABORATOR: Partial<AglynOrgMember> = {
  $id: 'u2',
  role: 'editor',
  allHosts: false,
  hostAccess: { 'host-a': 'editor' },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockWindowReads.length = 0
  mockRateConfig = {
    perHour: EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
    enabled: true,
  }
  mockWindow = {
    windowStartMs: 1_756_000_000_000,
    resetMs: 1_756_003_600_000,
    used: 0,
  }
  mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: true })
  mockResolveOrgMembership.mockResolvedValue({ orgId: ORG, member: MANAGER })
  // The real helper's first line is `if (!member) return false`. Mirrored, so
  // the non-member refusal below is carried by the permission gate as well as
  // by the org-wide one — a mock that answered `true` for a null member would
  // have left that test resting on a single clause without saying so.
  mockMemberHasOrgPermission.mockImplementation(async (_orgId, member) =>
    Boolean(member),
  )
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the fixture distinguishes the two member shapes', () => {
  /**
   * The control. Both assertions run against the REAL predicate, so a
   * `isOrgWideMember` that stopped discriminating could not leave the
   * collaborator test passing for the wrong reason.
   */
  it('a manager is org-wide and a site collaborator is not', () => {
    expect(isOrgWideMember(MANAGER)).toBe(true)
    expect(isOrgWideMember(COLLABORATOR)).toBe(false)
  })
})

describe('who may read the ceiling', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await get({})).status).toBe(401)
  })

  it('refuses a request with no organization', async () => {
    expect((await get({ token: 't', orgId: null })).status).toBe(400)
  })

  it('refuses a non-GET', async () => {
    const response = await emailCeiling(
      new Request(
        'https://app.aglyn.com/api/billing/email-ceiling?orgId=org-1',
        {
          method: 'POST',
          headers: { authorization: 'Bearer t' },
        },
      ),
    )
    expect(response.status).toBe(405)
  })

  it('refuses somebody who is not a member at all', async () => {
    mockResolveOrgMembership.mockResolvedValue(null)
    expect((await get({ token: 't' })).status).toBe(403)
  })

  it('refuses an org-wide member without billing.view', async () => {
    mockMemberHasOrgPermission.mockResolvedValue(false)
    expect((await get({ token: 't' })).status).toBe(403)
  })

  it('REFUSES A SITE COLLABORATOR EVEN WITH billing.view', async () => {
    // The permission is granted outright, so the only thing that can refuse
    // this request is the org-wide check. Billing is org-scoped: a
    // collaborator on one site has no claim on the organization's sending.
    mockResolveOrgMembership.mockResolvedValue({
      orgId: ORG,
      member: COLLABORATOR,
    })
    mockMemberHasOrgPermission.mockResolvedValue(true)
    const response = await get({ token: 't' })
    expect(response.status).toBe(403)
    // Nothing was read on their behalf, either — a refusal that has already
    // touched the counter has leaked the timing if not the number.
    expect(mockWindowReads).toEqual([])
  })

  it('admits an org-wide member with billing.view', async () => {
    expect((await get({ token: 't' })).status).toBe(200)
    expect(mockMemberHasOrgPermission).toHaveBeenCalledWith(
      ORG,
      MANAGER,
      'billing.view',
    )
  })

  it('admits staff without a membership', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'staff-1',
      email_verified: true,
      staff: true,
    })
    mockResolveOrgMembership.mockResolvedValue(null)
    expect((await get({ token: 't' })).status).toBe(200)
  })

  it('refuses an unverified email', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: false })
    const response = await get({ token: 't' })
    expect(response.status).toBe(403)
    expect((await response.json()).reason).toBe('email-unverified')
  })
})

describe('what it answers', () => {
  it('reads THIS organization’s hourly window', async () => {
    await get({ token: 't' })
    // Not the platform-wide window: that one is every tenant's traffic added
    // together and is an operator figure, not this customer's.
    expect(mockWindowReads).toEqual([ORG])
  })

  it('derives both ceilings from the live platform ramp', async () => {
    mockWindow = { ...mockWindow, used: 137 }
    const body = await (await get({ token: 't' })).json()
    expect(body).toEqual({
      hourUsed: 137,
      hourLimit: orgHourlyCampaignCeiling(EMAIL_SEND_RATE_DEFAULT_PER_HOUR),
      hourResetMs: mockWindow.resetMs,
      deliverableMonthly: deliverableMonthlyCeiling(
        EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
      ),
      perSend: EMAIL_MAX_RECIPIENTS_PER_SEND,
      paced: true,
    })
    // At the shipped constants: a quarter of 2,000 an hour, and 720 hours of
    // it. Pinned as literals too, so a share change is loud here as well as in
    // the library's own spec.
    expect(body.hourLimit).toBe(500)
    expect(body.deliverableMonthly).toBe(360_000)
  })

  it('MOVES when an operator ramps the platform', async () => {
    // The ceiling is a share of whatever the ramp currently is — that is the
    // property `send-ceilings.ts` exists to maintain, and a route that had
    // frozen a number at deploy time would tell a customer a ceiling nothing
    // was enforcing.
    mockRateConfig = { perHour: 800, enabled: true }
    const body = await (await get({ token: 't' })).json()
    expect(body.hourLimit).toBe(200)
    expect(body.deliverableMonthly).toBe(144_000)
    // Non-vacuous: these differ from the default-ramp figures above.
    expect(body.hourLimit).not.toBe(500)
  })

  it('reports the operator kill switch rather than hiding it', async () => {
    mockRateConfig = {
      perHour: EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
      enabled: false,
    }
    const body = await (await get({ token: 't' })).json()
    expect(body.paced).toBe(false)
    // The ceiling still comes back. A parked control is not an unknown one,
    // and blanking the row would be a worse answer than an honest caveat.
    expect(body.hourLimit).toBe(500)
  })

  it('never sends a value that cannot survive JSON', async () => {
    // `JSON.stringify(Infinity)` is `null` and `Number(null)` is `0`, so an
    // infinite ceiling would arrive at the browser as a cap of ZERO and render
    // as fully spent (AGL-2482). Every number here is finite by construction;
    // this asserts it rather than trusting it.
    const response = await get({ token: 't' })
    const body = await response.json()
    for (const [key, value] of Object.entries(body)) {
      if (key === 'paced') continue
      expect(typeof value).toBe('number')
      expect(Number.isFinite(value as number)).toBe(true)
      expect(value).not.toBeNull()
    }
  })

  it('does not publish the platform ramp itself', async () => {
    // The org's own share is what the customer operates against. The platform
    // ceiling is an operator control on a shared resource, and a field that
    // quietly started carrying it would put every tenant's capacity on every
    // customer's billing page.
    const body = await (await get({ token: 't' })).json()
    expect(Object.keys(body).sort()).toEqual([
      'deliverableMonthly',
      'hourLimit',
      'hourResetMs',
      'hourUsed',
      'paced',
      'perSend',
    ])
    expect(JSON.stringify(body)).not.toContain(
      String(EMAIL_SEND_RATE_DEFAULT_PER_HOUR),
    )
  })

  it('answers 500 rather than a partial reading when the counter fails', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('token service down'))
    expect((await get({ token: 't' })).status).toBe(500)
  })
})
