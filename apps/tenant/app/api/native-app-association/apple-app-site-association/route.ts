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

import { appleAppSiteAssociationResponse, hostnameOfUrl } from '@aglyn/aglyn/app-utils/native-app-association'
import { PLATFORM_HOME_URL } from '@aglyn/aglyn/app-utils/platform-brand'

// lockdown-423: exempt — a public document Apple's verifier fetches with no
// caller identity; it names the native apps and acts for no site.

export const dynamic = 'force-dynamic'

/**
 * `/.well-known/apple-app-site-association` on the platform's own home site
 * (AGL-3817), rewritten here by `middleware.ts`. That host is the passkey
 * relying party, so it carries `webcredentials` only: its paths are site
 * pages, not the console links the apps resolve. Every other site this app
 * serves is a customer's, and answers 404.
 */
export function GET(request: Request): Response {
  return appleAppSiteAssociationResponse({
    host: request.headers.get('host'),
    servedHosts: [hostnameOfUrl(PLATFORM_HOME_URL)],
    applinks: false,
    env: process.env,
  })
}
