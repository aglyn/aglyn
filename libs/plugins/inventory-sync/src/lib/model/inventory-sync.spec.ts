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

import { decimalToMinor, minorToDecimal } from './money'
import { INVENTORY_PROVIDERS, isBrightpearlContactId, readInventorySettings } from './inventory-sync'

describe('settings read from a request (AGL-3642)', () => {
  it('takes what it knows and refuses what it does not', () => {
    expect(readInventorySettings({ stockSource: 'system', productSync: 'import', sendOrders: true, locationId: '' })).toEqual({
      ok: true,
      settings: { stockSource: 'system', productSync: 'import', sendOrders: true, locationId: null },
    })
    expect(readInventorySettings({ stockSource: 'both' })).toMatchObject({ ok: false })
    expect(readInventorySettings({ productSync: 'sideways' })).toMatchObject({ ok: false })
    expect(readInventorySettings({ paused: 'yes' })).toMatchObject({ ok: false })
    expect(readInventorySettings({ locationId: '<script>' })).toMatchObject({ ok: false })
    expect(readInventorySettings({ orderCustomer: 'x'.repeat(121) })).toMatchObject({ ok: false })
  })

  it('knows a Brightpearl contact id when it sees one', () => {
    expect(isBrightpearlContactId('207')).toBe(true)
    expect(isBrightpearlContactId('Web Sales')).toBe(false)
    expect(isBrightpearlContactId('0')).toBe(false)
  })

  it('says which systems make products and cancel orders through their API', () => {
    expect(INVENTORY_PROVIDERS.brightpearl).toMatchObject({ auth: 'oauth', exportsProducts: false, cancelsOrders: false })
    expect(INVENTORY_PROVIDERS['cin7-core']).toMatchObject({ auth: 'keys', exportsProducts: true, cancelsOrders: true })
  })
})

describe('money between the store and a system (AGL-3642)', () => {
  it('converts minor units to and from decimals, respecting zero-decimal currencies', () => {
    expect(minorToDecimal(1999, 'usd')).toBe('19.99')
    expect(minorToDecimal(1500, 'JPY')).toBe('1500')
    expect(decimalToMinor('19.99', 'USD')).toBe(1999)
    expect(decimalToMinor('1,299.00', 'USD')).toBe(129900)
    expect(decimalToMinor(1500, 'jpy')).toBe(1500)
    expect(decimalToMinor('', 'USD')).toBeNull()
    expect(decimalToMinor('abc', 'USD')).toBeNull()
  })
})
