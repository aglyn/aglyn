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
  isPluginSale,
  PLUGIN_SALE_METADATA_KEY,
  PLUGIN_SALE_METADATA_VALUE,
} from './plugin-sale'

describe('isPluginSale (AGL-4049)', () => {
  it('reads the marker off a Stripe object', () => {
    expect(
      isPluginSale({ metadata: { [PLUGIN_SALE_METADATA_KEY]: PLUGIN_SALE_METADATA_VALUE } }),
    ).toBe(true)
  })

  it.each([
    [null],
    [undefined],
    [{}],
    [{ metadata: {} }],
    [{ metadata: null }],
    [{ metadata: { [PLUGIN_SALE_METADATA_KEY]: 'false' } }],
    [{ metadata: { type: 'subscription' } }],
  ])('anything else is the platform\'s own charge: %j', (stripeObject) => {
    expect(isPluginSale(stripeObject)).toBe(false)
  })
})
