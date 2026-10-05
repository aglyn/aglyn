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
  DEFAULT_SITE_ICON_BACKGROUND,
  FAVICON_ICO_SIZES,
  maskableMarkSize,
  normalizeSiteIconBackground,
  siteIconContentType,
  type SiteIconSpec,
} from '@aglyn/aglyn/app-utils/site-icon-set'
import type { Sharp, SharpOptions } from 'sharp'

import { loadSharp } from './media-variants'

/**
 * Draws one icon of a site's derived set (AGL-3484) — the pixels behind
 * `?icon=` on the media CDN. The grammar of the set (which sizes, which
 * plates, how each is addressed) is `site-icon-set.ts` in `@aglyn/aglyn`;
 * this module only turns a source file and a spec into bytes.
 *
 * Every plate starts from the same step: the mark CENTER-FIT on a square,
 * never stretched. A wordmark uploaded as an icon comes out letterboxed — the
 * same artwork, smaller — rather than squashed into a square it never was.
 */

type SharpFactory = (input?: Buffer | SharpOptions, options?: SharpOptions) => Sharp

/** A source whose decoded pixels exceed this is refused rather than decoded. */
const SITE_ICON_MAX_INPUT_PIXELS = 50_000_000

/** `sharp`'s supported SVG density range, kept well inside its upper bound. */
const SVG_DENSITY_RANGE = [1, 4800] as const

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

export interface RenderedSiteIcon {
  body: Buffer
  contentType: string
}

/**
 * The input options that decode `source` sharply at `target` pixels.
 *
 * A raster decodes as it is. An SVG has no pixels until it is rasterized, and
 * `sharp` does that at 72 dpi — a 24-unit icon would come out 24px and be
 * UPSCALED to 512, which is the blur deriving was meant to avoid. So the
 * density is raised until the longer side renders at least `target` pixels.
 */
async function decodeOptions(
  sharp: SharpFactory,
  source: Buffer,
  target: number,
): Promise<SharpOptions> {
  const base: SharpOptions = { limitInputPixels: SITE_ICON_MAX_INPUT_PIXELS }
  const meta = await sharp(source, base).metadata()
  if (meta.format !== 'svg') return base
  const longest = Math.max(meta.width ?? 0, meta.height ?? 0)
  if (!longest) return base
  const density = Math.min(
    SVG_DENSITY_RANGE[1],
    Math.max(SVG_DENSITY_RANGE[0], Math.ceil((72 * target) / longest)),
  )
  return { ...base, density }
}

/** The mark center-fit on a transparent `size` square, as PNG. */
async function containedMark(
  sharp: SharpFactory,
  source: Buffer,
  size: number,
): Promise<Buffer> {
  const options = await decodeOptions(sharp, source, size)
  return sharp(source, options)
    .resize(size, size, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toBuffer()
}

/** `mark` (already `markSize` square) centered on an opaque `size` plate. */
async function onPlate(
  sharp: SharpFactory,
  mark: Buffer,
  size: number,
  background: string,
): Promise<Buffer> {
  const composed = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: `#${background}`,
    },
  })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toBuffer()
  // A second pass, because `sharp` flattens BEFORE it composites within one
  // pipeline. The plate is opaque, and saying so in the file — no alpha
  // channel at all — is what keeps iOS from painting anything black.
  return sharp(composed)
    .flatten({ background: `#${background}` })
    .png()
    .toBuffer()
}

/**
 * Packs PNG images into one ICO container (PNG-in-ICO, which every browser
 * since Windows Vista's era reads).
 *
 * The format is a 6-byte header, a 16-byte directory entry per image and the
 * images themselves. A width or height of 256 is written as 0, per the format;
 * nothing in {@link FAVICON_ICO_SIZES} reaches it, but a caller might.
 */
export function encodeIco(
  images: ReadonlyArray<{ size: number; png: Buffer }>,
): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  const directory = Buffer.alloc(16 * images.length)
  let offset = header.length + directory.length
  images.forEach(({ size, png }, index) => {
    const at = index * 16
    const edge = size >= 256 ? 0 : size
    directory.writeUInt8(edge, at) // width
    directory.writeUInt8(edge, at + 1) // height
    directory.writeUInt8(0, at + 2) // palette size
    directory.writeUInt8(0, at + 3) // reserved
    directory.writeUInt16LE(1, at + 4) // color planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32LE(png.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([header, directory, ...images.map(({ png }) => png)])
}

/**
 * One derived icon of `source`.
 *
 *  - `transparent` — center-fit on a transparent square.
 *  - `flat` — center-fit, then flattened onto `background`: iOS renders a
 *    touch icon's transparency black, so a transparent mark would sit in a
 *    black tile on every home screen.
 *  - `maskable` — fitted inside the safe zone ({@link maskableMarkSize}) on a
 *    `background` plate, so a launcher's circle or squircle mask crops plate
 *    and never mark.
 *  - `ico` — the {@link FAVICON_ICO_SIZES} transparent PNGs in one ICO.
 *
 * `background` is anything {@link normalizeSiteIconBackground} reads, and
 * white when it reads nothing. `sharp` is injectable for the module-shape
 * reasons `loadSharp` documents; it is loaded when omitted.
 */
export async function renderSiteIcon(options: {
  source: Buffer
  spec: SiteIconSpec
  background?: string | null
  sharp?: SharpFactory
}): Promise<RenderedSiteIcon> {
  const { source, spec } = options
  const sharp =
    options.sharp ?? ((await loadSharp()) as unknown as SharpFactory)
  const background =
    normalizeSiteIconBackground(options.background) ??
    DEFAULT_SITE_ICON_BACKGROUND
  const contentType = siteIconContentType(spec)

  if (spec.plate === 'ico') {
    const images = await Promise.all(
      FAVICON_ICO_SIZES.map(async (size) => ({
        size,
        png: await containedMark(sharp, source, size),
      })),
    )
    return { body: encodeIco(images), contentType }
  }
  if (spec.plate === 'transparent') {
    return { body: await containedMark(sharp, source, spec.size), contentType }
  }
  const markSize =
    spec.plate === 'maskable' ? maskableMarkSize(spec.size) : spec.size
  const mark = await containedMark(sharp, source, markSize)
  return {
    body: await onPlate(sharp, mark, spec.size, background),
    contentType,
  }
}
