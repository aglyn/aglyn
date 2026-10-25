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
 * A CARD READER'S START-UP SCREEN (AGL-4048).
 *
 * Stripe's smart readers show a "splash screen" while they wait for a
 * payment. Stripe sets it per device type on a Terminal Configuration, from a
 * File uploaded with purpose `terminal_reader_splashscreen`, and a
 * Configuration is assigned per Location, so each store's readers can carry
 * their own. The rules Stripe states for the image, and the only ones this
 * module enforces:
 *
 *   - JPEG or PNG under 2 MB (a GIF may be 4 MB, but it is re-encoded here,
 *     so it is not offered);
 *   - cropped to the reader's own screen: 1080 × 1920 on the Stripe Reader
 *     S700 and S710, 720 × 1280 on the BBPOS WisePOS E.
 *
 * What a store shows is one of three CHOICES:
 *
 *   - `platform`  the platform's default screen, which staff upload;
 *   - `logo`      the workspace's own logo, centered on a white screen;
 *   - `image`     a full-screen portrait image the merchant picked from
 *                 their media library.
 *
 * A white-label workspace defaults to `logo` and can never be given
 * `platform`: its readers never show the platform's brand.
 *
 * Shared by the console and the server, so this module imports nothing.
 *=========================================*/

export type PosReaderSplashChoice = 'platform' | 'logo' | 'image'

export const POS_READER_SPLASH_CHOICES: readonly PosReaderSplashChoice[] = ['platform', 'logo', 'image']

export function isPosReaderSplashChoice(value: unknown): value is PosReaderSplashChoice {
  return typeof value === 'string' && (POS_READER_SPLASH_CHOICES as readonly string[]).includes(value)
}

/** A group of readers that share one screen size, so one image. */
export type PosReaderSplashFamilyId = 'portrait-large' | 'portrait-small'

export interface PosReaderSplashFamily {
  id: PosReaderSplashFamilyId
  /** The readers in it, for a person. */
  label: string
  width: number
  height: number
  /** The Terminal Configuration keys that take this family's image. */
  deviceTypes: readonly string[]
}

export const POS_READER_SPLASH_FAMILIES: readonly PosReaderSplashFamily[] = [
  {
    id: 'portrait-large',
    label: 'Stripe Reader S700 and S710',
    width: 1080,
    height: 1920,
    deviceTypes: ['stripe_s700', 'stripe_s710'],
  },
  {
    id: 'portrait-small',
    label: 'BBPOS WisePOS E',
    width: 720,
    height: 1280,
    deviceTypes: ['bbpos_wisepos_e'],
  },
]

export function posReaderSplashFamily(id: unknown): PosReaderSplashFamily | null {
  return POS_READER_SPLASH_FAMILIES.find((family) => family.id === id) ?? null
}

/** Every Terminal Configuration device key a start-up screen is set on. */
export const POS_READER_SPLASH_DEVICE_TYPES: readonly string[] = POS_READER_SPLASH_FAMILIES.flatMap(
  (family) => family.deviceTypes,
)

/** Stripe's limit is "less than 2 MB"; read as decimal megabytes, the smaller. */
export const POS_READER_SPLASH_MAX_BYTES = 2_000_000

/** What Stripe takes for a still start-up screen. */
export const POS_READER_SPLASH_CONTENT_TYPES: readonly string[] = ['image/png', 'image/jpeg']

/** What a merchant's own full-screen image may be picked as; it is re-encoded. */
export const POS_READER_SPLASH_SOURCE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp']

/** The largest source read to draw a screen from: a logo or a photo, never a video. */
export const POS_READER_SPLASH_SOURCE_MAX_BYTES = 15_000_000

/** The choice a store gets before anyone picks one. */
export function posReaderSplashDefaultChoice(whiteLabel: boolean): PosReaderSplashChoice {
  return whiteLabel ? 'logo' : 'platform'
}

/**
 * The choice that is applied: the stored one when it is valid, the default
 * otherwise, and never `platform` for a white-label workspace (one that
 * stored it before it was white-labeled gets its logo instead).
 */
