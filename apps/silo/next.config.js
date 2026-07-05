/**
 * @license
 * Copyright 2022 Aglyn LLC
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

// eslint-disable-next-line @typescript-eslint/no-var-requires, @nx/enforce-module-boundaries
const withAglyn = require('../../with-aglyn.nextjs.config')

// MARK – GLOBALS
const isProduction = process.env.NODE_ENV === 'production'

/**
 * @type {import('/tools/nextjs-base.config').WithAglynOptions}
 **/
module.exports = withAglyn({
  env: {
    AGLYN_TENANT_HOST_ID: process.env.AGLYN_TENANT_HOST_ID,
    AGLYN_TENANT_HOST_HOSTNAME: process.env.AGLYN_TENANT_HOST_HOSTNAME,
    AGLYN_TENANT_HOST_HOST: process.env.AGLYN_TENANT_HOST_HOST,
    AGLYN_TENANT_HOST_URL: process.env.AGLYN_TENANT_HOST_URL,
    AGLYN_TENANT_HOST_CNAME: process.env.AGLYN_TENANT_HOST_CNAME,
    AGLYN_TENANT_PUBLIC_KEY: process.env.AGLYN_TENANT_PUBLIC_KEY,
    AGLYN_SILOED_HOST: process.env.AGLYN_SILOED_HOST,
  },
})
