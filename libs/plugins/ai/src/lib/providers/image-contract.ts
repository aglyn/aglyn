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

import type { AiUsage } from './contract'

/**
 * The image-generation contract (AGL-3602): the one shape a door that makes
 * pictures speaks, beside the text contract in `contract.ts` rather than
 * inside it. A text provider answers tokens and is priced per token; an image
 * provider answers pictures and is priced per picture, and folding the two
 * into one interface would hand every text adapter a method it cannot
 * implement and every image adapter four token counts it does not have.
 *
 * Browser-safe: the constants and types here are what the Media dialog reads
 * too. The adapter that speaks a vendor's wire lives in its own module.
 */

/** The shapes a picture may be asked for, as the dialog offers them. */
export const AI_IMAGE_ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const
export type AiImageAspectRatio = (typeof AI_IMAGE_ASPECT_RATIOS)[number]

/** The most pictures one request makes. */
export const AI_IMAGE_MAX_COUNT = 4

/** The longest description a request carries, in characters. */
export const AI_IMAGE_PROMPT_MAX_CHARS = 1_000

/**
 * The two ways the Media dialog makes a picture (AGL-3602): a `photo` from
 * the image provider, and an `illustration` drawn as SVG by the text
 * provider every other AI door already uses. `photo` is the image provider's
 * mode whatever the kind — a watercolor is made there too — and is stored on
 * every picture's record, so the value is never renamed.
 */
export const AI_IMAGE_MODES = ['photo', 'illustration'] as const
export type AiImageMode = (typeof AI_IMAGE_MODES)[number]

/** What an illustration is: a scene, an icon, a tileable pattern or a simple mark. */
export const AI_SVG_STYLES = ['illustration', 'icon', 'pattern', 'logo'] as const
export type AiSvgStyle = (typeof AI_SVG_STYLES)[number]

/**
 * What a picture from the image provider is (AGL-3602): `photo` leaves the
 * style to the description, and every other kind adds its own fixed style
 * wording to it — a photographic genre, an art style or a design asset.
 */
export const AI_RASTER_STYLES = [
  'photo',
  'natural',
  'product',
  'lifestyle',
  'architecture',
  'food',
  'aerial',
  'render-3d',
  'watercolor',
  'oil-painting',
  'flat-art',
  'line-drawing',
  'cartoon',
  'background',
  'banner',
  'social',
  'mockup',
] as const
export type AiRasterStyle = (typeof AI_RASTER_STYLES)[number]

export function isAiRasterStyle(value: unknown): value is AiRasterStyle {
  return (AI_RASTER_STYLES as readonly unknown[]).includes(value)
}

/** The most colors a person may name for an illustration. */
export const AI_SVG_MAX_COLORS = 6

/**
 * Whether this deployment offers the photo mode, as its build says: a
 * deployment that configured an image provider sets
 * `NEXT_PUBLIC_AI_IMAGE_PHOTOS=on` beside it. Read where the dialog renders,
 * so no request is made to decide what to draw; the door still refuses a
 * photo on a deployment with no provider.
 */
export function aiImagePhotosOffered(): boolean {
  return process.env.NEXT_PUBLIC_AI_IMAGE_PHOTOS === 'on'
}

export function isAiImageAspectRatio(value: unknown): value is AiImageAspectRatio {
  return (AI_IMAGE_ASPECT_RATIOS as readonly unknown[]).includes(value)
}

/** One request to an image provider. */
export interface AiImageRequest {
  /** The model id, from the image catalog. */
  model: string
  prompt: string
  aspectRatio: AiImageAspectRatio
  /** 1 to `AI_IMAGE_MAX_COUNT`. */
  count: number
}

/** One picture the provider returned. */
export interface AiGeneratedImage {
  /** The bytes, base64-encoded, as the provider sent them. */
  base64: string
  /** The type the bytes are in: `image/jpeg` or `image/png`. */
  mimeType: string
}

/** What one request made. */
export interface AiImageResult {
  model: string
  images: AiGeneratedImage[]
  /**
   * The tokens the requests spent beside the pictures themselves — the
   * prompt, and any thinking — which the meter prices at the image row's
   * token rates. The pictures are priced per picture, never as tokens here.
   */
  usage: AiUsage
  /**
   * How many of the requested pictures the provider's safety filter held
   * back. A picture held back is not returned and is never billed.
   */
  filtered: number
}

/**
 * The provider's safety filter declined the whole request: the description,
 * or every picture made from it. Nothing came back, so nothing is billed and
 * the reservation is handed back. `message` is the sentence a person reads.
 */
export class AiImageSafetyRefusal extends Error {
  override readonly name = 'AiImageSafetyRefusal'
  /** The provider's own reason codes, for the log and never for a reader. */
  readonly reasons: readonly string[]

  constructor(reasons: readonly string[] = []) {
    super(
      'The image service declined this description. Try describing the scene differently, without real people, brands or anything unsafe.',
    )
    this.reasons = reasons
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * An image provider: one vendor's wire behind the contract. It reports
 * whether this deployment configured it, so a door can answer "not here"
 * before it reserves anything, and it maps its vendor's failures onto
 * `AiUpstreamError` and its declines onto `AiImageSafetyRefusal`.
 */
export interface AiImageProvider {
  readonly id: string
  readonly label: string
  /** The model a request runs on when nothing else names one. */
  defaultModel(): string
  /** True when this deployment's environment turns the provider on. */
  configured(): boolean
  /** The host requests go to, for the operator and the subprocessor record. */
  endpointHost(): string
  generate(request: AiImageRequest): Promise<AiImageResult>
}
