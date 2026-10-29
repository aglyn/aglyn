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
 * The server read the site-import edge defers (AGL-4085): whether this
 * platform serves a hostname, which opens Firestore and the hosting
 * platform's API. `site-import-edge.ts` loads it only once a secret is
 * configured, so a crawl without one never opens either.
 *
 * The deferral targets THIS module by relative path, for the reason
 * `ai-theme-brand-server.ts` gives: an `import()` of `@aglyn/tenant-data-admin`
 * by its package specifier makes nx treat that lib as lazy-loaded everywhere,
 * and every static import of it across the plugin, the console and the
 * tenant then fails lint.
 *
 * Import this module dynamically, and only from `site-import-edge.ts`.
 */
export { isPlatformServedDomain } from '@aglyn/tenant-data-admin/server/platform-served-domain'
