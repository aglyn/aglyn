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

import { transferLockUntil, transferStatusOf, VERCEL_REGISTRAR } from './registrar-vercel'

const fetchMock = jest.fn()

function respond(status: number, body: unknown) {
  return { status, json: async () => body } as unknown as Response
}

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
  process.env.VERCEL_TOKEN = 'tok'
  process.env.VERCEL_TEAM_ID = 'team_1'
})

afterEach(() => {
  delete process.env.VERCEL_TOKEN
  delete process.env.VERCEL_TEAM_ID
})

describe("Vercel's registrar driver (AGL-3962)", () => {
  it('is not configured without a token', () => {
    delete process.env.VERCEL_TOKEN
    expect(VERCEL_REGISTRAR.configured()).toBe(false)
  })

  it('searches in the team and reads prices and premium', async () => {
    fetchMock.mockResolvedValue(
      respond(200, {
        results: [
          { domain: 'testbakery.com', available: true, years: 1, price: 11.25, renewalPrice: 11.25, premium: false },
          { domain: 'testbakery.net', available: false },
        ],
      }),
    )
    const result = await VERCEL_REGISTRAR.search(['testbakery.com', 'testbakery.net'])
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.vercel.com/v1/registrar/domains/search?teamId=team_1')
    expect(result).toEqual({
      ok: 'yes',
      value: [
        { domain: 'testbakery.com', available: true, premium: false, years: 1, purchaseUsd: 11.25, renewalUsd: 11.25 },
        { domain: 'testbakery.net', available: false, premium: false, years: 1, purchaseUsd: 0, renewalUsd: 0 },
      ],
    })
  })

  it('sends the price guard and the contact on a purchase', async () => {
    fetchMock.mockResolvedValue(respond(200, { orderId: 'ord_1', _links: {} }))
    const result = await VERCEL_REGISTRAR.buy({
      domain: 'testbakery.com',
      years: 1,
      expectedPriceUsd: 11.25,
      autoRenew: true,
      contact: {
        firstName: 'Alex', lastName: 'Test', email: 'a@b.co', phone: '+1.5125550123',
        address1: '1 Main', city: 'Austin', state: 'TX', zip: '78701', country: 'US',
      },
    })
    expect(result).toEqual({ ok: 'yes', value: { orderId: 'ord_1' } })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body).toMatchObject({ autoRenew: true, years: 1, expectedPrice: 11.25 })
    expect(body.contactInformation).not.toHaveProperty('address2')
  })

  it('answers a refusal as its code, and a 5xx as retryable', async () => {
    fetchMock.mockResolvedValueOnce(respond(400, { error: { code: 'expected_price_mismatch', message: 'x' } }))
    expect(await VERCEL_REGISTRAR.renew({ domain: 'a.com', years: 1, expectedPriceUsd: 1 })).toEqual({ ok: 'no', code: 'expected_price_mismatch', retryable: false })
    fetchMock.mockResolvedValueOnce(respond(503, {}))
    expect(await VERCEL_REGISTRAR.renewalPrice('a.com')).toEqual({ ok: 'no', code: 'http_503', retryable: true })
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('t'), { name: 'TimeoutError' }))
    expect(await VERCEL_REGISTRAR.authCode('a.com')).toEqual({ ok: 'no', code: 'timeout', retryable: true })
  })

  it('reads an order as failed when its line was refunded', async () => {
    fetchMock.mockResolvedValue(
      respond(200, { orderId: 'o', status: 'completed', domains: [{ status: 'refunded', error: { code: 'price-change' } }] }),
    )
    expect(await VERCEL_REGISTRAR.order('o')).toEqual({
      ok: 'yes',
      value: { orderId: 'o', status: 'failed', failure: 'price-change' },
    })
  })

  it('owns only a name the team bought, and treats a missing one as not owned', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { domain: { boughtAt: 1, expiresAt: 2, renew: true } }))
    expect(await VERCEL_REGISTRAR.info('a.com')).toEqual({
      ok: 'yes',
      value: { owned: true, registeredAtMs: 1, expiresAtMs: 2, autoRenew: true },
    })
    fetchMock.mockResolvedValueOnce(respond(200, { domain: { boughtAt: null, expiresAt: null, renew: false } }))
    expect((await VERCEL_REGISTRAR.info('b.com')).ok === 'yes').toBe(true)
    fetchMock.mockResolvedValueOnce(respond(404, {}))
    expect(await VERCEL_REGISTRAR.info('c.com')).toEqual({
      ok: 'yes',
      value: { owned: false, registeredAtMs: null, expiresAtMs: null, autoRenew: null },
    })
  })

  it('treats an empty contact schema as the standard contact', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, {}))
    expect(await VERCEL_REGISTRAR.standardContact('a.com')).toEqual({ ok: 'yes', value: true })
    fetchMock.mockResolvedValueOnce(respond(200, { app_purpose: { required: true } }))
    expect(await VERCEL_REGISTRAR.standardContact('a.us')).toEqual({ ok: 'yes', value: false })
  })

  it('sends an edited contact with a renewal, and none otherwise (AGL-4040)', async () => {
    fetchMock.mockResolvedValue(respond(200, { orderId: 'ord_r' }))
    await VERCEL_REGISTRAR.renew({ domain: 'a.com', years: 1, expectedPriceUsd: 11.25 })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ years: 1, expectedPrice: 11.25 })
    await VERCEL_REGISTRAR.renew({
      domain: 'a.com',
      years: 1,
      expectedPriceUsd: 11.25,
      contact: CONTACT,
    })
    const body = JSON.parse(String(fetchMock.mock.calls[1][1].body))
    expect(body.contactInformation).toMatchObject({ firstName: 'Alex', country: 'US', companyName: 'Test Bakery' })
  })
})

