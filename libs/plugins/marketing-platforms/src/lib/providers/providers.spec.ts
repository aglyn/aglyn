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

import { mockFetch } from '../testing/memory-store'
import { createAttentiveProvider } from './attentive'
import { providerRequest, ProviderError, readRetryAfterMs } from './http'
import { createKlaviyoProvider, KLAVIYO_REVISION } from './klaviyo'
import { createMailchimpProvider, mailchimpDataCenter, mailchimpSubscriberHash } from './mailchimp'
import { createOmnisendProvider, readOmnisendCursor } from './omnisend'
import type { MarketingEvent, ProviderContact } from './provider'

const contact = (overrides: Partial<ProviderContact> = {}): ProviderContact => ({
  email: 'pat@example.com',
  status: 'subscribed',
  firstName: 'Pat',
  lastName: 'Lee',
  phone: '+15551234567',
  tags: ['vip'],
  lifetimeValueCents: 12345,
  ordersCount: 3,
  ...overrides,
})

const paid: MarketingEvent = {
  id: 'evt-1',
  name: 'order.paid',
  email: 'pat@example.com',
  occurredAtMs: Date.UTC(2026, 9, 7),
  currency: 'USD',
  valueCents: 4200,
  orderId: 'o1',
  orderNumber: '#1042',
  checkoutUrl: null,
  items: [
    { productId: 'p1', variantId: 'v1', name: 'Mug', sku: 'MUG', quantity: 2, unitCents: 1500 },
    { productId: 'p2', variantId: null, name: 'Tee', sku: null, quantity: 1, unitCents: 1200 },
  ],
  tracking: null,
}

describe('the one HTTP door', () => {
  it('retries a 5xx and a short 429 in the call, then answers', async () => {
    let n = 0
    const { http, calls } = mockFetch(() => {
      n += 1
      if (n === 1) return { status: 503 }
      if (n === 2) return { status: 429, headers: { 'retry-after': '1' } }
      return { body: { ok: true } }
    })
    const sleeps: number[] = []
    const answer = await providerRequest(
      { ...http, sleep: async (ms) => void sleeps.push(ms) },
      { provider: 'X', method: 'GET', url: 'https://x.test/' },
    )
    expect(answer).toEqual({ ok: true })
    expect(calls).toHaveLength(3)
    expect(sleeps).toEqual([500, 1000])
  })

  it('ends the call on a long rate limit, with how long to wait', async () => {
    const { http } = mockFetch(() => ({ status: 429, headers: { 'retry-after': '120' } }))
    const error = await providerRequest(http, { provider: 'X', method: 'GET', url: 'https://x.test/' }).catch((e) => e)
    expect(error).toBeInstanceOf(ProviderError)
    expect(error.kind).toBe('rate-limit')
    expect(error.retryAfterMs).toBe(120_000)
  })

  it('names a refused credential `auth` and any other 4xx `invalid`, with the provider’s words', async () => {
    const refused = mockFetch(() => ({ status: 401, body: { detail: 'API key invalid' } }))
    await expect(providerRequest(refused.http, { provider: 'X', method: 'GET', url: 'https://x.test/' })).rejects.toMatchObject({
      kind: 'auth',
    })
    const invalid = mockFetch(() => ({ status: 400, body: { errors: [{ detail: 'Bad email' }] } }))
    await expect(providerRequest(invalid.http, { provider: 'X', method: 'GET', url: 'https://x.test/' })).rejects.toMatchObject({
      kind: 'invalid',
      message: 'Bad email',
    })
  })

  it('reads Retry-After as seconds or a date', () => {
    expect(readRetryAfterMs('3')).toBe(3000)
    expect(readRetryAfterMs(new Date(10_000).toUTCString(), 4_000)).toBe(6_000)
    expect(readRetryAfterMs(null)).toBeNull()
  })
})

