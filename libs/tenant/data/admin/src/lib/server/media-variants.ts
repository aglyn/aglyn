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

import { readImageDimensions } from '@aglyn/aglyn/server'
// By path: the media-ref grammar is a leaf, and the routes that spread this
// module's helpers into a document reach it the same way.
import {
  MEDIA_CDN_VARIANT_WIDTHS,
  MEDIA_DELIVERY_MAX_EDGE,
  MEDIA_POSTER_OBJECT_SUFFIX,
  MEDIA_VARIANT_ENCODER_VERSION,
  mediaDisplayObjectPath,
  mediaPosterObjectPath,
  mediaRenditionObjectPath,
  parseMediaRenditions,
} from '@aglyn/aglyn/app-utils/media-ref'
import type { Sharp, SharpOptions } from 'sharp'

/**
 * WebP variant generation for a media asset (AGL-175), and the record of
 * whether it worked (AGL-1468).
 *
 * ## Why this is a library function and not two copies of a `try`
 *
 * `/api/media/upload` and `/api/media/replace` each carried the same eleven
 * lines, wrapped in a `catch` whose comment read *"Variants are an
 * optimization — never fail the upload for them."* That judgement is right and
 * it survives here. What did not survive is its consequence: the catch wrote
 * `console.error` and nothing else, so a **total** failure and a **healthy**
 * asset produced byte-identical documents — `variants: []` either way.
 *
 * Measured 2026-08-13 on production: **1 of 180 media documents has a
 * non-empty `variants` array.** The last successful generation was
 * 2026-07-19; every image uploaded since has an empty one. Nothing surfaced
 * that for three weeks, because the only trace was a serverless log line
 * whose retention is about an hour.
 *
 * So the contract of this function is not "generate variants". It is
 * **generate variants and say what happened**, and the two failure classes
 * are kept apart on purpose:
 *
 * - `variants: []` with **no** `error` — nothing was ELIGIBLE. A type in
 *   {@link MEDIA_TYPES_WITHOUT_VARIANTS}, a non-image, or a source already
 *   narrower than every target width. This is the correct, common,
 *   uninteresting outcome and must never look like a fault or the fault signal
 *   is worthless.
 * - `variants: []` with an `error` — generation was attempted and did not
 *   complete. That string goes onto the media document and bumps a counter,
 *   which is what makes "how many assets failed?" a query instead of an
 *   archaeology project.
 *
 * A partial run reports both: the widths that landed AND the error, because
 * the widths that landed are real files that the CDN route can serve.
 */

/** The shape of `sharp`'s default export. */
type SharpFactory = (input?: Buffer, options?: SharpOptions) => Sharp

/**
 * What a media document records about its delivery copies' display half
 * (AGL-3486). Present only when a display object was written; its absence on
 * a document at the current encoder generation means the original is clean
 * enough to serve as it is.
 */
export interface MediaDisplayCopy {
  /** Always the original's own type — the display copy never changes format. */
  contentType: string
  width: number
  height: number
  sizeBytes: number
}

export interface MediaVariantOutcome {
  /** Widths actually written. Safe to store — every entry is a real object. */
  variants: number[]
  /**
   * The display copy written for this asset, when one was needed and made.
   * Only ever produced when the caller asked for one (`display: true`).
   */
  display?: MediaDisplayCopy
  /**
   * Present ONLY when generation was attempted and did not complete.
   * `undefined` means nothing went wrong, which includes "nothing to do".
   */
  error?: string
}

/**
 * Writes one derived object. `contentType` is the type the bytes ARE: WebP
 * for a variant, the original's own type for a display copy.
 */
export type SaveMediaDerivedObject = (
  path: string,
  bytes: Buffer,
  contentType: string,
) => Promise<void>

