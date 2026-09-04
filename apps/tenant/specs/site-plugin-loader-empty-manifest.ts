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
 * `../utils/site-plugin-loader` with nothing in the manifest — the drop-in a
 * spec that renders `CatchAllPage` for something OTHER than the canvas asks
 * for:
 *
 * ```ts
 * jest.mock('../utils/site-plugin-loader', () =>
 *   require('./site-plugin-loader-empty-manifest'),
 * )
 * ```
 *
 * ## What it costs to leave the real one in
 *
 * `CatchAllPage` opens with `use(sitePluginLoader.ensure(…))`, and the real
 * `TENANT_PLUGIN_MANIFEST` reaches every first-party bundle through
 * `() => import('@aglyn/plugins-*')`. Under jest that is ~1,200 first-party
 * modules for babel to transform, and it is charged to whichever test renders
 * first, against a 30 s per-test budget:
 *
 * | phase, cold, one spec file      | wall     | cpu     |
 * | ------------------------------- | -------- | ------- |
 * | `ensure` the manifest's plugins | 105.1 s  | 42.3 s  |
 * | the render that follows it      |   0.05 s |  0.04 s |
 *
 * Warm the same `ensure` is 6.7 s, so the bulk is transform rather than
 * execution. That is what makes the failure a coin toss rather than a signal:
 * a warm cache puts the whole file under 13 s and green, a cold one puts a
 * single test at 41 s and red, and CI is always cold. jest's transform cache
 * is shared across a run but its module registry is not, so concurrent workers
 * each pay it in full and which test wears the charge moves with the scheduler.
 *
 * ## Why an empty manifest and not a fake `ensure`
 *
 * The loader stays REAL — `createPluginLoader` with no entries keeps the
 * promise caching, the React thenable contract and, crucially, the first-render
 * SUSPENSION that these specs' `renderSettled` helpers exist to flush. A
 * hand-written `ensure: async () => {}` would drop that shape, and the helpers
 * would be settling nothing.
 *
 * ## Why this does not weaken what the specs prove
 *
 * Only the bundles are gone, and a bundle can contribute to a render exactly
 * one way: by registering a canvas component. A spec using this passes `nodes`
 * as `null` or `{}`, so no canvas node renders and no plugin-registered
 * component can reach the DOM — anything asserted about the output came from
 * `catch-all-client.tsx`'s own JSX either way. Should one of those sinks ever
 * move behind a plugin component, the registry is empty and the assertion goes
 * red, not quietly green.
 *
 * That `CatchAllPage` gates on `ensure` at all is pinned separately, and by
 * the file that should own it: `analytics-survive-plugin-stall.spec.tsx` plants
 * the real loader's `ensure` and asserts the page genuinely suspends on a gate
 * that never settles and genuinely throws on one that rejects.
 */

import { createPluginLoader } from '@aglyn/aglyn/plugin-manager/plugin-loader'

export const sitePluginLoader = createPluginLoader([])