const CONTACT = {
  firstName: 'Alex', lastName: 'Test', email: 'a@b.co', phone: '+1.5125550123',
  address1: '1 Main', city: 'Austin', state: 'TX', zip: '78701', country: 'US',
  companyName: 'Test Bakery',
}

describe('transferring a name in (AGL-4040)', () => {
  it('reads the transfer price for one year', async () => {
    fetchMock.mockResolvedValue(respond(200, { years: 1, purchasePrice: 11.25, renewalPrice: 11.25, transferPrice: '10.5' }))
    expect(await VERCEL_REGISTRAR.transferPrice('a.com')).toEqual({ ok: 'yes', value: 10.5 })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.vercel.com/v1/registrar/domains/a.com/price?years=1&teamId=team_1')
  })

  it('posts the auth code, the price guard and the contact, and returns the order', async () => {
    fetchMock.mockResolvedValue(respond(200, { orderId: 'ord_t', _links: {} }))
    const result = await VERCEL_REGISTRAR.transferIn({
      domain: 'a.com', authCode: 'X-1', years: 1, expectedPriceUsd: 10.5, autoRenew: true, contact: CONTACT,
    })
    expect(result).toEqual({ ok: 'yes', value: { orderId: 'ord_t' } })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.vercel.com/v1/registrar/domains/a.com/transfer?teamId=team_1')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      authCode: 'X-1', autoRenew: true, years: 1, expectedPrice: 10.5,
      contactInformation: { firstName: 'Alex', zip: '78701' },
    })
  })

  it('answers the registrar’s refusals as their codes', async () => {
    for (const code of ['domain_already_owned', 'dnssec_enabled', 'expected_price_mismatch']) {
      fetchMock.mockResolvedValueOnce(respond(400, { status: 400, code, message: 'x' }))
      expect(
        await VERCEL_REGISTRAR.transferIn({
          domain: 'a.com', authCode: 'X', years: 1, expectedPriceUsd: 1, autoRenew: true, contact: CONTACT,
        }),
      ).toEqual({ ok: 'no', code, retryable: false })
    }
  })

  it('reads the transfer’s status into pending, completed or failed', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { status: 'pending_unlock' }))
    expect(await VERCEL_REGISTRAR.transferStatus('a.com')).toEqual({
      ok: 'yes',
      value: { status: 'pending', state: 'pending_unlock' },
    })
    expect(transferStatusOf('completed')).toBe('completed')
    for (const state of ['failed', 'rejected', 'canceled', 'canceled_pending_refund']) {
      expect(transferStatusOf(state)).toBe('failed')
    }
    for (const state of ['created', 'pending_transfer', 'pending_new_auth_code', 'submitting_transfer']) {
      expect(transferStatusOf(state)).toBe('pending')
    }
  })
})