/**
 * The WebP encoder settings for every `?w=` variant (AGL-3486).
 *
 * Quality 72 is where a photo stops showing a difference to the eye at the
 * size it is painted; 80, the setting since AGL-175, spent 15-25% more bytes
 * on detail nobody sees. Effort 5 of 6: measured on the four images the issue
 * names, effort 6 saved another 1-2% for twice the encode time, and the
 * encode runs inside an upload request or after a CDN response.
 *
 * Changing either value changes the bytes every asset should hold, so it
 * bumps `MEDIA_VARIANT_ENCODER_VERSION` — that is what reaches the existing
 * corpus.
 */
export const MEDIA_VARIANT_WEBP_OPTIONS = Object.freeze({
  quality: 72,
  effort: 5,
})

/**
 * The quality the display copy is re-encoded at (AGL-3486). Higher than a
 * variant's because the display copy is what a link preview, an email client
 * and a CSS background receive at full size — it stands in for the original.
 */
export const MEDIA_DISPLAY_QUALITY = 82

/**
 * Formats that get a display copy. JPEG, PNG and WebP are the formats a
 * camera, a screenshot tool and a design export produce, and the ones `sharp`
 * re-encodes losslessly enough to stand in for the original. Not GIF, whose
 * animation the encoder would flatten, and not SVG or ICO, which have no
 * variants at all.
 */
export const MEDIA_DISPLAY_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
])

/**
 * Encode one `?w=` variant: auto-oriented, downscaled, metadata stripped.
 *
 * `rotate()` with no angle applies the EXIF orientation, which a WebP cannot
 * carry — before AGL-3486 a portrait phone photo's variants came out lying on
 * their side. `sharp` writes no EXIF, XMP or IPTC unless asked to keep it, so
 * a photo's GPS position never reaches a variant.
 */
export async function encodeMediaVariant(
  sharp: SharpFactory,
  source: Buffer,
  width: number,
): Promise<Buffer> {
  return sharp(source)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp(MEDIA_VARIANT_WEBP_OPTIONS)
    .toBuffer()
}

/**
 * The display copy of an image, or null when the original can be served as
 * it is (AGL-3486).
 *
 * The bare URL is what a link preview, an email client, a CSS background and
 * every pasted Copy URL fetch, and before this it served the upload byte for
 * byte: a 6 MB, 6000-pixel phone photo with the GPS position it was taken at.
 * A display copy is made when the original has any of three properties:
 *
 * - **larger than {@link MEDIA_DELIVERY_MAX_EDGE} on its long edge** —
 *   downscaled to fit, since nothing on a page paints more;
 * - **EXIF, XMP or IPTC metadata** — stripped. This is the privacy half, and
 *   it is kept even when the re-encode is not smaller: a location is not
 *   something to trade for bytes;
 * - **an EXIF orientation** — applied, so the pixels are upright without it.
 *
 * Same format as the original, so nothing that could read the original loses
 * the ability to read the copy. Null for an animated image, whose frames the
 * encoder would drop, and for a format outside {@link MEDIA_DISPLAY_TYPES}.
 */
