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

import type {
  MediaDeliveryCapability,
  MediaDeliveryProvider,
} from '@aglyn/aglyn/plugin-manager/media-delivery-provider'
import {
  DELIVERY_SECRET_MIN_LENGTH,
  DELIVERY_TOKEN_PARAM,
  mintDeliveryToken,
} from './delivery-token'
import {
  createR2ObjectStore,
  deleteR2Prefix,
  r2CredentialsUsable,
  type R2ObjectStore,
} from './r2-object-store'
import { encodeRfc3986 } from './sigv4'

/**
 * Core's media delivery provider, on Cloudflare R2 and a Worker (AGL-2824).
 *
 * `store` is R2's S3 API with a bucket-scoped key pair; `deliver` is a token
 * the Worker on the delivery host verifies before it serves the object from
 * its bucket binding. The two capabilities read different settings, so a
 * deployment can hold the R2 key pair only where copies are written — the
 * console — and the delivery secret wherever a URL is minted.
 *
 * Settings are read from the environment on every call rather than once, so
 * a deployment that gains or loses them behaves accordingly without a
 * restart, and each read is a handful of property lookups.
 */

export interface VideoDeliverySettings {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  /** A bare hostname, or an origin; see {@link videoDeliveryOrigin}. */
  deliveryHost: string
  deliverySecret: string
}

/** The provider's settings, from this process's environment. */
export function videoDeliverySettingsFromEnv(): VideoDeliverySettings {
  return {
    accountId: (process.env['R2_ACCOUNT_ID'] ?? '').trim(),
    accessKeyId: (process.env['R2_ACCESS_KEY_ID'] ?? '').trim(),
    secretAccessKey: (process.env['R2_SECRET_ACCESS_KEY'] ?? '').trim(),
    bucket: (process.env['R2_VIDEO_BUCKET'] ?? '').trim(),
    deliveryHost: (process.env['MEDIA_VIDEO_DELIVERY_HOST'] ?? '').trim(),
    deliverySecret: (process.env['MEDIA_VIDEO_DELIVERY_SECRET'] ?? '').trim(),
  }
}

/**
 * The origin delivery URLs are minted on, or null for a setting that is not
 * one.
 *
 * A bare hostname (`video.example.workers.dev`) means HTTPS. A full origin is
 * accepted too, which is what a local `wrangler dev` needs: HTTPS anywhere,
 * or HTTP on the loopback host only. Anything with a path, a query or
 * credentials is refused rather than trimmed, because a URL minted on a
 * guess is a URL that points somewhere nobody chose.
 */
export function videoDeliveryOrigin(host: string): string | null {
  const value = host.trim()
  if (!value) return null
  if (value.includes('://')) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return null
    }
    if (url.username || url.password || url.search || url.hash) return null
    if (url.pathname !== '/' && url.pathname !== '') return null
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) {
      return url.origin
    }
    return null
  }
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::\d{1,5})?$/i.test(value)) return null
  return `https://${value.toLowerCase()}`
}

/** Whether `settings` hold everything `capability` needs. */
export function videoDeliveryConfigured(
  settings: VideoDeliverySettings,
  capability: MediaDeliveryCapability,
): boolean {
  if (capability === 'deliver') {
    return (
      videoDeliveryOrigin(settings.deliveryHost) !== null &&
      settings.deliverySecret.length >= DELIVERY_SECRET_MIN_LENGTH
    )
  }
  return r2CredentialsUsable(settings)
}

export function createVideoDeliveryProvider(
  options: {
    settings?: () => VideoDeliverySettings
    fetch?: typeof fetch
    now?: () => number
  } = {},
): MediaDeliveryProvider {
  const settings = options.settings ?? videoDeliverySettingsFromEnv
  const now = options.now ?? Date.now

  /** The object store for the current settings; throws when unconfigured. */
  const store = (): R2ObjectStore => {
    const current = settings()
    if (!videoDeliveryConfigured(current, 'store')) {
      throw new Error('Video delivery storage is not configured')
    }
    return createR2ObjectStore(current, {
      ...(options.fetch ? { fetch: options.fetch } : {}),
      now: () => new Date(now()),
    })
  }

  return {
    isConfigured: (capability) => videoDeliveryConfigured(settings(), capability),

    putObject: (request) => store().putObject(request),

    deleteObject: (key) => store().deleteObject(key),

    deleteObjectsWithPrefix: (prefix) => deleteR2Prefix(store(), prefix),

    async deliveryUrl({ key, expiresAtMs, claims }) {
      const current = settings()
      const origin = videoDeliveryOrigin(current.deliveryHost)
      if (!origin || !videoDeliveryConfigured(current, 'deliver')) {
        throw new Error('Video delivery is not configured')
      }
      const token = await mintDeliveryToken(
        {
          key,
          expiresAtMs,
          orgId: claims.orgId,
          hostId: claims.hostId,
          mediaId: claims.mediaId,
          scope: claims.scope,
        },
        current.deliverySecret,
        now(),
      )
      const path = key.split('/').map(encodeRfc3986).join('/')
      return `${origin}/${path}?${DELIVERY_TOKEN_PARAM}=${token}`
    },
  }
}