describe('transferring a name out (AGL-4040)', () => {
  it('reads the registry’s lock date from the 409', async () => {
    fetchMock.mockResolvedValueOnce(
      respond(409, {
        status: 409,
        code: 'domain_cannot_be_transfered_out_until',
        message: 'The domain cannot be transfered out until 2026-12-18T04:05:06.000Z.',
      }),
    )
    expect(await VERCEL_REGISTRAR.authCode('a.com')).toEqual({
      ok: 'no',
      code: 'domain_cannot_be_transfered_out_until',
      retryable: false,
      untilMs: Date.parse('2026-12-18T04:05:06.000Z'),
    })
  })

  it('reads a date however the message words it, and null when it names none', () => {
    expect(transferLockUntil('Locked until 2026-12-18.')).toBe(Date.parse('2026-12-18T00:00:00Z'))
    expect(transferLockUntil('cannot be transferred out until Dec 18, 2026')).toBe(Date.parse('Dec 18, 2026'))
    expect(transferLockUntil(`until ${Date.parse('2026-12-18T00:00:00Z')}`)).toBe(Date.parse('2026-12-18T00:00:00Z'))
    expect(transferLockUntil('locked')).toBeNull()
    expect(transferLockUntil(undefined)).toBeNull()
  })
})

describe('nameservers and DNS records (AGL-4040)', () => {
  it('knows a name on the registrar’s nameservers from one elsewhere', async () => {
    fetchMock.mockResolvedValueOnce(
      respond(200, {
        domain: {
          serviceType: 'external',
          nameservers: ['NS1.Vercel-DNS.com.', 'ns2.vercel-dns.com'],
          intendedNameservers: ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'],
          customNameservers: [],
        },
      }),
    )
    expect(await VERCEL_REGISTRAR.nameservers('a.com')).toEqual({
      ok: 'yes',
      value: {
        ours: true,
        nameservers: ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'],
        intended: ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'],
      },
    })
    fetchMock.mockResolvedValueOnce(
      respond(200, {
        domain: {
          serviceType: 'external',
          nameservers: ['ns1.otherhost.example'],
          intendedNameservers: ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'],
        },
      }),
    )
    const elsewhere = await VERCEL_REGISTRAR.nameservers('b.com')
    expect(elsewhere.ok === 'yes' && elsewhere.value.ours).toBe(false)
  })

  it('lists records with their creator and priority, following the pages', async () => {
    fetchMock
      .mockResolvedValueOnce(
        respond(200, {
          records: [
            { id: 'rec_1', type: 'ALIAS', name: '', value: 'cname.vercel-dns.com', creator: 'system', ttl: 60 },
            { id: 'rec_2', type: 'MX', name: '', value: 'mx.example.com', mxPriority: 10, creator: 'user' },
          ],
          pagination: { count: 2, next: 1700000000000, prev: null },
        }),
      )
      .mockResolvedValueOnce(respond(200, { records: [], pagination: { count: 0, next: null, prev: null } }))
    const listed = await VERCEL_REGISTRAR.listDnsRecords('a.com')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.vercel.com/v5/domains/a.com/records?limit=100&teamId=team_1')
    expect(fetchMock.mock.calls[1][0]).toContain('until=1700000000000')
    expect(listed).toEqual({
      ok: 'yes',
      value: [
        { id: 'rec_1', type: 'ALIAS', name: '', value: 'cname.vercel-dns.com', ttl: 60, priority: null, creator: 'system' },
        { id: 'rec_2', type: 'MX', name: '', value: 'mx.example.com', ttl: null, priority: 10, creator: 'user' },
      ],
    })
  })

  it('creates, updates and deletes one record on the documented paths', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { uid: 'rec_9' }))
    expect(
      await VERCEL_REGISTRAR.createDnsRecord('a.com', { type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=none' }),
    ).toEqual({ ok: 'yes', value: { id: 'rec_9' } })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.vercel.com/v2/domains/a.com/records?teamId=team_1')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=none',
    })

    fetchMock.mockResolvedValueOnce(respond(200, { id: 'rec_9' }))
    expect(
      await VERCEL_REGISTRAR.updateDnsRecord('rec_9', {
        type: 'SRV', name: '_sip._tcp', srv: { priority: 1, weight: 2, port: 3, target: 'x.example.com' }, ttl: 300,
      }),
    ).toEqual({ ok: 'yes', value: true })
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.vercel.com/v1/domains/records/rec_9?teamId=team_1')
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH')

    fetchMock.mockResolvedValueOnce(respond(200, {}))
    expect(await VERCEL_REGISTRAR.deleteDnsRecord('a.com', 'rec_9')).toEqual({ ok: 'yes', value: true })
    expect(fetchMock.mock.calls[2][0]).toBe('https://api.vercel.com/v2/domains/a.com/records/rec_9?teamId=team_1')
    expect(fetchMock.mock.calls[2][1].method).toBe('DELETE')
  })
})
