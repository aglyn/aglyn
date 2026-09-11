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
 * Asset metadata helpers (AGL-173): tag normalization shared by the
 * console editor and any future API validation, plus a dependency-free
 * image header parser so the upload route can stamp dimensions without
 * pulling in an image library.
 */

import { MEDIA_ALT_MAX_LENGTH } from './media-alt'

export * from './media-alt'

export const MEDIA_TAG_MAX_COUNT = 20
export const MEDIA_TAG_MAX_LENGTH = 40

/**
 * Trim, lowercase, dedupe, and cap tags. Accepts a comma-separated string
 * or an array; empty and oversized entries are dropped.
 */
export function normalizeMediaTags(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(',')
  const seen = new Set<string>()
  const tags: string[] = []
  for (const entry of raw) {
    const tag = String(entry ?? '').trim().toLowerCase()
    if (!tag || tag.length > MEDIA_TAG_MAX_LENGTH || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
    if (tags.length >= MEDIA_TAG_MAX_COUNT) break
  }
  return tags
}

/**
 * What a placement should store for `alt` once the asset's own alt text is
 * taken into account (AGL-1896) — the DAM asset is the DEFAULT, the
 * placement keeps the override.
 *
 * `AglynHostMedia.alt` has existed since AGL-173 and the library drawer has
 * always been able to set it; what never existed is anybody READING it. Every
 * placement surface asked the author to type alt again from scratch, so the
 * same logo on eight pages needed its alt typed eight times and in practice
 * shipped blank — on a customer's published site.
 *
 * ONE function, called at pick time by every surface, rather than a rule
 * re-derived per surface. The three refusals are the whole contract:
 *
 * * **`decorative` wins outright.** It is the field AGL-1305 added to record
 *   "screen readers should skip this", and `image.tsx` already forces
 *   `alt=""` over any alt text when it is on. Inheriting into a node that has
 *   declared itself decorative would put text on a node whose renderer
 *   discards it — invisible, and misleading to the next author who opens the
 *   panel.
 * * **A non-blank placement alt wins.** That is the per-placement override,
 *   and clobbering it is the one failure that would make this feature worse
 *   than not having it: the author's sentence about THIS placement is better
 *   than the asset's generic one by construction.
 * * **A blank asset alt yields nothing.** Never a fabricated default. The
 *   file name is not alt text ("IMG_4021.jpg" announced to a screen reader is
 *   worse than silence), and nothing here has seen the image. Returning
 *   `undefined` is what lets callers omit the key entirely rather than
 *   writing `alt: ''`, which on a besigner node is itself an authored value.
 *
 * A blank placement alt DOES inherit, deliberately. Presets ship `alt: ''`
 * (see `card.tsx`), so requiring an absent key would have skipped the single
 * commonest authoring path — dropping a preset and pointing its image at a
 * library asset — and left the issue open for the case it was filed about.
 *
 * @returns the alt to store, or `undefined` when the caller should write
 * nothing at all.
 */
export function inheritedMediaAlt(options: {
  /** The alt already on the placement — a node prop, a config field. */
  placementAlt?: unknown
  /** The placement's explicit "skip me" intent, when it has one. */
  decorative?: unknown
  /** The chosen DAM asset's stored alt text. */
  assetAlt?: unknown
}): string | undefined {
  const { placementAlt, decorative, assetAlt } = options ?? {}
  if (decorative === true) return undefined
  if (typeof placementAlt === 'string' && placementAlt.trim()) return undefined
  const inherited = typeof assetAlt === 'string' ? assetAlt.trim() : ''
  if (!inherited) return undefined
  // Capped at the same length the library drawer saves through, so an alt
  // that reaches a placement is one the DAM would also have stored.
  return inherited.slice(0, MEDIA_ALT_MAX_LENGTH)
}

/**
 * Component ids whose renderer reads intrinsic pixel dimensions off the node.
 *
 * Component ids are persisted in screen documents and never renamed, which is
 * what makes matching on them safe. The list is the gate rather than a
 * decoration: a prop written onto an element that does not destructure it
 * reaches `...rest` and is spread onto the DOM, so an unlisted element would
 * gain an invalid `intrinsicwidth` attribute in its published HTML.
 *
 * ⛔ `video` is NOT here, and its absence is a decision rather than an
 * oversight (AGL-2749). A video needs the pair at least as badly as an image
 * does — `preload="none"` means its metadata never arrives until someone
 * presses play, so the element is zero-height for the whole life of the page
 * without it — but it cannot get it from `width`/`height`. Those are read
 * from the bytes by the server and are absent on every video, deliberately:
 * AGL-2742 kept the client-measured triple in its own `video` record so a
 * reader can tell a server measurement from a browser's report.
 * {@link videoMediaProps} is where a video gets its pair.
 */
const INTRINSIC_SIZE_COMPONENT_IDS = new Set(['image'])

/**
 * The intrinsic `width`/`height` to copy onto a node when an author picks a
 * library asset for it (AGL-2486).
 *
 * ## Why the copy happens at pick time, and why it is not the last word
 *
 * The pair rides on the node like every other prop, so the editor canvas, and
 * any page whose asset cannot be read, still reserve a box. It is not the last
 * word. A replace rewrites the asset's `width`/`height` and cannot reach the
 * nodes that copied them, so the tenant composition reads every placed
 * image's document, in one projected batch per page, and lays its current
 * pair over this one (`media-asset-facts.ts`, AGL-2833). What is written here
 * is what a page shows when that read cannot answer.
 *
 * ## Why it matters
 *
 * `image.tsx` lays images out with `width: 100%; height: auto`, under which an
 * `<img>` has NO height until its bytes decode. Without an intrinsic pair the
 * browser has no ratio to reserve a box from, so every image on the page
 * shifts the content below it as it lands.
 *
 * ## The rules
 *
 * * **Both or neither.** A browser derives an aspect-ratio only from the
 *   pair; a lone `width` is read as a real dimension and reserves a box of
 *   the wrong shape, which is worse than reserving none.
 * * **Only for renderers that read them**, see
 *   `INTRINSIC_SIZE_COMPONENT_IDS` — otherwise the prop lands on the DOM.
 * * **Finite and positive.** Upload capture is best-effort, so a media
 *   document may carry `0`, a partial capture, or nothing at all; `width="0"`
 *   collapses the element.
 * * **`{}` when anything is unknown**, never `{ intrinsicWidth: undefined }`.
 *   Callers spread the result into a props object that `updateNodeProps`
 *   REPLACES wholesale, so a key present with an undefined value would strip
 *   a pair a previous pick had correctly stored.
 *
 * @returns the props to spread, or `{}` when the caller should write nothing.
 */
export function intrinsicMediaSize(options: {
  /** The element being written to — its persisted component id. */
  componentId?: unknown
  /** The attribute the picker was opened for; only `src` carries an image. */
  propName?: unknown
  /** The chosen asset's stored pixel width. */
  assetWidth?: unknown
  /** The chosen asset's stored pixel height. */
  assetHeight?: unknown
}): { intrinsicWidth?: number; intrinsicHeight?: number } {
  const { componentId, propName, assetWidth, assetHeight } = options ?? {}
  if (propName !== 'src') return {}
  if (!INTRINSIC_SIZE_COMPONENT_IDS.has(String(componentId ?? ''))) return {}
  const usable = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
  if (!usable(assetWidth) || !usable(assetHeight)) return {}
  return { intrinsicWidth: assetWidth, intrinsicHeight: assetHeight }
}

/** The one element that reads the props below off its node. */
const VIDEO_COMPONENT_ID = 'video'

/**
 * The video-only companions to {@link intrinsicMediaSize}, copied onto the
 * node when an author picks a video asset (AGL-2741, rewritten against the
 * real document shape in AGL-2749).
 *
 * Same route as the image dimensions, and like theirs not the last word. A
 * replace rewrites the asset's `video` and `poster` records and cannot reach
 * the nodes that copied them, so the tenant composition reads each placed
 * film's document, in the same batch as the images', and lays its current
 * records over these (`media-asset-facts.ts`, AGL-2807). What is written here
 * is what a page shows when that read cannot answer.
 *
 * ## Why a video does not simply use {@link intrinsicMediaSize}
 *
 * A video's pixel dimensions are NOT in `media.width`/`media.height`. Those
 * are read from the bytes by the server and carry a stronger claim than a
 * browser's report, so AGL-2742 kept the client-measured triple in its own
 * `video` record rather than widening them — a reader that folded the two
 * together would lose the ability to tell which it had. A video therefore
 * reaches its intrinsic pair through here, and `intrinsicMediaSize` finds
 * nothing to copy for one.
 *
 * ## The three rules
 *
 * * **Only the `video` element, only its `src`.** A `durationSeconds` spread
 *   onto an element that does not destructure it becomes an invalid attribute
 *   in the published HTML.
 * * **The duration is stored in SECONDS**, because the author-facing field is
 *   in seconds and a person types 63, not 63000. `videoDurationIso8601` takes
 *   milliseconds, and the structured-data builder is the one place that
 *   converts back.
 * * **`{}` when unknown**, never a key with an `undefined` value: callers
 *   spread this into a props object `updateNodeProps` REPLACES wholesale, so
 *   a present-but-undefined key strips what an earlier pick stored.
 *
 * `posterFromSource` is a FLAG rather than a url, deliberately. The generated
 * poster is `?poster=1` on the video's own reference, which
 * {@link mediaPosterSrc} builds without reading anything — and that url is
 * explicitly not a promise the poster exists. This flag IS the promise: it is
 * written only when the document records one, which is what lets
 * `videoPosterSrc` offer the derived url to an `<img>` and to a
 * `thumbnailUrl`, where a 404 would be a broken image and a rich result
 * pointing at nothing.
 *
 * An author's own poster is never touched here. It wins at render time
 * instead (`videoPosterSrc`), so re-picking the SOURCE cannot quietly replace
 * a frame somebody chose.
 *
 * @returns the props to spread, or `{}` when the caller should write nothing.
 */
export function videoMediaProps(options: {
  /** The element being written to — its persisted component id. */
  componentId?: unknown
  /** The attribute the picker was opened for; only `src` carries a video. */
  propName?: unknown
  /**
   * The chosen asset's `video` record, as {@link normalizeVideoMetadata}
   * bounds it — `durationMs`, `width` and `height`, all three or none.
   */
  assetVideo?: unknown
  /** The chosen asset's generated `poster` record, when it has one. */
  assetPoster?: unknown
}): {
  durationSeconds?: number
  intrinsicWidth?: number
  intrinsicHeight?: number
  posterFromSource?: boolean
} {
  const { componentId, propName, assetVideo, assetPoster } = options ?? {}
  if (propName !== 'src') return {}
  if (String(componentId ?? '') !== VIDEO_COMPONENT_ID) return {}
  const patch: {
    durationSeconds?: number
    intrinsicWidth?: number
    intrinsicHeight?: number
    posterFromSource?: boolean
  } = {}
  // Through the DAM's own validator rather than a second reading of the same
  // three numbers: it is all-or-nothing by design, and re-deriving that rule
  // here is how two files come to disagree about what a partial record means.
  const video = normalizeVideoMetadata(assetVideo)
  if (video) {
    // Never rounds to zero: a sub-second clip is still a clip, and a stored
    // `0` reads as "no duration" to everything downstream.
    patch.durationSeconds = Math.max(1, Math.round(video.durationMs / 1000))
    patch.intrinsicWidth = video.width
    patch.intrinsicHeight = video.height
  }
  // A poster RECORD, not a poster url — see the note above. Its mere presence
  // on the document is the whole fact being carried.
  if (assetPoster && typeof assetPoster === 'object') {
    patch.posterFromSource = true
  }
  return patch
}

export interface ImageDimensions {
  width: number
  height: number
}

const readU32BE = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] << 24) |
  (bytes[offset + 1] << 16) |
  (bytes[offset + 2] << 8) |
  bytes[offset + 3]

