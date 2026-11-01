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

import { sellsAsPlatform } from './platform-seller'

describe('sellsAsPlatform (AGL-4049)', () => {
  it('holds for the platform org at a waived fee', () => {
    expect(
      sellsAsPlatform({ sellerOrgId: 'platform', feePercent: 0, platformOrgId: 'platform' }),
    ).toBe(true)
  })

  it('needs the waiver: the platform org at any real rate sells like anyone', () => {
    expect(
      sellsAsPlatform({ sellerOrgId: 'platform', feePercent: 20, platformOrgId: 'platform' }),
    ).toBe(false)
  })

  it('needs the org: a waiver on any other seller still pays that seller', () => {
    expect(
      sellsAsPlatform({ sellerOrgId: 'seller', feePercent: 0, platformOrgId: 'platform' }),
    ).toBe(false)
  })

  it.each([null, undefined, ''])('holds for nobody when the marker reads %p', (platformOrgId) => {
    expect(sellsAsPlatform({ sellerOrgId: '', feePercent: 0, platformOrgId })).toBe(false)
    expect(sellsAsPlatform({ sellerOrgId: 'platform', feePercent: 0, platformOrgId })).toBe(false)
  })
})
