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
 *
 * @jest-environment node
 */

/**
 * "Used by" on a function names the workflows that call it, read through the
 * index of the plugin that keeps workflows (AGL-3080).
 *
 * A site's workflows are the workflows plugin's records. The scan asks the
 * `workflow` index for the site's live ones, with each one's steps among the
 * facts, and never reads the plugin's collection itself: where no plugin keeps
 * workflows in this process, no workflow depends on anything.
 *
 * The index here is registered under the owner's id by this spec, as the
 * plugin's server declarations register it at boot — an app spec reaches a
 * plugin only through the generated manifests, never by importing it.
 */

import {
  registerPluginRecordIndex,
  type PluginRecordIndex,
} from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'

const mockCollectionsRead: string[] = []

jest.mock('@aglyn/tenant-data-admin', () => {
  const hostSnapshot = {
    exists: true,
    get: (field: string) =>
      field === 'memberRoles' ? { 'uid-admin': 'admin' } : undefined,
    data: () => ({}),
  }
  const emptyCollection = (name: string) => ({
    limit: () => ({
      get: async () => {
        mockCollectionsRead.push(name)
        return { docs: [] }
      },
    }),
  })
  return {
    emailUnverifiedResponse: () =>
      Response.json({ error: 'Email unverified' }, { status: 403 }),
    getOrgForHost: async () => null,
    isImpersonationSession: () => false,
    lockdownRefusal: async () => null,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async () => ({ uid: 'uid-admin', email_verified: true }),
        }),
        firestore: () => ({
          collection: () => ({
            doc: () => ({
              get: async () => hostSnapshot,
              collection: (name: string) => emptyCollection(name),
            }),
          }),
        }),
      }),
    },
  }
})

import { POST } from '../app/api/hosts/where-used/route'

const request = () =>
  new Request('https://app.aglyn.com/api/hosts/where-used', {
    method: 'POST',
    headers: {
      authorization: 'Bearer id-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ hostId: 'site-1', kind: 'function', id: 'fn-1', name: 'rateFor' }),
  })

const listed: Array<{ hostId?: string | null; limit: number }> = []

const workflowIndex: PluginRecordIndex = {
  async list(request) {
    listed.push({ hostId: request.hostId, limit: request.limit })
    return {
      records: [
        {
          id: 'wf-quote',
          name: 'Quote calculator',
          facts: { steps: [{ functionName: 'rateFor', args: ['qty'] }] },
        },
        { id: 'wf-other', name: 'Other', facts: { steps: [{ functionName: 'taxFor' }] } },
        { id: 'wf-odd', name: 'Odd', facts: { steps: 'not a list' } },
      ],
      truncated: false,
    }
  },
  async get() {
    return null
  },
}

describe('/api/hosts/where-used and the workflows that call a function (AGL-3080)', () => {
  beforeEach(() => {
    resetPluginServicesForTests()
    mockCollectionsRead.length = 0
    listed.length = 0
  })

  it('names the workflows whose steps call the function, from the owner’s index', async () => {
    registerPluginRecordIndex('workflow', workflowIndex, { pluginId: 'workflows' })
    const response = await POST(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.dependents).toEqual([
      { type: 'workflow', id: 'wf-quote', name: 'Quote calculator', via: ['name'] },
    ])
    expect(listed).toEqual([{ hostId: 'site-1', limit: 100 }])
    expect(mockCollectionsRead).not.toContain('workflows')
  })

  it('names no workflow, and reads no collection for one, where no plugin keeps workflows', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect((await response.json()).dependents).toEqual([])
    expect(mockCollectionsRead).not.toContain('workflows')
  })
})