export async function encodeMediaDisplay(
  sharp: SharpFactory,
  source: Buffer,
  contentType: string,
): Promise<{ bytes: Buffer; copy: MediaDisplayCopy } | null> {
  if (!MEDIA_DISPLAY_TYPES.has(contentType)) return null
  const metadata = await sharp(source).metadata()
  if ((metadata.pages ?? 1) > 1) return null
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  const oversize = Math.max(width, height) > MEDIA_DELIVERY_MAX_EDGE
  const oriented = (metadata.orientation ?? 1) > 1
  const carriesMetadata = Boolean(metadata.exif || metadata.xmp || metadata.iptc)
  if (!oversize && !oriented && !carriesMetadata) return null

  let pipeline = sharp(source).rotate()
  if (oversize) {
    pipeline = pipeline.resize({
      width: MEDIA_DELIVERY_MAX_EDGE,
      height: MEDIA_DELIVERY_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
  }
  pipeline =
    contentType === 'image/png'
      ? pipeline.png({
          compressionLevel: 9,
          // A palette PNG re-encoded as truecolor can triple in size.
          palette: Boolean((metadata as { isPalette?: boolean }).isPalette),
        })
      : contentType === 'image/webp'
        ? pipeline.webp({ ...MEDIA_VARIANT_WEBP_OPTIONS, quality: MEDIA_DISPLAY_QUALITY })
        : pipeline.jpeg({ quality: MEDIA_DISPLAY_QUALITY, mozjpeg: true })
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
  // Only the privacy reason justifies a copy that is not smaller.
  if (!carriesMetadata && data.length >= source.length) return null
  return {
    bytes: data,
    copy: {
      contentType,
      width: info.width,
      height: info.height,
      sizeBytes: data.length,
    },
  }
}

/**
 * Formats a WebP copy at the SOURCE'S OWN width beats.
 *
 * A renderer's srcSet offers every width in `MEDIA_CDN_VARIANT_WIDTHS`, and
 * `serveMediaCdn` answers a width an asset has no variant for with the
 * original. For a JPEG or PNG no wider than a candidate, that original is what
 * every request at or above its width downloads — the `1280w` a phone asks
 * for, the `1920w` a desktop asks for. Measured on aglyn.com's hero poster, a
 * 1920x1080 JPEG: 166,756 B served for `?w=1920`, where a WebP of the same
 * 1920 pixels at the generator's quality is 40,598 B.
 *
 * So these formats also get the widths AT and ABOVE their own, each encoded at
 * the source width (`withoutEnlargement`): a re-encode, never an upscale, and
 * the same pixels the original answer served. Not GIF, whose animation a WebP
 * frame would drop; not WebP or AVIF, which a re-encode could make larger.
 */
const SOURCE_WIDTH_WEBP_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
])

/**
 * `image/*` types that produce no variants, for two different reasons.
 *
 * SVG is a vector: there is nothing to downscale, and rasterizing it would be
 * a different asset rather than a variant of this one.
 *
 * ICO carries no `sharp` decoder at all, so attempting it raises an
 * unsupported-format error from `toBuffer` — an ERROR on the media document,
 * which is the signal reserved for generation that was attempted and broke. An
 * icon having no variants is neither attempted nor broken; it is the ordinary
 * outcome, and it has to read as one or the fault counter measures the favicon
 * instead of a fault (AGL-3121).
 *
 * Exported because lazy regeneration (`media-delivery-regeneration.ts`) has to
 * skip exactly this set. The backfill script it replaced kept a second copy of
 * the SVG half, which is how ICO came to be missing from one and not the
 * other.
 */
export const MEDIA_TYPES_WITHOUT_VARIANTS: ReadonlySet<string> = new Set([
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
])

/**
 * Which widths this source should produce.
 *
 * Split out and exported because it is the predicate that decides whether an
 * empty result is NORMAL, and both the routes and the health probe have to
 * agree on it. Inlined, the skip rule was a `continue` buried in the loop that
 * a reader had to reconstruct in order to know whether `[]` was a bug.
 *
 * Widths narrower than the source always; for {@link SOURCE_WIDTH_WEBP_TYPES}
 * the rest as well, provided the source is wider than the narrowest width — a
 * source smaller than every candidate is an icon, and it is served as it is.
 */
export function mediaVariantWidthsFor(options: {
  contentType: string
  /** Source pixel width, when it could be read from the header. */
  sourceWidth?: number | null
}): number[] {
  if (!options.contentType.startsWith('image/')) return []
  if (MEDIA_TYPES_WITHOUT_VARIANTS.has(options.contentType)) return []
  const sourceWidth = options.sourceWidth ?? 0
  // No known width means generate and let `withoutEnlargement` decide, which
  // is the same call the loop made before: an unreadable header must not
  // silently opt an asset out of the CDN.
  if (!sourceWidth) return [...MEDIA_CDN_VARIANT_WIDTHS]
  const narrower = MEDIA_CDN_VARIANT_WIDTHS.filter((width) => width < sourceWidth)
  if (!narrower.length || !SOURCE_WIDTH_WEBP_TYPES.has(options.contentType)) {
    return narrower
  }
  return [...MEDIA_CDN_VARIANT_WIDTHS]
}

