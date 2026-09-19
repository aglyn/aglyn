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

import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginService,
} from './plugin-services'

/**
 * Media delivery through a provider outside this platform (AGL-2824).
 *
 * The media CDN serves every byte through a function, which is the right
 * shape for images the edge can hold and the wrong one for video: a video
 * is served `private` (AGL-1515), so every play pulls the whole file through
 * the function and its transfer is billed twice over. A delivery provider is
 * an object store with its own edge in front. The platform keeps every access
 * decision and hands a caller a short-lived signed URL on the provider's
 * host; the provider checks that URL and serves the bytes.
 *
 * Core defines the contract and never names a provider. A plugin registers
 * the one implementation from its `serverDeclarations` entry, so the
 * provider is registered in both apps before the first request, and core
 * asks for it by capability:
 *
 *  - `store` — the provider can hold copies: `putObject`, `deleteObject`,
 *    `deleteObjectsWithPrefix`. Only a process that writes copies needs the
 *    credentials behind it.
 *  - `deliver` — the provider can mint a delivery URL: `deliveryUrl`. Every
 *    process that answers a media request needs it.
 *
 * A provider that is registered and not configured for a capability answers
 * as absent for it, so a deployment with no provider settings behaves exactly
 * as one without the plugin.
 *
 * ## What the platform keeps
 *
 * The media document stays the record of an asset, and the platform's own
 * bucket keeps the bytes; a provider holds COPIES, keyed by the content hash
 * they were made from (`media-delivery.ts` in `tenant-data-admin` owns the
 * key grammar and the copy record). Nothing here authorizes a caller: every
 * access decision is made before core asks the provider for a URL.
 */

/** What a provider must be configured for before core relies on it. */
export type MediaDeliveryCapability = 'store' | 'deliver'

/** The bytes of one copy. A stream is read once, start to end. */
export type MediaDeliveryBody = ReadableStream<Uint8Array> | Uint8Array

export interface MediaDeliveryPutRequest {
  /** The object key, from core's key grammar. */
  key: string
  body: MediaDeliveryBody
  /** Exact byte length of `body`; the provider sends it as-is. */
  contentLength: number
  /** The type the provider should serve the object as. */
  contentType: string
}

/**
 * What a delivery URL carries about the request it was minted for, so a
 * provider can attribute delivered bytes to an organization later. None of it
 * authorizes anything: the URL is bound to its key, and the platform decided
 * who may have it before minting.
 */
export interface MediaDeliveryClaims {
  /** The CDN scope segment the asset was requested under. */
  scope: string
  mediaId: string
  /** The owning organization, or null when it could not be resolved. */
  orgId: string | null
  /** The site the delivery is for, or null for an org-wide request. */
  hostId: string | null
}

export interface MediaDeliveryUrlRequest {
  key: string
  /** When the URL stops working. The provider may refuse a longer lifetime. */
  expiresAtMs: number
  claims: MediaDeliveryClaims
}

export interface MediaDeliveryProvider {
  /** Whether this deployment has the settings `capability` needs. */
  isConfigured(capability: MediaDeliveryCapability): boolean
  /** Stores one object under `key`, replacing any object already there. */
  putObject(request: MediaDeliveryPutRequest): Promise<void>
  /** Removes `key`. Resolves when the key is absent, whether or not it existed. */
  deleteObject(key: string): Promise<void>
  /**
   * Removes every object whose key starts with `prefix`, and answers how
   * many it removed. An erasure calls it with a scope's whole prefix.
   */
  deleteObjectsWithPrefix(prefix: string): Promise<number>
  /** A URL on the provider's host that serves `key` until `expiresAtMs`. */
  deliveryUrl(request: MediaDeliveryUrlRequest): Promise<string>
}

/**
 * The slot one plugin holds. A second plugin registering a provider is a
 * conflict, not a list: two providers would each hold half the copies, and
 * a URL minted by one would name an object the other stores.
 */
export const MEDIA_DELIVERY_PROVIDER =
  definePluginServiceContract<MediaDeliveryProvider>('core.media-delivery', {
    multiple: false,
  })

/**
 * Registers the platform's delivery provider. The owner is the loader's
 * marker when a register fn is running, else `options.pluginId`. The same
 * plugin registering again replaces its provider; a different plugin throws
 * naming both.
 */
export function registerMediaDeliveryProvider(
  provider: MediaDeliveryProvider,
  options?: { pluginId?: string },
): void {
  registerPluginService(MEDIA_DELIVERY_PROVIDER, provider, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/**
 * The registered provider when it is configured for `capability`, else
 * `null`. Synchronous and free of I/O, so a hot path can ask it first and pay
 * nothing when no provider is set up.
 *
 * A provider whose configuration check throws answers as unconfigured: a
 * delivery provider is an optimization over serving the bytes directly, and
 * its failure must leave that path standing.
 */
export function mediaDeliveryProvider(
  capability: MediaDeliveryCapability,
): MediaDeliveryProvider | null {
  const provider = resolvePluginService(MEDIA_DELIVERY_PROVIDER)
  if (!provider) return null
  try {
    return provider.isConfigured(capability) ? provider : null
  } catch {
    return null
  }
}
