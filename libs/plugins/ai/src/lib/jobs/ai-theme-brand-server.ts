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
 * The server helpers the theme brand reads defer (AGL-2938).
 *
 * A theme job loads the pinned fetch only when it actually reads a page the
 * brief links to, so `ai-theme-brand-inputs` defers it; a logo is read through
 * the media library's own read, which defers its storage helpers from
 * `ai-media-asset-server.ts`. The deferral has to target THIS module by
 * relative path. Nx treats a workspace lib that is ever `import()`ed by its
 * package specifier as lazy-loaded everywhere, and
 * `@nx/enforce-module-boundaries` then forbids every static import of
 * `@aglyn/tenant-data-admin` across the plugin, the console and the tenant —
 * the constraint `report-server-error.ts` documents in both apps. A relative
 * specifier crosses no project boundary, so nx records no lazy edge.
 *
 * Import this module dynamically, and only from the brand reads.
 */
export {
  createPinnedDispatcher,
  resolvePublicIp,
} from '@aglyn/tenant-data-admin/server/serve-plugin-fetch'