const readU16BE = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] << 8) | bytes[offset + 1]

const readU16LE = (bytes: Uint8Array, offset: number) =>
  bytes[offset] | (bytes[offset + 1] << 8)

/**
 * Reads pixel dimensions from PNG, JPEG, GIF, and WebP headers. Returns
 * null for anything unrecognized or truncated — callers treat dimensions
 * as best-effort metadata, never a gate.
 */
export function readImageDimensions(
  bytes: Uint8Array,
): ImageDimensions | null {
  if (bytes.length < 24) return null

  // PNG: 8-byte signature, IHDR width/height at offsets 16/20.
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const width = readU32BE(bytes, 16)
    const height = readU32BE(bytes, 20)
    return width > 0 && height > 0 ? { width, height } : null
  }

  // GIF87a/GIF89a: little-endian dimensions at offsets 6/8.
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    const width = readU16LE(bytes, 6)
    const height = readU16LE(bytes, 8)
    return width > 0 && height > 0 ? { width, height } : null
  }

  // JPEG: scan segments for a SOFn marker (C0–CF except C4/C8/CC).
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = bytes[offset + 1]
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
        offset += 2
        continue
      }
      const length = readU16BE(bytes, offset + 2)
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        const height = readU16BE(bytes, offset + 5)
        const width = readU16BE(bytes, offset + 7)
        return width > 0 && height > 0 ? { width, height } : null
      }
      if (length < 2) return null
      offset += 2 + length
    }
    return null
  }

  // WebP: RIFF....WEBP then VP8/VP8L/VP8X chunk.
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    const chunk = String.fromCharCode(
      bytes[12],
      bytes[13],
      bytes[14],
      bytes[15],
    )
    if (chunk === 'VP8X' && bytes.length >= 30) {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16))
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
      return { width, height }
    }
    if (chunk === 'VP8 ' && bytes.length >= 30) {
      const width = readU16LE(bytes, 26) & 0x3fff
      const height = readU16LE(bytes, 28) & 0x3fff
      return width > 0 && height > 0 ? { width, height } : null
    }
    if (chunk === 'VP8L' && bytes.length >= 25) {
      const bits =
        bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)
      const width = (bits & 0x3fff) + 1
      const height = ((bits >> 14) & 0x3fff) + 1
      return { width, height }
    }
  }

  return null
}

