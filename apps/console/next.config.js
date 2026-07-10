/**
 * @license
 * Copyright 2023 Aglyn LLC
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

// MARK – IMPORTS
// eslint-disable-next-line @typescript-eslint/no-var-requires, @nx/enforce-module-boundaries
const withAglyn = require('../../with-aglyn.nextjs.config')

// MARK – GLOBALS
const isProduction = process.env.NODE_ENV !== 'production'

/**
 * @type {import('/tools/nextjs-base.config').WithAglynOptions}
 **/
module.exports = withAglyn({
  // experimental: { appDir: isProduction },
  env: {
    AGLYN_SILOED_HOST: process.env.AGLYN_SILOED_HOST,
  },
  // Manage → Org section move (AGL-236) and the staff Tenants →
  // Organizations rename (AGL-238): old bookmarks keep working.
  async redirects() {
    return [
      ...['billing', 'team', 'support', 'community'].map((section) => ({
        source: `/manage/${section}`,
        destination: `/org/${section}`,
        permanent: true,
      })),
      {
        source: '/admin/tenants',
        destination: '/admin/orgs',
        permanent: true,
      },
      {
        source: '/admin/tenants/:tenantId',
        destination: '/admin/orgs',
        permanent: true,
      },
    ]
  },
})
