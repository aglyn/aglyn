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
  AI_RASTER_STYLES,
  AI_SVG_STYLES,
  type AiImageAspectRatio,
  type AiImageMode,
  type AiRasterStyle,
  type AiSvgStyle,
} from '../providers/image-contract'

/**
 * The kinds of picture Media's Create with AI offers (AGL-3602), as the Kind
 * menu lists them: four drawn as SVG by the text provider, and seventeen made
 * by the image provider — a photo whose description decides its style, six
 * photographic genres, six art styles and four design assets.
 *
 * Browser-safe: the dialog reads this to draw the menu, pick a shape and
 * decide which controls to show, with no request until Create. The style
 * wording a raster kind adds to the description is the server's
 * (`server/ai-media-raster-prompt.ts`), so the browser bundle does not carry
 * it.
 */

/** The Kind menu's sections, in order. */
export const AI_MEDIA_KIND_GROUPS = ['vector', 'photo', 'art', 'design'] as const
export type AiMediaKindGroup = (typeof AI_MEDIA_KIND_GROUPS)[number]

/** Each section's heading in the Kind menu. */
export const AI_MEDIA_KIND_GROUP_LABELS: Readonly<Record<AiMediaKindGroup, string>> = {
  vector: 'Vector',
  photo: 'Photo',
  art: 'Art',
  design: 'Design',
}

/** A kind's id: an SVG style, or an image-provider style. */
export type AiMediaKindId = AiSvgStyle | AiRasterStyle

/**
 * Which colors a kind takes. `palette` offers the site theme's colors or the
 * person's own, sent with the request; `describe` sends none and suggests
 * naming colors in the description; `none` is a photograph, whose colors
 * are the scene's.
 */
export type AiMediaKindColors = 'palette' | 'describe' | 'none'

export interface AiMediaKind {
  id: AiMediaKindId
  group: AiMediaKindGroup
  /** The provider mode the door runs it in. */
  mode: AiImageMode
  label: string
  /** The line under the Kind menu once it is chosen. */
  hint: string
  /** The shape the dialog switches to when the kind is chosen. */
  aspectRatio: AiImageAspectRatio
  colors: AiMediaKindColors
  /** The description field's example. */
  placeholder: string
}

const vector = (
  id: AiSvgStyle,
  label: string,
  hint: string,
  placeholder: string,
): AiMediaKind => ({
  id,
  group: 'vector',
  mode: 'illustration',
  label,
  hint,
  aspectRatio: '1:1',
  colors: 'palette',
  placeholder,
})

const raster = (
  id: AiRasterStyle,
  group: Exclude<AiMediaKindGroup, 'vector'>,
  label: string,
  hint: string,
  aspectRatio: AiImageAspectRatio,
  placeholder: string,
): AiMediaKind => ({
  id,
  group,
  mode: 'photo',
  label,
  hint,
  aspectRatio,
  colors: group === 'photo' ? 'none' : 'describe',
  placeholder,
})

