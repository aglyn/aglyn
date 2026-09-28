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
 * @jest-environment node
 */

const sends: Array<Record<string, unknown>> = []
let staffUids: string[] = []
const directory = new Map<string, string>()

jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email'),
  sendEmail: async (options: Record<string, unknown>) => {
    sends.push(options)
    return { sent: true }
  },
}))
jest.mock('./firebase-admin', () => {
  const offline = { app: () => { throw new Error('offline') } }
  return { __esModule: true, default: offline, firebaseAdmin: offline }
})
jest.mock('./auth-pools', () => ({
  listStaffUidsAcrossPools: async () => staffUids,
  findUserByUidAcrossPools: async (uid: string) =>
    directory.has(uid) ? { record: { email: directory.get(uid) } } : null,
}))
jest.mock('./email-metering', () => ({ meterPlatformEmail: async () => undefined }))

import {
  resolveStaffAlertRecipients,
  sendOperatorAlertEmail,
} from './staff-alert-email'

const ENV_KEYS = ['STAFF_ALERT_EMAIL', 'NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL', 'VERCEL_ENV'] as const

describe('who hears a staff alarm (AGL-3375)', () => {
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
    sends.length = 0
    staffUids = []
    directory.clear()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    jest.restoreAllMocks()
  })

  it('the alerts inbox, when the operator set one', async () => {
    process.env.STAFF_ALERT_EMAIL = 'Alerts@Example.com'
    process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL = 'support@example.com'
    expect(await resolveStaffAlertRecipients()).toEqual(['alerts@example.com'])
  })

  it('else the operator support address', async () => {
    process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL = 'support@example.com'
    expect(await resolveStaffAlertRecipients()).toEqual(['support@example.com'])
  })

  it('else every staff account, so an install nobody configured still hears', async () => {
    staffUids = ['a', 'b', 'c']
    directory.set('a', 'ann@example.com')
    directory.set('b', 'bo@example.com')
    expect(await resolveStaffAlertRecipients()).toEqual(['ann@example.com', 'bo@example.com'])
  })

  it('never falls back on a preview deployment', async () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL = 'support@example.com'
    staffUids = ['a']
    directory.set('a', 'ann@example.com')
    expect(await resolveStaffAlertRecipients()).toEqual([])
    process.env.STAFF_ALERT_EMAIL = 'alerts@example.com'
    expect(await resolveStaffAlertRecipients()).toEqual(['alerts@example.com'])
  })

  it('mails each staff account on its own, never on a shared To line', async () => {
    staffUids = ['a', 'b']
    directory.set('a', 'ann@example.com')
    directory.set('b', 'bo@example.com')
    await sendOperatorAlertEmail({
      title: 'Card testing on northwind.test',
      body: '38 declined attempts in 10 minutes.',
      url: 'https://app.example.com/admin/abuse-reports/r1',
      context: 'operator-alert test',
    })
    expect(sends.map((send) => send['to'])).toEqual(['ann@example.com', 'bo@example.com'])
  })

  it('renders the operator-alert system email: the alert, its button, the operator brand', async () => {
    process.env.STAFF_ALERT_EMAIL = 'alerts@example.com'
    const result = await sendOperatorAlertEmail({
      title: 'A payment on your subscription needs attention',
      body: 'A dispute was opened on invoice in_123.',
      url: 'https://app.example.com/admin/abuse-reports/r1',
      context: 'operator-alert test',
    })
    expect(result.sent).toBe(true)
    expect(sends[0]['subject']).toBe('A payment on your subscription needs attention')
    const html = String(sends[0]['html'])
    expect(html).toContain('A dispute was opened on invoice in_123.')
    expect(html).toContain('href="https://app.example.com/admin/abuse-reports/r1"')
    expect(html).toContain('operator alerts')
  })

  it('reports unconfigured, and sends nothing, when there is no one to tell', async () => {
    const result = await sendOperatorAlertEmail({ title: 'x', context: 'operator-alert test' })
    expect(result).toEqual({ sent: false, reason: 'unconfigured' })
    expect(sends).toHaveLength(0)
  })
})
