/**
 * @jest-environment node
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
 * AGL-4117 — when the browser's claim of a held sign-up name fails, the name
 * the person typed still names the workspace.
 */

const mockVerifyIdToken = jest.fn()
const mockCreateOrganization = jest.fn()
const mockRead = jest.fn()
const mockSettle = jest.fn()
const mockAnnounce = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  recordSignupAttempt: () => undefined,
  firebaseAdmin: {
    app: () => ({ auth: () => ({ verifyIdToken: mockVerifyIdToken }) }),
  },
  consumeRateLimit: jest.fn(async () => ({
    allowed: true,
    limit: 3,
    remaining: 2,
    resetMs: Date.now() + 3_600_000,
    degraded: false,
  })),
  createOrganization: (...args: unknown[]) => mockCreateOrganization(...args),
  emailUnverifiedResponse: () => Response.json({}, { status: 403 }),
  freeWorkspaceCapRefusalResponse: () => null,
  isImpersonationSession: () => false,
  lockdownRefusal: async () => null,
  OrgSlugTakenError: class OrgSlugTakenError extends Error {},
  recordSignupRefusal: () => undefined,
}))
jest.mock('@aglyn/tenant-data-admin/server/account-acquisition', () => ({
  recordSignUpAcquisition: jest.fn(async () => undefined),
}))
jest.mock('@aglyn/tenant-data-admin/server/signup-held-workspace', () => ({
  readHeldSignUpWorkspaceName: (...args: unknown[]) => mockRead(...args),
  settleHeldSignUpWorkspace: (...args: unknown[]) => mockSettle(...args),
}))
jest.mock('../app/api/_lib/growth-announcements', () => ({
  announceNewWorkspace: (...args: unknown[]) => mockAnnounce(...args),
}))
jest.mock('../constants/sanctions-geo', () => ({
  enforceSanctionsGeo: () => null,
}))

import { POST } from '../app/api/orgs/create/route'

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://app.aglyn.com/api/orgs/create', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )

describe('AGL-4117 · /api/orgs/create honors a held typed name', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockVerifyIdToken.mockResolvedValue({ uid: 'u-1', email_verified: true })
    mockCreateOrganization.mockResolvedValue('org-1')
    mockRead.mockResolvedValue(null)
  })

  it('names and addresses the workspace from the hold, then spends it', async () => {
    mockRead.mockResolvedValue('Specialty Alloys')
    const response = await post({ name: 'Omar Faruq', derived: true })
    expect(mockCreateOrganization.mock.calls[0][0]).toMatchObject({
      name: 'Specialty Alloys',
      slug: 'specialty-alloys',
    })
    expect(await response.json()).toMatchObject({ slug: 'specialty-alloys' })
    expect(mockSettle).toHaveBeenCalledWith('u-1')
  })

  it('keeps the slug of a retry after a taken address', async () => {
    mockRead.mockResolvedValue('Specialty Alloys')
    await post({ name: 'Omar Faruq', slug: 'omar-faruq-x1y2', derived: true })
    expect(mockCreateOrganization.mock.calls[0][0]).toMatchObject({
      name: 'Specialty Alloys',
      slug: 'omar-faruq-x1y2',
    })
  })

  it('uses the derived name when nothing is held', async () => {
    await post({ name: 'Omar Faruq', derived: true })
    expect(mockCreateOrganization.mock.calls[0][0]).toMatchObject({
      name: 'Omar Faruq',
      slug: 'omar-faruq',
    })
    expect(mockSettle).not.toHaveBeenCalled()
  })

  it('never reads the hold for a name the person chose', async () => {
    await post({ name: 'Second Workspace' })
    expect(mockRead).not.toHaveBeenCalled()
    expect(mockCreateOrganization.mock.calls[0][0]).toMatchObject({
      name: 'Second Workspace',
    })
  })
})
