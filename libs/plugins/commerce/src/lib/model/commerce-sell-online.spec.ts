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

import { productListedOnline, productSellsOnline } from './commerce'

/*
 * The "Sell online" switch (AGL-4060). Only an explicit `false` turns it off:
 * every product stored before the switch existed has no `sellOnline` and must
 * sell online exactly as it did.
 */
describe('productSellsOnline', () => {
  it('reads an absent switch as on, and only `false` as off', () => {
    expect(productSellsOnline({})).toBe(true)
    expect(productSellsOnline({ sellOnline: true })).toBe(true)
    expect(productSellsOnline({ sellOnline: undefined })).toBe(true)
    expect(productSellsOnline({ sellOnline: null })).toBe(true)
    expect(productSellsOnline({ sellOnline: false })).toBe(false)
    expect(productSellsOnline(undefined)).toBe(true)
  })
})

describe('productListedOnline', () => {
  it('is live, active and sold online', () => {
    expect(productListedOnline({ status: 'active', deletedAt: null })).toBe(true)
    expect(productListedOnline({ status: 'active', sellOnline: false })).toBe(false)
    expect(productListedOnline({ status: 'draft' })).toBe(false)
    expect(productListedOnline({ status: 'archived' })).toBe(false)
    expect(productListedOnline({ status: 'active', deletedAt: 5 })).toBe(false)
    expect(productListedOnline(null)).toBe(false)
    expect(productListedOnline(undefined)).toBe(false)
  })
})
