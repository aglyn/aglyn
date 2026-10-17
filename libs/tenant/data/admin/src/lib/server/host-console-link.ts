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

import { normalizeNotificationLink } from '@aglyn/aglyn/server'
import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import { getHostDocAdmin, getOrgForHost } from './organizations'

/**
 * A site's console page as an absolute link, for an email to the people who
 * run the site: `link` is written the way a notification's is,
 * `/{hostId}/products/returns`, and comes back on today's route,
 * `https://app…/{orgSlug}/hosts/{subdomain}/products/returns`. When the site
 * or its workspace cannot be read, the console home, so the button still
 * opens somewhere the reader can find it from.
 */
export async function hostConsoleUrl(hostId: string, link: string): Promise<string> {
  const origin = platformConsoleOrigin()
  try {
    const [host, owner] = await Promise.all([getHostDocAdmin(hostId), getOrgForHost(hostId)])
    const subdomain = typeof host?.['subdomain'] === 'string' ? host['subdomain'] : undefined
    const orgSlug = typeof owner?.org?.slug === 'string' ? owner.org.slug : undefined
    const path = normalizeNotificationLink(link, { orgSlug, hostId, hostSubdomain: subdomain })
    return path?.startsWith('/') ? `${origin}${path}` : origin
  } catch {
    return origin
  }
}
