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

import * as Aglyn from '@aglyn/aglyn'

/**
 * How a product card draws its photo: `cover` fills the card's frame and
 * crops what does not fit; `contain` shows the whole photo inside the same
 * frame, so a wide or tall shot keeps its ends.
 */
export type ProductPhotoFit = 'cover' | 'contain'

/**
 * The fit a stored value asks for. Anything but `contain` — no value, an
 * older page, a value this build does not know — is `cover`, the way every
 * card was drawn before the setting existed, so no existing site changes.
 */
export function productPhotoFit(value: unknown): ProductPhotoFit {
  return value === 'contain' ? 'contain' : 'cover'
}

/**
 * The photo's own styles for a fit. `contain` keeps the frame's size (the
 * caller's aspect ratio or height), so the cards in a row stay aligned, and
 * sits the photo on the theme's quiet neutral (the no-photo tile's colour)
 * with a little room, so a transparent cut-out and a full shot both read as
 * framed on purpose.
 */
export function productPhotoFitSx(fit: ProductPhotoFit) {
  return fit === 'contain'
    ? ({ objectFit: 'contain', boxSizing: 'border-box', p: 1.5, bgcolor: 'action.hover' } as const)
    : ({ objectFit: 'cover' } as const)
}

/** The element setting both storefront card blocks carry. */
export const PRODUCT_PHOTO_FIT_ATTRIBUTE: Aglyn.AttributeSchema = {
  // Blank is `cover`, so a page that already places the block keeps its look.
  name: 'photoFit',
  label: 'Photo fit',
  description:
    'Fill the frame crops each photo to the card’s shape. Show the whole ' +
    'photo fits it inside the card without cutting anything off.',
  component: Aglyn.FieldComponentType.SELECT,
  options: [
    { label: 'Fill the frame (crops to fit)', value: 'cover' },
    { label: 'Show the whole photo', value: 'contain' },
  ],
}
