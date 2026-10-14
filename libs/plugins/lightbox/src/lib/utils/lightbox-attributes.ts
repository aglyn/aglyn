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
import {
  LIGHTBOX_APPEARANCE_FIELDS,
  type LightboxFieldKind,
} from '@aglyn/shared-ui-jsx/components/lightbox/lightbox-appearance'

const FIELD_COMPONENT: Record<LightboxFieldKind, Aglyn.FieldComponentType> = {
  color: Aglyn.FieldComponentType.COLOR_PICKER,
  number: Aglyn.FieldComponentType.TEXT_FIELD,
  dimension: Aglyn.FieldComponentType.CSS_DIMENSION,
  select: Aglyn.FieldComponentType.SELECT,
  switch: Aglyn.FieldComponentType.SWITCH,
}

/**
 * The lightbox's look-and-close settings as this bundle's schema attributes
 * (AGL-3717), from the one shared field list, so the Lightbox container
 * offers the settings the Image, the Image List and the Video offer, under
 * the same prop names. The mapping is restated per bundle because plugins
 * never import each other; the list it maps is the shared one.
 */
export function lightboxAppearanceAttributes(
  condition?: Aglyn.AglynAttributeSchema['condition'],
): Aglyn.AglynAttributeSchema[] {
  return LIGHTBOX_APPEARANCE_FIELDS.map((field) => ({
    name: field.name,
    label: field.label,
    description: field.description,
    component: FIELD_COMPONENT[field.kind],
    ...(field.kind === 'number' ? { type: 'number' } : {}),
    ...(field.options ? { options: field.options.map((o) => ({ ...o })) } : {}),
    // Unset means ON for both closing rules, so the switch has to open in
    // that position or it lies about the dialog (AGL-2506's rule).
    ...(field.kind === 'switch' ? { initialValue: true } : {}),
    ...(condition ? { condition } : {}),
  }))
}
