/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
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
 * Workspace creation is the sign-up acquisition's backstop (AGL-3674).
 *
 * The workspace copies its creator's acquisition record at birth. The sign-up
 * page records it first, but a page torn down by a navigation before that
 * call went out recorded nothing — which is how every Google sign-up's
 * workspace came to say `unknown`. So the route asks the writer once more,
 * BEFORE it creates the workspace, with the first touch the page sent or the
 * request's cookie. The writer decides from the verified token and the auth
 * record whether there is anything to write; these cases pin only that the
 * route asks, asks first, and never lets the answer cost the workspace.
 */

const mockVerifyIdToken = jest.fn()
const mockCreateOrganization = jest.fn()
const mockRecordSignUpAcquisition = jest.fn()
const mockSteps: string[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  recordSignupAttempt: () => undefined,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
    }),
  },
  consumeRateLimit: jest.fn(async () => ({
    allowed: true,
    limit: 3,
    remaining: 2,
    resetMs: Date.now() + 60 * 60 * 1000,
    degraded: false,
  })),
  createOrganization: (...args: unknown[]) => {
    mockSteps.push('workspace')
    return mockCreateOrganization(...args)
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email to continue' }, { status: 403 }),
  isImpersonationSession: (decoded: Record<string, unknown>) =>
    typeof decoded['impersonatedBy'] === 'string',
  lockdownRefusal: async () => null,
  OrgSlugTakenError: class OrgSlugTakenError extends Error {},
}))

jest.mock('@aglyn/tenant-data-admin/server/account-acquisition', () => ({
  __esModule: true,
  recordSignUpAcquisition: (...args: unknown[]) => {
    mockSteps.push('acquisition')
    return mockRecordSignUpAcquisition(...args)
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  isSignupCanaryOrgSlug: () => false,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
      cookie: request.headers.get('cookie') ?? undefined,
      host: 'app.aglyn.com',
    },
  }),
  generateOrgSlug: (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
  isValidOrgSlug: (slug: string) => /^[a-z0-9-]{3,30}$/.test(slug),
  resolveIdpDisplayName: () => 'Ada Lovelace',
}))

jest.mock('../app/api/_lib/growth-announcements', () => ({
  __esModule: true,
  announceNewWorkspace: async () => undefined,
}))

jest.mock('../constants/sanctions-geo', () => ({
  __esModule: true,
  enforceSanctionsGeo: () => null,
}))

import { POST } from '../app/api/orgs/create/route'

const TOUCH = { v: 1, at: 1, host: 'example.com', path: '/pricing', ref: 'www.g2.com' }

const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  POST(
    new Request('https://app.aglyn.com/api/orgs/create', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', ...headers },
      body: JSON.stringify({ name: 'Ada Lovelace', ...body }),
    }),
  )

const googleToken = (extra: Record<string, unknown> = {}) => ({
  uid: 'u-google',
  email: 'ada@example.com',
  email_verified: true,
  firebase: { sign_in_provider: 'google.com' },
  ...extra,
})

beforeEach(() => {
  jest.clearAllMocks()
  mockSteps.length = 0
  mockCreateOrganization.mockResolvedValue('org-new')
  mockRecordSignUpAcquisition.mockResolvedValue({ status: 'recorded' })
  mockVerifyIdToken.mockResolvedValue(googleToken())
})

describe('AGL-3674 · workspace creation records a missing sign-up acquisition first', () => {
  it('asks the writer, with the verified provider and the page\'s touch, BEFORE the workspace', async () => {
    const response = await post({ touch: TOUCH })

    expect(response.status).toBe(200)
    expect(mockSteps).toEqual(['acquisition', 'workspace'])
    expect(mockRecordSignUpAcquisition).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'u-google',
        provider: 'google.com',
        email: 'ada@example.com',
        touch: TOUCH,
      }),
    )
  })

  it('falls back to the first-touch cookie when the page sent none', async () => {
    const cookie = `aglyn_ft=${encodeURIComponent(JSON.stringify(TOUCH))}`
    await post({}, { cookie })

    expect(mockRecordSignUpAcquisition).toHaveBeenCalledWith(
      expect.objectContaining({ touch: TOUCH }),
    )
  })

  it('still creates the workspace when the record cannot be written', async () => {
    mockRecordSignUpAcquisition.mockRejectedValue(new Error('firestore down'))
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await post({ touch: TOUCH })

    expect(response.status).toBe(200)
    expect(mockCreateOrganization).toHaveBeenCalled()
    quiet.mockRestore()
  })

  it('asks nothing for a staff member acting as somebody', async () => {
    mockVerifyIdToken.mockResolvedValue(googleToken({ impersonatedBy: 'staff-1' }))

    await post({ touch: TOUCH })

    expect(mockRecordSignUpAcquisition).not.toHaveBeenCalled()
    expect(mockCreateOrganization).toHaveBeenCalled()
  })
})
