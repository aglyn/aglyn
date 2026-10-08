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

const { apiUrl, rowsOf } = require('../lib/api')

/**
 * The organization's sites, for every Site dropdown (AGL-3643). Hidden: it
 * feeds dropdowns and starts no Zap. Pages through `GET /v1/sites` with the
 * list's own cursor, a hundred at a time. Needs `sites:read`.
 */
module.exports = {
  key: 'site',
  noun: 'Site',
  display: {
    label: 'Site',
    description: 'Lists your sites, for choosing one.',
    hidden: true,
  },
  operation: {
    canPaginate: true,
    perform: async (z, bundle) => {
      const cursor = bundle.meta && bundle.meta.page ? await z.cursor.get() : undefined
      const response = await z.request({
        url: apiUrl('/v1/sites'),
        params: { limit: 100, ...(cursor ? { cursor } : {}) },
      })
      await z.cursor.set((response.data && response.data.next_cursor) || '')
      return rowsOf(response).map((site) => ({
        ...site,
        name: site.displayName || site.domain || site.subdomain || site.id,
      }))
    },
    sample: {
      id: 'host_demo',
      object: 'site',
      displayName: 'Demo Bakery',
      subdomain: 'demo',
      domain: null,
      name: 'Demo Bakery',
    },
  },
}
