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
 * The nodejs-only seam for `instrumentation.ts`'s error hook (AGL-1921).
 *
 * A separate module for the same single reason `apps/tenant/utils/boot-warmup.ts`
 * is one, and it is a GRAPH constraint rather than a runtime one: nx treats a
 * workspace lib that is ever `import()`ed as lazy-loaded EVERYWHERE, so
 * `await import('@aglyn/tenant-data-admin')` written directly in
 * `instrumentation.ts` made `@nx/enforce-module-boundaries` forbid every
 * STATIC import of that lib across the whole app — 181 errors in console and
 * 41 in tenant, none of them in a file anyone had touched.
 *
 * The lib is imported STATICALLY here; `instrumentation.ts` defers THIS file
 * by relative path instead. A relative specifier crosses no project boundary,
 * so nx records no lazy edge — while the deferral still does its runtime job
 * of keeping firebase-admin out of the edge (middleware) bundle, because this
 * module is only ever reached from inside the `NEXT_RUNTIME === 'nodejs'`
 * branch.
 *
 * Import it dynamically and only there. A static import of this file from
 * `instrumentation.ts` would pull firebase-admin into the edge bundle.
 */
export { reportServerError } from '@aglyn/tenant-data-admin'
