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
 * The Squarespace URL mappings read's column names (AGL-4245), apart from
 * the parser: the transfer fields load with the plugin on every console
 * screen, and the parser loads only when a file is read
 * (`squarespace-url-mappings.ts`, check:plugin-budgets).
 *=========================================*/

/** The headers the read CSV carries; the alias dictionary maps each. */
export const SQUARESPACE_URL_MAPPING_HEADERS = {
  source: 'URL mapping from',
  destination: 'URL mapping to',
  statusCode: 'URL mapping type',
  kind: 'URL mapping match',
} as const

/** The dictionary's name, as the mapping step shows it. */
export const SQUARESPACE_URL_MAPPINGS_SOURCE = 'Squarespace URL mappings'
