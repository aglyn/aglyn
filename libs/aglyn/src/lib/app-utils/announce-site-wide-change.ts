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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

/**
 * A plugin's console card just saved a SITE-WIDE setting: drop every cached
 * page of the site (AGL-3386).
 *
 * The plugin-side door to the console's own `/api/screens/revalidate`, which
 * a plugin cannot import. A setting that lives on the host document, or on a
 * site-wide settings document beside it — the announcement bar, the popup,
 * the store's currency — is rendered on every page and saved with no publish
 * step, so without this the live site shows it only once each page's
 * hour-long cache happens to lapse.
 *
 * `entireHost` because such a setting has no address of its own. It is the
 * console route's explicit whole-site branch, authorized for exactly the
 * roles the rules let write the site — the caller already proved that by
 * writing.
 *
 * Call it AFTER the write has succeeded, and do not await it into the save's
 * outcome: it never throws and never rejects, because a cache hint that fails
 * must not make a successful save look failed. The hour-long window is still
 * underneath as the backstop.
 */
export async function announceSiteWideChange(options: {
  /** The signed-in user; its ID token authenticates the console route. */
  user: { getIdToken?: () => Promise<string> } | null | undefined
  hostId: string
}): Promise<boolean> {
  const { user, hostId } = options
  if (!hostId) return false
  try {
    const response = await authorizedFetch(user, '/api/screens/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostId, entireHost: true }),
    })
    return response.ok
  } catch {
    return false
  }
}

export default announceSiteWideChange
