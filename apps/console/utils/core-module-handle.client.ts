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
 * Hangs the whole core namespace off `window.AglynModule`, so a developer with
 * an editor open can call any core export from a devtools console.
 *
 * This is the second place in the console that needs the core namespace as a
 * single VALUE, after the realm-plugin host ABI, and it is a module of its own
 * for the same reason `realm-plugin-host.client.ts` is. A namespace held as a
 * value is opaque to a bundler — it cannot know which exports are read, so it
 * keeps every module the barrel reaches. Held in `constants/app-setup`, which
 * every editor route imports for its side effect, it pinned all 176 of the
 * `app-utils` modules into the besigner's first load: the health checks, the
 * request-IP and upload-CORS helpers, the collection-delete rules, none of
 * which a canvas reads.
 *
 * `app-setup` reaches this file by RELATIVE `import()`, which crosses no
 * project boundary and so registers no dynamic nx edge. Deferring
 * `@aglyn/aglyn` by its package specifier instead makes
 * `@nx/enforce-module-boundaries` forbid every static import of core across
 * the whole app, which is what `aglyn/no-dynamic-first-party-import` exists to
 * prevent.
 *
 * The caller gates the call on `IS_PRODUCTION`, so a visitor to a production
 * editor never fetches the chunk this import creates.
 */
export function exposeCoreModule(): void {
  ;(window as unknown as { AglynModule: typeof Aglyn }).AglynModule = Aglyn
}
