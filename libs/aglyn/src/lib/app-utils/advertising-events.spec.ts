/**
 * @jest-environment jsdom
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

import {
  ADVERTISING_EVENTS_ATTRIBUTE,
  ADVERTISING_TAG_ATTRIBUTE,
  advertisingEventId,
  merchantAdvertisingTagsResident,
  sendAdvertisingEvent,
} from './advertising-events'
import { trackEvent } from './analytics-events'

/**
 * A site owner's own advertising tags hear the site's conversions (AGL-3694)
 * — and NOTHING reaches a tag the consent gate did not mount on the owner's
 * own site.
 */

type Scope = Record<string, any>

function mount(vendor: string, siteOwned = true): void {
  const script = document.createElement('script')
  script.setAttribute(ADVERTISING_TAG_ATTRIBUTE, vendor)
  if (siteOwned) script.setAttribute(ADVERTISING_EVENTS_ATTRIBUTE, '1')
  document.head.appendChild(script)
}

beforeEach(() => {
  document.head.innerHTML = ''
  const scope = window as unknown as Scope
  scope.fbq = jest.fn()
  scope.ttq = { track: jest.fn() }
  scope.pintrk = jest.fn()
  delete scope.gtag
})

const purchase = {
  transaction_id: 'cs_live_abc',
  currency: 'USD',
  value: 25,
  items: [{ item_id: 'prod-1', item_name: 'Mug', price: 12.5, quantity: 2 }],
}

describe('the shared event id', () => {
  it('is derived from the key both sides know', () => {
    expect(advertisingEventId('purchase', 'cs_live_abc')).toBe('purchase.cs_live_abc')
    expect(advertisingEventId('lead', 'lead-1')).toBe('lead.lead-1')
  })
  it('refuses a key that could not be one', () => {
    expect(advertisingEventId('purchase', '')).toBeNull()
    expect(advertisingEventId('lead', 'a b')).toBeNull()
  })
})

describe('sendAdvertisingEvent', () => {
  it('reaches NOTHING when no tag of the owner’s is mounted — the visitor did not grant', () => {
    const scope = window as unknown as Scope
    expect(sendAdvertisingEvent('purchase', purchase)).toEqual([])
    expect(scope.fbq).not.toHaveBeenCalled()
    expect(scope.ttq.track).not.toHaveBeenCalled()
    expect(scope.pintrk).not.toHaveBeenCalled()
    expect(merchantAdvertisingTagsResident()).toBe(false)
  })

  it('never reaches OUR tags, which carry only the first mark', () => {
    mount('meta', false)
    expect(sendAdvertisingEvent('purchase', purchase)).toEqual([])
    expect((window as unknown as Scope).fbq).not.toHaveBeenCalled()
  })

  it('a purchase reaches each owner’s tag under the id the server derives', () => {
    mount('meta')
    mount('tiktok')
    mount('pinterest')
    const scope = window as unknown as Scope
    expect(sendAdvertisingEvent('purchase', purchase)).toEqual(['meta', 'tiktok', 'pinterest'])
    expect(scope.fbq).toHaveBeenCalledWith(
      'track',
      'Purchase',
      expect.objectContaining({ value: 25, currency: 'USD', content_ids: ['prod-1'] }),
      { eventID: 'purchase.cs_live_abc' },
    )
    expect(scope.ttq.track).toHaveBeenCalledWith(
      'CompletePayment',
      expect.objectContaining({ value: 25, currency: 'USD' }),
      { event_id: 'purchase.cs_live_abc' },
    )
    expect(scope.pintrk).toHaveBeenCalledWith(
      'track',
      'checkout',
      expect.objectContaining({ order_id: 'cs_live_abc', event_id: 'purchase.cs_live_abc' }),
    )
  })

  it('a lead goes under the id its form minted', () => {
    mount('meta')
    sendAdvertisingEvent('generate_lead', { form_name: 'Contact' }, { eventId: 'lead.abc' })
    expect((window as unknown as Scope).fbq).toHaveBeenCalledWith('track', 'Lead', {}, { eventID: 'lead.abc' })
  })

  it('an event a vendor has no standard name for is not invented', () => {
    mount('pinterest')
    expect(sendAdvertisingEvent('begin_checkout', { currency: 'USD', value: 1, items: [] })).toEqual([])
    expect(sendAdvertisingEvent('sign_up', { method: 'password' })).toEqual([])
  })

  it('trackEvent delivers to the owner’s tags with no Google tag on the page', () => {
    mount('meta')
    trackEvent('add_to_cart', { currency: 'USD', value: 5, items: [{ item_id: 'prod-1', item_name: 'Mug' }] })
    expect((window as unknown as Scope).fbq).toHaveBeenCalledWith(
      'track',
      'AddToCart',
      expect.objectContaining({ content_ids: ['prod-1'] }),
      expect.objectContaining({ eventID: expect.stringMatching(/^add_to_cart\./) }),
    )
  })
})
