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

'use client'

import * as Aglyn from '@aglyn/aglyn'

/**
 * Console side of the realm-plugin host ABI (AGL-420), and the one place the
 * console needs the core namespace as a single VALUE. Remote bundles import
 * nothing; they reach React and every core registry through this object.
 *
 * The ABI hands a remote bundle the whole core namespace. A namespace passed
 * as a value is opaque to a bundler — it cannot know which exports the
 * consumer reads, so every module reachable from the barrel is kept and
 * shipped. Holding that import in a module the console shell loads eagerly
 * therefore pinned the whole of `app-utils` into the org route's first load:
 * the health checks, the request-IP and upload-CORS helpers, the SVG
 * sanitizer and the collection-delete rules, none of which run in a browser
 * and none of which a console page reads.
 *
 * `realm-plugins.client.ts` reaches this file by RELATIVE `import()`, which
 * crosses no project boundary and so registers no dynamic nx edge. Deferring
 * `@aglyn/aglyn` by its package specifier instead makes
 * `@nx/enforce-module-boundaries` forbid every static import of core across
 * the whole app, which is what `aglyn/no-dynamic-first-party-import` exists
 * to prevent.
 *
 * React and the JSX runtime are the app's own: the blank-canvas invariant is
 * that a remote bundle shares THIS bundle's React singleton.
 *
 * The tenant twin is `apps/tenant/utils/realm-plugin-host.client.ts`.
 */
export function composeRealmPluginHost(host: {
  React: unknown
  jsxRuntime: unknown
}): void {
  Aglyn.setRealmPluginHost({ ...host, aglyn: Aglyn })
}