/**
 * What the platform knows about a VIDEO asset (AGL-2742).
 *
 * ## Why this is not `width`/`height` on the document beside an image's
 *
 * An image's dimensions are read from its own header by
 * {@link readImageDimensions}, server-side, from bytes the platform holds.
 * None of that is available for video: the dimensions live in a `moov` atom
 * that an MP4 is free to place at the END of the file, so reading them
 * server-side means fetching up to 200 MB back out of Storage to answer a
 * question worth twelve bytes — the exact download `generateStoredMediaVariants`
 * is written to avoid. So these numbers arrive from the BROWSER, which had
 * the file in hand and a decoder already loaded, and they are consequently
 * client data: every field is bounded here before it reaches a document.
 *
 * They live under their own key rather than widening `width`/`height`
 * because the provenance differs and a reader should be able to tell. A
 * `width` on a media document means "measured from the bytes"; a
 * `video.width` means "reported by the uploader's browser". Folding the two
 * together would make the weaker claim indistinguishable from the stronger
 * one on every asset in the library.
 */
export interface MediaVideoMetadata {
  /** Duration in whole milliseconds. Always finite and positive. */
  durationMs: number
  /** Coded frame width in pixels, after any display-aspect correction. */
  width: number
  height: number
  /**
   * A short label for what produced the file, when the browser offered one
   * (`video/mp4; codecs="avc1.640028"` collapses to `avc1.640028`). Absent
   * far more often than present — no browser API reports the codec of a
   * local file, so this is only ever filled from a `MediaCapabilities` probe
   * or a container sniff, and nothing depends on it.
   */
  codec?: string
}