describe('Mailchimp', () => {
  const key = { kind: 'api-key' as const, token: 'abc123-us21' }

  it('reads the data center off the key, and refuses a key with none', async () => {
    expect(mailchimpDataCenter('abc-us21')).toBe('us21')
    expect(mailchimpDataCenter('abc')).toBeNull()
    const { http } = mockFetch(() => ({ body: {} }))
    await expect(createMailchimpProvider(http).verify({ kind: 'api-key', token: 'nodc' })).rejects.toMatchObject({ kind: 'auth' })
  })

  it('verifies a key: the account, its audiences and the API root', async () => {
    const { http, calls } = mockFetch((url) =>
      url.includes('/lists')
        ? { body: { lists: [{ id: 'aud1', name: 'Newsletter' }] } }
        : { body: { account_name: 'Acme' } },
    )
    const verified = await createMailchimpProvider(http).verify(key)
    expect(verified).toEqual({
      accountName: 'Acme',
      lists: [{ id: 'aud1', name: 'Newsletter' }],
      apiBase: 'https://us21.api.mailchimp.com/3.0',
    })
    expect(calls[0].headers['Authorization']).toBe(`Basic ${Buffer.from('aglyn:abc123-us21').toString('base64')}`)
  })

  it('never resubscribes from here: a subscribed person is sent as status_if_new only', async () => {
    const { http, calls } = mockFetch(() => ({ body: {} }))
    const provider = createMailchimpProvider(http)
    await provider.pushContacts(key, { listId: 'aud1', tag: 'Aglyn' }, [
      contact(),
      contact({ email: 'gone@example.com', status: 'unsubscribed', tags: [] }),
    ])
    const hash = mailchimpSubscriberHash('pat@example.com')
    expect(calls[0]).toMatchObject({
      method: 'PUT',
      url: `https://us21.api.mailchimp.com/3.0/lists/aud1/members/${hash}?skip_merge_validation=true`,
      body: {
        email_address: 'pat@example.com',
        status_if_new: 'subscribed',
        merge_fields: { FNAME: 'Pat', LNAME: 'Lee', PHONE: '+15551234567' },
      },
    })
    expect(calls[0].body.status).toBeUndefined()
    expect(calls[1]).toMatchObject({
      method: 'POST',
      url: expect.stringContaining(`/members/${hash}/tags`),
      body: { tags: [{ name: 'Aglyn', status: 'active' }, { name: 'vip', status: 'active' }] },
    })
    expect(calls[2].body).toMatchObject({ status: 'unsubscribed', status_if_new: 'unsubscribed' })
    // No tags for a person who left.
    expect(calls).toHaveLength(3)
  })

  it('skips a person Mailchimp will not take, and goes on', async () => {
    let first = true
    const { http } = mockFetch(() => {
      if (first) {
        first = false
        return { status: 400, body: { title: 'Forgotten Email Not Subscribed', detail: 'was permanently deleted' } }
      }
      return { body: {} }
    })
    const result = await createMailchimpProvider(http).pushContacts(key, { listId: 'aud1', tag: '' }, [
      contact({ email: 'forgot@example.com', tags: [] }),
      contact({ tags: [] }),
    ])
    expect(result.pushed).toBe(1)
    expect(result.skipped).toEqual([{ email: 'forgot@example.com', reason: 'was permanently deleted' }])
  })

  it('reads back both directions since the cursor, and moves the cursor to the latest change', async () => {
    const { http, calls } = mockFetch((url) =>
      url.includes('status=unsubscribed')
        ? { body: { members: [{ email_address: 'Left@Example.com', last_changed: '2026-10-05T10:00:00+00:00' }] } }
        : { body: { members: [{ email_address: 'back@example.com', last_changed: '2026-10-06T10:00:00+00:00' }] } },
    )
    const page = await createMailchimpProvider(http).pullConsent(key, { listId: 'aud1', tag: '' }, '2026-10-01T00:00:00+00:00')
    expect(page).toEqual({
      changes: [
        { email: 'left@example.com', status: 'unsubscribed' },
        { email: 'back@example.com', status: 'subscribed' },
      ],
      cursor: '2026-10-06T10:00:00+00:00',
      more: false,
    })
    expect(calls[0].url).toContain('since_last_changed=2026-10-01T00%3A00%3A00%2B00%3A00')
    expect(calls[0].url).toContain('sort_dir=ASC')
  })
})

