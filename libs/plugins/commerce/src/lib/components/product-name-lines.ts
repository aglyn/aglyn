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

/** How many lines a product card gives its name before the ellipsis. */
export const PRODUCT_NAME_LINES = 2

/**
 * A product card's name: it wraps to two lines, then ends in an ellipsis.
 * On one line, two products whose names start alike ("Touchscreen
 * reader (Model A)", "Touchscreen reader, 4G-capable (Model B)") were cut
 * to the same "Touchscreen reader…" on a phone and read as one product.
 *
 * The name always takes two lines of height, in the card's own type
 * (`2lh` follows the variant's line height, whatever the theme sets), so
 * a one-line name leaves the price and the Add to cart button level with
 * the next card's in the row instead of riding a line higher.
 */
export const PRODUCT_NAME_SX = {
  display: '-webkit-box',
  WebkitLineClamp: PRODUCT_NAME_LINES,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  overflowWrap: 'anywhere',
  minHeight: `${PRODUCT_NAME_LINES}lh`,
} as const
