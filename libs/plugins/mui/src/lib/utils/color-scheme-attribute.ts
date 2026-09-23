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
 * "Color scheme" for the layout elements (AGL-3284): Section, Container,
 * Stack, Box and Grid.
 *
 * The renderer's leaf reads the prop and swaps in the site's theme for the
 * pinned scheme around the element, so no component here has to know about
 * it — and none of them ever receives it. It is offered on the wrappers an
 * author builds a band of the page from, not on every element, because the
 * point is "this part of the page", and a wrapper is how a page has parts.
 *
 * "Match the site" is a real, persistable sentinel rather than `''`
 * (AGL-1453): the list does not otherwise name the default, so without it the
 * only way back from "Always dark" would be the field's clear button.
 */
export function colorSchemeAttribute(): Aglyn.AglynAttributeSchema {
  return {
    name: Aglyn.NODE_COLOR_SCHEME_PROP,
    label: 'Color scheme',
    description:
      'Keep this part of the page light or dark no matter which mode the ' +
      'visitor picked. Everything inside follows it — backgrounds, text and ' +
      'cards use your site’s colors for that mode.',
    component: Aglyn.FieldComponentType.SELECT,
    options: [
      { value: Aglyn.ELEMENT_COLOR_SCHEME_SITE, label: 'Match the site' },
      { value: 'light', label: 'Always light' },
      { value: 'dark', label: 'Always dark' },
    ],
  } as Aglyn.AglynAttributeSchema
}
