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

import { pluginHostResource } from '@aglyn/aglyn/plugin-manager/plugin-host-resources'

/**
 * What a NEW product keeps (AGL-473, AGL-3080).
 *
 * The console's Add product goes through `/api/hosts/resources`, whose field
 * list for a product is the kind this plugin declares beside its collection
 * in `plugins.config.json`, compiled into the core's generated catalog. It is
 * an allow-list: a key nobody named is DROPPED without a word, so the create
 * succeeds and the product is simply stored without the setting the merchant
 * chose. An edit is a client `setDoc` the rules let through whole, so the
 * same setting saved on an existing product sticks, which is what hid the
 * gap.
 */
const product = pluginHostResource('product')

describe('the product create allow-list', () => {
  it('is the commerce plugin’s declaration, on the products collection', () => {
    expect(product?.pluginId).toBe('commerce')
    expect(product?.collection).toBe('products')
  })

  it('keeps the check-in setting a new pass or parking product is created with (AGL-4043)', () => {
    expect(product?.fields).toContain('checkIn')
  })
})
