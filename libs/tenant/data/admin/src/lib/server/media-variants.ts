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

import { MEDIA_CDN_VARIANT_WIDTHS } from './serve-media-cdn'

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
 * - `variants: []` with **no** `error` — nothing was ELIGIBLE. An SVG, a
 *   non-image, or a source already narrower than every target width. This is
 *   the correct, common, uninteresting outcome and must never look like a
 *   fault or the fault signal is worthless.
 * - `variants: []` with an `error` — generation was attempted and did not
 *   complete. That string goes onto the media document and bumps a counter,
 *   which is what makes "how many assets failed?" a query instead of an
 *   archaeology project.
 *
 * A partial run reports both: the widths that landed AND the error, because
 * the widths that landed are real files that the CDN route can serve.
 */

/** The shape of `sharp`'s default export, narrowed to what is used here. */
type SharpFactory = (input: Buffer) => {
  resize(options: { width: number; withoutEnlargement: boolean }): {
    webp(options: { quality: number }): { toBuffer(): Promise<Buffer> }
  }
}

export interface MediaVariantOutcome {
  /** Widths actually written. Safe to store — every entry is a real object. */
  variants: number[]
  /**
   * Present ONLY when generation was attempted and did not complete.
   * `undefined` means nothing went wrong, which includes "nothing to do".
   */
  error?: string
}

/**
 * Which widths this source should produce.
 *
 * Split out and exported because it is the predicate that decides whether an
 * empty result is NORMAL, and both the routes and the health probe have to
 * agree on it. Inlined, the skip rule was a `continue` buried in the loop that
 * a reader had to reconstruct in order to know whether `[]` was a bug.
 */
export function mediaVariantWidthsFor(options: {
  contentType: string
  /** Source pixel width, when it could be read from the header. */
  sourceWidth?: number | null
}): number[] {
  if (!options.contentType.startsWith('image/')) return []
  // Vector: there is nothing to downscale, and rasterising it would be a
  // different asset rather than a variant of this one.
  if (options.contentType === 'image/svg+xml') return []
  const sourceWidth = options.sourceWidth ?? 0
  // No known width means generate and let `withoutEnlargement` decide, which
  // is the same call the loop made before: an unreadable header must not
  // silently opt an asset out of the CDN.
  return MEDIA_CDN_VARIANT_WIDTHS.filter(
    (width) => !(sourceWidth && sourceWidth <= width),
  )
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
async function loadSharp(): Promise<SharpFactory> {
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
 * Generate the WebP variants for one asset and report the outcome.
 *
 * `saveVariant` is a callback rather than a `Bucket` so this stays free of a
 * storage dependency and so a spec can assert on the BYTES it produces —
 * which is the only assertion that distinguishes a working variant from the
 * original served back under a `?w=` that selects nothing.
 */
export async function generateMediaVariants(options: {
  buffer: Buffer
  contentType: string
  sourceWidth?: number | null
  /** Object path of the ORIGINAL; variants are `${objectPath}__w{n}.webp`. */
  objectPath: string
  saveVariant: (path: string, webp: Buffer) => Promise<void>
}): Promise<MediaVariantOutcome> {
  const widths = mediaVariantWidthsFor(options)
  if (!widths.length) return { variants: [] }

  const variants: number[] = []
  try {
    const sharp = await loadSharp()
    for (const width of widths) {
      const webp = await sharp(options.buffer)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer()
      await options.saveVariant(`${options.objectPath}__w${width}.webp`, webp)
      variants.push(width)
    }
  } catch (error) {
    // Still never fails the upload — but no longer only whispers.
    console.error('media variant generation failed', options.objectPath, error)
    return { variants, error: describe(error) }
  }
  return { variants }
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
    const source = await (
      sharp as unknown as (
        input: Buffer,
        options: unknown,
      ) => { png(): { toBuffer(): Promise<Buffer> } }
    )(pixels, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer()
    const resized = await sharp(source)
      .resize({ width: 320, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()
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
