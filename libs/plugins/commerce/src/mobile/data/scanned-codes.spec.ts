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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CARRIER_MAX_LENGTH, TRACKING_NUMBER_MAX_LENGTH } from './limits'
import { scannedProductCode, scannedTracking } from './scanned-codes'

describe('scannedTracking', () => {
  it('drops the USPS routing prefix and ZIP from a GS1-128 label code', () => {
    expect(scannedTracking('42090210 9400111899223197428490')).toEqual({
      trackingNumber: '9400111899223197428490',
      carrier: 'USPS',
    })
    expect(scannedTracking('420902101234 9400111899223197428490')).toEqual({
      trackingNumber: '9400111899223197428490',
      carrier: 'USPS',
    })
  })

  it('names UPS only from its own 1Z shape', () => {
    expect(scannedTracking('1z 999 aa1 01 2345 6784')).toEqual({
      trackingNumber: '1Z999AA10123456784',
      carrier: 'UPS',
    })
  })

  it('leaves the carrier to the merchant when the shape is shared', () => {
    expect(scannedTracking('123456789012')).toEqual({ trackingNumber: '123456789012', carrier: null })
  })

  it('refuses what is not a tracking number', () => {
    expect(scannedTracking('')).toBeNull()
    expect(scannedTracking('https://example.com/x')).toBeNull()
    expect(scannedTracking('9'.repeat(41))).toBeNull()
  })

  it('strips the GS1 group separator', () => {
    expect(scannedTracking('\u001d1Z999AA10123456784')?.trackingNumber).toBe('1Z999AA10123456784')
  })
})

describe('scannedProductCode', () => {
  it('folds the code the way the product writer stores it', () => {
    expect(scannedProductCode(' 0 12345 67890 5 ')).toBe('012345678905')
    expect(scannedProductCode('ABC-1')).toBe('abc-1')
    expect(scannedProductCode('')).toBeNull()
  })
})

describe('limits', () => {
  // Read as text: the route is server code, and loading it here would load
  // the server with it.
  const route = readFileSync(join(__dirname, '../../lib/server/fulfill-order.ts'), 'utf8')
  const constant = (name: string) =>
    Number(new RegExp(`export const ${name} = (\\d+)`).exec(route)?.[1])

  it('match the fulfill route', () => {
    expect(CARRIER_MAX_LENGTH).toBe(constant('CARRIER_MAX'))
    expect(TRACKING_NUMBER_MAX_LENGTH).toBe(constant('TRACKING_NUMBER_MAX'))
  })
})
