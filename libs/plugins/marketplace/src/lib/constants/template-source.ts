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
 * The `source.type` this plugin stamps on every template it installs into a
 * site's library (AGL-669), and the value it declares as its
 * `templateSource` in `plugins.config.json` (AGL-3080) — which is how the
 * library, the template's page and the gallery name it without naming this
 * plugin. `template-source.spec.ts` holds the two to each other.
 */
export const TEMPLATE_SOURCE_TYPE = 'marketplace'
