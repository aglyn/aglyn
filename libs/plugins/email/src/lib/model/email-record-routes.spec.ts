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
 * Where the Emails page's records are read (AGL-3080): what this plugin
 * publishes under `emailMessage` and `sendingIdentity`, for the surfaces that
 * link to them — a contact's timeline, a composer refused for its sender.
 */

import {
  pluginRecordHref,
  pluginRecordListHref,
  pluginRecordRoute,
} from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerEmailRecordRoutes } from './email-record-routes'

const SITE = { orgSlug: 'acme', host: 'shop' }
const ORG = { orgSlug: 'acme', host: null }

beforeEach(() => {
  resetPluginServicesForTests()
  registerEmailRecordRoutes()
})

describe('the Emails page’s record routes', () => {
  it('publishes both kinds under this plugin', () => {
    expect(pluginRecordRoute('emailMessage')?.pluginId).toBe('email')
    expect(pluginRecordRoute('sendingIdentity')?.pluginId).toBe('email')
  })

  it('addresses a message on the site’s Emails page, and on the organization’s', () => {
    expect(pluginRecordHref('emailMessage', SITE, 'cmp 1')).toBe('/acme/hosts/shop/emails/messages/cmp%201')
    expect(pluginRecordListHref('emailMessage', SITE)).toBe('/acme/hosts/shop/emails/messages')
    expect(pluginRecordHref('emailMessage', ORG, 'cmp-1')).toBe('/acme/emails/messages/cmp-1')
  })

  it('sends a sender to the Sending section, which is where an identity is kept', () => {
    expect(pluginRecordListHref('sendingIdentity', SITE)).toBe('/acme/hosts/shop/emails/sending')
    expect(pluginRecordHref('sendingIdentity', SITE, 'any')).toBe('/acme/hosts/shop/emails/sending')
    expect(pluginRecordListHref('sendingIdentity', ORG)).toBe('/acme/emails/sending')
  })
})
