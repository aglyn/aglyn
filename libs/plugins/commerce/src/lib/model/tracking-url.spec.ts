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
  carrierIdFor,
  carrierLabelFor,
  fulfillmentTrackingUrl,
  trackingUrlFor,
} from './tracking-url'

describe('carrier tracking links (AGL-3610)', () => {
  it.each([
    ['USPS', 'usps'],
    ['usps priority mail', 'usps'],
    ['United States Postal Service', 'usps'],
    ['UPS', 'ups'],
    ['UPS Ground', 'ups'],
    ['Fed Ex', 'fedex'],
    ['FedEx 2Day', 'fedex'],
    ['DHL Express', 'dhl'],
    ['Canada Post', 'canada-post'],
    ['Postes Canada', 'canada-post'],
    ['Royal Mail', 'royal-mail'],
    ['Parcelforce', 'royal-mail'],
    ['Australia Post', 'australia-post'],
    ['AusPost', 'australia-post'],
  ])('reads %s as %s', (typed, id) => {
    expect(carrierIdFor(typed)).toBe(id)
  })

  it('knows nothing it was not told, and never matches a substring', () => {
    expect(carrierIdFor('Pups Express')).toBeNull()
    expect(carrierIdFor('Local courier')).toBeNull()
    expect(carrierIdFor('')).toBeNull()
    expect(carrierIdFor(undefined)).toBeNull()
  })

  it('builds each carrier link with the number encoded and spaces dropped', () => {
    expect(trackingUrlFor('UPS', '1Z 999 AA1 01 2345 6784')).toBe(
      'https://www.ups.com/track?tracknum=1Z999AA10123456784',
    )
    expect(trackingUrlFor('usps', '9400&x')).toBe(
      'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400%26x',
    )
    for (const carrier of [
      'FedEx',
      'DHL',
      'Canada Post',
      'Royal Mail',
      'Australia Post',
    ]) {
      expect(trackingUrlFor(carrier, 'ABC123')).toMatch(/^https:\/\/.*ABC123/)
    }
  })

  it('gives no link for an unknown carrier or a missing number', () => {
    expect(trackingUrlFor('Local courier', 'ABC')).toBeNull()
    expect(trackingUrlFor('UPS', '  ')).toBeNull()
  })

  it('prefers a stored https link and refuses any other scheme', () => {
    expect(
      fulfillmentTrackingUrl({
        carrier: 'UPS',
        trackingNumber: '1Z1',
        trackingUrl: 'https://carrier.example/track/1Z1',
      }),
    ).toBe('https://carrier.example/track/1Z1')
    expect(
      fulfillmentTrackingUrl({
        carrier: 'UPS',
        trackingNumber: '1Z1',
        trackingUrl: 'javascript:alert(1)',
      }),
    ).toBe('https://www.ups.com/track?tracknum=1Z1')
  })

  it('labels a known carrier by its own name and keeps unknown text', () => {
    expect(carrierLabelFor('fed ex ground')).toBe('FedEx')
    expect(carrierLabelFor(' Local courier ')).toBe('Local courier')
  })
})