/**
 * The upper bound on a stored duration: 24 hours.
 *
 * Not a policy about what may be uploaded — the DAM's ceiling is 200 MB of
 * bytes and says nothing about running time. This is the bound past which a
 * number stops being a duration and starts being a bug, and the specific
 * bug it exists for is real: `HTMLMediaElement.duration` is `Infinity` for a
 * stream and for some WebM files until the element has been seeked to the
 * end. `Infinity` fails the finite test below before it reaches this
 * constant, but a browser that reports a plausible-looking 10^12 instead
 * would otherwise write a document claiming a 31-year film.
 */
export const MEDIA_VIDEO_MAX_DURATION_MS = 24 * 60 * 60 * 1000

/** The largest coded dimension accepted, matching the 8K ceiling encoders use. */
export const MEDIA_VIDEO_MAX_DIMENSION = 16384

/**
 * Bound a browser's report into something safe to store, or refuse it whole.
 *
 * All-or-nothing on purpose. A partial record — a duration with no
 * dimensions — is worse than none: `VideoObject` JSON-LD would emit a
 * `duration` and omit `width`, and a renderer sizing its container from
 * `video.height` would find the key present and the value absent. The three
 * numbers are produced by one `loadedmetadata` event and are meaningful only
 * together, so they are accepted or rejected together.
 *
 * `codec` is the exception and is dropped rather than refused, for the same
 * reason `formatMediaRef` drops a malformed content pin: it is a label
 * nothing branches on, and losing the whole record over it would trade a
 * working poster and a correct aspect ratio for a cosmetic string.
 */