describe('Klaviyo', () => {
  const key = { kind: 'api-key' as const, token: 'pk_live' }

  it('authenticates with the private key at a pinned revision', async () => {
    const { http, calls } = mockFetch((url) =>
      url.includes('/accounts/')
        ? { body: { data: [{ attributes: { contact_information: { organization_name: 'Acme' } } }] } }
        : { body: { data: [{ id: 'L1', attributes: { name: 'Main' } }], links: { next: null } } },
    )
    expect(await createKlaviyoProvider(http).verify(key)).toEqual({
      accountName: 'Acme',
      lists: [{ id: 'L1', name: 'Main' }],
      apiBase: null,
    })
    expect(calls[0].headers).toMatchObject({ Authorization: 'Klaviyo-API-Key pk_live', revision: KLAVIYO_REVISION })
  })

  it('imports profiles to the list, then subscribes and unsubscribes by consent', async () => {
    const { http, calls } = mockFetch(() => ({ status: 202 }))
    const result = await createKlaviyoProvider(http).pushContacts(key, { listId: 'L1', tag: 'Aglyn' }, [
      contact(),
      contact({ email: 'gone@example.com', status: 'unsubscribed' }),
    ])
    expect(result.pushed).toBe(2)
    expect(calls.map((call) => call.url)).toEqual([
      'https://a.klaviyo.com/api/profile-bulk-import-jobs/',
      'https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/',
      'https://a.klaviyo.com/api/profile-subscription-bulk-delete-jobs/',
    ])
    const profile = calls[0].body.data.attributes.profiles.data[0].attributes
    expect(profile).toMatchObject({
      email: 'pat@example.com',
      first_name: 'Pat',
      phone_number: '+15551234567',
      properties: { aglyn_tags: ['vip'], aglyn_lifetime_value: 123.45, aglyn_orders_count: 3, aglyn_source: 'Aglyn' },
    })
    expect(calls[1].body.data.attributes.profiles.data.map((p: any) => p.attributes.email)).toEqual(['pat@example.com'])
    expect(calls[2].body.data.attributes.profiles.data.map((p: any) => p.attributes.email)).toEqual(['gone@example.com'])
  })

  it('reads back consent changes since the cursor, a suppressed subscriber not counted as back', async () => {
    const { http, calls } = mockFetch(() => ({
      body: {
        data: [
          { attributes: { email: 'left@example.com', updated: '2026-10-05T00:00:00Z', subscriptions: { email: { marketing: { consent: 'UNSUBSCRIBED' } } } } },
          { attributes: { email: 'back@example.com', updated: '2026-10-06T00:00:00Z', subscriptions: { email: { marketing: { consent: 'SUBSCRIBED', suppression: [] } } } } },
          { attributes: { email: 'bounced@example.com', updated: '2026-10-07T00:00:00Z', subscriptions: { email: { marketing: { consent: 'SUBSCRIBED', suppression: [{ reason: 'HARD_BOUNCE' }] } } } } },
        ],
        links: { next: null },
      },
    }))
    const page = await createKlaviyoProvider(http).pullConsent(key, { listId: 'L1', tag: '' }, '2026-10-01T00:00:00Z')
    expect(page).toEqual({
      changes: [
        { email: 'left@example.com', status: 'unsubscribed' },
        { email: 'back@example.com', status: 'subscribed' },
      ],
      cursor: '2026-10-07T00:00:00Z',
      more: false,
    })
    expect(decodeURIComponent(calls[0].url)).toContain('greater-than(updated,2026-10-01T00:00:00Z)')
  })

  it('sends Placed Order with a unique id, and one Ordered Product per line', async () => {
    const { http, calls } = mockFetch(() => ({ status: 202 }))
    await createKlaviyoProvider(http).sendEvent!(key, paid)
    expect(calls).toHaveLength(3)
    expect(calls[0].body.data.attributes).toMatchObject({
      unique_id: 'evt-1',
      value: 42,
      value_currency: 'USD',
      metric: { data: { attributes: { name: 'Placed Order' } } },
      profile: { data: { attributes: { email: 'pat@example.com' } } },
    })
    expect(calls[1].body.data.attributes).toMatchObject({ unique_id: 'evt-1:0', value: 30 })
    expect(calls[2].body.data.attributes.metric.data.attributes.name).toBe('Ordered Product')
  })

  it('sends Started Checkout with the link back, for an abandoned-cart flow', async () => {
    const { http, calls } = mockFetch(() => ({ status: 202 }))
    await createKlaviyoProvider(http).sendEvent!(key, {
      ...paid,
      name: 'checkout.started',
      orderId: null,
      orderNumber: null,
      checkoutUrl: 'https://shop.test/cart',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].body.data.attributes.metric.data.attributes.name).toBe('Started Checkout')
    expect(calls[0].body.data.attributes.properties.CheckoutURL).toBe('https://shop.test/cart')
  })
})

