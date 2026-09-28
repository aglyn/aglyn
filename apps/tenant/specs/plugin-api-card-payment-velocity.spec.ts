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
 * The tenant dispatcher holds a visitor's payment door to the card-testing
 * counters (AGL-3363).
 *
 * Before this, a public `POST /api/commerce/checkout` met only the shared
 * 120-writes-a-minute visitor limit, so one script could open 120 real
 * Stripe Checkout Sessions a minute against one shop. A route registered
 * with `{ cardPayment: true }` now meets the per-visitor counter too — and a
 * route that did not declare it (a cart write) does not, so an add-to-cart
 * burst is never mistaken for card testing.
 *
 * The assertion surface is the handler's call count: "the handler never
 * runs" is the claim, because the handler is what opens the payment.
 */

let mockHandlerCalls: number

const rateLimitDocs = new Map<string, Record<string, unknown>>()
const fakeFirestore = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      path: `${name}/${id}`,
      set: async (value: Record<string, unknown>) => {
        const path = `${name}/${id}`
        const prior = rateLimitDocs.get(path) ?? {}
        const next: Record<string, unknown> = { ...prior }
        for (const [field, raw] of Object.entries(value)) {
          const operand = (raw as { operand?: unknown })?.operand
          next[field] =
            typeof operand === 'number' ? (Number(prior[field]) || 0) + operand : raw
        }
        rateLimitDocs.set(path, next)
      },
      get: async () => {
        const path = `${name}/${id}`
        return {
          exists: rateLimitDocs.has(path),
          get: (field: string) => rateLimitDocs.get(path)?.[field],
        }
      },
    }),
  }),
}

jest.mock('./../../../libs/tenant/data/admin/src/lib/server/firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: Object.assign(() => fakeFirestore, {
      FieldValue: { increment: (n: number) => ({ operand: n }) },
    }),
  },
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: Object.assign(() => fakeFirestore, {
      FieldValue: { increment: (n: number) => ({ operand: n }) },
    }),
  },
}))

jest.mock('./../../../libs/tenant/data/admin/src/lib/server/notifications', () => ({
  __esModule: true,
  notifyStaff: jest.fn(async () => undefined),
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const velocity = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/card-payment-velocity',
  )
  return {
    __esModule: true,
    filterEnabledPluginsByReleaseFlags: jest.fn(async (ids: string[]) => [...ids]),
    getHostDisabledPlugins: jest.fn(async () => []),
    getOrgForHost: jest.fn(async () => ({
      orgId: 'org-1',
      // An established workspace: created long before the clock below.
      org: { enabledPlugins: ['commerce'], createdAt: 1_000 },
    })),
    visitorWriteRefusal: jest.fn(async () => null),
    // Not this suite's subject: the ordinary write limit always admits here.
    visitorWriteRateLimitRefusal: jest.fn(async () => null),
    cardPaymentVelocityRefusal: velocity.cardPaymentVelocityRefusal,
    isYoungWorkspace: jest.fn(() => false),
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/collection-entry-date'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/lockdown'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/plugin-manager/enabled-plugins'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plugin-api-rate-limit'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plugin-api-cross-origin'),
  pluginIdForRegisteredApiPath: jest.fn(() => 'commerce'),
  resolvePluginApiMatch: jest.requireActual('@aglyn/aglyn/app-utils/api-plugins')
    .resolvePluginApiMatch,
  runPluginApiMatch: jest.requireActual('@aglyn/aglyn/app-utils/api-plugins').runPluginApiMatch,
  resolvePluginApiRequestSubject: jest.requireActual('@aglyn/aglyn/app-utils/api-plugins')
    .resolvePluginApiRequestSubject,
  runLegacyHandler: jest.fn(async () => {
    mockHandlerCalls += 1
    return Response.json({ ok: true }, { status: 200 })
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

import {
  registerPluginApiRoute,
  unregisterPluginApiRoute,
} from '@aglyn/aglyn/app-utils/api-plugins'
import { CARD_PAYMENT_VELOCITY } from '@aglyn/aglyn/app-utils/card-payment-velocity'
import { resetCardPaymentAlarmsForTests } from '../../../libs/tenant/data/admin/src/lib/server/card-payment-velocity'
import { POST } from '../app/api/[...pluginApi]/route'

const noop = () => undefined

function post(path: string, ip: string) {
  return new Request(`https://shop.aglyn.app/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ hostId: 'host-1', productId: 'p1' }),
  })
}

const params = (path: string) => Promise.resolve({ pluginApi: path.split('/') })

let nowSpy: jest.SpyInstance<number, []>

beforeEach(() => {
  mockHandlerCalls = 0
  rateLimitDocs.clear()
  resetCardPaymentAlarmsForTests()
  const { windowMs } = CARD_PAYMENT_VELOCITY.perVisitor
  nowSpy = jest
    .spyOn(Date, 'now')
    .mockReturnValue(Math.floor(1_760_000_000_000 / windowMs) * windowMs)
  registerPluginApiRoute('commerce/checkout', noop, { cardPayment: true })
  registerPluginApiRoute('commerce/cart', noop)
})

afterEach(() => {
  nowSpy.mockRestore()
  unregisterPluginApiRoute('commerce/checkout')
  unregisterPluginApiRoute('commerce/cart')
})

describe('tenant plugin API dispatcher — card-testing velocity', () => {
  it('stops one address opening payment after payment on a declared door', async () => {
    const { limit } = CARD_PAYMENT_VELOCITY.perVisitor
    const statuses: number[] = []
    for (let i = 0; i < limit + 3; i += 1) {
      statuses.push(
        (await POST(post('commerce/checkout', '9.9.9.9'), { params: params('commerce/checkout') }))
          .status,
      )
    }
    expect(mockHandlerCalls).toBe(limit)
    expect(statuses.filter((status) => status === 429)).toHaveLength(3)
  })

  it('leaves a door that did not declare a card payment to the ordinary limit', async () => {
    const { limit } = CARD_PAYMENT_VELOCITY.perVisitor
    for (let i = 0; i < limit + 3; i += 1) {
      await POST(post('commerce/cart', '9.9.9.9'), { params: params('commerce/cart') })
    }
    expect(mockHandlerCalls).toBe(limit + 3)
  })

  it('counts each shopper on their own (false-positive guard)', async () => {
    for (let shopper = 0; shopper < 40; shopper += 1) {
      const response = await POST(post('commerce/checkout', `10.0.${shopper}.1`), {
        params: params('commerce/checkout'),
      })
      expect(response.status).toBe(200)
    }
    expect(mockHandlerCalls).toBe(40)
  })
})
