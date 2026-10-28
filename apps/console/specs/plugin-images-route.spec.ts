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

/**
 * A plugin route that draws images runs in its own function (AGL-4048).
 *
 * `sharp`'s native library is 17 MB, and `next.config.js` ships it beside
 * the plugins' image function (`/api/plugin-images/[...pluginApi]`) and not
 * beside the plugin dispatcher, whose cold start every plugin door pays. So
 * a route registered with `images: true` (a machine's door) is served there
 * and nowhere else, and that function serves nothing else: a member's door
 * keeps the dispatcher and its gates.
 *
 * The registry is REAL; the dispatcher's other gates are recorders.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: jest.fn(async (pluginIds: string[]) => [...pluginIds]),
  featureLockdownRefusal: jest.fn(async () => null),
  lockdownRefusal: jest.fn(async () => null),
  consoleApiRateLimitRefusal: jest.fn(async () => null),
  emailUnverifiedResponse: jest.fn(() => Response.json({}, { status: 403 })),
  isEmailVerified: jest.fn(() => true),
  isImpersonationSession: jest.fn(() => false),
  firebaseAdmin: { app: () => ({ auth: () => ({ verifyIdToken: async () => ({ uid: 'member-1' }) }) }) },
  getHostDisabledPlugins: jest.fn(async () => []),
  getHostDocAdmin: jest.fn(async () => ({ id: 'host-1' })),
  getOrgForHost: jest.fn(async () => ({ orgId: 'org-1', org: { enabledPlugins: ['acme-shop'] } })),
}))

jest.mock('@aglyn/aglyn/server', () => {
  const registry = jest.requireActual('@aglyn/aglyn/app-utils/api-plugins')
  return {
    __esModule: true,
    ...jest.requireActual('../../../libs/aglyn/src/lib/plugin-manager/enabled-plugins'),
    lockdownFeaturesForPluginApiPath: jest.fn(() => []),
    pluginIdForRegisteredApiPath: jest.fn(() => 'acme-shop'),
    resolvePluginApiMatch: registry.resolvePluginApiMatch,
    resolvePluginApiRequestSubject: registry.resolvePluginApiRequestSubject,
    runPluginApiMatch: registry.runPluginApiMatch,
    runLegacyHandler: jest.fn(),
  }
})

jest.mock('../utils/remote-server-bundles', () => ({
  __esModule: true,
  ensureRemoteServerBundles: jest.fn(async () => undefined),
}))

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: {
    ensureAll: jest.fn(async () => undefined),
    pluginIdForApiPath: jest.fn(() => 'acme-shop'),
  },
}))

import { registerPluginApiRoute, unregisterPluginApiRoute } from '@aglyn/aglyn/app-utils/api-plugins'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POST as dispatcherPost } from '../app/api/[...pluginApi]/route'
import { POST as imagesPost } from '../app/api/plugin-images/[...pluginApi]/route'

const DRAW_ROUTE = 'acme-shop/draw-screen'
const MEMBER_DRAW_ROUTE = 'acme-shop/member-draw'
const SWEEP_ROUTE = 'acme-shop/nightly-sweep'
const DOOR_ROUTE = 'acme-shop/settings'

const params = (path: string) => Promise.resolve({ pluginApi: path.split('/') })
const post = (route: typeof imagesPost, prefix: string, path: string) =>
  route(new Request(`https://app.example.com/api/${prefix}${path}`, { method: 'POST' }), { params: params(path) })

beforeEach(() => {
  registerPluginApiRoute(DRAW_ROUTE, { web: async () => Response.json({ drawn: true }) }, { machine: true, images: true })
  registerPluginApiRoute(MEMBER_DRAW_ROUTE, { web: async () => Response.json({ drawn: true }) }, { images: true })
  registerPluginApiRoute(SWEEP_ROUTE, { web: async () => Response.json({ swept: true }) }, { machine: true })
  registerPluginApiRoute(DOOR_ROUTE, { web: async () => Response.json({ ok: true }) })
})

afterEach(() => {
  for (const path of [DRAW_ROUTE, MEMBER_DRAW_ROUTE, SWEEP_ROUTE, DOOR_ROUTE]) unregisterPluginApiRoute(path)
})

describe('the plugins’ image function (AGL-4048)', () => {
  it('serves a machine’s route that draws images', async () => {
    const response = await post(imagesPost, 'plugin-images/', DRAW_ROUTE)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ drawn: true })
  })

  it('serves nothing else: a member’s door, a sweep, a door that only says it draws, a GET', async () => {
    for (const path of [DOOR_ROUTE, SWEEP_ROUTE, MEMBER_DRAW_ROUTE, 'acme-shop/nothing-here']) {
      expect((await post(imagesPost, 'plugin-images/', path)).status).toBe(404)
    }
    const get = await imagesPost(new Request(`https://app.example.com/api/plugin-images/${DRAW_ROUTE}`), {
      params: params(DRAW_ROUTE),
    })
    expect(get.status).toBe(405)
  })

  it('is never served by the plugin dispatcher, which serves every other route as before', async () => {
    expect((await post(dispatcherPost, '', DRAW_ROUTE)).status).toBe(404)
    expect((await post(dispatcherPost, '', SWEEP_ROUTE)).status).toBe(200)
    expect((await post(dispatcherPost, '', DOOR_ROUTE)).status).toBe(200)
    // A member's door that says it draws keeps the dispatcher and its gates.
    expect((await post(dispatcherPost, '', MEMBER_DRAW_ROUTE)).status).toBe(200)
  })

  it('declares the lockdown exemption with its reason', () => {
    const source = readFileSync(join(__dirname, '../app/api/plugin-images/[...pluginApi]/route.ts'), 'utf8')
    expect(source).toMatch(/lockdown-423: exempt — server-internal machine calls only/)
  })
})
