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

// Brings a capture under the docs' size ceiling as the harness writes it, so
// a re-run never leaves a step for somebody to remember (AGL-3319).
//
// Lossless first: Chrome's PNG encoder favors speed, and maximum deflate with
// adaptive filtering alone takes a typical console capture down by a third.
// Only a capture still over the ceiling after that is quantized to a palette.
// A console screen is flat fills and anti-aliased text, which a 256-color
// palette with dithering reproduces without visible loss, and a photo-heavy
// frame (the media grid, a storefront) is the only kind that gets there.

import { readFileSync, writeFileSync } from 'node:fs'

/** The ceiling `check:docs-screenshots` holds every docs image to. */
export const MAX_IMAGE_BYTES = 300 * 1024

/**
 * Re-encodes the PNG at `path` in place and returns its final size.
 *
 * Throws when even the palette encoding is over the ceiling. A frame that big
 * is a composition problem (too much of the page, or a photo where a UI crop
 * was meant), and a silently oversized file is what the guard exists to stop.
 */
export async function optimizePng(path, { maxBytes = MAX_IMAGE_BYTES } = {}) {
  const sharp = (await import('sharp')).default
  const original = readFileSync(path)
  const lossless = await sharp(original)
    .png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 })
    .toBuffer()
  let best = lossless.length < original.length ? lossless : original
  if (best.length > maxBytes) {
    best = await sharp(original)
      .png({ palette: true, colors: 256, dither: 1, quality: 95, effort: 10, compressionLevel: 9 })
      .toBuffer()
  }
  if (best.length > maxBytes) {
    throw new Error(
      `${path} is ${Math.round(best.length / 1024)} KB after optimizing, over the ` +
        `${Math.round(maxBytes / 1024)} KB ceiling. Crop it tighter.`,
    )
  }
  writeFileSync(path, best)
  return best.length
}
