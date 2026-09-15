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

import {
  listPluginApiRoutes,
  registerPluginApiRoute,
  resolvePluginApiMatch,
  resolvePluginApiRequestSubject,
  unregisterPluginApiRoute,
} from './api-plugins'

/**
 * A route's declared release subject (AGL-2978), as the registry answers it.
 *
 * The dispatchers call `resolvePluginApiRequestSubject` in front of their
 * release gate, so what matters is exactly what this returns: the subject a
 * route declared for THIS path, nothing for an undeclared route, and nothing
 * — never an exception — for a resolver that could not read its request.
 */

const request = (url: string, init?: RequestInit) => new Request(url, init)

describe('plugin API registry — a route-declared subject', () => {
  afterEach(() => {
    for (const path of listPluginApiRoutes()) unregisterPluginApiRoute(path)
  })

  it('answers null for a route that declared no subject, and for no route at all', async () => {
    registerPluginApiRoute('events/list', jest.fn())
    await expect(
      resolvePluginApiRequestSubject('events/list', request('https://x.example/api/events/list')),
    ).resolves.toBeNull()
    await expect(
      resolvePluginApiRequestSubject('nope/missing', request('https://x.example/api/nope/missing')),
    ).resolves.toBeNull()
  })

  it('answers what the route read, for an exact path and for a `:name` pattern', async () => {
    const subject = jest.fn((incoming: Request) => ({
      orgId: new URL(incoming.url).searchParams.get('orgId'),
    }))
    registerPluginApiRoute('outreach/mailboxes/list', jest.fn(), { subject })
    registerPluginApiRoute('outreach/mailboxes/:mailboxId/pause', jest.fn(), { subject })

    await expect(
      resolvePluginApiRequestSubject(
        '/outreach/mailboxes/list/',
        request('https://x.example/api/outreach/mailboxes/list?orgId=org-1'),
      ),
    ).resolves.toEqual({ orgId: 'org-1' })
    await expect(
      resolvePluginApiRequestSubject(
        'outreach/mailboxes/mb-1/pause',
        request('https://x.example/api/outreach/mailboxes/mb-1/pause?orgId=org-2'),
      ),
    ).resolves.toEqual({ orgId: 'org-2' })
    // The same matcher decides the route, so the two cannot disagree.
    expect(resolvePluginApiMatch('outreach/mailboxes/mb-1/pause')?.params).toEqual({
      mailboxId: 'mb-1',
    })
  })

  it('carries a uid only when the route named one', async () => {
    registerPluginApiRoute('outreach/callback', jest.fn(), {
      subject: () => ({ orgId: 'org-1', uid: 'member-1' }),
    })
    await expect(
      resolvePluginApiRequestSubject('outreach/callback', request('https://x.example/api/outreach/callback')),
    ).resolves.toEqual({ orgId: 'org-1', uid: 'member-1' })
  })

  it('reads a clone, leaving the body for the handler', async () => {
    registerPluginApiRoute('outreach/connect', jest.fn(), {
      subject: async (incoming) => {
        const body = (await incoming.json()) as { orgId: string }
        return { orgId: body.orgId }
      },
    })
    const original = request('https://x.example/api/outreach/connect', {
      method: 'POST',
      body: JSON.stringify({ orgId: 'org-3' }),
    })
    await expect(resolvePluginApiRequestSubject('outreach/connect', original)).resolves.toEqual({
      orgId: 'org-3',
    })
    await expect(original.json()).resolves.toEqual({ orgId: 'org-3' })
  })

  it('answers null when the resolver throws or names nothing usable', async () => {
    registerPluginApiRoute('a/throws', jest.fn(), {
      subject: () => {
        throw new Error('unreadable')
      },
    })
    registerPluginApiRoute('a/path-shaped', jest.fn(), {
      subject: () => ({ orgId: 'orgs/other/hosts', uid: '' }),
    })
    registerPluginApiRoute('a/empty', jest.fn(), { subject: () => ({ orgId: null }) })
    for (const path of ['a/throws', 'a/path-shaped', 'a/empty']) {
      await expect(
        resolvePluginApiRequestSubject(path, request(`https://x.example/api/${path}`)),
      ).resolves.toBeNull()
    }
  })

  it('forgets a subject when the route is registered again without one, or removed', async () => {
    const path = 'outreach/re-registered'
    registerPluginApiRoute(path, jest.fn(), { subject: () => ({ orgId: 'org-1' }) })
    registerPluginApiRoute(path, jest.fn())
    await expect(
      resolvePluginApiRequestSubject(path, request(`https://x.example/api/${path}`)),
    ).resolves.toBeNull()

    registerPluginApiRoute(path, jest.fn(), { subject: () => ({ orgId: 'org-1' }) })
    unregisterPluginApiRoute(path)
    await expect(
      resolvePluginApiRequestSubject(path, request(`https://x.example/api/${path}`)),
    ).resolves.toBeNull()
  })
})
