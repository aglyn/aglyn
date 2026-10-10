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
 * What a picture lightbox shows, read off the page (AGL-3717).
 *
 * No React and no MUI here: the Image and the Image List import this on every
 * page that places them, and the dialog itself (`image-lightbox.tsx`) loads
 * only when a visitor opens it.
 *
 * ## Why the pictures are read from the DOM
 *
 * A gallery is "the pictures in this list" or "the pictures that share this
 * gallery name", and the page already holds exactly that: every Image that
 * takes part stamps {@link LIGHTBOX_ATTRIBUTE} on its `<img>`, with its
 * caption beside it. Reading them when the visitor clicks — rather than
 * registering each Image with its list in React state — gives the order the
 * visitor sees (a list's tiles, a page's sections), costs nothing until the
 * click, and works whatever wraps the pictures: a tile, a card, a grid cell
 * or a reusable component.
 *
 * The lightbox asks for the picture by the URL and `srcset` the Image already
 * rendered, with a `sizes` of the whole screen, so the browser picks the
 * full-size variant the media CDN already holds for it (AGL-175). Nothing new
 * is resolved here, and no host is reached that the page did not reach.
 */

import { createContext } from 'react'

/** Marks an `<img>` that opens in a lightbox; its value is the gallery name. */
export const LIGHTBOX_ATTRIBUTE = 'data-aglyn-lightbox'
/** The caption a picture shows in the lightbox. */
export const LIGHTBOX_CAPTION_ATTRIBUTE = 'data-aglyn-lightbox-caption'

export interface LightboxPicture {
  src: string
  srcSet?: string
  alt: string
  caption?: string
}

export interface LightboxGallery {
  pictures: LightboxPicture[]
  index: number
}

/**
 * Opens the gallery the trigger belongs to. Provided by an Image List whose
 * lightbox is on, so every Image inside it opens the list's gallery rather
 * than one of its own.
 */
export interface ImageLightboxGalleryApi {
  open: (trigger: HTMLElement) => void
}

export const ImageLightboxGalleryContext =
  createContext<ImageLightboxGalleryApi | null>(null)

/** The caption of an Image List tile, when the picture names none itself. */
function tileCaption(img: Element): string | undefined {
  const title = img
    .closest('li')
    ?.querySelector('.MuiImageListItemBar-title')
    ?.textContent?.trim()
  return title || undefined
}

/** One `<img>` as a lightbox picture, or nothing for one with no source. */
export function pictureOf(img: Element): LightboxPicture | null {
  const src = img.getAttribute('src')?.trim()
  if (!src) return null
  const srcSet = img.getAttribute('srcset')?.trim() || undefined
  const caption =
    img.getAttribute(LIGHTBOX_CAPTION_ATTRIBUTE)?.trim() || tileCaption(img)
  return {
    src,
    ...(srcSet ? { srcSet } : {}),
    alt: img.getAttribute('alt') ?? '',
    ...(caption ? { caption } : {}),
  }
}

/** The pictures under `root` that take part, in document order. */
function picturesUnder(
  root: ParentNode,
  trigger: Element,
  selector: string,
): LightboxGallery {
  const images = Array.from(root.querySelectorAll(selector))
  const pictures: LightboxPicture[] = []
  let index = 0
  for (const img of images) {
    const picture = pictureOf(img)
    if (!picture) continue
    if (img === trigger || img.contains(trigger) || trigger.contains(img)) {
      index = pictures.length
    }
    pictures.push(picture)
  }
  return { pictures, index }
}

/**
 * The gallery an Image List opens from one of its pictures: every picture in
 * the list, starting at the one pressed.
 */
export function listGalleryOf(
  list: Element,
  trigger: Element,
): LightboxGallery {
  return picturesUnder(list, trigger, `img[${LIGHTBOX_ATTRIBUTE}]`)
}

/**
 * The gallery an Image opens on its own: itself, or — when it names a
 * gallery — every picture on the page with the same name.
 */
export function imageGalleryOf(img: Element): LightboxGallery {
  const name = img.getAttribute(LIGHTBOX_ATTRIBUTE) ?? ''
  if (name) {
    const doc = img.ownerDocument
    const escaped =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(name)
        : name.replace(/["\\]/g, '\\$&')
    const gallery = picturesUnder(doc, img, `img[${LIGHTBOX_ATTRIBUTE}="${escaped}"]`)
    if (gallery.pictures.length) return gallery
  }
  const picture = pictureOf(img)
  return { pictures: picture ? [picture] : [], index: 0 }
}

/** The next index, wrapping at both ends. */
export function stepIndex(index: number, step: number, count: number): number {
  if (count <= 0) return 0
  return (((index + step) % count) + count) % count
}
