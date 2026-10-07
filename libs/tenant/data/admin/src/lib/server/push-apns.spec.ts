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

import { generateKeyPairSync, verify } from 'node:crypto'
import {
  APNS_HOSTS,
  APNS_TOKEN_TTL_MS,
  apnsCredentials,
  apnsOutcome,
  apnsPayload,
  apnsProviderToken,
  createApnsTransport,
  parseApnsKey,
  type ApnsRequest,
} from './push-apns'
import type { PushMessage, PushTarget } from './push-delivery'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const PEM = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
const DER = privateKey.export({ format: 'der', type: 'pkcs8' })
const ENV = { APNS_KEY_P8: PEM, APNS_KEY_ID: 'ABC123DEFG', APNS_TEAM_ID: 'TEAM123456' }

const MESSAGE: PushMessage = {
  title: 'New order #1042',
  body: '$12.50 from Acme',
  data: { type: 'content.order', link: '/acme/orders/o1', orgId: 'org-1' },
  urgent: false,
}
const PHONE: PushTarget = { token: 'a'.repeat(64), app: 'aglyn', topic: 'com.aglyn.app', apnsEnvironment: 'production' }
const MAC: PushTarget = { token: 'b'.repeat(64), app: 'aglyn-pos', topic: 'com.aglyn.pos', apnsEnvironment: 'sandbox' }

function fakeRequest(answer: (path: string) => { status: number; body?: string }) {
  const calls: Array<{ origin: string; headers: Record<string, string>; body: string }> = []
  const request: ApnsRequest = async (origin, headers, body) => {
    calls.push({ origin, headers, body })
    const { status, body: text = '' } = answer(headers[':path'])
    return { status, body: text }
  }
  return { calls, request }
}

describe('APNs transport (AGL-3651)', () => {
  it('reads the key as PEM, as base64 of the PEM, or as base64 of the DER', () => {
    for (const raw of [PEM, PEM.replace(/\n/g, '\\n'), Buffer.from(PEM).toString('base64'), DER.toString('base64')]) {
      expect(parseApnsKey(raw).asymmetricKeyType).toBe('ec')
    }
    expect(apnsCredentials({ ...ENV, APNS_TEAM_ID: '' })).toBeNull()
    expect(apnsCredentials({})).toBeNull()
    expect(apnsCredentials(ENV)?.keyId).toBe('ABC123DEFG')
  })

  it('signs an ES256 provider token APNs can verify', () => {
    const credentials = apnsCredentials(ENV)!
    const token = apnsProviderToken(credentials, Date.UTC(2026, 9, 7))
    const [header, claims, signature] = token.split('.')
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'ABC123DEFG' })
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      iss: 'TEAM123456',
      iat: Date.UTC(2026, 9, 7) / 1000,
    })
    const raw = Buffer.from(signature, 'base64url')
    expect(raw).toHaveLength(64)
    expect(
      verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, raw),
    ).toBe(true)
  })

  it('sends the alert with the tap data beside aps, to each device’s own gateway and topic', async () => {
    const { calls, request } = fakeRequest(() => ({ status: 200 }))
    const transport = createApnsTransport({ credentials: apnsCredentials(ENV)!, request, now: () => 0 })
    expect(await transport.send([PHONE, MAC], { ...MESSAGE, urgent: true })).toEqual(['sent', 'sent'])
    expect(calls.map((c) => c.origin)).toEqual([APNS_HOSTS.production, APNS_HOSTS.sandbox])
    expect(calls[0].headers).toMatchObject({
      ':path': `/3/device/${PHONE.token}`,
      'apns-topic': 'com.aglyn.app',
      'apns-push-type': 'alert',
      'apns-priority': '10',
    })
    expect(calls[1].headers['apns-topic']).toBe('com.aglyn.pos')
    expect(calls[0].headers['authorization']).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/)
    expect(JSON.parse(calls[0].body)).toEqual({
      aps: { alert: { title: 'New order #1042', body: '$12.50 from Acme' }, sound: 'default' },
      type: 'content.order',
      link: '/acme/orders/o1',
      orgId: 'org-1',
    })
    expect(JSON.parse(apnsPayload({ ...MESSAGE, body: undefined })).aps.alert).toEqual({ title: 'New order #1042' })
  })

  it('prunes a token APNs reports gone, and fails anything else', async () => {
    expect(apnsOutcome({ status: 410, body: '{"reason":"Unregistered"}' })).toBe('prune')
    expect(apnsOutcome({ status: 400, body: '{"reason":"BadDeviceToken"}' })).toBe('prune')
    expect(apnsOutcome({ status: 400, body: '{"reason":"DeviceTokenNotForTopic"}' })).toBe('prune')
    expect(apnsOutcome({ status: 400, body: '{"reason":"PayloadTooLarge"}' })).toBe('failed')
    expect(apnsOutcome({ status: 500, body: 'not json' })).toBe('failed')
    const { request } = fakeRequest((path) => (path.endsWith('a'.repeat(64)) ? { status: 410 } : { status: 429 }))
    const transport = createApnsTransport({ credentials: apnsCredentials(ENV)!, request })
    expect(await transport.send([PHONE, MAC], MESSAGE)).toEqual(['prune', 'failed'])
    const throwing = createApnsTransport({
      credentials: apnsCredentials(ENV)!,
      request: async () => {
        throw new Error('socket hang up')
      },
    })
    expect(await throwing.send([PHONE], MESSAGE)).toEqual(['failed'])
  })

  it('reuses its provider token for up to 50 minutes, and mints a new one after a 403', async () => {
    let now = 0
    let status = 200
    const { calls, request } = fakeRequest(() => ({ status }))
    const transport = createApnsTransport({ credentials: apnsCredentials(ENV)!, request, now: () => now })
    const bearer = (i: number) => calls[i].headers['authorization']
    await transport.send([PHONE], MESSAGE)
    now = APNS_TOKEN_TTL_MS - 1000
    await transport.send([PHONE], MESSAGE)
    expect(bearer(1)).toBe(bearer(0))
    now = APNS_TOKEN_TTL_MS
    await transport.send([PHONE], MESSAGE)
    expect(bearer(2)).not.toBe(bearer(0))
    status = 403
    now += 1000
    await transport.send([PHONE], MESSAGE)
    status = 200
    now += 1000
    await transport.send([PHONE], MESSAGE)
    expect(bearer(4)).not.toBe(bearer(3))
  })

  it('is off, and says so once, without its three settings', async () => {
    jest.isolateModules(() => {
      // A fresh module, so the once-per-process warning starts unspent.
      const { apnsTransport } = jest.requireActual<typeof import('./push-apns')>('./push-apns')
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        expect(apnsTransport({})).toBeNull()
        expect(apnsTransport({ APNS_KEY_ID: 'x' })).toBeNull()
        expect(warn).toHaveBeenCalledTimes(1)
        expect(apnsTransport(ENV)).not.toBeNull()
      } finally {
        warn.mockRestore()
      }
    })
  })
})
