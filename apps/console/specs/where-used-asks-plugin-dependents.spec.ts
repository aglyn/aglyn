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
 * "Used by" names what plugins' records refer to the thing asked about by
 * asking the plugins that keep them (AGL-3080).
 *
 * A workflow calling a function is the workflows plugin's record; a variable
 * computed from a workflow is the logic plugin's. The scan asks every
 * dependents source registered for the kind and reads neither plugin's
 * collection itself: where no plugin keeps such records in this process,
 * nothing of theirs depends on anything. A source that reads part of its
 * records, or fails, makes the answer incomplete rather than wrong.
 *
 * The sources here are registered under their owners' ids by this spec, as
 * the plugins' server declarations register them at boot — an app spec
 * reaches a plugin only through the generated manifests, never by importing it.
 */

import {
  registerPluginDependentsSource,
  type PluginDependentsRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-dependents'
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

const request = (body: Record<string, string>) =>
  new Request('https://app.aglyn.com/api/hosts/where-used', {
    method: 'POST',
    headers: {
      authorization: 'Bearer id-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

const asked: PluginDependentsRequest[] = []

describe('/api/hosts/where-used and the plugins whose records refer to a thing (AGL-3080)', () => {
  beforeEach(() => {
    resetPluginServicesForTests()
    mockCollectionsRead.length = 0
    asked.length = 0
  })

  it('names the workflows that call a function, as the plugin that keeps them answers', async () => {
    registerPluginDependentsSource(
      {
        kinds: ['function'],
        async find(ask) {
          asked.push(ask)
          return {
            dependents: [{ type: 'workflow', id: 'wf-quote', name: 'Quote calculator', via: ['id'] }],
            truncated: false,
          }
        },
      },
      { pluginId: 'workflows' },
    )
    const response = await POST(
      request({ hostId: 'site-1', kind: 'function', id: 'fn-1', name: 'rateFor' }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.dependents).toEqual([
      { type: 'workflow', id: 'wf-quote', name: 'Quote calculator', via: ['id'] },
    ])
    expect(body.complete).toBe(true)
    expect(body.legacyCount).toBe(0)
    expect(asked).toEqual([{ hostId: 'site-1', kind: 'function', id: 'fn-1', name: 'rateFor' }])
    expect(mockCollectionsRead).not.toContain('workflows')
  })

  it('names the variables computed from a workflow, and reads no variables itself', async () => {
    registerPluginDependentsSource(
      {
        kinds: ['workflow'],
        async find() {
          return {
            dependents: [{ type: 'variable', id: 'v-price', name: 'price', via: ['name'] }],
            truncated: false,
          }
        },
      },
      { pluginId: 'logic' },
    )
    const response = await POST(
      request({ hostId: 'site-1', kind: 'workflow', id: 'wf-1', name: 'Quote' }),
    )
    const body = await response.json()
    expect(body.dependents).toEqual([
      { type: 'variable', id: 'v-price', name: 'price', via: ['name'] },
    ])
    expect(body.legacyCount).toBe(1)
    expect(mockCollectionsRead).toEqual([])
  })

  it('names nothing of a plugin’s, and reads no collection for one, where no plugin keeps such records', async () => {
    const response = await POST(
      request({ hostId: 'site-1', kind: 'workflow', id: 'wf-1', name: 'Quote' }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.dependents).toEqual([])
    expect(body.complete).toBe(true)
    expect(mockCollectionsRead).toEqual([])
  })

  it('says the answer is incomplete when a source fails, rather than that nothing uses it', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerPluginDependentsSource(
      {
        kinds: ['workflow'],
        find: async () => {
          throw new Error('storage down')
        },
      },
      { pluginId: 'logic' },
    )
    const response = await POST(
      request({ hostId: 'site-1', kind: 'workflow', id: 'wf-1', name: 'Quote' }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.dependents).toEqual([])
    expect(body.complete).toBe(false)
    spy.mockRestore()
  })
})
