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
 * Stands in for `@generated/docusaurus.config`, which only exists inside a
 * Docusaurus build (mapped in `jest.config.ts`).
 *
 * It reads a global rather than exporting a fixed object so a spec can set the
 * site config BEFORE requiring the module under test. `error-beacon.ts` reads
 * `customFields.errorBeaconEndpoint` at module scope and decides there whether
 * to install any handlers at all, so a stub that could not vary would make the
 * unconfigured case — the one AGL-2124 exists for — untestable.
 */
export default {
  get customFields(): Record<string, unknown> {
    return (
      (globalThis as Record<string, any>)['__DOCS_SITE_CUSTOM_FIELDS__'] ?? {}
    )
  },
}