/**
 * Resolve `sharp`'s callable through either module shape.
 *
 * `(await import('sharp')).default` is correct under Node ESM and under a
 * bundler that synthesises the CJS namespace. It is `undefined` under one that
 * hands back `module.exports` directly — and `undefined(buffer)` is a
 * `TypeError` raised INSIDE the same `try` that catches a genuine load
 * failure, so from outside the two are the same event: no variants, no
 * message, a 200. This normalises the shape and, when neither shape yields a
 * function, throws something that NAMES the problem instead of a bare
 * `is not a function` from three frames away.
 */
export async function loadSharp(): Promise<SharpFactory> {
  const imported: unknown = await import('sharp')
  const candidate =
    typeof imported === 'function'
      ? imported
      : (imported as { default?: unknown } | null)?.default
  if (typeof candidate !== 'function') {
    throw new Error(
      `sharp did not resolve to a function (module was ${typeof imported}, ` +
        `default was ${typeof candidate})`,
    )
  }
  return candidate as SharpFactory
}

/**
 * A short, PUBLISHABLE name for why the encoder is unavailable (AGL-1471).
 *
 * The first thing the probe said on production was `sharp-unavailable`, and
 * that answered less than it looked like it did: it is the fallback for "the
 * error carried no `code`", and BOTH interesting failures land there. `sharp`
 * catches every `require` of its prebuilt binaries and rethrows one composed
 * `Error` with no `code` at all; `loadSharp` throws a plain `Error` too when
 * the module resolves to something that is not callable. One means the native
 * library did not load, the other means the bundler handed back the wrong
 * shape, and they have nothing in common except the remedy being different.
 *
 * Matching on `sharp`'s own help text is the only signal available — the
 * distinction is not in a field, only in the prose. It is matched loosely and
 * it degrades to the old fallback, so a reworded upstream message costs a
 * detail rather than the answer.
 *
 * The MESSAGE still never leaves the process. A native loader failure names
 * every path it tried, the health endpoint is public, and the point of a code
 * is that it is a fixed vocabulary the caller can branch on.
 */
export function classifyLoadFailure(error: unknown): string {
  const code = (error as { code?: string })?.code
  if (code) return String(code)
  const message = error instanceof Error ? error.message : ''
  if (/Could not load the "?sharp"? module/i.test(message)) {
    return 'sharp-native-missing'
  }
  if (/did not resolve to a function/i.test(message)) {
    return 'sharp-not-a-function'
  }
  return 'sharp-unavailable'
}

/** Error text kept short — it is stored on a document, not in a log. */
function describe(error: unknown): string {
  const text =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error ?? 'unknown')
  return text.slice(0, 300)
}

/**
 * Generate the delivery copies for one asset and report the outcome: its
 * WebP variants, and with `display: true` its display copy (AGL-3486).
 *
 * `saveVariant` is a callback rather than a `Bucket` so this stays free of a
 * storage dependency and so a spec can assert on the BYTES it produces —
 * which is the only assertion that distinguishes a working variant from the
 * original served back under a `?w=` that selects nothing.
 *
 * ## A variant is never larger than what it replaces
 *
 * A width the asset has no variant for is answered with the display copy, or
 * the original when there is none — so a variant is only worth storing when
 * it is SMALLER than that answer. Measured on a customer's 1280px JPEGs before
 * AGL-3486: the source-width WebP at `?w=1280` was 384 KB against a 305 KB
 * original, so the variant made every retina visit 26% heavier. A width whose
 * encode comes out no smaller is now skipped and the smaller bytes serve it.
 *
 * The display copy is made FIRST for that reason: it is what the comparison
 * is against.
 */
