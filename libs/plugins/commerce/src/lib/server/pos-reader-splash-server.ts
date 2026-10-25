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
 * The server helpers the card reader start-up screen (AGL-4048) loads only
 * when it draws or reads an image: the media CDN's block, a media asset's
 * storage path, `sharp`, and the pinned fetch for an outside logo address.
 *
 * Loaded by RELATIVE path from `pos-reader-splash.ts` and
 * `pos-reader-splash-admin.ts`, never by importing `@aglyn/tenant-data-admin`
 * lazily: a workspace lib `import()`ed by its package specifier is lazy-loaded
 * everywhere as far as nx is concerned, and every static import of it across
 * this plugin would then fail the module boundary rule
 * (`ai-media-asset-server.ts` in the AI plugin is the same arrangement).
 */
export { mediaStoragePathInScope } from '@aglyn/tenant-data-admin/server/media-storage-path'
export { loadSharp } from '@aglyn/tenant-data-admin/server/media-variants'
export { mediaCdnServeBlock } from '@aglyn/tenant-data-admin/server/serve-media-cdn'
export { createPinnedDispatcher, resolvePublicIp } from '@aglyn/tenant-data-admin/server/serve-plugin-fetch'
