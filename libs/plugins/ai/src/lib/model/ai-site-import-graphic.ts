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

/*==========================================
 * A PICTURE THAT IS A GRAPHIC, BY ITS PIXELS (AGL-4152).
 *
 * A logo, a wordmark, a badge, a flat illustration or a screenshot of text
 * is drawn, not photographed, and a redesign never sets one where a photo
 * goes: a cover, a photo band, the picture beside a section. Its name says
 * so only when someone named it ("logo.png"); a phone's "IMG_4295.webp" of
 * a partner's wordmark says nothing. Its pixels do:
 *
 * - **Transparency.** A photo has none; a cut-out mark does.
 * - **A flat area.** A drawing's background is one color, edge to edge; a
 *   photo's lightest wall still varies.
 * - **No grain.** Between neighbouring pixels a drawing either keeps its
 *   color or jumps at an edge; a photo's light changes a little everywhere.
 * - **Few colors.** A drawing is a few inks.
 *
 * The facts are read from the picture drawn at most 64 pixels on its long
 * side, as RGBA, which is what `sharp` hands back for any of the raster
 * types the library holds. Read once, when an import brings the picture
 * in, and kept on its photo entry (`AiSiteImportPhoto.graphic`).
 *=========================================*/

/** The long side a picture is drawn at to be read. */
export const AI_SITE_IMPORT_GRAPHIC_SIDE = 64

/** The share of see-through pixels past which a picture is a cut-out, not a photo (a photo's rounded corners stay under it). */
export const AI_SITE_IMPORT_GRAPHIC_CLEAR = 0.05

/** The share of one color past which a picture has a flat area. */
export const AI_SITE_IMPORT_GRAPHIC_FLAT = 0.3

/** The share of neighbours a little apart under which a picture has no grain. */
export const AI_SITE_IMPORT_GRAPHIC_GRAIN = 0.2

/** The share of one color past which a picture of two inks or fewer is a graphic, whatever its grain (a screenshot's small text). */
export const AI_SITE_IMPORT_GRAPHIC_FLAT_FEW_INKS = 0.5

/** The most coarse colors that make most of a picture of a few inks. */
export const AI_SITE_IMPORT_GRAPHIC_FEW_INKS = 2

/** What a picture's pixels say of it. */
export interface AiSiteImportPixelFacts {
  /** The share of its pixels that are see-through. */
  clear: number
  /** The share of its opaque pixels in its most common color, each channel read to 64 levels. */
  flat: number
  /** The share of neighbouring pairs whose light differs a little (more than none, less than an edge): a photo's grain. */
  grain: number
  /** The fewest colors, each channel read to 8 levels, that make 90% of its opaque pixels. */
  inks: number
}

/** A pair this close in light is the same color. */
const SAME_LIGHT = 1.5

/** A pair this far apart in light is an edge. */
const EDGE_LIGHT = 24

/** An alpha under this is see-through. */
const OPAQUE = 250

/**
 * What a picture's pixels say (`AiSiteImportPixelFacts`), from its pixels
 * row by row, `channels` bytes each (3: RGB; 4: RGBA).
 */
export function aiSiteImportPixelFacts(data: Uint8Array, width: number, height: number, channels: number): AiSiteImportPixelFacts {
  const count = Math.max(0, Math.min(width * height, Math.floor(data.length / Math.max(1, channels))))
  if (!count || channels < 3) return { clear: 0, flat: 0, grain: 0, inks: 0 }
  let clear = 0
  let opaque = 0
  const fine = new Map<number, number>()
  const coarse = new Map<number, number>()
  for (let at = 0; at < count; at += 1) {
    const offset = at * channels
    if (channels >= 4 && (data[offset + 3] as number) < OPAQUE) {
      clear += 1
      continue
    }
    opaque += 1
    const r = data[offset] as number
    const g = data[offset + 1] as number
    const b = data[offset + 2] as number
    const fineKey = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2)
    const coarseKey = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
    fine.set(fineKey, (fine.get(fineKey) ?? 0) + 1)
    coarse.set(coarseKey, (coarse.get(coarseKey) ?? 0) + 1)
  }
  const flat = opaque ? Math.max(0, ...fine.values()) / opaque : 0
  let inks = 0
  let covered = 0
  for (const share of [...coarse.values()].sort((a, b) => b - a)) {
    if (covered >= 0.9 * opaque) break
    covered += share
    inks += 1
  }
  const light = (at: number) => {
    const offset = at * channels
    return 0.299 * (data[offset] as number) + 0.587 * (data[offset + 1] as number) + 0.114 * (data[offset + 2] as number)
  }
  let pairs = 0
  let grain = 0
  const rows = Math.floor(count / width)
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x
      const here = light(at)
      for (const next of [x + 1 < width ? at + 1 : -1, y + 1 < rows ? at + width : -1]) {
        if (next < 0) continue
        pairs += 1
        const apart = Math.abs(here - light(next))
        if (apart >= SAME_LIGHT && apart < EDGE_LIGHT) grain += 1
      }
    }
  }
  return { clear: clear / count, flat, grain: pairs ? grain / pairs : 0, inks }
}

/**
 * Whether a picture's pixels make it a graphic (AGL-4152): see-through, or
 * a flat area with no grain, or a large flat area in two inks or fewer.
 */
export function aiSiteImportLooksGraphic(facts: AiSiteImportPixelFacts): boolean {
  if (facts.clear >= AI_SITE_IMPORT_GRAPHIC_CLEAR) return true
  if (facts.flat >= AI_SITE_IMPORT_GRAPHIC_FLAT && facts.grain < AI_SITE_IMPORT_GRAPHIC_GRAIN) return true
  return facts.inks > 0 && facts.inks <= AI_SITE_IMPORT_GRAPHIC_FEW_INKS && facts.flat >= AI_SITE_IMPORT_GRAPHIC_FLAT_FEW_INKS
}