export async function generateMediaVariants(options: {
  buffer: Buffer
  contentType: string
  sourceWidth?: number | null
  /** Object path of the ORIGINAL; variants are `${objectPath}__w{n}.webp`. */
  objectPath: string
  saveVariant: SaveMediaDerivedObject
  /** Also make the display copy. Asked for by an asset, never by a poster. */
  display?: boolean
}): Promise<MediaVariantOutcome> {
  const widths = mediaVariantWidthsFor(options)
  const wantsDisplay =
    options.display === true && MEDIA_DISPLAY_TYPES.has(options.contentType)
  if (!widths.length && !wantsDisplay) return { variants: [] }

  const variants: number[] = []
  let display: MediaDisplayCopy | undefined
  try {
    const sharp = await loadSharp()
    let fallbackBytes = options.buffer.length
    if (wantsDisplay) {
      const made = await encodeMediaDisplay(sharp, options.buffer, options.contentType)
      if (made) {
        await options.saveVariant(
          mediaDisplayObjectPath(options.objectPath),
          made.bytes,
          options.contentType,
        )
        display = made.copy
        fallbackBytes = made.bytes.length
      }
    }
    for (const width of widths) {
      const webp = await encodeMediaVariant(sharp, options.buffer, width)
      if (webp.length >= fallbackBytes) continue
      await options.saveVariant(
        `${options.objectPath}__w${width}.webp`,
        webp,
        'image/webp',
      )
      variants.push(width)
    }
  } catch (error) {
    // Still never fails the upload — but no longer only whispers.
    console.error('media variant generation failed', options.objectPath, error)
    return { variants, ...(display ? { display } : {}), error: describe(error) }
  }
  return { variants, ...(display ? { display } : {}) }
}

/**
 * The media document fields a generation outcome writes (AGL-3486), shared by
 * every route that generates so none of them can forget the encoder
 * generation — the field lazy regeneration keys on.
 *
 * `display` is written as `null` rather than left out when there is none, so
 * a replace whose new bytes need no display copy clears the previous one's
 * record instead of pointing at an object it just deleted. The caller decides
 * `variantsError`, because the routes record it with a counter beside it.
 */
export function mediaVariantDocFields(
  outcome: Pick<MediaVariantOutcome, 'variants' | 'display'>,
): {
  variants: number[]
  variantEncoderVersion: number
  display: MediaDisplayCopy | null
} {
  return {
    variants: outcome.variants,
    variantEncoderVersion: MEDIA_VARIANT_ENCODER_VERSION,
    display: outcome.display ?? null,
  }
}

/**
 * Every derived object a media document names, given its original's path
 * (AGL-3486): the `?w=` variants, the display copy, a video's poster and the
 * poster's widths, and its renditions.
 *
 * The one list every path that moves, replaces or deletes an asset reads, so
 * a new kind of derived object is added in one place. Before it, each of the
 * three kept its own: a replace dropped all four kinds, while a folder move
 * and a delete knew only the variants — so a moved film lost its poster and
 * renditions to the old prefix, and a deleted one left them in the bucket.
 */
export function mediaDerivedObjectPaths(
  objectPath: string,
  /** The media document's fields, or its snapshot. */
  document:
    | {
        variants?: unknown
        display?: unknown
        poster?: unknown
        videoRenditions?: unknown
      }
    | { get(field: string): unknown },
): string[] {
  const read = (field: 'variants' | 'display' | 'poster' | 'videoRenditions') =>
    'get' in document && typeof document.get === 'function'
      ? document.get(field)
      : (document as Record<string, unknown>)[field]
  const widths = (value: unknown): number[] =>
    Array.isArray(value)
      ? value.filter((width): width is number => Number.isInteger(width) && width > 0)
      : []
  const poster = read('poster') as { variants?: unknown } | null | undefined
  return [
    ...widths(read('variants')).map((width) => `${objectPath}__w${width}.webp`),
    ...(read('display') ? [mediaDisplayObjectPath(objectPath)] : []),
    ...(poster ? [mediaPosterObjectPath(objectPath)] : []),
    ...widths(poster?.variants).map(
      (width) => `${objectPath}${MEDIA_POSTER_OBJECT_SUFFIX}__w${width}.webp`,
    ),
    ...parseMediaRenditions(read('videoRenditions')).map((rendition) =>
      mediaRenditionObjectPath(objectPath, rendition),
    ),
  ]
}

