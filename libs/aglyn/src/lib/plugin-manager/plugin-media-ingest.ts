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
  AglynHostMediaImportSource,
  AglynHostMediaStockSource,
} from '../foundation/definitions/platform.types'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginService,
} from './plugin-services'

/**
 * A SERVER PROCESS STORES A PICTURE IN A SITE'S MEDIA LIBRARY (AGL-3660).
 *
 * The media library takes bytes through the console's own ingress — the
 * upload routes and the v1 API — which check the caller, the site's
 * lockdown, the bytes' structure, the takedown list, the plan and the
 * storage band before anything is written. A plugin that holds a picture on
 * the server with no browser request behind it (an AI job copying a stock
 * photo) has no route to post to. This is that route's door for it: the
 * console registers the one implementation at boot (`instrumentation.ts`),
 * the same direction as `core.site-cache`, and it applies the ingress checks
 * as the member named, so a plugin never writes a media document or a
 * Storage object itself.
 *
 * Images only: a server-held video or document has no caller yet.
 *
 * A process with no implementation answers `null` from
 * {@link pluginMediaIngest}, and a caller keeps its own fallback.
 */

export interface PluginMediaIngestRequest {
  /**
   * The site whose library the asset is stored in; with {@link orgId}, the
   * site on screen, if any, which the workspace's Default sharing may narrow
   * the asset to, and otherwise empty.
   */
  hostId: string
  /**
   * The workspace whose SHARED library the asset is stored in instead of a
   * site's (AGL-4066): the media picker opened with no site, adding a stock
   * photo. Absent, the site's own library.
   */
  orgId?: string
  /**
   * The member the asset is stored as. Their access to the site, the site's
   * lockdown and the workspace's plan and storage band are checked as for
   * an upload they made themselves.
   */
  uid: string
  fileName: string
  /** A raster image type: `image/jpeg`, `image/png`, `image/webp` or `image/gif`. */
  contentType: string
  bytes: Uint8Array
  alt?: string
  description?: string
  /** Where a photo copied from a stock library came from (`stockPhoto` on the asset). */
  stockPhoto?: Omit<AglynHostMediaStockSource, 'importedAt'>
  /**
   * The library folder the asset is filed in (AGL-3957); absent or null,
   * the library's root. An id the library does not hold files the asset at
   * the root, as an upload naming a stale folder does.
   */
  folderId?: string | null
  /**
   * The asset is the business's own photo, sent through a site photo link
   * (AGL-3957) — the id of the link it came through. Stamps `ownerPhoto` on
   * the asset, which is what the AI reads its owner's pictures by.
   */
  ownerPhotoLinkId?: string
  /**
   * The website a site import brought the picture in from (AGL-3976),
   * stamped as `importedFrom` on the asset; {@link PluginMediaIngest.findImportedPhoto}
   * reads it back by its key, so one picture is stored once per site.
   */
  importedFrom?: Omit<AglynHostMediaImportSource, 'importedAt'>
}

/** A stored asset, as a page names it. */
export interface PluginMediaAsset {
  mediaId: string
  /** What an `image` node's `src` holds: the asset's media reference, else its URL. */
  src: string
  width?: number
  height?: number
  /** What the asset's own alt text says it shows, where a member wrote one. */
  alt?: string
}

export type PluginMediaIngestResult =
  | ({ ok: true } & PluginMediaAsset)
  | { ok: false; status: number; reason: string }

export interface PluginMediaIngest {
  /** Stores one picture in the site's own library. */
  ingest(request: PluginMediaIngestRequest): Promise<PluginMediaIngestResult>
  /**
   * The site's live, public asset copied from a stock photo with this source
   * key (`{provider}:{id}`), so a photo is never stored twice in one library.
   * With `orgId`, the workspace library's asset (AGL-4066), taken only where
   * it is shared with every site, or with `hostId`'s when one is named, so a
   * member is never handed a file their sharing keeps from them.
   */
  findStockPhoto(input: {
    hostId: string
    sourceKey: string
    orgId?: string
  }): Promise<PluginMediaAsset | null>
  /**
   * The site's live, public photos of the business itself (AGL-3957): what
   * came through a site photo link, newest first, at most `limit`. A photo
   * of the owner's own work is placed before any stock photo is searched
   * for. Optional: an implementation registered before the link existed
   * answers nothing, and a caller treats that as an empty library.
   */
  listOwnerPhotos?(input: { hostId: string; limit?: number }): Promise<PluginMediaAsset[]>
  /**
   * The site's live, public asset a site import already brought in under this
   * source key (`import:<hash>`, AGL-3976), so the same picture is never
   * stored twice. Optional: an implementation registered before imports
   * existed answers nothing, and an import then stores no picture at all
   * rather than risk a second copy.
   */
  findImportedPhoto?(input: { hostId: string; sourceKey: string }): Promise<PluginMediaAsset | null>
}

/** One implementation: the app that holds the media ingress. */
export const PLUGIN_MEDIA_INGEST = definePluginServiceContract<PluginMediaIngest>(
  'core.media-ingest',
  { multiple: false },
)

export function registerPluginMediaIngest(
  ingest: PluginMediaIngest,
  options?: { pluginId?: string },
): void {
  if (typeof ingest?.ingest !== 'function' || typeof ingest?.findStockPhoto !== 'function') {
    throw new Error('a media ingest needs ingest and findStockPhoto')
  }
  registerPluginService(PLUGIN_MEDIA_INGEST, ingest, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** The registered ingest, or `null` in a process that registered none. */
export function pluginMediaIngest(): PluginMediaIngest | null {
  return resolvePluginService(PLUGIN_MEDIA_INGEST) ?? null
}
