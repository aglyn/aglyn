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

import type { CustomFieldType } from '@aglyn/aglyn'

/**
 * The `rating` custom field type (AGL-434) — the reference adopter of the
 * plugin custom-fields registry. PURE DATA (type-only import) so the
 * /server entry registers the validator without dragging in React; the
 * client barrel adds the Input component on top.
 */
export const RATING_FIELD: CustomFieldType = {
  name: 'rating',
  pluginId: 'community',
  label: 'Rating (0–5)',
  baseType: 'int32',
  description: 'Whole-number rating between 0 and 5.',
  validate: (value) => {
    const rating = Number(value)
    return Number.isInteger(rating) && rating >= 0 && rating <= 5
      ? null
      : 'must be a whole number from 0 to 5'
  },
}
