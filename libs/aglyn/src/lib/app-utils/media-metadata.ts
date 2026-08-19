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

export const MEDIA_TAG_MAX_COUNT = 20
export const MEDIA_TAG_MAX_LENGTH = 40
export const MEDIA_ALT_MAX_LENGTH = 300

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
