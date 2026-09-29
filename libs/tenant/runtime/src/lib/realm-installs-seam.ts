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
 * The static edge to the host's realm installs that `compose-screen-nodes.ts`
 * defers by RELATIVE path (AGL-3393).
 *
 * `realm-plugins` reaches `render-cache`, which imports `next/cache`, and
 * loading that module outside a Next server — a jsdom spec composing a tree —
 * throws at import time (`NextRequest` extends a `Request` jsdom does not
 * have). Compose only reads the installs when a tree places a marketplace
 * element on a host with a function, so deferring this file keeps every other
 * compose, and every spec that imports compose, from loading it. A relative
 * specifier crosses no project boundary, so nx records no lazy edge.
 */
export { getRealmPluginInstalls } from '@aglyn/tenant-data-admin/server/realm-plugins'
