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

import { findPluginPerson } from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import { readSiteMarketingStatuses } from '@aglyn/tenant-data-admin/server/site-marketing-sync'
import { reviewPlatformsDb } from './db'

/**
 * MAY THIS BUYER BE ASKED FOR A REVIEW? (AGL-3699)
 *
 * A review invitation is MARKETING in Aglyn's consent model. The model's
 * test (`marketing-send.ts`): a message is marketing when the merchant
 * decided to mail the person, rather than because the person just did
 * something that makes the message owed to them. A receipt or a shipping
 * notice is owed by the order; an invitation to review the store is not —
 * the merchant chose to ask, as with an abandoned-cart reminder, which the
 * same model already counts as marketing. And it is sent by an outside
 * service under that service's own name, so Aglyn's unsubscribe link and
 * frequency ceiling never travel with it.
 *
 * So a buyer is invited only when the site may market to them — the same
 * decision a campaign makes and the email-platform connectors mirror
 * (`readSiteMarketingStatuses`): the consent basis on the person's record
 * under the workspace's consent policy and the site's consent group, then
 * both suppression lists. An unsubscribe, a bounce, a complaint or an
 * erasure on any site of the group withholds the invitation; a buyer who
 * ticked the store's marketing box at checkout (recorded on their contact)
 * is asked.
 *
 * Throws when a list cannot be read: the caller treats that as "not now",
 * never as consent.
 */
export async function buyerMayBeInvited(input: {
  hostId: string
  orgId: string
  org: Record<string, unknown>
  email: string
}): Promise<boolean> {
  const email = input.email.trim().toLowerCase()
  if (!email) return false
  const person = await findPluginPerson({
    hostId: input.hostId,
    orgId: input.orgId,
    email,
    onlyVisibleToSite: true,
    anyKind: true,
  })
  const [status] = await readSiteMarketingStatuses({
    hostId: input.hostId,
    org: input.org,
    people: [{ email, data: (person?.data as Record<string, unknown> | undefined) ?? null }],
    firestore: reviewPlatformsDb(),
  })
  return status === 'subscribed'
}
