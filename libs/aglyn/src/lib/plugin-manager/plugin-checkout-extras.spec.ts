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

import {
  checkoutExtrasCents,
  decodeCheckoutExtrasMetadata,
  encodeCheckoutExtrasMetadata,
  hasPluginCheckoutExtras,
  normalizePluginCheckoutExtra,
  quotePluginCheckoutExtras,
  readChosenCheckoutExtras,
  registerPluginCheckoutExtra,
} from './plugin-checkout-extras'
import { resetPluginServicesForTests } from './plugin-services'
import { resolvePluginTrackingPages, registerPluginTrackingPage } from './plugin-tracking-pages'

const REQUEST = {
  hostId: 'host-1',
  currency: 'usd',
  itemsCents: 10_000,
  lines: [{ name: 'Lamp', quantity: 1, unitCents: 10_000, ships: true }],
}

const OFFER = {
  key: 'package-protection',
  label: 'Package protection',
  amountCents: 198,
  currency: 'usd',
  quoteRef: 'q_1',
}

afterEach(() => {
  resetPluginServicesForTests()
  jest.useRealTimers()
})

describe('quotePluginCheckoutExtras', () => {
  it('answers nothing when nobody offers', async () => {
    expect(hasPluginCheckoutExtras()).toBe(false)
    await expect(quotePluginCheckoutExtras(REQUEST, { timeoutMs: 50 })).resolves.toEqual([])
  })

  it('names each offer by plugin and key, unticked unless the provider says', async () => {
    registerPluginCheckoutExtra({ offer: async () => OFFER }, { pluginId: 'insurer' })
    expect(hasPluginCheckoutExtras()).toBe(true)
    const [extra] = await quotePluginCheckoutExtras(REQUEST, { timeoutMs: 100 })
    expect(extra).toMatchObject({
      id: 'insurer.package-protection',
      pluginId: 'insurer',
      amountCents: 198,
      defaultSelected: false,
      quoteRef: 'q_1',
    })
  })

  it('drops a provider that throws, is late, or answers money that is not integer cents', async () => {
    registerPluginCheckoutExtra({ offer: async () => { throw new Error('down') } }, { pluginId: 'thrower' })
    registerPluginCheckoutExtra({ offer: () => new Promise(() => undefined) }, { pluginId: 'sleeper' })
    registerPluginCheckoutExtra({ offer: async () => ({ ...OFFER, amountCents: 1.5 }) }, { pluginId: 'fractional' })
    registerPluginCheckoutExtra({ offer: async () => ({ ...OFFER, currency: 'eur' }) }, { pluginId: 'other-currency' })
    registerPluginCheckoutExtra({ offer: async () => OFFER }, { pluginId: 'good' })
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const extras = await quotePluginCheckoutExtras(REQUEST, { timeoutMs: 30 })
    spy.mockRestore()
    expect(extras.map((extra) => extra.pluginId)).toEqual(['good'])
  })

  it('aborts the providers it stops waiting for', async () => {
    let aborted = false
    registerPluginCheckoutExtra(
      {
        offer: (request) =>
          new Promise((resolve) => {
            request.signal?.addEventListener('abort', () => {
              aborted = true
              resolve(null)
            })
          }),
      },
      { pluginId: 'slow' },
    )
    await quotePluginCheckoutExtras(REQUEST, { timeoutMs: 10 })
    expect(aborted).toBe(true)
  })
})

