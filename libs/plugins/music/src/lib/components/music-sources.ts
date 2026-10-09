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

import * as Aglyn from '@aglyn/aglyn'

/**
 * Where a track's audio comes from, and whether the player may play it
 * (AGL-3716). Pure, so the rule is held by a spec rather than by markup.
 *
 * Two kinds of source, and they are treated differently on purpose:
 *
 * - **The media library** — a media reference (`media:{scope}/{id}`, what
 *   "Browse media" stores) or a CDN path. Every audio file in the library was
 *   uploaded with its owner's rights confirmation, stored on the asset, so
 *   the player plays it as it is. A file staff took down is refused by the
 *   CDN, and the player says the track is unavailable.
 * - **An address somewhere else** — `https:` only. The player plays it only
 *   when the element itself records the author's confirmation that they own
 *   the recording or hold a license for it (`rightsConfirmed`). Without it,
 *   a published page names the track as unavailable and the editor says
 *   what is missing.
 *
 * Anything else — `http:`, `data:`, `javascript:`, a relative path that is
 * not the CDN — is no source at all.
 */
export type MusicTrackSource =
  | { state: 'empty' }
  | { state: 'unconfirmed' }
  | { state: 'ready'; url: string; library: boolean }

export interface MusicTrackFields {
  /** A media reference, a CDN path, or an `https:` address. */
  src?: string
  title?: string
  artist?: string
  /** Cover art: a media reference or an `https:` image address. */
  image?: string
  /**
   * The author's confirmation that they own an external recording or hold a
   * license to publish it. Read only for an `https:` source; a library file
   * carries its own confirmation on the asset.
   */
  rightsConfirmed?: boolean
}

/** Whether a value names a file in the site's media library. */
export function isLibraryAudio(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (Aglyn.isMediaRef(value.trim()) || Aglyn.isMediaCdnPath(value.trim()))
  )
}

/** What a track's `src` resolves to, for this site. */
export function musicTrackSource(
  track: MusicTrackFields,
  options: { hostId?: string | null } = {},
): MusicTrackSource {
  const raw = typeof track.src === 'string' ? track.src.trim() : ''
  if (!raw) return { state: 'empty' }
  if (isLibraryAudio(raw)) {
    const url = Aglyn.resolveMediaSrc(raw, { hostId: options.hostId ?? undefined })
    return url ? { state: 'ready', url, library: true } : { state: 'empty' }
  }
  if (!/^https:\/\/[^\s/]+/i.test(raw)) return { state: 'empty' }
  if (track.rightsConfirmed !== true) return { state: 'unconfirmed' }
  return { state: 'ready', url: raw, library: false }
}

/** A cover image's address, or `undefined` when it names nothing loadable. */
export function musicCoverSrc(
  image: unknown,
  options: { hostId?: string | null } = {},
): string | undefined {
  const raw = typeof image === 'string' ? image.trim() : ''
  if (!raw) return undefined
  if (Aglyn.isMediaRef(raw) || Aglyn.isMediaCdnPath(raw)) {
    return Aglyn.resolveMediaSrc(raw, { hostId: options.hostId ?? undefined })
  }
  return /^https:\/\//i.test(raw) ? raw : undefined
}

/** `m:ss`, or `h:mm:ss` past an hour; `0:00` for anything unusable. */
export function formatTrackTime(seconds: unknown): string {
  const total =
    typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
      ? Math.floor(seconds)
      : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** A track's name as the player and a screen reader say it. */
export function trackLabel(track: MusicTrackFields, index: number): string {
  const title = track.title?.trim() || `Track ${index + 1}`
  const artist = track.artist?.trim()
  return artist ? `${title} by ${artist}` : title
}
