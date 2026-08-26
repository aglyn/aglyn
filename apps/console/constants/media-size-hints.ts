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
 * What size to upload, said BEFORE the upload (AGL-2486).
 *
 * Zach: *"We need to suggest the recommended size for the users to upload on
 * all uploads areas."* Only the social image ever said one, and it said it
 * about the picture already chosen — the current file's dimensions, which is
 * a different sentence from "here is what to bring".
 *
 * Every number here is a REQUIREMENT SOMEBODY ELSE PUBLISHES, not a taste
 * call, and each says whose. That is the difference between guidance an
 * author can act on and a number invented to fill a caption:
 *
 * - a social card is 1200×630 because that is the Open Graph aspect every
 *   major network crops to;
 * - a favicon is square because every consumer of it is;
 * - a publisher logo has a floor because Google's structured-data guidance
 *   sets one, and a logo under it is dropped from rich results rather than
 *   scaled up.
 *
 * Stated as ADVICE, never as a gate. Nothing here rejects an upload: an
 * author who knows their case better than the caption does is not stopped,
 * and a smaller image renders — it just may not be used everywhere.
 */

export interface MediaSizeHint {
  /** The one-line caption shown under the control. */
  text: string
}

/** Open Graph's card, and the aspect every network crops to. */
export const SOCIAL_IMAGE_HINT =
  'Recommended: 1200×630 PNG or JPG — the size social networks crop to.'

/**
 * Browsers ask for many favicon sizes and derive them from one square file.
 * 512 is the largest anything asks for, so it is the one that scales down to
 * all of them without being upscaled into anything.
 */
export const FAVICON_HINT =
  'Recommended: a square PNG or ICO, 512×512 — browsers scale it down for ' +
  'every tab, bookmark and home-screen size.'

/**
 * Google's structured-data guidance sets a floor for a publisher logo, and a
 * logo under it is dropped from rich results rather than scaled up — which is
 * the failure worth warning about, because nothing in the console can see it
 * happen.
 */
export const ENTITY_LOGO_HINT =
  'Recommended: at least 112×112, PNG or SVG — search engines skip a ' +
  'publisher logo smaller than that rather than scaling it up.'

/** A site's own mark, rendered at whatever height the layout gives it. */
export const SITE_LOGO_HINT =
  'Recommended: SVG, or a PNG at least 400px wide — it renders at different ' +
  'sizes across your site and on retina screens.'

/** A byline avatar: square, small on the page, crisp on retina. */
export const AVATAR_HINT =
  'Recommended: a square PNG or JPG, at least 400×400 — it is shown small, ' +
  'but on retina screens at twice the size.'

/** An entry's cover doubles as its share card, so it takes that shape. */
export const COVER_IMAGE_HINT =
  'Recommended: 1200×630 PNG or JPG — it heads the entry and doubles as its ' +
  'share card.'

/**
 * An email logo, which is the one that must NOT be an SVG.
 *
 * Most email clients refuse SVG outright and none of them resize an image the
 * way a browser does — a logo arrives at the width it was authored at, on a
 * screen that may be twice that density. So the advice here is the opposite of
 * {@link SITE_LOGO_HINT}'s, and saying "same as your site logo" would be
 * wrong in both directions.
 */
export const EMAIL_LOGO_HINT =
  'Recommended: a PNG about 400px wide — email clients do not resize images, ' +
  'and most refuse SVG.'

/**
 * A marketplace listing's mark, rendered in a grid of square tiles beside
 * other publishers' — so square is not a preference here, it is the shape of
 * the slot.
 */
export const LISTING_LOGO_HINT =
  'Recommended: a square PNG or SVG, at least 256×256 — listings are shown ' +
  'as square tiles.'
