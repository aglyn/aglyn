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

import { createFakeTwilio } from '../testing/fake-twilio'
import { signTwilioWebhook } from '../twilio/twilio-client'
import { createMemoryPhoneRepository } from './phone-repository'
import { createPhoneService } from './phone-service'
import { createPhoneHookRoutes, createPhoneMemberRoutes, type PhoneRouteDeps } from './routes'
import type { PhoneGateDeps } from './route-gate'
import { createVoiceService } from './voice-service'

const ORG = 'org1'

function setup(gate: Partial<PhoneGateDeps> = {}) {
  const repo = createMemoryPhoneRepository()
  const twilio = createFakeTwilio()
  let id = 0
  const serviceDeps = {
    repo,
    twilio: twilio.client,
    now: () => Date.UTC(2026, 10, 26, 16, 0),
    newId: () => `id${++id}`,
    webhookOrigin: () => 'https://app.aglyn.io',
    consumeSendRate: async () => true,
  }
  const phone = createPhoneService(serviceDeps)
  const voice = createVoiceService(serviceDeps, phone)
  const deps: PhoneRouteDeps = {
    gate: {
      verifyIdToken: async (token) => {
        if (token !== 'good') throw Object.assign(new Error('bad'), { code: 'auth/argument-error' })
        return { uid: 'u1', email: 'u1@example.com', email_verified: true } as never
      },
      isInvalidToken: () => true,
      isEmailVerified: () => true,
      resolveOrgPermissions: async (_uid, { orgId }) => ({
        orgId,
        role: 'admin',
        orgWide: true,
        permissions: { 'phone.use': true, 'phone.manage': true },
      }),
      readOrg: async () => ({ name: 'Ranch', seatAddons: { phone: 1 } }),
      hasFeature: (org) => (org['seatAddons'] as { phone?: number } | undefined)?.phone === 1,
      lockdownRefusal: async () => null,
      ...gate,
    },
    phone,
    voice,
    webhookOrigin: () => 'https://app.aglyn.io',
    addonUnits: () => 1,
  }
  return { repo, twilio, phone, member: createPhoneMemberRoutes(deps), hooks: createPhoneHookRoutes(deps) }
}

const get = (path: string, token = 'good') =>
  new Request(`https://app.aglyn.io/api/${path}`, { headers: { authorization: `Bearer ${token}` } })
const post = (path: string, body: unknown, token = 'good') =>
  new Request(`https://app.aglyn.io/api/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('phone member routes (AGL-4251)', () => {
  it('refuses without a session, a member, the permission or the add-on', async () => {
    expect((await setup().member['status'](get('phone/status?orgId=org1', 'bad'))).status).toBe(401)
    expect(
      (await setup({ resolveOrgPermissions: async () => ({ orgId: ORG, role: null, orgWide: true, permissions: {} }) }).member['status'](
        get('phone/status?orgId=org1'),
      )).status,
    ).toBe(403)
    const noPermission = await setup({
      resolveOrgPermissions: async () => ({ orgId: ORG, role: 'editor', orgWide: true, permissions: { 'phone.use': true } }),
    }).member['numbersSearch'](post('phone/numbers/search', { orgId: ORG, kind: 'local' }))
    expect(noPermission.status).toBe(403)
    const noAddon = await setup({ readOrg: async () => ({}) }).member['status'](get('phone/status?orgId=org1'))
    expect(noAddon.status).toBe(403)
    expect(await noAddon.json()).toMatchObject({ reason: 'entitlement' })
  })

  it('buys a number, sends a text and never returns another member’s cell', async () => {
    const env = setup()
    const bought = await env.member['numbersBuy'](
      post('phone/numbers/buy', { orgId: ORG, e164: '+18305550100', kind: 'local', hostId: 'site1', label: 'Desk' }),
    )
    expect(bought.status).toBe(200)
    const settings = await env.phone.settings(ORG)
    await env.phone.saveSettings(ORG, { ...settings, memberCells: { u1: '+15125550000', u2: '+15125550001' } })
    const status = await (await env.member['status'](get('phone/status?orgId=org1'))).json()
    expect(status.myCell).toBe('+15125550000')
    expect(status.settings.memberCells).toBeUndefined()
    const sent = await env.member['send'](post('phone/messages/send', { orgId: ORG, to: '8305550142', body: 'Hello' }))
    expect(sent.status).toBe(200)
    expect(env.twilio.called('sendMessage')).toHaveLength(1)
  })
})

describe('phone webhooks (AGL-4251)', () => {
  it('refuses an unsigned or mis-signed webhook and files a signed one', async () => {
    const env = setup()
    await env.phone.buyNumber(ORG, 'Ranch', 'u1', { e164: '+18305550100', kind: 'local', hostId: 'site1', label: '' }, 1)
    const params = { To: '+18305550100', From: '+18305550142', Body: 'hi', MessageSid: 'SM00000000000000000000000000000009', AccountSid: 'AC_sub_1' }
    const url = 'https://app.aglyn.io/api/phone/hooks/sms'
    const request = (signature: string) =>
      new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature },
        body: new URLSearchParams(params).toString(),
      })
    expect((await env.hooks['hookSms'](request('nope'))).status).toBe(403)
    expect((await env.hooks['hookSms'](request(signTwilioWebhook(url, params, 'other-token')))).status).toBe(403)
    const filed = await env.hooks['hookSms'](request(signTwilioWebhook(url, params, 'sub-token')))
    expect(filed.status).toBe(200)
    expect(await filed.text()).toContain('<Response></Response>')
    expect(await env.phone.listThreads(ORG, {})).toHaveLength(1)
  })
})
