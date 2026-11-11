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
 * WHICH OF A PAGE'S PHOTOS ARE GRAPHICS, READ AS THE IMPORT BRINGS THEM IN (AGL-4152).
 *
 * A page's pictures, once in the site's library, are each drawn small and
 * read (`aiSiteImportPixelFacts`), and every photo entry keeps the answer as
 * `graphic`, so a redesign reads a flag and never a picture while a model
 * waits. The read is the library's own (`readAiMediaAssetBytes`): nothing is
 * fetched from a URL.
 *
 * Decoding takes `sharp`, whose native library on Vercel only the plugins'
 * image function ships (`ai-image-reads.ts`, AGL-4048): there the page's
 * pictures go to it by their media references, in one signed request; off
 * Vercel they are read here. A picture that cannot be read keeps no flag,
 * and its name decides, as before.
 *=========================================*/

import type { AiSiteImportPhoto } from '../model/ai-site-import'
import { AI_SITE_IMPORT_GRAPHIC_SIDE, aiSiteImportLooksGraphic, aiSiteImportPixelFacts } from '../model/ai-site-import-graphic'
import { aiMediaAssetLocation, loadAiMediaSharp, readAiMediaAssetBytes } from './ai-media-asset'

/** The clock for reading one page's pictures. */
export const AI_SITE_IMPORT_GRAPHICS_MS = 20_000

/** The largest picture read: the largest an import brings in. */
const GRAPHIC_MAX_BYTES = 8 * 1024 * 1024

/** The raster types an import stores. */
const GRAPHIC_TYPES = /^image\/(?:png|jpeg|webp|gif)$/

/** The pictures read at once in this process. */
const AT_ONCE = 4

/** The part of `sharp` the read uses. */
interface SharpGraphicPipeline {
  resize(width: number, height: number, options: { fit: 'inside' }): SharpGraphicPipeline
  ensureAlpha(): SharpGraphicPipeline
  raw(): SharpGraphicPipeline
  toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number; channels: number } }>
}
type SharpGraphic = (input: Buffer, options?: { limitInputPixels?: number; animated?: boolean }) => SharpGraphicPipeline

/** Whether a picture's bytes make it a graphic (`aiSiteImportLooksGraphic`), decoded in this process. */
export async function aiSiteImportGraphicOfBytes(bytes: Uint8Array): Promise<boolean> {
  const sharp = (await loadAiMediaSharp()) as SharpGraphic
  const side = AI_SITE_IMPORT_GRAPHIC_SIDE
  const { data, info } = await sharp(Buffer.from(bytes), { limitInputPixels: 64_000_000, animated: false })
    .resize(side, side, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return aiSiteImportLooksGraphic(aiSiteImportPixelFacts(new Uint8Array(data), info.width, info.height, info.channels))
}

/**
 * Whether each of a site's library pictures, by its media reference, is a
 * graphic, read and decoded in THIS process: what the import does off
 * Vercel, and what the images function does for it there. `null` for one
 * that is not the site's or its org's, cannot be read, or cannot be decoded.
 */
export async function readAiSiteImportGraphicsHere(
  firestore: FirebaseFirestore.Firestore,
  refs: readonly string[],
  hostId: string,
  orgId: string,
  signal?: AbortSignal,
): Promise<Array<boolean | null>> {
  const out: Array<boolean | null> = refs.map(() => null)
  let next = 0
  const worker = async () => {
    while (next < refs.length && !signal?.aborted) {
      const at = next++
      const location = aiMediaAssetLocation(refs[at], hostId, orgId)
      if (!location) continue
      try {
        const asset = await readAiMediaAssetBytes(firestore, location, hostId, { maxBytes: GRAPHIC_MAX_BYTES, types: GRAPHIC_TYPES })
        out[at] = asset ? await aiSiteImportGraphicOfBytes(new Uint8Array(asset.buffer)) : null
      } catch (error) {
        console.warn('[site-import] a picture’s pixels could not be read', { hostId, error })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, refs.length) }, worker))
  return out
}

/** Reads whether each picture, by its media reference, is a graphic: `null` for one that could not be read. */
export type AiSiteImportPictureGraphics = (
  refs: readonly string[],
  input: { firestore: FirebaseFirestore.Firestore; hostId: string; orgId: string; signal: AbortSignal },
) => Promise<ReadonlyArray<boolean | null>>

/** Where `sharp` is shipped (`ai-image-reads.ts`): the images function on Vercel, this process elsewhere. */
const readPictureGraphics: AiSiteImportPictureGraphics = async (refs, { firestore, hostId, orgId, signal }) => {
  const images = await import('./ai-image-reads')
  const origin = images.aiImageReadsOrigin()
  if (!origin) return readAiSiteImportGraphicsHere(firestore, refs, hostId, orgId, signal)
  const out: Array<boolean | null> = []
  for (let at = 0; at < refs.length; at += images.AI_PICTURE_GRAPHICS_MAX_REFS) {
    const chunk = refs.slice(at, at + images.AI_PICTURE_GRAPHICS_MAX_REFS)
    const answer = await images.requestAiImageReads<{ graphics?: unknown }>(origin, { op: 'picture-graphics', refs: chunk, hostId, orgId }, signal)
    const graphics = Array.isArray(answer?.graphics) ? answer.graphics : []
    out.push(...chunk.map((_ref, index) => (typeof graphics[index] === 'boolean' ? (graphics[index] as boolean) : null)))
  }
  return out
}

/**
 * A page's photos, each with whether its pixels make it a graphic
 * (`AiSiteImportPhoto.graphic`, AGL-4152), inside the read's own clock.
 * Never throws: a read that fails leaves the photos as they came, and a
 * photo that could not be read keeps no flag.
 */
export async function aiSiteImportPhotoGraphics(
  assets: readonly AiSiteImportPhoto[],
  input: { firestore: FirebaseFirestore.Firestore; hostId: string; orgId: string; signal?: AbortSignal },
  read: AiSiteImportPictureGraphics = readPictureGraphics,
): Promise<AiSiteImportPhoto[]> {
  if (!assets.length || input.signal?.aborted) return [...assets]
  const signal = AbortSignal.any([AbortSignal.timeout(AI_SITE_IMPORT_GRAPHICS_MS), ...(input.signal ? [input.signal] : [])])
  // The clock holds whichever way the read runs: an answer that does not come in time is none.
  const late = new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  late.catch(() => undefined)
  try {
    const flags = await Promise.race([read(assets.map((photo) => photo.src), { firestore: input.firestore, hostId: input.hostId, orgId: input.orgId, signal }), late])
    return assets.map((photo, index) => {
      const graphic = flags[index]
      return typeof graphic === 'boolean' ? { ...photo, graphic } : photo
    })
  } catch (error) {
    console.warn('[site-import] a page’s pictures could not be read for graphics', { hostId: input.hostId, error })
    return [...assets]
  }
}
