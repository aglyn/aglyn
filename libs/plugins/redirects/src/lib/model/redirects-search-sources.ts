/**
 * @license
 * Copyright 2026 Aglyn LLC
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *   http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { ConsoleSearchSource } from '@aglyn/aglyn'
import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'

/**
 * What the console's search finds among a site's redirects (AGL-3080): a
 * redirect by the path it answers or the one it sends to, opening on the
 * site's Redirects page. A redirect has no name, so its source path is what
 * a row is labeled by.
 */
export const REDIRECTS_SEARCH_SOURCES: readonly ConsoleSearchSource[] = [
  {
    id: 'redirects',
    group: 'Redirects',
    noun: 'redirects',
    scope: 'host',
    collection: 'redirects',
    nameField: 'source',
    extraFields: ['destination'],
    entitlementKey: 'redirectsPerHost',
    order: 170,
    href: (_row, { orgSlug, host }) =>
      host ? buildRoute(Route.HOST_REDIRECTS, { orgSlug, host }) : null,
  },
]