/**
 * The largest object this will pull back OUT of storage in order to generate.
 *
 * Deliberately equal to `IMAGE_MAX_BYTES`, the console's per-type ceiling for
 * an image (`apps/console/utils/media-upload-limits.ts`), rather than derived
 * from it: this library cannot import that file, and the two numbers answer
 * different questions. That one asks "may this be uploaded at all"; this one
 * asks "may a serverless function afford to fetch it back and decode it". They
 * agree today, which is the point — every image the DAM accepts gets variants.
 * If the upload ceiling is ever raised for a format where 15 MB is small (a
 * camera RAW, a TIFF), the download stops there instead of silently following
 * it into a timeout, and says so.
 */
export const MEDIA_VARIANT_SOURCE_MAX_BYTES = 15 * 1024 * 1024

/**
 * Generate variants for an object whose bytes are in STORAGE, not in hand
 * (AGL-1476).
 *
 * `/api/media/upload` has the buffer — the client base64'd it into the request
 * body. `/api/media/upload-url` never sees it: the browser PUTs straight to GCS
 * with a signed URL, and finalize is handed a path. Since AGL-1465 gave images
 * a signed-path ceiling, every image between 3 MB and 15 MB takes that route,
 * so the assets that most need a 320px WebP became precisely the ones that got
 * none. Measured on production 2026-08-13: a 6,606,921 B PNG landed with
 * `variants` **absent**, and `?w=320` served back all 6,606,921 B of
 * `image/png`; a 2,168,376 B PNG on the base64 route landed with
 * `variants: [320, 640]` and answered `?w=320` in 31,566 B of `image/webp`.
 *
 * So the bytes have to come back. `readSource` is a callback, for the same
 * reason `saveVariant` is one: this stays free of a storage dependency, and a
 * spec can hand it a real PNG and count what comes out.
 *
 * **The read is the last thing that happens, not the first.** Widths are
 * decided from the header dimensions the caller already has, so a source
 * narrower than every target width — and every non-image — costs nothing at
 * all. That ordering is what keeps this from pulling a 200 MB video back out
 * of the bucket to discover it has no variants.
 *
 * The size refusal is reported as an ERROR rather than as an empty success,
 * and the distinction is AGL-1468's: `variants: []` with no error means
 * nothing was ELIGIBLE, and an image the platform accepted and then declined
 * to optimize is not that. It is eligible work that did not happen, so it
 * belongs on the document and in `variantFailures` where it can be counted.
 */
export async function generateStoredMediaVariants(options: {
  contentType: string
  /** The object's REAL size, as storage reports it. */
  sizeBytes: number
  sourceWidth?: number | null
  objectPath: string
  /** Fetches the whole object. Only ever called when there is work to do. */
  readSource: () => Promise<Buffer>
  saveVariant: SaveMediaDerivedObject
  maxSourceBytes?: number
  /** Also make the display copy (see {@link generateMediaVariants}). */
  display?: boolean
}): Promise<MediaVariantOutcome> {
  const widths = mediaVariantWidthsFor(options)
  const wantsDisplay =
    options.display === true && MEDIA_DISPLAY_TYPES.has(options.contentType)
  if (!widths.length && !wantsDisplay) return { variants: [] }

  const maxSourceBytes = options.maxSourceBytes ?? MEDIA_VARIANT_SOURCE_MAX_BYTES
  if (options.sizeBytes > maxSourceBytes) {
    return {
      variants: [],
      error: `source too large to fetch for variants (${options.sizeBytes} > ${maxSourceBytes} bytes)`,
    }
  }

  let buffer: Buffer
  try {
    buffer = await options.readSource()
  } catch (error) {
    // A download failure is a genuine fault on an eligible asset, and it is
    // NOT the same event as `sharp` being unavailable — so it is described
    // here rather than left to be inferred from a message three frames away.
    console.error('media variant source download failed', options.objectPath, error)
    return { variants: [], error: `source download failed — ${describe(error)}` }
  }

  return generateMediaVariants({ ...options, buffer })
}

