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
 * Where a form submission is read (AGL-3080): what this plugin publishes
 * under `formSubmission`, for the surfaces that link to one — a contact's
 * timeline opening the submission that captured the person.
 */

import {
  pluginRecordHref,
  pluginRecordListHref,
  pluginRecordRoute,
} from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerInboxRecordRoutes } from './inbox-record-routes'

const SITE = { orgSlug: 'acme', host: 'shop' }
const ORG = { orgSlug: 'acme', host: null }

beforeEach(() => {
  resetPluginServicesForTests()
  registerInboxRecordRoutes()
})

describe('the inbox record route', () => {
  it('is this plugin’s', () => {
    expect(pluginRecordRoute('formSubmission')?.pluginId).toBe('inbox')
  })

  it('opens a submission in the site’s reader, by the key the section reads', () => {
    expect(pluginRecordHref('formSubmission', SITE, 'sub-1')).toBe(
      '/acme/hosts/shop/inbox/submissions?submission=sub-1',
    )
    expect(pluginRecordListHref('formSubmission', SITE)).toBe('/acme/hosts/shop/inbox/submissions')
  })

  it('lists the organization’s submissions, but opens one only on its site', () => {
    expect(pluginRecordListHref('formSubmission', ORG)).toBe('/acme/inbox/submissions')
    expect(pluginRecordHref('formSubmission', ORG, 'sub-1')).toBeNull()
  })
})
