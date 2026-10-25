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

import type { Sharp, SharpOptions } from 'sharp'
import {
  POS_READER_SPLASH_MAX_BYTES,
  posReaderSplashImageProblem,
  type PosReaderSplashFamily,
} from '../model/pos-reader-splash'

/*==========================================
 * Draws a reader's start-up screen (AGL-4048) at the exact size Stripe asks
 * for, from either:
 *
 *   - `artwork`  a full-screen portrait image, scaled to cover the screen
 *                (a 9:16 image covers both readers' screens whole);
 *   - `logo`     a logo, fitted inside the middle of the screen on an opaque
 *                white ground, never stretched.
 *
 * The logo's box is 60% of the width and 30% of the height: on a 1080-wide
 * portrait screen a square logo comes out 648 px, and a wide wordmark keeps
 * a margin either side. White is the ground the approved workspace-logo
 * standard sets (a square logo on an opaque white plate), so the same logo
 * reads the same on a reader as in the apps.
 *
 * The result is PNG, the lossless choice for flat artwork; a photo that
 * comes out at 2 MB or more is re-encoded as JPEG until it fits, and every
 * screen is checked against Stripe's rules before it is handed back.
 *=========================================*/

type SharpFactory = (input?: Buffer | SharpOptions, options?: SharpOptions) => Sharp

export type PosReaderSplashRenderMode = 'artwork' | 'logo'

/** A source whose decoded pixels exceed this is refused rather than decoded. */
const MAX_INPUT_PIXELS = 50_000_000

/** The logo's box, as a share of the screen. */
const LOGO_BOX = { width: 0.6, height: 0.3 } as const

/** The opaque ground a logo sits on. */
const LOGO_GROUND = { r: 255, g: 255, b: 255, alpha: 1 } as const

/** JPEG qualities tried, best first, when a PNG is too large for Stripe. */
const JPEG_QUALITIES = [90, 82, 74, 66] as const

export interface RenderedPosReaderSplash {
  body: Buffer
  contentType: 'image/png' | 'image/jpeg'
}

export class PosReaderSplashRenderError extends Error {}

/** Decoding options; an SVG is rasterized at a density sharp at `target`. */
async function decodeOptions(sharp: SharpFactory, source: Buffer, target: number): Promise<SharpOptions> {
  const base: SharpOptions = { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }
  const meta = await sharp(source, base).metadata()
  if (meta.format !== 'svg') return base
  const longest = Math.max(meta.width ?? 0, meta.height ?? 0)
  if (!longest) return base
  return { ...base, density: Math.min(2400, Math.max(1, Math.ceil((72 * target) / longest))) }
}

async function drawn(
  sharp: SharpFactory,
  source: Buffer,
  family: PosReaderSplashFamily,
  mode: PosReaderSplashRenderMode,
): Promise<Buffer> {
  if (mode === 'artwork') {
    const options = await decodeOptions(sharp, source, family.height)
    return sharp(source, options)
      .rotate()
      .resize(family.width, family.height, { fit: 'cover' })
      .flatten({ background: LOGO_GROUND })
      .png()
      .toBuffer()
  }
  const boxWidth = Math.round(family.width * LOGO_BOX.width)
  const boxHeight = Math.round(family.height * LOGO_BOX.height)
  const options = await decodeOptions(sharp, source, Math.max(boxWidth, boxHeight))
  const mark = await sharp(source, options)
    .rotate()
    .resize(boxWidth, boxHeight, { fit: 'inside' })
    .png()
    .toBuffer()
  const composed = await sharp({
    create: { width: family.width, height: family.height, channels: 4, background: LOGO_GROUND },
  })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toBuffer()
  // A second pass: sharp flattens before it composites within one pipeline,
  // and the screen has no use for an alpha channel.
  return sharp(composed).flatten({ background: LOGO_GROUND }).png().toBuffer()
}

/** One reader family's start-up screen from `source`. */
export async function renderPosReaderSplash(options: {
  source: Buffer
  family: PosReaderSplashFamily
  mode: PosReaderSplashRenderMode
  sharp: SharpFactory
}): Promise<RenderedPosReaderSplash> {
  const { source, family, mode, sharp } = options
  let png: Buffer
  try {
    png = await drawn(sharp, source, family, mode)
  } catch {
    throw new PosReaderSplashRenderError('That image could not be read.')
  }
  let rendered: RenderedPosReaderSplash = { body: png, contentType: 'image/png' }
  if (png.length >= POS_READER_SPLASH_MAX_BYTES) {
    for (const quality of JPEG_QUALITIES) {
      const body = await sharp(png).jpeg({ quality, mozjpeg: true }).toBuffer()
      rendered = { body, contentType: 'image/jpeg' }
      if (body.length < POS_READER_SPLASH_MAX_BYTES) break
    }
  }
  const meta = await sharp(rendered.body).metadata()
  const problem = posReaderSplashImageProblem(
    {
      contentType: rendered.contentType,
      bytes: rendered.body.length,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
    },
    family,
  )
  if (problem) throw new PosReaderSplashRenderError(problem)
  return rendered
}

/** An image's format and size, read without decoding its pixels. */
export async function posReaderSplashImageFacts(
  sharp: SharpFactory,
  body: Buffer,
): Promise<{ contentType: string; width: number; height: number } | null> {
  try {
    const meta = await sharp(body, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
    const contentType =
      meta.format === 'png' ? 'image/png' : meta.format === 'jpeg' ? 'image/jpeg' : meta.format === 'webp' ? 'image/webp' : ''
    return { contentType, width: meta.width ?? 0, height: meta.height ?? 0 }
  } catch {
    return null
  }
}
