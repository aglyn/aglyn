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
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/server'
import type { Metadata } from 'next'

/**
 * The console tab title: a bare segment, a middle dot, and the bare brand —
 * "Billing · Aglyn" (AGL-1059). Deliberately not `APP_CONSOLE.SEP`/`AFFIX`
 * ('–' / 'Aglyn Platform Console'): a marketing string would eat the half of
 * the tab that carries the information a user is picking between.
 *
 * Kept in step with the `title.template` on the root layout's metadata.
 */
export const TITLE_TEMPLATE = `%s · ${PLATFORM_BRAND_NAME}`

/**
 * The title for a layout that other titled routes nest inside.
 *
 * Next resolves `title` by walking the segments, and a segment that sets a
 * plain string title carries no template of its own — so it consumes the
 * root template and everything below it renders unbranded ("Staff users"
 * rather than "Staff users · Aglyn"). Any intermediate layout must therefore
 * re-declare the template alongside its own fallback, which is all this is.
 *
 * A leaf layout, with no titled route beneath it, can keep the plain string.
 */
export function segmentTitle(fallback: string): Metadata['title'] {
  return { default: fallback, template: TITLE_TEMPLATE }
}