export function normalizeVideoMetadata(
  input: unknown,
): MediaVideoMetadata | null {
  if (!input || typeof input !== 'object') return null
  const source = input as Record<string, unknown>
  const durationMs = Math.round(Number(source['durationMs']))
  const width = Math.round(Number(source['width']))
  const height = Math.round(Number(source['height']))
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null
  if (durationMs > MEDIA_VIDEO_MAX_DURATION_MS) return null
  if (!Number.isFinite(width) || width <= 0 || width > MEDIA_VIDEO_MAX_DIMENSION)
    return null
  if (
    !Number.isFinite(height) ||
    height <= 0 ||
    height > MEDIA_VIDEO_MAX_DIMENSION
  )
    return null
  const rawCodec = source['codec']
  const codec =
    typeof rawCodec === 'string' && /^[\w.,\- ]{1,64}$/.test(rawCodec.trim())
      ? rawCodec.trim()
      : undefined
  return codec ? { durationMs, width, height, codec } : { durationMs, width, height }
}

/**
 * The `duration` a schema.org `VideoObject` wants: an ISO 8601 duration.
 *
 * Whole seconds, and never a fractional component. Google's structured-data
 * documentation accepts `PT1M30S` and treats sub-second precision as noise,
 * and a `PT1M30.437S` in a rich result is a number nobody asked for. A
 * duration under one second rounds UP to `PT1S` rather than to `PT0S`, which
 * would read as "no duration" to a consumer that tests for truthiness.
 */
export function videoDurationIso8601(
  durationMs: number | undefined | null,
): string | undefined {
  const total = Math.max(1, Math.round(Number(durationMs) / 1000))
  if (!Number.isFinite(total)) return undefined
  if (!durationMs || Number(durationMs) <= 0) return undefined
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const parts = [
    hours ? `${hours}H` : '',
    minutes ? `${minutes}M` : '',
    seconds ? `${seconds}S` : '',
  ].join('')
  return `PT${parts || '0S'}`
}