describe('Omnisend', () => {
  const key = { kind: 'api-key' as const, token: 'om-key' }

  it('upserts each contact with its email status and tags', async () => {
    const { http, calls } = mockFetch(() => ({ body: {} }))
    await createOmnisendProvider(http).pushContacts(key, { listId: null, tag: 'Aglyn' }, [contact()])
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.omnisend.com/v3/contacts',
      headers: { 'X-API-KEY': 'om-key' },
      body: {
        identifiers: [{ type: 'email', id: 'pat@example.com', channels: { email: { status: 'subscribed' } } }],
        firstName: 'Pat',
        tags: ['Aglyn', 'vip'],
        customProperties: { aglynLifetimeValue: 123.45, aglynOrdersCount: 3 },
      },
    })
  })

  it('hands back unsubscribes after the cursor date, and resumes an unfinished walk by offset', async () => {
    const at = (iso: string) => ({ identifiers: [{ type: 'email', id: iso.slice(0, 10) + '@x.test', channels: { email: { statusDate: iso } } }] })
    const { http } = mockFetch(() => ({ body: { contacts: [at('2026-10-01T00:00:00Z'), at('2026-10-05T00:00:00Z')] } }))
    const since = Date.parse('2026-10-03T00:00:00Z')
    const page = await createOmnisendProvider(http).pullConsent(key, { listId: null, tag: '' }, `${since}|0|0`)
    expect(page?.changes).toEqual([{ email: '2026-10-05@x.test', status: 'unsubscribed' }])
    expect(page?.more).toBe(false)
    expect(readOmnisendCursor(page!.cursor)).toEqual({ sinceMs: Date.parse('2026-10-05T00:00:00Z'), offset: 0, seenMs: 0 })
  })

  it('sends its own event names with a stable event id', async () => {
    const { http, calls } = mockFetch(() => ({ body: {} }))
    await createOmnisendProvider(http).sendEvent!(key, paid)
    expect(calls[0]).toMatchObject({
      url: 'https://api.omnisend.com/v5/events',
      body: { eventName: 'placed order', eventID: 'evt-1', contact: { email: 'pat@example.com' }, properties: { totalPrice: 42 } },
    })
  })
})

describe('Attentive', () => {
  const token = { kind: 'oauth' as const, token: 'att-token' }

  it('subscribes and unsubscribes by consent, and reads nothing back', async () => {
    const { http, calls } = mockFetch(() => ({ body: {} }))
    const provider = createAttentiveProvider(http)
    await provider.pushContacts(token, { listId: null, tag: '' }, [contact(), contact({ email: 'gone@example.com', status: 'unsubscribed' })])
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.attentivemobile.com/v1/subscriptions',
      'https://api.attentivemobile.com/v1/subscriptions/unsubscribe',
    ])
    expect(calls[0].headers['Authorization']).toBe('Bearer att-token')
    expect(await provider.pullConsent(token, { listId: null, tag: '' }, null)).toBeNull()
  })

  it('sends a purchase through the e-commerce event, the rest as custom events', async () => {
    const { http, calls } = mockFetch(() => ({ body: {} }))
    const provider = createAttentiveProvider(http)
    await provider.sendEvent!(token, paid)
    await provider.sendEvent!(token, { ...paid, id: 'evt-2', name: 'order.fulfilled' })
    expect(calls[0]).toMatchObject({ url: expect.stringContaining('/events/ecommerce/purchase'), body: { externalEventId: 'evt-1' } })
    expect(calls[1]).toMatchObject({ url: expect.stringContaining('/events/custom'), body: { type: 'Order Fulfilled', externalEventId: 'evt-2' } })
  })
})
