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
  // Same-origin Firebase auth helpers (AGL-462): OAuth redirect/popup
  // return legs break under third-party storage partitioning when the
  // authDomain is cross-origin (*.firebaseapp.com), which is why Google
  // sign-in from a mobile browser never completed. Proxying /__/* lets
  // the client use window.location.host as authDomain (see
  // resolveFirebaseAuthDomain) so the whole handshake stays same-site.
  async rewrites() {
    const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    if (!project) return []
    return [
      {
        source: '/__/:path*',
        destination: `https://${project}.firebaseapp.com/__/:path*`,
      },
    ]
  },
  // Manage → Org section move (AGL-236): old bookmarks keep working.
  async redirects() {
    return [
      ...['billing', 'team', 'support', 'community'].map((section) => ({
        source: `/manage/${section}`,
        destination: `/org/${section}`,
        permanent: true,
      })),
    ]
  },
})
