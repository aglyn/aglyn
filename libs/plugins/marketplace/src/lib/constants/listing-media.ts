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
 * A marketplace listing's mark, rendered in a grid of square tiles beside
 * other publishers' — so square is not a preference here, it is the shape of
 * the slot.
 *
 * Lived in the console's `constants/media-size-hints` until AGL-3080 moved
 * the marketplace's console surfaces into this plugin. It sat there beside a
 * site's favicon and a person's avatar, which are the console's own; what a
 * LISTING's tile has to look like is the marketplace's, and it is the only
 * hint in that file no console surface reads.
 */
export const LISTING_LOGO_HINT =
  'Recommended: a square PNG or SVG, at least 256×256 — listings are shown ' +
  'as square tiles.'
