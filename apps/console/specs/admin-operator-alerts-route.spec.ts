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

/**
 * STAFF → OPERATOR ALERTS, and who may change them (AGL-3377).
 *
 * Any staff may read the registry and where alerts go; only `super` may
 * switch a type, move it to the digest or send a test, and each of those
 * writes an adminAudit row. What is stored is only what differs from the
 * coded default, so the document never pins a default in place.
 */

export {}

const mockVerifyIdToken = jest.fn()
const mockAuditAdd = jest.fn(async (..._args: unknown[]) => undefined)
const mockSettingsSet = jest.fn(async (..._args: unknown[]) => undefined)
const mockTestSend = jest.fn(async (..._args: unknown[]) => ({
  email: { sent: true },
  webhook: { posted: false, reason: 'unconfigured' },
}))
let mockStored: Record<string, unknown> = {}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: () => ({ set: (...args: unknown[]) => mockSettingsSet(...args) }),
          add: (row: unknown) => mockAuditAdd(name, row),
        }),
      }),
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
}))

jest.mock('@aglyn/tenant-data-admin/server/operator-alerts', () => {
  const actual = jest.requireActual('../../../libs/tenant/data/admin/src/lib/server/operator-alerts')
  return {
    __esModule: true,
    OPERATOR_ALERT_SETTINGS_COLLECTION: actual.OPERATOR_ALERT_SETTINGS_COLLECTION,
    OPERATOR_ALERT_SETTINGS_DOC: actual.OPERATOR_ALERT_SETTINGS_DOC,
    normalizeOperatorAlertSettings: actual.normalizeOperatorAlertSettings,
    operatorAlertCatalogRows: actual.operatorAlertCatalogRows,
    readOperatorAlertSettings: async () => actual.normalizeOperatorAlertSettings(mockStored),
    invalidateOperatorAlertSettingsCache: () => undefined,
    describeOperatorAlertRecipients: async () => ({ source: 'STAFF_ALERT_EMAIL', count: 1 }),
    operatorAlertWebhookUrl: () => '',
    sendOperatorAlertTest: (...args: unknown[]) => mockTestSend(...args),
  }
})

jest.mock('@aglyn/tenant-data-admin/server/operator-health', () => ({
  __esModule: true,
  listHealthStates: async () => [
    { checkId: 'console-crons', label: 'Scheduled jobs', status: 'degraded', sinceMs: 1, detail: 'Failing: x.', updatedAtMs: 1 },
  ],
}))

jest.mock('../constants/plugins.declarations.server.generated', () => ({
  __esModule: true,
  registerPluginServerDeclarations: async () => undefined,
}))

import { GET, POST, PUT } from '../app/api/admin/operator-alerts/route'

function request(method: string, body?: unknown) {
  return new Request('https://app.example.com/api/admin/operator-alerts', {
    method,
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function asStaff(role: string) {
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email: 'staff@example.com',
    email_verified: true,
    staff: true,
    staffRole: role,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockStored = {}
})

describe('/api/admin/operator-alerts (AGL-3377)', () => {
  it('lets any staff read the registry, the channels and the health states', async () => {
    asStaff('support')
    const response = await GET(request('GET'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.role).toBe('support')
    expect(body.recipients).toEqual({ source: 'STAFF_ALERT_EMAIL', count: 1 })
    expect(body.webhookConfigured).toBe(false)
    const lost = body.alerts.find((row: { type: string }) => row.type === 'billing.platformDisputeLost')
    expect(lost).toMatchObject({
      tier: 'must',
      defaults: { enabled: true, delivery: 'immediate' },
      effective: { enabled: true, delivery: 'immediate' },
      overridden: false,
    })
    expect(body.health).toEqual([
      expect.objectContaining({ checkId: 'console-crons', status: 'degraded' }),
    ])
  })

  it('refuses a change from anyone but super staff', async () => {
    asStaff('support')
    const response = await PUT(request('PUT', { types: { 'billing.autoLocked': { enabled: false } } }))
    expect(response.status).toBe(403)
    expect(mockSettingsSet).not.toHaveBeenCalled()
  })

  it('stores only answers that differ from the default, and audits the change', async () => {
    asStaff('super')
    mockStored = { types: { 'system.scopeDrift': { delivery: 'immediate' } } }
    const response = await PUT(
      request('PUT', {
        types: {
          'billing.autoLocked': { enabled: false },
          // Back to its coded default: removed rather than pinned.
          'system.scopeDrift': { delivery: 'digest' },
          // Already the default: never stored.
          'billing.usageNotReported': { enabled: true },
        },
        digestHourUtc: 9,
      }),
    )
    expect(response.status).toBe(200)
    const [write] = mockSettingsSet.mock.calls[0] as [Record<string, unknown>]
    expect(write).toMatchObject({
      types: { 'billing.autoLocked': { enabled: false } },
      digestHourUtc: 9,
      updatedByEmail: 'staff@example.com',
    })
    expect(Object.keys(write['types'] as object)).toEqual(['billing.autoLocked'])
    expect(mockAuditAdd).toHaveBeenCalledWith(
      'adminAudit',
      expect.objectContaining({ action: 'operatorAlerts.update', actorUid: 'staff-1' }),
    )
  })

  it('refuses an alert type nobody registered', async () => {
    asStaff('super')
    const response = await PUT(request('PUT', { types: { 'made.up': { enabled: false } } }))
    expect(response.status).toBe(400)
    expect(mockSettingsSet).not.toHaveBeenCalled()
  })

  it('sends a test of one type, super only, and audits it', async () => {
    asStaff('support')
    expect((await POST(request('POST', { action: 'test', type: 'data.orgErasureFailed' }))).status).toBe(403)
    asStaff('super')
    const response = await POST(request('POST', { action: 'test', type: 'data.orgErasureFailed' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, email: { sent: true } })
    expect(mockTestSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'data.orgErasureFailed' }))
    expect(mockAuditAdd).toHaveBeenCalledWith(
      'adminAudit',
      expect.objectContaining({ action: 'operatorAlerts.test' }),
    )
  })
})
