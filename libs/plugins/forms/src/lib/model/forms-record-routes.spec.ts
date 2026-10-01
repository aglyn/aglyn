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

/**
 * Where a form is read (AGL-3080): what this plugin publishes under `form`,
 * for the surfaces that link to one — a campaign's members, the CRM's lead
 * routing, an assistant job's draft.
 */

import {
  pluginRecordHref,
  pluginRecordListHref,
  pluginRecordRoute,
} from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerFormsRecordRoutes } from './forms-record-routes'

const SITE = { orgSlug: 'acme', host: 'shop' }
const ORG = { orgSlug: 'acme', host: null }

beforeEach(() => {
  resetPluginServicesForTests()
  registerFormsRecordRoutes()
})

describe('the forms record route', () => {
  it('is this plugin’s', () => {
    expect(pluginRecordRoute('form')?.pluginId).toBe('forms')
  })

  it('addresses a form on its own page in the site’s catalog', () => {
    expect(pluginRecordListHref('form', SITE)).toBe('/acme/hosts/shop/forms')
    expect(pluginRecordHref('form', SITE, 'quote request')).toBe('/acme/hosts/shop/forms/quote%20request')
  })

  it('has no address at the organization, where no form lives', () => {
    expect(pluginRecordListHref('form', ORG)).toBeNull()
    expect(pluginRecordHref('form', ORG, 'quote')).toBeNull()
  })
})
