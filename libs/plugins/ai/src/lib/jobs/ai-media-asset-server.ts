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
 * The server helpers a media library read defers (AGL-2916): storage, the
 * media CDN's block and sharp, loaded only when a job actually reads an
 * asset's bytes.
 *
 * The deferral targets THIS module by relative path, for the reason
 * `ai-theme-brand-server.ts` gives: a workspace lib ever `import()`ed by its
 * package specifier is lazy-loaded everywhere as far as nx is concerned, and
 * the module boundary rule then forbids every static import of
 * `@aglyn/tenant-data-admin` across the plugin and both apps. A relative
 * specifier crosses no project boundary.
 *
 * Import this module dynamically, and only from `ai-media-asset.ts`.
 */
export { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
export { mediaStoragePathInScope } from '@aglyn/tenant-data-admin/server/media-storage-path'
export { loadSharp } from '@aglyn/tenant-data-admin/server/media-variants'
export { mediaCdnServeBlock } from '@aglyn/tenant-data-admin/server/serve-media-cdn'
