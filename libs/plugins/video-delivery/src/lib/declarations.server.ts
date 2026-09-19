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
import { registerMediaDeliveryProvider } from '@aglyn/aglyn/plugin-manager/media-delivery-provider'
import { VIDEO_DELIVERY_PLUGIN_ID } from './constants'
import { createVideoDeliveryProvider } from './video-delivery-provider'

/**
 * The plugin's SERVER declarations (AGL-2824): the delivery provider, in
 * core's `core.media-delivery` slot.
 *
 * Named under `serverDeclarations` in `plugins.config.json`, so both apps
 * register it at boot (`instrumentation.ts`), before the first request. The
 * routes that need it — the media CDN in both apps, the commerce stream, the
 * console's upload, replace, restore and takedown routes — are core routes
 * that never load a plugin surface, so a registration made anywhere later
 * would miss them.
 *
 * Light by construction: registering reads no setting and opens no
 * connection. The provider reads its settings when core asks it a question,
 * and answers "not configured" until they are set, so a deployment without
 * them serves every video exactly as before.
 */
export function registerVideoDeliveryServerDeclarations(): void {
  registerMediaDeliveryProvider(createVideoDeliveryProvider(), {
    pluginId: VIDEO_DELIVERY_PLUGIN_ID,
  })
}