describe('normalizePluginCheckoutExtra', () => {
  it('refuses a bad key, an empty label, zero and negative money', () => {
    expect(normalizePluginCheckoutExtra('p', { ...OFFER, key: 'Bad Key' }, 'usd')).toBeNull()
    expect(normalizePluginCheckoutExtra('p', { ...OFFER, label: '  ' }, 'usd')).toBeNull()
    expect(normalizePluginCheckoutExtra('p', { ...OFFER, amountCents: 0 }, 'usd')).toBeNull()
    expect(normalizePluginCheckoutExtra('p', { ...OFFER, amountCents: -5 }, 'usd')).toBeNull()
  })

  it('keeps only an https terms link', () => {
    expect(normalizePluginCheckoutExtra('p', { ...OFFER, termsUrl: 'javascript:alert(1)' }, 'usd')?.termsUrl).toBeUndefined()
    expect(normalizePluginCheckoutExtra('p', { ...OFFER, termsUrl: 'https://example.com/t' }, 'usd')?.termsUrl).toBe(
      'https://example.com/t',
    )
  })
})

describe('the buyer’s choice and the sale’s record', () => {
  it('reads only well-formed ids, once each, at most three', () => {
    expect(readChosenCheckoutExtras(['a.b-c', 'a.b-c', 'BAD', 7, 'x.yy', 'p.qq', 'r.ss'])).toEqual([
      'a.b-c',
      'x.yy',
      'p.qq',
    ])
    expect(readChosenCheckoutExtras('a.bb')).toEqual([])
  })

  it('round-trips through metadata, one key per extra', async () => {
    registerPluginCheckoutExtra({ offer: async () => ({ ...OFFER, quoteRef: 'q'.repeat(64) }) }, { pluginId: 'insurer' })
    const extras = await quotePluginCheckoutExtras(REQUEST, { timeoutMs: 100 })
    const metadata = encodeCheckoutExtrasMetadata(extras)
    expect(Object.keys(metadata)).toEqual(['extra0'])
    expect(metadata['extra0'].length).toBeLessThanOrEqual(500)
    const sold = decodeCheckoutExtrasMetadata(metadata)
    expect(sold).toEqual([
      {
        id: 'insurer.package-protection',
        pluginId: 'insurer',
        key: 'package-protection',
        label: 'Package protection',
        amountCents: 198,
        quoteRef: 'q'.repeat(64),
      },
    ])
    expect(checkoutExtrasCents(sold)).toBe(198)
  })

  it('drops what it cannot read rather than guessing', () => {
    expect(
      decodeCheckoutExtrasMetadata({
        extra0: 'not json',
        extra1: JSON.stringify(['insurer.package-protection', 12.5, 'x']),
        extra2: JSON.stringify(['insurer.package-protection', 300, 'Protection']),
      }),
    ).toEqual([
      { id: 'insurer.package-protection', pluginId: 'insurer', key: 'package-protection', label: 'Protection', amountCents: 300 },
    ])
    expect(decodeCheckoutExtrasMetadata(null)).toEqual([])
    expect(checkoutExtrasCents([{ amountCents: -1 }, { amountCents: 2 }])).toBe(2)
  })
})

describe('resolvePluginTrackingPages', () => {
  const PARCEL = { hostId: 'host-1', recordId: 'o-1', carrier: 'UPS', trackingNumber: '1Z1' }

  it('is empty with no provider', async () => {
    await expect(resolvePluginTrackingPages([PARCEL], { timeoutMs: 20 })).resolves.toEqual(new Map())
  })

  it('takes the first https answer and ignores the rest', async () => {
    registerPluginTrackingPage(async () => 'http://insecure.example/1Z1', { pluginId: 'a' })
    registerPluginTrackingPage(async () => 'https://track.example/1Z1', { pluginId: 'b' })
    registerPluginTrackingPage(async () => 'https://later.example/1Z1', { pluginId: 'c' })
    const pages = await resolvePluginTrackingPages([PARCEL, { ...PARCEL, trackingNumber: ' ' }], { timeoutMs: 50 })
    expect([...pages.entries()]).toEqual([['1Z1', 'https://track.example/1Z1']])
  })

  it('gives up on a slow provider', async () => {
    registerPluginTrackingPage(() => new Promise(() => undefined), { pluginId: 'slow' })
    await expect(resolvePluginTrackingPages([PARCEL], { timeoutMs: 10 })).resolves.toEqual(new Map())
  })
})
