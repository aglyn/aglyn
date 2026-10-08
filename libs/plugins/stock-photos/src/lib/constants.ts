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

/** The plugin's id, as `plugins.config.json` names it. */
export const STOCK_PHOTOS_PLUGIN_ID = 'stock-photos'

/**
 * The search cache (AGL-3660): `stockPhotoSearches/{key}`, top level, one
 * document per search a library answered, keyed by a SHA-256 of the provider
 * and the request. Platform-wide, like `mailDomains`: what a library says
 * about "yoga studio" is a fact about the library, not about any workspace,
 * and it holds no workspace's data. Kept 24 hours (`expiresAt`, Firestore
 * TTL), which is what Pixabay's terms ask of every request.
 */
export const STOCK_PHOTO_SEARCH_CACHE_COLLECTION = 'stockPhotoSearches'

/** How long a search answer is kept and served again. */
export const STOCK_PHOTO_SEARCH_CACHE_MS = 24 * 60 * 60 * 1000
