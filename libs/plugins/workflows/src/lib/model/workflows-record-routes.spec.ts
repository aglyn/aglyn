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
 * Where a site's workflows, actions and webhooks are read (AGL-3080): what
 * this plugin publishes for the surfaces that link to them — the CRM naming
 * where an installed recipe landed, an assistant job's drafted automation.
 */

import {
  pluginRecordHref,
  pluginRecordListHref,
  pluginRecordRoute,
} from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerWorkflowsRecordRoutes } from './workflows-record-routes'

const SITE = { orgSlug: 'acme', host: 'shop' }
const ORG = { orgSlug: 'acme', host: null }

beforeEach(() => {
  resetPluginServicesForTests()
  registerWorkflowsRecordRoutes()
})

describe('the workflows record routes', () => {
  it('publishes the three kinds it indexes, under this plugin', () => {
    for (const kind of ['workflow', 'action', 'webhook']) {
      expect(pluginRecordRoute(kind)?.pluginId).toBe('workflows')
    }
  })

  it('addresses each kind at its section of the site’s Automation page', () => {
    expect(pluginRecordListHref('workflow', SITE)).toBe('/acme/hosts/shop/automation/workflows')
    expect(pluginRecordListHref('action', SITE)).toBe('/acme/hosts/shop/automation/actions')
    expect(pluginRecordListHref('webhook', SITE)).toBe('/acme/hosts/shop/automation/webhooks')
  })

  it('opens a record on its section, which is where it is edited', () => {
    expect(pluginRecordHref('action', SITE, 'welcome')).toBe('/acme/hosts/shop/automation/actions')
  })

  it('addresses the organization’s hub, which lists every site’s records', () => {
    expect(pluginRecordListHref('action', ORG)).toBe('/acme/automation/actions')
  })
})
