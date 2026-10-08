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

'use strict'

const { apiUrl } = require('./lib/api')

/**
 * Connecting Aglyn (AGL-3643): the merchant pastes an API key from their
 * organization's settings. The test is `GET /v1/me`, which answers for any
 * live key, and the connection is labeled with the key's own name so two
 * keys read apart in Zapier without either secret showing.
 */
module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      helpText:
        'Create one in Aglyn under your organization’s settings, **API keys**. Give it the scopes your Zaps need: ' +
        '`sites:read` to choose a site, then `orders:read`, `bookings:read`, `contacts:read` or `forms:read` for triggers, ' +
        'and `contacts:write` or `orders:write` for actions.',
    },
  ],
  test: async (z) => {
    const response = await z.request({ url: apiUrl('/v1/me') })
    return response.data
  },
  connectionLabel: (z, bundle) => {
    const me = bundle.inputData || {}
    return me.name ? `${me.name} (${me.org})` : String(me.org || 'Aglyn')
  },
}
