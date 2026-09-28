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
 * A suspended site cannot take a payment by naming a different site to the
 * lockdown gate than the one its checkout charges (AGL-3360).
 *
 * The dispatcher read `?hostId=` first and parsed only a JSON body; every
 * storefront, booking and reservation handler reads `body.hostId`, with
 * urlencoded bodies handed to it as fields. Two requests therefore reached a
 * locked site's checkout with no lockdown in the way:
 *
 * - `POST /api/commerce/checkout?hostId=<open site>` + `{"hostId": <locked>}`
 * - `POST /api/commerce/checkout` as a form, `hostId=<locked>&productId=…`
 *
 * The assertion surface is the handler's call count and the host the
 * lockdown gate was asked about, not only the status.
 */

/** Sites under an active lock. */
const mockLocked = new Set<string>()
/** Every hostId the lockdown gate was asked about. */
let mockLockdownAsked: string[]
/** Requests that reached the plugin handler. */
let mockHandlerCalls: number

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: jest.fn(async (ids: string[]) => [...ids]),
  getHostDisabledPlugins: jest.fn(async () => []),
  getOrgForHost: jest.fn(async () => ({
    orgId: 'org-1',
    org: { enabledPlugins: ['commerce'] },
  })),
  visitorWriteRefusal: jest.fn(async ({ hostId }: { hostId: string }) => {
    mockLockdownAsked.push(hostId)
    return mockLocked.has(hostId)
      ? Response.json({ error: 'locked' }, { status: 423 })
      : null
  }),
  visitorWriteRateLimitRefusal: jest.fn(async () => null),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/collection-entry-date',
  ),
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/plugin-manager/enabled-plugins',
  ),
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plugin-api-cross-origin',
  ),
  lockdownPausedSurfaceForPluginApiPath: jest.fn(() => 'checkout'),
  pluginIdForRegisteredApiPath: jest.fn(() => 'commerce'),
  resolvePluginApiMatch: jest.fn(() => ({
    route: { path: 'commerce/checkout' },
    params: {},
  })),
  runPluginApiMatch: jest.requireActual('@aglyn/aglyn/app-utils/api-plugins')
    .runPluginApiMatch,
  resolvePluginApiRequestSubject: jest.requireActual(
    '@aglyn/aglyn/app-utils/api-plugins',
  ).resolvePluginApiRequestSubject,
  runLegacyHandler: jest.fn(async () => {
    mockHandlerCalls += 1
    return Response.json({ url: 'https://checkout.stripe.com/c/pay/x' })
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
    pluginIdForApiPath: jest.fn(() => 'commerce'),
  },
}))

import { POST } from '../app/api/[...pluginApi]/route'

const params = Promise.resolve({ pluginApi: ['commerce', 'checkout'] })
const URL_BASE = 'https://shop.aglyn.app/api/commerce/checkout'

beforeEach(() => {
  mockLocked.clear()
  mockLocked.add('locked-site')
  mockLockdownAsked = []
  mockHandlerCalls = 0
})

describe('tenant plugin API dispatcher — the lockdown gates the site the handler charges', () => {
  it('refuses a request that names an open site in the query and a locked one in the body', async () => {
    const response = await POST(
      new Request(`${URL_BASE}?hostId=open-site`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hostId: 'locked-site', productId: 'p1' }),
      }),
      { params },
    )

    expect(response.status).toBe(400)
    expect(mockHandlerCalls).toBe(0)
  })

  it('gates a urlencoded checkout on the site its fields name', async () => {
    const response = await POST(
      new Request(URL_BASE, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'hostId=locked-site&productId=p1',
      }),
      { params },
    )

    expect(mockLockdownAsked).toEqual(['locked-site'])
    expect(response.status).toBe(423)
    expect(mockHandlerCalls).toBe(0)
  })

  it('gates a JSON body sent as text/plain, which the handler parses itself', async () => {
    const response = await POST(
      new Request(URL_BASE, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ hostId: 'locked-site', productId: 'p1' }),
      }),
      { params },
    )

    expect(response.status).toBe(423)
    expect(mockHandlerCalls).toBe(0)
  })

  it('still serves an open site whose query and body agree', async () => {
    const response = await POST(
      new Request(`${URL_BASE}?hostId=open-site`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hostId: 'open-site', productId: 'p1' }),
      }),
      { params },
    )

    expect(mockLockdownAsked).toEqual(['open-site'])
    expect(response.status).toBe(200)
    expect(mockHandlerCalls).toBe(1)
  })
})
