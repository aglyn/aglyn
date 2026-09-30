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

import { pluginRecordIndex } from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { BUNDLE_ID } from './constants/bundle-common'
import { registerCommerceServerDeclarations } from './declarations.server'

/**
 * The commerce plugin's boot registrations — the ones every app runs before a
 * surface loads, so a reader in any server process finds them.
 */
describe('registerCommerceServerDeclarations', () => {
  beforeEach(() => resetPluginServicesForTests())

  it('publishes the product and category indexes as this plugin’s (AGL-3080)', () => {
    registerCommerceServerDeclarations()
    expect(pluginRecordIndex('product')?.pluginId).toBe(BUNDLE_ID)
    expect(pluginRecordIndex('productCategory')?.pluginId).toBe(BUNDLE_ID)
  })

  it('registers again without refusing itself', () => {
    registerCommerceServerDeclarations()
    expect(() => registerCommerceServerDeclarations()).not.toThrow()
  })
})