export const AI_MEDIA_KINDS: readonly AiMediaKind[] = [
  vector(
    'illustration',
    'Illustration',
    'A spot illustration or small scene, drawn as an SVG and sharp at any size.',
    'A friendly delivery van with a parcel, simple and flat',
  ),
  vector(
    'icon',
    'Icon',
    'A single icon in one color, or two tones, readable at small sizes.',
    'A shopping bag with a heart',
  ),
  vector(
    'pattern',
    'Pattern',
    'A seamless background that tiles.',
    'Scattered coffee beans and leaves',
  ),
  vector(
    'logo',
    'Logo mark',
    'A simple symbol, without lettering. Not a real brand’s logo.',
    'A mountain peak inside a circle',
  ),
  raster(
    'photo',
    'photo',
    'Photo',
    'A realistic photo; your description decides the style.',
    '1:1',
    'A sunlit bakery counter with fresh sourdough loaves, warm morning light',
  ),
  raster(
    'natural',
    'photo',
    'Natural photo',
    'Candid and true to life, in soft available light.',
    '4:3',
    'A florist arranging tulips in a small shop',
  ),
  raster(
    'product',
    'photo',
    'Studio product shot',
    'The product alone on a clean backdrop, in soft studio light.',
    '1:1',
    'A matte ceramic coffee mug in sage green',
  ),
  raster(
    'lifestyle',
    'photo',
    'Lifestyle with people',
    'People using or enjoying the subject in a real setting. The people are made up, not anyone real.',
    '4:3',
    'Friends sharing pastries at an outdoor café table',
  ),
  raster(
    'architecture',
    'photo',
    'Architecture & interiors',
    'Buildings and rooms with straight lines and natural daylight.',
    '4:3',
    'A bright Scandinavian living room with oak floors',
  ),
  raster(
    'food',
    'photo',
    'Food',
    'Styled dishes in soft window light.',
    '3:4',
    'A bowl of ramen with a soft-boiled egg and scallions',
  ),
  raster(
    'aerial',
    'photo',
    'Aerial & landscape',
    'A sweeping view from above or across the land.',
    '16:9',
    'A winding coastal road at sunset',
  ),
  raster(
    'render-3d',
    'art',
    '3D render',
    'Smooth, stylized 3D shapes in soft studio light.',
    '1:1',
    'A stack of colorful gift boxes',
  ),
  raster(
    'watercolor',
    'art',
    'Watercolor',
    'Soft washes of color on textured paper.',
    '4:3',
    'A harbor town with fishing boats',
  ),
  raster(
    'oil-painting',
    'art',
    'Oil painting',
    'Rich color and visible brushstrokes on canvas.',
    '4:3',
    'A vase of sunflowers on a wooden table',
  ),
  raster(
    'flat-art',
    'art',
    'Flat vector art',
    'Clean flat shapes and solid colors, made as an image rather than an SVG.',
    '4:3',
    'A team working together around a laptop',
  ),
  raster(
    'line-drawing',
    'art',
    'Line drawing',
    'Clean ink lines on a plain background.',
    '1:1',
    'A bicycle leaning against a lamppost',
  ),
  raster(
    'cartoon',
    'art',
    'Cartoon or anime',
    'Bold outlines and bright colors, with original characters only.',
    '1:1',
    'A cheerful robot watering plants',
  ),
  raster(
    'background',
    'design',
    'Background or texture',
    'Low contrast with no focal point, so text can sit on top.',
    '16:9',
    'Soft gradient waves in calm blues',
  ),
  raster(
    'banner',
    'design',
    'Banner or hero image',
    'Wide, with calm space on one side for a headline. No lettering.',
    '16:9',
    'A yoga mat and plants by a sunny window',
  ),
  raster(
    'social',
    'design',
    'Social post graphic',
    'A bold, centered picture for a social post.',
    '1:1',
    'A summer sale feel with citrus fruit and bright colors',
  ),
  raster(
    'mockup',
    'design',
    'Mockup',
    'Your design shown on a device screen or on packaging.',
    '4:3',
    'A phone on a desk showing a bakery’s online menu',
  ),
]

/** A kind by id; `undefined` for an id no kind has. */
export function aiMediaKind(id: string): AiMediaKind | undefined {
  return AI_MEDIA_KINDS.find((kind) => kind.id === id)
}

/**
 * The kinds this deployment offers: every kind where the image provider is
 * on, and only the SVG kinds where it is not, so nothing the door would
 * refuse is ever listed.
 */
export function aiMediaKindsOffered(photos: boolean): readonly AiMediaKind[] {
  return photos ? AI_MEDIA_KINDS : AI_MEDIA_KINDS.filter((kind) => kind.mode === 'illustration')
}

/** Every SVG and raster style has exactly one kind; the spec holds the list to it. */
export const AI_MEDIA_KIND_IDS: readonly AiMediaKindId[] = [...AI_SVG_STYLES, ...AI_RASTER_STYLES]
