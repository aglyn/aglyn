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

/*
 * The arithmetic of the media library's image editor (AGL-184): rotate 90°,
 * flip, an aspect-locked crop and a downscale, with no pixels in it. It was
 * inline in the console's dialog; the native apps edit an image with their
 * own drawing code and replay these cases, so a crop that lands on one pixel
 * in the browser lands on the same pixel in the app.
 */

/** A rectangle in whatever pixels the caller measures in. */
export interface ImageEditRect {
  x: number
  y: number
  w: number
  h: number
}

/** The crop ratios the editor offers; `null` is a free crop. */
export const IMAGE_EDIT_ASPECTS: ReadonlyArray<{
  label: string
  ratio: number | null
}> = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '16:9', ratio: 16 / 9 },
]

/**
 * The same list as one JSON string: the contracts carry a plain string, and
 * the native apps parse the ratios from it.
 */
export const IMAGE_EDIT_ASPECTS_JSON: string = JSON.stringify(IMAGE_EDIT_ASPECTS)

/** The longest side of the editor's preview, in pixels. */
export const IMAGE_EDIT_PREVIEW_MAX = 480

/** The quality an edited JPEG is encoded at. */
export const IMAGE_EDIT_JPEG_QUALITY = 0.9

/** The image's size once it is turned: a quarter turn swaps the sides. */
export function imageEditWorkedSize(
  width: number,
  height: number,
  rotation: number,
): { w: number; h: number } {
  const swapped = rotation === 90 || rotation === 270
  return swapped ? { w: height, h: width } : { w: width, h: height }
}

/** How far the preview is shrunk so its longest side fits; never enlarged. */
export function imageEditPreviewScale(workedW: number, workedH: number): number {
  if (!workedW || !workedH) return 1
  return Math.min(1, IMAGE_EDIT_PREVIEW_MAX / Math.max(workedW, workedH))
}

/**
 * The crop a drag draws, from where it started to where the pointer is, kept
 * inside the preview. A locked ratio is width-led; a free crop uses the
 * dragged height.
 */
export function imageEditCropFromDrag(
  start: { x: number; y: number },
  now: { x: number; y: number },
  aspect: number | null,
  previewW: number,
  previewH: number,
): ImageEditRect {
  const w = Math.abs(now.x - start.x)
  const h = aspect ? w / aspect : Math.abs(now.y - start.y)
  const x = Math.min(start.x, now.x)
  const y = Math.min(start.y, now.y)
  return {
    x,
    y,
    w: Math.min(w, previewW - x),
    h: Math.min(h, previewH - y),
  }
}

/** What an edit writes: the crop in the turned image's own pixels, and the size it is drawn at. */
export interface ImageEditOutput {
  crop: ImageEditRect
  width: number
  height: number
}

/**
 * Where an edit cuts and how big it comes out. `crop` is in preview pixels
 * (`null` keeps the whole turned image) and `scale` is the preview's
 * {@link imageEditPreviewScale}; `maxWidth` shrinks the result to at most
 * that wide (0, a blank or a width at or above the crop's keeps the size). A
 * crop under a pixel each way is taken as no crop.
 */
export function imageEditOutput(
  worked: { w: number; h: number },
  crop: ImageEditRect | null,
  scale: number,
  maxWidth: number,
): ImageEditOutput {
  const invScale = scale ? 1 / scale : 1
  const drawn = crop
    ? {
        x: Math.round(crop.x * invScale),
        y: Math.round(crop.y * invScale),
        w: Math.round(crop.w * invScale),
        h: Math.round(crop.h * invScale),
      }
    : null
  // A crop with no width or height (a click that never dragged) is no crop.
  const cropNat =
    drawn && drawn.w >= 1 && drawn.h >= 1
      ? drawn
      : { x: 0, y: 0, w: worked.w, h: worked.h }
  const targetW =
    Number.isFinite(maxWidth) && maxWidth > 0 && maxWidth < cropNat.w
      ? maxWidth
      : cropNat.w
  const targetH =
    cropNat.w > 0 ? Math.round((cropNat.h * targetW) / cropNat.w) : cropNat.h
  return {
    crop: cropNat,
    width: Math.max(1, targetW),
    height: Math.max(1, targetH),
  }
}

/** The name "Save as copy" gives the new file: `photo.png` becomes `photo (edited).png`. */
export function imageEditCopyName(fileName: string): string {
  return fileName.replace(/(\.[^.]+)?$/, ' (edited)$1')
}

/** PNG stays PNG, so a logo keeps its edges; anything else is saved as JPEG. */
export function imageEditContentType(fileName: string): string {
  return /\.png$/i.test(fileName) ? 'image/png' : 'image/jpeg'
}
