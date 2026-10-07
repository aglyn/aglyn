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
 * The buyer's "Request a return" page (AGL-3611).
 *
 * The component id is persisted in screen documents; never rename it. The
 * path is where the site serves the page when it has no page of its own
 * there, and where the account block and the order-status page link to.
 */
export const RETURN_REQUEST_COMPONENT_ID = 'return-request'

export const RETURN_REQUEST_PATH = 'order-return'

/** The page's address for one order, with the status-link token when there is one. */
export function returnRequestHref(orderId: string, token?: string | null): string {
  const query = new URLSearchParams({ o: orderId })
  if (token) query.set('t', token)
  return `/${RETURN_REQUEST_PATH}?${query.toString()}`
}
