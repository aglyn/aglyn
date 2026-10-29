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

import { FORM_FIELD_DATA_SUFFIX } from '@aglyn/aglyn/app-utils/forms'

/**
 * The key the Product and options field posts its exact choice under, beside
 * its readable answer (AGL-4098): `product__data` for a field named
 * `product`. The suffix is the core's form protocol, so the forms plugin keeps
 * it apart from the answers without knowing what a product is.
 */
export function formFieldDataKey(field: string): string {
  return `${field}${FORM_FIELD_DATA_SUFFIX}`
}
