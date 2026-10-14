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
  pluginRecordHref,
  pluginRecordListHref,
  pluginRecordRoute,
} from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerEventsRecordRoutes } from './events-record-routes'

/**
 * An event an AI build drafted (AGL-3743) opens on the site's Events page,
 * the address the plugin's own nav item serves; with no site, nowhere.
 */
describe('the event record route', () => {
  beforeEach(() => resetPluginServicesForTests())

  it('opens the Events page of the site the event is on', () => {
    registerEventsRecordRoutes()
    expect(pluginRecordRoute('event')?.pluginId).toBe('events-calendar')
    const site = { orgSlug: 'acme', host: 'bakery' }
    expect(pluginRecordListHref('event', site)).toBe('/acme/hosts/bakery/events')
    expect(pluginRecordHref('event', site, 'job-1-i0')).toBe('/acme/hosts/bakery/events')
    expect(pluginRecordListHref('event', { orgSlug: 'acme', host: null })).toBeNull()
  })

  it('answers nothing where the plugin is not loaded', () => {
    expect(pluginRecordListHref('event', { orgSlug: 'acme', host: 'bakery' })).toBeNull()
  })
})
