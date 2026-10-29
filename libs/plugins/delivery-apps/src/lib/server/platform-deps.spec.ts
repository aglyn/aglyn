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
import { registerPluginPermissions } from '@aglyn/aglyn/plugin-manager/plugin-permissions'
import { deliveryAppsGate } from './platform-deps'
import type { DeliveryGateKind } from './routes'

/**
 * THE DELIVERY REGISTER'S GATE ASKS THE KEYS, NOT THE SITE ROLE (AGL-4047).
 *
 * Its services are faked at the module edge (the ID token, the site, the
 * plan, the lockdown, the resolver); the gate itself, the key decision and
 * the refusal copy are the real ones. Each case sets the site's
 * `memberRoles` AGAINST what the resolver answers, so a gate that still read
 * the role would fail one way or the other.
 */

let mockHost: Record<string, unknown> | null
let mockPermissions: Record<string, boolean>
let mockClaims: Record<string, unknown>
let mockResolved: Array<{ uid: string; hostId?: string | null }>

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async (token: string) => {
          if (token === 'expired') throw Object.assign(new Error('Firebase ID token has expired.'), { code: 'auth/id-token-expired' })
          if (token === 'outage') throw Object.assign(new Error('Service unavailable'), { code: 'app/network-error' })
          return { uid: 'member-1', email_verified: true, ...mockClaims }
        },
      }),
    }),
  },
  isEmailVerified: (decoded: { email_verified?: boolean }) => decoded.email_verified === true,
  isImpersonationSession: () => false,
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  getOrgForHost: async () => ({ orgId: 'org-1', org: { id: 'org-1' } }),
  getHostDocAdmin: async () => mockHost,
}))
jest.mock('@aglyn/tenant-data-admin/server/lockdown', () => ({
  getLockdownVerdict: async () => null,
  lockdownRefusal: async () => null,
}))
jest.mock('@aglyn/aglyn/app-utils/plan-entitlements', () => ({
  ...jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements'),
  checkEntitlement: () => true,
}))
jest.mock('@aglyn/aglyn/plugin-manager/enabled-plugins', () => ({
  ...jest.requireActual('@aglyn/aglyn/plugin-manager/enabled-plugins'),
  resolveHostEnabledPlugins: () => ['commerce', 'delivery-apps'],
}))
// The deployment offers a service, whichever it is.
jest.mock('./config', () => ({
  ...jest.requireActual('./config'),
  offeredServices: () => [jest.requireActual('../model/delivery-apps').DELIVERY_SERVICE_IDS[0]],
}))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async (uid: string, context: { hostId?: string | null }) => {
    mockResolved.push({ uid, hostId: context.hostId })
    return { permissions: mockPermissions }
  },
}))

const HOST = 'host-1'

beforeAll(() => {
  // The catalog names the register's keys as commerce declares them.
  registerPluginPermissions([
    {
      key: 'managePos',
      pluginId: 'commerce',
      label: 'Use the point of sale',
      description: 'Open the point of sale.',
      defaults: { admin: true, editor: true, viewer: false },
      groupLabel: 'Commerce',
    },
    {
      key: 'posSell',
      pluginId: 'commerce',
      label: 'Sell at the register',
      description: 'Ring up sales and take payment at the register.',
      defaults: { admin: true, editor: true, viewer: false },
      groupLabel: 'Commerce',
      refines: 'managePos',
    },
  ])
})

beforeEach(() => {
  mockHost = { memberRoles: {} }
  mockPermissions = {}
  mockClaims = {}
  mockResolved = []
})

const request = (token = 'member') =>
  new Request(`https://console.example.com/api/delivery-apps/queue?hostId=${HOST}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  })

async function ask(kind: DeliveryGateKind, token?: string): Promise<{ status: number; error?: string }> {
  const answer = await deliveryAppsGate(request(token), kind)
  if (!(answer instanceof Response)) return { status: 200 }
  return { status: answer.status, error: ((await answer.json()) as { error?: string }).error }
}

describe('the delivery register’s gate (AGL-4047)', () => {
  it('admits the register’s keys as resolved for the site, whatever the site role says', async () => {
    // A site viewer the workspace grants the register works it.
    mockHost = { memberRoles: { 'member-1': 'viewer' } }
    mockPermissions = { managePos: true, posSell: true }
    expect(await ask('register')).toEqual({ status: 200 })
    expect(await ask('registerOrder')).toEqual({ status: 200 })
    expect(mockResolved).toEqual([
      { uid: 'member-1', hostId: HOST },
      { uid: 'member-1', hostId: HOST },
    ])
  })

  it('refuses a site admin a role takes the register from, naming the permission', async () => {
    mockHost = { memberRoles: { 'member-1': 'admin' } }
    mockPermissions = { managePos: false, posSell: false }
    const refusal = { status: 403, error: 'Your role does not include "Use the point of sale" — ask an organization admin' }
    expect(await ask('register')).toEqual(refusal)
    expect(await ask('registerOrder')).toEqual(refusal)
  })

  it('shows the queue to a member who may not sell, and refuses them an order, naming "Sell at the register"', async () => {
    mockHost = { memberRoles: { 'member-1': 'editor' } }
    mockPermissions = { managePos: true, posSell: false }
    expect(await ask('register')).toEqual({ status: 200 })
    expect(await ask('registerOrder')).toEqual({
      status: 403,
      error: 'Your role does not include "Sell at the register" — ask an organization admin',
    })
  })

  it('keeps the settings door on "Manage site settings", and never asks the register’s keys there', async () => {
    mockHost = { memberRoles: { 'member-1': 'editor' } }
    mockPermissions = { managePos: true, posSell: true }
    expect((await ask('settings')).status).toBe(403)
    expect(mockResolved).toEqual([])
  })

  it('lets staff through without asking, answers an expired sign-in 401, and never calls an outage a bad sign-in', async () => {
    mockClaims = { staff: true }
    expect(await ask('registerOrder')).toEqual({ status: 200 })
    expect(mockResolved).toEqual([])
    mockClaims = {}
    expect((await ask('register', 'expired')).status).toBe(401)
    await expect(ask('register', 'outage')).rejects.toThrow('Service unavailable')
  })
})