export function posReaderSplashEffectiveChoice(stored: unknown, whiteLabel: boolean): PosReaderSplashChoice {
  const choice = isPosReaderSplashChoice(stored) ? stored : posReaderSplashDefaultChoice(whiteLabel)
  return whiteLabel && choice === 'platform' ? 'logo' : choice
}

export interface PosReaderSplashImageFacts {
  contentType: string
  bytes: number
  width: number
  height: number
}

/**
 * Why an image cannot be sent to Stripe as `family`'s start-up screen, or
 * null when it can: the exact screen size, JPEG or PNG, under 2 MB. Staff's
 * default screens are checked with this as they are uploaded, and every
 * rendered screen again before it leaves.
 */
export function posReaderSplashImageProblem(
  facts: PosReaderSplashImageFacts,
  family: PosReaderSplashFamily,
): string | null {
  if (!POS_READER_SPLASH_CONTENT_TYPES.includes(facts.contentType)) {
    return 'Use a PNG or JPEG image.'
  }
  if (facts.width !== family.width || facts.height !== family.height) {
    return `The ${family.label} screen is ${family.width} × ${family.height} pixels; this image is ${facts.width} × ${facts.height}.`
  }
  if (!(facts.bytes > 0) || facts.bytes >= POS_READER_SPLASH_MAX_BYTES) {
    return 'Use an image under 2 MB.'
  }
  return null
}

/** The largest screen, which a merchant's full-screen image must cover. */
export const POS_READER_SPLASH_LARGEST = POS_READER_SPLASH_FAMILIES[0]

/**
 * Why a merchant's own image cannot be a full-screen start-up screen, or null
 * when it can: a PNG, JPEG or WebP, portrait 9:16 (a 1% slack, since a
 * designer's export is often a pixel off), at least as large as the largest
 * screen so no reader shows it enlarged.
 */
export function posReaderSplashArtworkProblem(facts: {
  contentType?: string | null
  bytes?: number | null
  width: number
  height: number
}): string | null {
  const largest = POS_READER_SPLASH_LARGEST
  if (facts.contentType && !POS_READER_SPLASH_SOURCE_TYPES.includes(facts.contentType)) {
    return 'Choose a PNG, JPEG or WebP image.'
  }
  if (typeof facts.bytes === 'number' && facts.bytes > POS_READER_SPLASH_SOURCE_MAX_BYTES) {
    return 'Choose an image under 15 MB.'
  }
  if (!(facts.width > 0) || !(facts.height > 0)) return 'That image could not be read.'
  const ratio = facts.width / facts.height
  const wanted = largest.width / largest.height
  if (Math.abs(ratio - wanted) / wanted > 0.01) {
    return `Choose a portrait image shaped 9:16, such as ${largest.width} × ${largest.height} pixels.`
  }
  if (facts.width < largest.width || facts.height < largest.height) {
    return `Choose an image at least ${largest.width} × ${largest.height} pixels.`
  }
  return null
}

/** `hosts/{hostId}/terminal/config.splash`: the store's choice. */
export interface PosReaderSplashSetting {
  choice: PosReaderSplashChoice
  /** For `image`: the picked asset, as the media library names it. */
  mediaScope?: string
  mediaId?: string
  updatedAtMs: number
  updatedBy?: string
}

/** What the POS devices card shows about the store's start-up screen. */
export interface PosReaderSplashStatus {
  /** Whether card readers are offered at all; the setting is hidden otherwise. */
  available: boolean
  /** The stored choice, or null when none was made. */
  choice: PosReaderSplashChoice | null
  /** What is applied, after the default and the white-label rule. */
  effectiveChoice: PosReaderSplashChoice
  whiteLabel: boolean
  /** The brand a white-label workspace or the platform goes by, for copy. */
  productName: string
  /** Whether staff have uploaded the platform's default screen. */
  platformReady: boolean
  /** The workspace logo that `logo` would use, or null when there is none. */
  logoUrl: string | null
  /** The asset `image` uses, when one was picked, with an address to preview it. */
  image: { mediaScope: string; mediaId: string; url: string | null } | null
  /** Whether the store has a Terminal Location yet (its first reader makes it). */
  locationReady: boolean
  /** When the current choice last reached Stripe. */
  appliedAtMs: number | null
  /** Why the current choice could not be applied, when it could not. */
  problem: string | null
}
