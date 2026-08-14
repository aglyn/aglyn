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

import { sanitizeEventParams } from '@aglyn/aglyn/app-utils/analytics-events'

/**
 * Build the console's SPA `page_view` params (AGL-1643).
 *
 * ## Why `page_location` must be a full URL
 *
 * It used to be `usePathname()` — `/org/hosts`. GA4 specifies `page_location`
 * as the full URL and DERIVES the Hostname dimension from it, and Hostname is
 * how one property tells `aglyn.com` from `app.aglyn.com` now that both report
 * into `G-YW5PG16YTM`. A host-less value did not merely look untidy: it
 * emptied the dimension the whole property consolidation rests on, and took
 * the landing-page and page-referrer dimensions with it.
 *
 * ## Why it goes through the sanitizer
 *
 * Every other console event reaches GA through `trackEvent`, which sanitizes;
 * this one call used `logEvent` directly and bypassed it. That matters more
 * here than anywhere else, because a console URL is the value most likely to
 * carry an address — prefilled invite and signup links put one in the query.
 * `sanitizeEventParams` reduces any `http(s)` value to origin + pathname, so
 * the query is gone before the hit is built and the upgrade from pathname to
 * full URL cannot leak more than the pathname already did.
 *
 * Extracted from the layout so the guarantee is testable without mounting the
 * console's whole provider tree.
 */
export function buildConsolePageViewParams(
  href: string,
): Record<string, unknown> {
  return sanitizeEventParams({ page_location: href })
}
