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
 * The customer's quote page (AGL-4094), where a quote's pay link opens.
 *
 * The component id is persisted in screen documents; never rename it. The
 * path is where the site serves the page when it has no page of its own
 * there. It is `pay-quote` rather than `quote` because a business that sells
 * made-to-order work often has a "Request a quote" page at `/quote` already,
 * and a page of the site's own at an address always wins over this one: a pay
 * link there would open the request form.
 */
export const QUOTE_PAGE_COMPONENT_ID = 'quote-page'

export const QUOTE_PAGE_PATH = 'pay-quote'

/** The page's address for one quote and its signed link token, relative to the site. */
export function quotePageHref(quoteId: string, token: string): string {
  const query = new URLSearchParams({ q: quoteId, t: token })
  return `/${QUOTE_PAGE_PATH}?${query.toString()}`
}
