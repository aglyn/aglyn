/**
 * @jest-environment node
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

const mockDuplicateResource = jest.fn()
const mockGetOrgForUser = jest.fn()
const mockHasPermission = jest.fn()

jest.mock('@aglyn/tenant-data-admin/server/duplicate-resource', () => ({
  __esModule: true,
  duplicateResource: (...args: unknown[]) => mockDuplicateResource(...args),
}))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  getOrgForUser: (...args: unknown[]) => mockGetOrgForUser(...args),
  memberHasPermissionOnHost: (...args: unknown[]) => mockHasPermission(...args),
}))

import { DUPLICABLE_HOST_RESOURCE_KINDS } from '@aglyn/aglyn/app-utils/duplicate-resource'
import type { AiGateContext } from '../runtime/ai-gate'
import {
  AI_DUPLICATE_RESOURCE_TOOL,
  parseAiDuplicateResourceInput,
  runAiDuplicateResourceTool,
} from './ai-duplicate-resource-tool'

let hostDoc: Record<string, unknown> | null

/** ONE held gate context, as the ladder hands a door its answer. */
const gate = {
  uid: 'u-1',
  decoded: { uid: 'u-1', email: 'writer@example.test' },
  staff: false,
  orgId: 'org-1',
  org: { plan: 'pro' },
  firestore: {
    collection: () => ({
      doc: () => ({
        get: async () => ({
          exists: hostDoc !== null,
          get: (field: string) => hostDoc?.[field],
        }),
      }),
    }),
  },
  rate: {},
  reservation: { allowed: true },
} as unknown as AiGateContext

const call = (input: Record<string, unknown>, over: Partial<AiGateContext> = {}) =>
  runAiDuplicateResourceTool({ gate: { ...gate, ...over } as AiGateContext, hostId: 'host-1' }, input)

beforeEach(() => {
  jest.clearAllMocks()
  hostDoc = { orgId: 'org-1', memberRoles: { 'u-1': 'editor' } }
  mockGetOrgForUser.mockResolvedValue({ orgId: 'org-1', org: {}, member: { role: 'editor', allHosts: true } })
  mockHasPermission.mockResolvedValue(true)
  mockDuplicateResource.mockResolvedValue({
    ok: true,
    id: 'copy-1',
    versionId: 'version-1',
    name: 'Copy of Home',
  })
})

/**
 * The `duplicate_resource` tool (AGL-2984): the schema a model is offered,
 * and the gates a copy climbs before core's `duplicateResource` makes it.
 */
describe('the duplicate_resource tool', () => {
  it('offers every host kind the duplicate catalog copies, strict, with every key required', () => {
    const schema = AI_DUPLICATE_RESOURCE_TOOL.inputSchema as {
      properties: { kind: { enum: string[] } }
      required: string[]
      additionalProperties: boolean
    }
    expect(AI_DUPLICATE_RESOURCE_TOOL.name).toBe('duplicate_resource')
    expect(AI_DUPLICATE_RESOURCE_TOOL.strict).toBe(true)
    expect(schema.properties.kind.enum).toEqual([...DUPLICABLE_HOST_RESOURCE_KINDS])
    expect(schema.required).toEqual(['kind', 'sourceId', 'name'])
    expect(schema.additionalProperties).toBe(false)
  })

  it('reads a call, and refuses one naming a kind or a source it cannot copy', () => {
    expect(parseAiDuplicateResourceInput({ kind: 'screen', sourceId: ' s-1 ', name: null })).toEqual({
      kind: 'screen',
      sourceId: 's-1',
      name: null,
    })
    expect(parseAiDuplicateResourceInput({ kind: 'screen', sourceId: 's-1', name: '  ' })?.name).toBeNull()
    expect(parseAiDuplicateResourceInput({ kind: 'campaign', sourceId: 's-1', name: null })).toBeNull()
    expect(parseAiDuplicateResourceInput({ kind: 'screen', sourceId: 'a/b', name: null })).toBeNull()
    expect(parseAiDuplicateResourceInput({ kind: 'screen', sourceId: '', name: null })).toBeNull()
  })

  it('makes the copy through core, as the admitted person, with no attempt key', async () => {
    const outcome = await call({ kind: 'layout', sourceId: 'layout-1', name: 'Blog chrome' })
    expect(outcome).toEqual({
      ok: true,
      kind: 'layout',
      id: 'copy-1',
      versionId: 'version-1',
      name: 'Copy of Home',
    })
    expect(mockHasPermission).toHaveBeenCalledWith(
      'org-1',
      'host-1',
      { role: 'editor', allHosts: true },
      'ai.generate',
    )
    expect(mockDuplicateResource).toHaveBeenCalledWith('layout', {
      orgId: 'org-1',
      hostId: 'host-1',
      sourceId: 'layout-1',
      name: 'Blog chrome',
      uid: 'u-1',
      email: 'writer@example.test',
      org: { plan: 'pro' },
      attemptKey: null,
    })
  })

  it('refuses without generate permission, without a writing role, and on another workspace’s site', async () => {
    mockHasPermission.mockResolvedValueOnce(false)
    expect(await call({ kind: 'screen', sourceId: 's-1', name: null })).toMatchObject({
      ok: false,
      status: 403,
    })
    hostDoc = { orgId: 'org-1', memberRoles: { 'u-1': 'viewer' } }
    expect(await call({ kind: 'screen', sourceId: 's-1', name: null })).toEqual({
      ok: false,
      status: 403,
      error: 'Editing requires the editor role',
    })
    hostDoc = { orgId: 'org-2', memberRoles: { 'u-1': 'admin' } }
    expect(await call({ kind: 'screen', sourceId: 's-1', name: null })).toMatchObject({
      ok: false,
      status: 404,
    })
    expect(mockDuplicateResource).not.toHaveBeenCalled()
  })

  it('refuses a reservation the band or caps did not admit, and relays core’s own refusal', async () => {
    expect(
      await call(
        { kind: 'screen', sourceId: 's-1', name: null },
        { reservation: { allowed: false } as never },
      ),
    ).toMatchObject({ ok: false, status: 429 })
    expect(mockDuplicateResource).not.toHaveBeenCalled()
    mockDuplicateResource.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Your plan includes 3 layouts — upgrade in Billing for more',
    })
    expect(await call({ kind: 'layout', sourceId: 'layout-1', name: null })).toEqual({
      ok: false,
      status: 403,
      error: 'Your plan includes 3 layouts — upgrade in Billing for more',
    })
  })

  it('lets staff past the permission rung, never past the writing role', async () => {
    hostDoc = { orgId: 'org-1', memberRoles: {} }
    expect(
      await call({ kind: 'screen', sourceId: 's-1', name: null }, { staff: true }),
    ).toMatchObject({ ok: false, status: 403, error: 'Editing requires the editor role' })
    expect(mockGetOrgForUser).not.toHaveBeenCalled()
  })
})
