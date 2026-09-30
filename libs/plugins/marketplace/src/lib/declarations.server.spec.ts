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
  getCustomFieldType,
  validateCustomFieldValue,
} from '@aglyn/aglyn/plugin-manager/custom-fields'
import { registerMarketplaceServerDeclarations } from './declarations.server'

/**
 * The `rating` validator registers from the server declarations every app
 * runs at boot (AGL-2773), so a tenant-side write — a form submission, an
 * automation step — refuses a rating of 9 without loading the marketplace.
 */
describe('registerMarketplaceServerDeclarations', () => {
  it('registers the rating field type and its validator', () => {
    expect(getCustomFieldType('rating')).toBeUndefined()

    registerMarketplaceServerDeclarations()

    expect(getCustomFieldType('rating')?.baseType).toBe('int32')
    expect(validateCustomFieldValue('rating', 9)).toMatch(/0 to 5/)
    expect(validateCustomFieldValue('rating', 4)).toBeNull()
  })

  it('registers no input component, which only the client barrel carries', () => {
    registerMarketplaceServerDeclarations()
    expect(getCustomFieldType('rating')?.Input).toBeUndefined()
  })
})
