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
 * The chunk boundary for the consent surfaces (AGL-2706), and nothing else.
 *
 * `site-analytics.tsx` defers THIS module by relative path. The deferral is
 * the point — `consent.ready` starts false, so the banner is drawn on neither
 * the server render nor the first client render, and MUI's `Dialog`,
 * `Switch`, `FormControlLabel` and `SwitchBase` have no business on first
 * paint of every published screen. Only the SPECIFIER lives here.
 *
 * Deferring `@aglyn/aglyn/app-utils/consent-banner-ui` by its package
 * specifier instead registers a DYNAMIC edge on the `tenant → aglyn` project
 * pair. nx then treats core as lazy-loaded and
 * `@nx/enforce-module-boundaries` forbids every STATIC import of it across
 * the whole app — 100 errors on files nobody had touched, which is the
 * failure `aglyn/no-dynamic-first-party-import` exists to prevent and which
 * `utils/report-server-error.ts` is the server-side twin of. A relative
 * specifier crosses no project boundary, so nx records no lazy edge, while
 * Turbopack splits on the `import()` exactly as it did before.
 *
 * Deliberately NO 'use client' directive. Next treats such a module as a
 * client entry of its own and builds it a chunk group to match; this one is
 * only ever reached from `site-analytics.tsx`, which is already a client
 * module, so the directive would buy a second chunk group and the duplicated
 * bytes that come with it (AGL-2706 measured that shape on the 404 boundary).
 *
 * Import it dynamically and only from there. A static import of this file
 * puts the preferences dialog straight back into first paint.
 */
export { default } from '@aglyn/aglyn/app-utils/consent-banner-ui'
