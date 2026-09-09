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
 * The chunk boundary for the attribution guard (AGL-2706), and nothing else.
 *
 * `attribution-guard.component.tsx` defers THIS module by relative path from
 * its effect. The deferral is the point — the guard is only wanted where
 * there is attribution to guard, and a static import ships its bytes to paid
 * sites that render neither marked element. Only the SPECIFIER lives here.
 *
 * Deferring `@aglyn/aglyn/app-utils/attribution-guard` by its package
 * specifier instead registers a DYNAMIC edge on the `tenant → aglyn` project
 * pair. nx then treats core as lazy-loaded and
 * `@nx/enforce-module-boundaries` forbids every STATIC import of it across
 * the whole app — 100 errors on files nobody had touched, which is the
 * failure `aglyn/no-dynamic-first-party-import` exists to prevent and which
 * `utils/report-server-error.ts` is the server-side twin of. A relative
 * specifier crosses no project boundary, so nx records no lazy edge, while
 * Turbopack splits on the `import()` exactly as it did before.
 *
 * `ATTRIBUTION_ATTRIBUTE` is deliberately NOT re-exported here. The page has
 * to name the marker attribute eagerly, which is why it lives in a leaf of
 * its own; routing it through this module would put the guard back on every
 * page that marks an element.
 *
 * Import it dynamically and only from the component's effect. A static import
 * of this file puts the guard back on every site.
 */
export { installAttributionGuard } from '@aglyn/aglyn/app-utils/attribution-guard'