/**
 * Can this deployment produce a variant at all?
 *
 * Synthesises a small image in memory, downscales it, and asserts the result
 * is both a WebP and SMALLER than the source. No Storage, no Firestore, no
 * upload — so it can run from a health endpoint on a schedule instead of
 * waiting for a customer to notice their thumbnails are full-size originals.
 *
 * The size comparison is the point. A resize that silently returns its input
 * is exactly the failure this issue is about: `?w=640` answering 200 with the
 * original is indistinguishable from success unless something counts bytes.
 */
export async function probeMediaVariantSupport(): Promise<{
  ok: boolean
  code?: string
}> {
  try {
    const sharp = await loadSharp()
    // A smooth gradient, not a flat fill and not noise. A flat fill
    // compresses to a handful of bytes at every width, so the size
    // comparison below would pass on a resize that did nothing; noise
    // re-expands under lossy WebP, so it would FAIL on a perfectly healthy
    // encoder. Real images sit between the two, and so does this.
    const width = 640
    const height = 128
    const pixels = Buffer.alloc(width * height * 3)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 3
        pixels[index] = Math.round((x * 255) / width)
        pixels[index + 1] = Math.round((y * 255) / height)
        pixels[index + 2] = Math.round((((x + y) % 300) * 255) / 300)
      }
    }
    const source = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer()
    const resized = await encodeMediaVariant(sharp, source, 320)
    // `RIFF....WEBP` — a WebP, not the PNG handed back.
    const isWebp =
      resized.length > 12 &&
      resized.toString('ascii', 0, 4) === 'RIFF' &&
      resized.toString('ascii', 8, 12) === 'WEBP'
    if (!isWebp) return { ok: false, code: 'not-webp' }
    if (resized.length >= source.length) return { ok: false, code: 'not-smaller' }
    return { ok: true }
  } catch (error) {
    // A CODE, never the message: the health endpoint is public and an error
    // from a native module can carry filesystem paths.
    return { ok: false, code: classifyLoadFailure(error) }
  }
}

/**
 * The largest poster this will accept from a client (AGL-2742).
 *
 * The browser encodes the still it captured as WebP at quality ~0.72, and a
 * 1920-wide frame of real video lands between 40 KB and 250 KB. 4 MB is
 * therefore ~16x the worst realistic case and is not a quality knob: it is
 * the point past which the bytes stopped being a poster. It has to sit well
 * under the platform's 4.5 MB request-body wall, because the poster rides
 * base64 in the finalize call and a ceiling that admits a body the platform
 * will reject turns a refusal we can explain into a 413 we cannot.
 */
export const MEDIA_POSTER_MAX_BYTES = 4 * 1024 * 1024

/**
 * The widest poster stored. Above this a still is being kept at a resolution
 * no `<video poster>` paints — the element scales it to the player box, and
 * the largest realistic player box is the 1920 the variant widths already
 * top out at.
 */
export const MEDIA_POSTER_MAX_WIDTH = 1920

/** WebP quality for the poster — the variants' own since AGL-3486. */
const POSTER_QUALITY = MEDIA_VARIANT_WEBP_OPTIONS.quality

export interface MediaPosterOutcome {
  /** Set only when a poster object was actually written. */
  poster?: { width: number; height: number; variants: number[] }
  /**
   * Present ONLY when a poster was offered and could not be produced —
   * the same two-failure-class contract {@link MediaVariantOutcome} keeps.
   * An upload with no poster offered returns an empty object, not an error.
   */
  error?: string
}

