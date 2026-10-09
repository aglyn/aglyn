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

// By path, not through a barrel: boot needs one registry.
import { registerStockPhotoProvider } from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import { STOCK_PHOTOS_PLUGIN_ID } from './constants'
import { createPixabayStockPhotoProvider } from './pixabay-provider'
import type { PixabayPhoto } from './providers/pixabay'
import { createFirestoreSearchCache } from './server/search-cache'

/**
 * The plugin's CONSOLE server declarations (AGL-3660): Pixabay, in core's
 * `core.stock-photos` slot. The console alone: the AI jobs that copy stock
 * photos run there, and the tenant runtime, which serves the public
 * internet, has no reason to hold the key or bundle the client.
 *
 * Light by construction: registering reads no setting and opens no
 * connection. The key is read when a caller asks, and the cache's Firestore
 * handle on the first search.
 */
export function registerStockPhotosConsoleServerDeclarations(): void {
  registerStockPhotoProvider(
    createPixabayStockPhotoProvider({
      cache: createFirestoreSearchCache<PixabayPhoto>({
        firestore: async () => (await import('./server/firestore')).stockPhotosFirestore(),
      }),
    }),
    { pluginId: STOCK_PHOTOS_PLUGIN_ID },
  )
}
