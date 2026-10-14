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

/** Where a dataset is read (AGL-3616): the site's Data page, or the organization's. */

import { pluginRecordHref, pluginRecordListHref } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerDataRecordRoutes } from './data-record-routes'

beforeEach(() => {
  resetPluginServicesForTests()
  registerDataRecordRoutes()
})

describe('the dataset record route', () => {
  it('lists a site’s datasets on its Data page, and the organization’s on the org Data page', () => {
    expect(pluginRecordListHref('dataset', { orgSlug: 'acme', host: 'shop' })).toBe('/acme/hosts/shop/data')
    expect(pluginRecordListHref('dataset', { orgSlug: 'acme', host: null })).toBe('/acme/data')
    // No page of one dataset: a record opens the list.
    expect(pluginRecordHref('dataset', { orgSlug: 'acme', host: 'shop' }, 'ds-1')).toBe('/acme/hosts/shop/data')
  })
})
