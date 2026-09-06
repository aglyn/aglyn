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
 * `crm/org-activity` (AGL-2634): the one door a client-direct act at the
 * organization level has into `orgs/{orgId}/activity`, which the rules close
 * to every client. What it must hold: the line names the VERIFIED caller,
 * never a uid the body claims; a site collaborator is refused whatever
 * permission their site role carries; the target is one of the CRM's own
 * record kinds and nothing the org feed holds for its own reasons.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'

const ORG = 'org-1'
let mockDecoded: Record<string, unknown> = { uid: 'u-1', email: 'ada@acme.test' }
let mockPermissions: Record<string, unknown> = {
  orgId: ORG,
  role: 'editor',
  isOwner: false,
  permissions: { 'data.manage': true },
  orgWide: true,
  hostRole: 'editor',
}
let orgs: Record<string, Record<string, unknown>> = { [ORG]: { $id: ORG, plan: 'starter' } }
const mockVerifyIdToken = jest.fn(async () => mockDecoded)
const mockResolveOrgPermissions = jest.fn(async () => mockPermissions)
const mockLogOrgActivity = jest.fn(async () => undefined)

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: (...args: unknown[]) => (mockResolveOrgPermissions as any)(...args),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => (mockVerifyIdToken as any)(...args) }),
    }),
  },
  getOrgDoc: async (orgId: string) => orgs[orgId] ?? null,
  logOrgActivity: (...args: unknown[]) => (mockLogOrgActivity as any)(...args),
}))

import { CRM_ORG_ACTIVITY_ROUTE, crmOrgActivityHandler } from './org-activity'

async function call(
  body: unknown,
  options: { method?: string; token?: string | null } = {},
) {
  const { method = 'POST', token = 'token' } = options
  let status = 0
  let answer: any
  const res = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      answer = value
    },
    setHeader: () => undefined,
    send: () => undefined,
  } as unknown as PluginApiResponse
  const req = {
    method,
    body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    query: {},
  } as unknown as PluginApiRequest
  await crmOrgActivityHandler(req, res)
  return { status, answer }
}

const good = {
  orgId: ORG,
  action: 'Owner set on 3 deals',
  target: { type: 'deal', name: '3 deals' },
}

beforeEach(() => {
  mockDecoded = { uid: 'u-1', email: 'ada@acme.test' }
  mockPermissions = {
    orgId: ORG,
    role: 'editor',
    isOwner: false,
    permissions: { 'data.manage': true },
    orgWide: true,
    hostRole: 'editor',
  }
  orgs = { [ORG]: { $id: ORG, plan: 'starter' } }
  mockLogOrgActivity.mockClear()
  mockResolveOrgPermissions.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('crm/org-activity', () => {
  it('is registered under the name the client posts to', () => {
    expect(CRM_ORG_ACTIVITY_ROUTE).toBe('crm/org-activity')
  })

  it('appends one line naming the verified caller, resolved by the org the body names', async () => {
    const { status, answer } = await call({ ...good, actorId: 'somebody-else' })
    expect(status).toBe(200)
    expect(answer).toEqual({ ok: true })
    expect(mockResolveOrgPermissions).toHaveBeenCalledWith('u-1', { orgId: ORG })
    expect(mockLogOrgActivity).toHaveBeenCalledTimes(1)
    expect(mockLogOrgActivity).toHaveBeenCalledWith(
      ORG,
      { uid: 'u-1', email: 'ada@acme.test' },
      'Owner set on 3 deals',
      { type: 'deal', name: '3 deals' },
    )
  })

  it('carries the target id when the line names one record, and trims what it carries', async () => {
    await call({
      orgId: ORG,
      action: `  Merged contact  `,
      target: { type: 'contact', id: ' c-1 ', name: '' },
    })
    expect(mockLogOrgActivity).toHaveBeenCalledWith(
      ORG,
      expect.anything(),
      'Merged contact',
      { type: 'contact', id: 'c-1' },
    )
  })

  it('refuses a site-scoped member whatever their site role, and an org-wide one without data.manage', async () => {
    mockPermissions = { ...mockPermissions, orgWide: false, hostRole: 'admin' }
    expect((await call(good)).status).toBe(403)
    mockPermissions = {
      ...mockPermissions,
      orgWide: true,
      permissions: { 'data.manage': false },
    }
    expect((await call(good)).status).toBe(403)
    // A membership resolved in ANOTHER org is not reach in this one.
    mockPermissions = { ...mockPermissions, orgId: 'org-2', permissions: { 'data.manage': true } }
    expect((await call(good)).status).toBe(403)
    expect(mockLogOrgActivity).not.toHaveBeenCalled()
  })

  it('admits staff whatever the roster says', async () => {
    mockDecoded = { ...mockDecoded, staff: true }
    mockPermissions = { ...mockPermissions, orgWide: false, permissions: {} }
    expect((await call(good)).status).toBe(200)
    expect(mockLogOrgActivity).toHaveBeenCalledTimes(1)
  })

  it('refuses a target that is not a CRM record kind', async () => {
    const { status, answer } = await call({ ...good, target: { type: 'member', id: 'u-2' } })
    expect(status).toBe(400)
    expect(answer.error).toMatch(/record kind/)
    expect(mockLogOrgActivity).not.toHaveBeenCalled()
  })

  it('answers the shape refusals before reading anything', async () => {
    expect((await call(good, { method: 'GET' })).status).toBe(405)
    expect((await call({ orgId: ORG, target: good.target })).status).toBe(400)
    expect((await call({ orgId: ORG, action: 'x' })).status).toBe(400)
    expect((await call({ action: 'x', target: good.target })).status).toBe(400)
    expect((await call(good, { token: null })).status).toBe(401)
    expect(mockResolveOrgPermissions).not.toHaveBeenCalled()
    expect(mockLogOrgActivity).not.toHaveBeenCalled()
  })

  it('answers reach before existence: an org the caller does not reach is refused, one they reach but which is gone is unknown', async () => {
    // The resolver fails closed for an org the caller is not on the roster
    // of, so an unknown org and another org's roster answer the same 403 —
    // a probe cannot tell them apart.
    expect((await call({ ...good, orgId: 'nope' })).status).toBe(403)
    mockPermissions = { ...mockPermissions, orgId: 'nope' }
    const gone = await call({ ...good, orgId: 'nope' })
    expect(gone.status).toBe(404)
    expect(gone.answer.error).toBe('Unknown organization')
    expect(mockLogOrgActivity).not.toHaveBeenCalled()
  })
})
