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

import { normalizeVideoMetadata } from '@aglyn/aglyn/server'
import {
  generateMediaPoster,
  MEDIA_POSTER_MAX_BYTES,
} from '@aglyn/tenant-data-admin'

import { VIDEO_TYPES } from '../media-upload-limits'

/**
 * The video half of a media document, decided once for both upload routes
 * (AGL-2742).
 *
 * ## Why a shared function and not eleven lines in each route
 *
 * Because that is the defect `media-variants.ts` was extracted to fix, and
 * the shape of this work is identical: two routes, the same bytes, the same
 * "never fail the upload for an optimization" judgement, and — the part that
 * actually bit — the same need to distinguish *nothing to do* from *tried
 * and failed*. A private copy in each route is two `catch` blocks that will
 * drift, and the drift is invisible because both produce a 200.
 *
 * ## The failure classes, kept apart
 *
 * - **No fields at all** — not a video. The common, correct, uninteresting
 *   outcome, and it must never look like a fault.
 * - **`video` present, `poster` absent, `posterError` present** — the
 *   browser read the file but could not paint a frame from it, or the
 *   encoder refused the bytes it sent. Eligible work that did not happen,
 *   which is the case AGL-1468 established belongs on the document.
 * - **`poster` present** — a real object exists at `{objectPath}__poster.webp`
 *   and `serveMediaCdn` will answer `?poster=1` with it.
 *
 * `video` and `poster` are independent on purpose. The commonest partial
 * failure is a WebM whose `duration` reads `Infinity` — the file plays
 * perfectly and its first frame captures perfectly — and refusing the poster
 * over a missing duration would drop the half that makes a page fast.
 */
export interface VideoUploadFieldsOptions {
  /** Canonical stored type. Anything outside {@link VIDEO_TYPES} is a no-op. */
  contentType: string
  /** `body.video` exactly as received. Bounded before it is believed. */
  video: unknown
  /** `body.poster`: base64 with no data-URL prefix, or absent. */
  poster: unknown
  /** The client's own short reason for an absent probe, when it gave one. */
  probeReason?: unknown
  /** Object path of the master. Poster paths derive from it. */
  objectPath: string
  /**
   * The `mediaCdn` verdict. A poster is only ever readable through the CDN
   * route, so generating one for a workspace that serves raw storage URLs
   * would write bytes nothing can reference — the identical reasoning that
   * gates WebP variants. The METADATA is not a CDN feature and lands either
   * way, exactly as pixel dimensions do.
   */
  cdnAllowed: boolean
  saveVariant: (path: string, bytes: Buffer) => Promise<void>
}

/** Bounds a client-supplied reason before it reaches a document. */
function shortReason(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, 200)
  return trimmed || undefined
}

export async function videoUploadFields(
  options: VideoUploadFieldsOptions,
): Promise<Record<string, unknown>> {
  if (!VIDEO_TYPES.has(options.contentType)) return {}

  const fields: Record<string, unknown> = {}
  const video = normalizeVideoMetadata(options.video)
  if (video) fields['video'] = video

  const probeReason = shortReason(options.probeReason)
  if (typeof options.poster !== 'string' || !options.poster) {
    // A browser that never offered a poster and never said why is not a
    // fault to record — it is an older console, a scripted upload, or the
    // v1 API. Only a stated reason becomes a marker.
    return probeReason ? { ...fields, posterError: probeReason } : fields
  }
  if (!options.cdnAllowed) {
    return {
      ...fields,
      posterError: 'poster not generated — the workspace plan has no media CDN',
    }
  }

  // Base64 is decoded, not measured as a string: `Buffer.from` silently
  // ignores characters outside the alphabet, so a 40 MB body of junk
  // measures 40 MB as text and zero as bytes, and it is the BYTES that
  // reach the encoder.
  let buffer: Buffer
  try {
    buffer = Buffer.from(options.poster, 'base64')
  } catch {
    return { ...fields, posterError: 'poster was not valid base64' }
  }
  if (!buffer.length) {
    return { ...fields, posterError: 'poster decoded to no bytes' }
  }
  if (buffer.length > MEDIA_POSTER_MAX_BYTES) {
    return {
      ...fields,
      posterError: `poster too large (${buffer.length} > ${MEDIA_POSTER_MAX_BYTES} bytes)`,
    }
  }

  // `generateMediaPoster` re-encodes through `sharp` rather than storing what
  // arrived, which is what makes accepting an image from a browser safe at
  // all — see its own docstring. It never throws.
  const outcome = await generateMediaPoster({
    buffer,
    objectPath: options.objectPath,
    saveVariant: options.saveVariant,
  })
  if (outcome.poster) fields['poster'] = outcome.poster
  if (outcome.error) fields['posterError'] = outcome.error
  return fields
}
