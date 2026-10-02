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

/**
 * A DOOR THAT KEEPS ITS OWN VISITOR GATES (AGL-3080).
 *
 * The forms plugin's `POST /api/forms/submit` is served by the tenant's
 * plugin API dispatcher, at the address it always had, and declares
 * `ownVisitorGates`: every visitor gate in front of a submission is a
 * published answer of the route's — whose switch decides it, the notice a
 * site with Forms off gives, the per-(site, address) limit and the monthly
 * ceiling, and where lockdown sits among them. So the dispatcher must hand it
 * the request untouched, and must not hand that to anyone who has not taken
 * the gates on.
 *
 * Each case below names a dispatcher gate and proves it is skipped for the
 * declared route and still applies to the same route undeclared. The gates
 * are real where they are pure (the cross-origin check, the release filter's
 * shape) and observed where they read Firestore.
 */

let mockHandlerCalls = 0

const mockGates = {
  enablementReads: 0,
  lockdownChecks: 0,
  limitChecks: 0,
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: jest.fn(async () => []),
  getHostDisabledPlugins: jest.fn(async () => {
    mockGates.enablementReads += 1
    return ['forms']
  }),
  getOrgForHost: jest.fn(async () => {
    mockGates.enablementReads += 1
    return { orgId: 'org-1', org: { enabledPlugins: [] } }
  }),
  visitorWriteRefusal: jest.fn(async () => {
    mockGates.lockdownChecks += 1
    return Response.json({ error: 'paused' }, { status: 503 })
  }),
  visitorWriteRateLimitRefusal: jest.fn(async () => {
    mockGates.limitChecks += 1
    return Response.json({ error: 'Too many requests' }, { status: 429 })
  }),
  cardPaymentVelocityRefusal: jest.fn(async () => null),
  isYoungWorkspace: jest.fn(() => false),
}))

jest.mock('../utils/remote-server-bundles', () => ({
  __esModule: true,
  ensureRemoteServerBundles: jest.fn(async () => undefined),
}))

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: {
    ensureAll: jest.fn(async () => undefined),
    pluginIdForApiPath: jest.fn(() => 'forms'),
  },
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isPluginOwnVisitorGatesRoute,
  registerPluginApiRoute,
  unregisterPluginApiRoute,
} from '@aglyn/aglyn/app-utils/api-plugins'
import { setRegisteringPluginId } from '@aglyn/aglyn/app-utils/registering-plugin'
import { createPluginLoader } from '@aglyn/aglyn/plugin-manager/plugin-loader'
import { POST } from '../app/api/[...pluginApi]/route'
import { TENANT_PLUGIN_SERVER_MANIFEST } from '../utils/plugins.server.generated'

const DOOR = 'forms/submit'

const door = {
  web: async () => {
    mockHandlerCalls += 1
    return Response.json({ received: true }, { status: 200 })
  },
}

/** Registers the door as `pluginId` would, under the loader's marker. */
function registerAs(pluginId: string, ownVisitorGates: boolean) {
  setRegisteringPluginId(pluginId)
  try {
    registerPluginApiRoute(DOOR, door, ownVisitorGates ? { ownVisitorGates: true } : undefined)
  } finally {
    setRegisteringPluginId(undefined)
  }
}

/** A cross-origin form post naming a site — every gate's favorite request. */
const submission = () =>
  POST(
    new Request(`https://shop.aglyn.app/api/${DOOR}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://elsewhere.example',
        'sec-fetch-site': 'cross-site',
        'x-forwarded-for': '9.9.9.9',
      },
      body: JSON.stringify({ hostId: 'host-1', fields: { email: 'a@b.co' } }),
    }),
    { params: Promise.resolve({ pluginApi: DOOR.split('/') }) },
  )

let errorSpy: jest.SpyInstance

beforeEach(() => {
  mockHandlerCalls = 0
  mockGates.enablementReads = 0
  mockGates.lockdownChecks = 0
  mockGates.limitChecks = 0
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  unregisterPluginApiRoute(DOOR)
  errorSpy.mockRestore()
})

describe('the tenant dispatcher and a door that keeps its own gates', () => {
  it('hands the declared door the request untouched', async () => {
    registerAs('forms', true)
    const response = await submission()
    expect(response.status).toBe(200)
    expect(mockHandlerCalls).toBe(1)
    // Not one of the dispatcher's gates was asked: no site read for the
    // enablement gate, no lockdown, no write limit.
    expect(mockGates).toEqual({ enablementReads: 0, lockdownChecks: 0, limitChecks: 0 })
  })

  it('THE CONTROL: the same door undeclared meets the dispatcher’s gates', async () => {
    // RED CHECK for the case above: without the declaration, the cross-origin
    // check refuses this request before anything else runs.
    registerAs('forms', false)
    const response = await submission()
    expect(response.status).not.toBe(200)
    expect(mockHandlerCalls).toBe(0)
  })

  it('THE CONTROL, past the cross-origin check: enablement answers before the door', async () => {
    registerAs('forms', false)
    const response = await POST(
      new Request(`https://shop.aglyn.app/api/${DOOR}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' },
        body: JSON.stringify({ hostId: 'host-1', fields: { email: 'a@b.co' } }),
      }),
      { params: Promise.resolve({ pluginApi: DOOR.split('/') }) },
    )
    // A site with Forms off: the dispatcher's own 404, not the route's notice.
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
    expect(mockGates.enablementReads).toBeGreaterThan(0)
    expect(mockHandlerCalls).toBe(0)
  })

  it('honors the declaration only from a first-party plugin', async () => {
    // A realm bundle — or any registration not made as a first-party plugin —
    // that skipped lockdown would be a door a paused site keeps open.
    registerAs('acme-listing-123', true)
    expect(isPluginOwnVisitorGatesRoute(DOOR)).toBe(false)
    unregisterPluginApiRoute(DOOR)
    registerPluginApiRoute(DOOR, door, { ownVisitorGates: true })
    expect(isPluginOwnVisitorGatesRoute(DOOR)).toBe(false)
    expect(await submission().then((response) => response.status)).not.toBe(200)
    expect(mockHandlerCalls).toBe(0)
  })
})

describe('the forms plugin’s door', () => {
  it('is registered by the forms plugin’s tenant API surface, keeping its own gates', async () => {
    // The real manifest entry and the real loader, which marks the
    // registration as the forms plugin's.
    const loader = createPluginLoader(
      TENANT_PLUGIN_SERVER_MANIFEST.filter((entry) => entry.id === 'forms'),
    )
    await loader.ensureAll(['tenantApi'])
    expect(isPluginOwnVisitorGatesRoute(DOOR)).toBe(true)
  })

  it('runs lockdown and its own rate limit itself, since the dispatcher does not', () => {
    // What declaring the gates takes on: a paused site must still refuse a
    // submission, and an address must still be limited per site.
    const source = readFileSync(
      join(__dirname, '../../../libs/plugins/forms/src/lib/server/form-submit.ts'),
      'utf8',
    )
    expect(source).toMatch(/await visitorWriteRefusal\(\{\s*hostId,\s*request,\s*surface: 'form',/)
    expect(source).toContain('await consumeRateLimit(`form:${hostId}:${ip}`')
  })
})