/**
 * Turn a client-supplied still into the asset's poster (AGL-2742).
 *
 * ## The re-encode is a security control, not a compression pass
 *
 * These bytes come from a browser, over the wire, and land in the shared
 * media bucket under an org's own prefix, where `serveMediaCdn` will stream
 * them `inline` from the console's origin and from every tenant site's. That
 * is precisely the shape of AGL-1474, where an uploaded `image/svg+xml`
 * turned out to be a scripted document served from `app.aglyn.com`.
 *
 * Nothing here trusts the declared type, the magic bytes, or the extension.
 * The buffer is decoded by `sharp` and **re-encoded** to WebP, so what gets
 * stored is bytes this process produced. A polyglot, an SVG, an HTML file
 * with a PNG header — each either fails to decode (reported, no object
 * written) or becomes a real raster WebP with whatever it was smuggling
 * discarded. That is a stronger guarantee than any sniffing gate, and it is
 * why the poster is allowed to be client-generated at all.
 *
 * ## Why it reuses `generateMediaVariants` rather than looping itself
 *
 * A poster IS an image, and the width set a poster should offer is the width
 * set every other image offers — the srcSet the renderer already knows how
 * to write. Handing the generator `{objectPath}__poster` as its object path
 * makes it emit `{objectPath}__poster__w{n}.webp` with no knowledge that
 * video exists, and inherits its skip rule, its partial-run reporting and
 * its refusal to fail an upload. A private loop here would be a second set
 * of widths to keep in step, which is the defect AGL-175's widths list was
 * moved into `@aglyn/aglyn` to prevent.
 *
 * The dimensions returned are read back from the ENCODED bytes rather than
 * taken from the caller. The browser's report is what sized the capture, and
 * the resize below may have changed it; a document that records what was
 * asked for instead of what was written is how an `aspect-ratio` drifts off
 * by the cap.
 */
export async function generateMediaPoster(options: {
  /** Raw bytes as received. Never assumed to be an image of any kind. */
  buffer: Buffer
  /** Object path of the ORIGINAL video, without the poster suffix. */
  objectPath: string
  saveVariant: SaveMediaDerivedObject
  maxWidth?: number
}): Promise<MediaPosterOutcome> {
  const posterPath = mediaPosterObjectPath(options.objectPath)
  let webp: Buffer
  try {
    const sharp = await loadSharp()
    webp = await sharp(options.buffer)
      .resize({
        width: options.maxWidth ?? MEDIA_POSTER_MAX_WIDTH,
        withoutEnlargement: true,
      })
      .webp({ quality: POSTER_QUALITY })
      .toBuffer()
  } catch (error) {
    console.error('media poster encode failed', options.objectPath, error)
    return { error: `poster encode failed — ${describe(error)}` }
  }

  // Read the WRITTEN bytes. `readImageDimensions` parses the WebP chunk
  // headers this encoder just emitted, so this is a measurement of the
  // stored object and not a restatement of the request.
  const dimensions = readImageDimensions(new Uint8Array(webp))
  if (!dimensions) {
    return { error: 'poster encoded but its dimensions were unreadable' }
  }

  try {
    await options.saveVariant(posterPath, webp, 'image/webp')
  } catch (error) {
    console.error('media poster save failed', posterPath, error)
    return { error: `poster save failed — ${describe(error)}` }
  }

  // Widths for the poster, generated from the poster's own bytes. A failure
  // past this point still leaves a usable full-size poster on the document,
  // which is the whole reason the object above is written first.
  const outcome = await generateMediaVariants({
    buffer: webp,
    contentType: 'image/webp',
    sourceWidth: dimensions.width,
    objectPath: `${options.objectPath}${MEDIA_POSTER_OBJECT_SUFFIX}`,
    saveVariant: options.saveVariant,
  })

  return {
    poster: {
      width: dimensions.width,
      height: dimensions.height,
      variants: outcome.variants,
    },
    ...(outcome.error ? { error: outcome.error } : {}),
  }
}
