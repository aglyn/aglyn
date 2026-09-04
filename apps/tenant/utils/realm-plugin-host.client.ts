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
 * Composes `__AGLYN_PLUGIN_HOST__`, which is the one place the tenant app needs
 * the core namespace as a single VALUE.
 *
 * A separate module for the same reason `boot-warmup.ts` is one, and the cost
 * here is a visitor's bandwidth rather than a cold start.
 *
 * The ABI hands a remote bundle the whole core namespace. A namespace passed as
 * a value is opaque to a bundler — it cannot know which exports the consumer
 * reads, so every module reachable from the barrel is kept and shipped. Holding
 * that import in a module the published page loads eagerly therefore pinned the
 * console route table, the plan and billing tables and the DMCA, webhook,
 * dataset and marketplace models into every visitor's download, on the
 * overwhelming majority of sites, which have no realm plugin installed at all.
 *
 * Measured as encoded bytes on a cold load of a real published home page
 * (Turbopack production build, gzip, CDP `encodedDataLength`): 1041.9 KB over
 * 64 requests before this boundary and the named imports that go with it,
 * 949.2 KB over 70 after. JavaScript is 889.8 KB of the first figure and
 * 797.0 KB of the second, and core's own share of it fell from 211.3 KB to
 * 141.7 KB — the console route table, the plan and billing tables and the
 * DMCA, webhook and dataset models leaving the page.
 *
 * `realm-plugins.client.ts` reaches this file by RELATIVE `import()`, which
 * crosses no project boundary and so registers no dynamic nx edge. Deferring
 * `@aglyn/aglyn` by its package specifier instead makes
 * `@nx/enforce-module-boundaries` forbid every static import of core across the
 * whole app — hundreds of errors on files that did not change, which is what
 * `aglyn/no-dynamic-first-party-import` exists to prevent.
 *
 * It also has to live in the APP rather than in core. `realm-plugins.ts` is on
 * the `/server` path (`realm-server.ts` imports it), and a deferred barrel
 * import placed there pulls `app-utils/contexts` — and its `createContext` —
 * into the RSC graph, which fails the production build outright.
 *
 * React and the JSX runtime are the app's own: the blank-canvas invariant is
 * that a remote bundle shares THIS bundle's React singleton.
 */
export function composeRealmPluginHost(host: {
  React: unknown
  jsxRuntime: unknown
}): void {
  Aglyn.setRealmPluginHost({ ...host, aglyn: Aglyn })
}
