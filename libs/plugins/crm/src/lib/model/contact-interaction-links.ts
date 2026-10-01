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

import type { ContactInteraction, ContactSource } from '@aglyn/aglyn'
import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import {
  pluginRecordHref,
  pluginRecordListHref,
  type PluginRecordRouteContext,
} from '@aglyn/aglyn/plugin-manager/plugin-record-routes'

/**
 * Where a contact's captured history points back at (AGL-2622): the record
 * each capture door left, where the console reads it.
 *
 * The submission, the order and the booking are other plugins' records, so
 * their addresses are the ones those plugins publish on the record-route seam
 * (`formSubmission`, `order`, `booking` — AGL-3080), and an entry whose owner
 * is not loaded carries no link. A member sign-up lands on the platform's own
 * Users page.
 */

/**
 * What the link on a captured timeline entry says. Only the doors that
 * leave a record the console can open are named; a newsletter opt-in, an
 * API create, an import or a by-hand add leave nothing to open, so they
 * carry no link and no label.
 */
export const INTERACTION_LINK_LABELS: Partial<Record<ContactSource, string>> = {
  form: 'Open submission',
  order: 'Open order',
  booking: 'Open bookings',
  member: 'Open site users',
}

/**
 * The console page a captured interaction points back at, or `null` when
 * the door left nothing to open, or its owner publishes no address here.
 *
 * A submission and an order are addressed by the `refId` the capture door
 * stamped — `formSubmissions/{id}`, `orders/{id}` — and an interaction that
 * predates the stamp lands on nothing rather than on a list that would read
 * as "the record is gone". A booking and a member sign-up land on their
 * pages, which list them; neither page addresses one row.
 */
export function contactInteractionHref(
  interaction: Pick<ContactInteraction, 'type' | 'refId'>,
  context: PluginRecordRouteContext,
): string | null {
  switch (interaction.type) {
    case 'form':
      return interaction.refId ? pluginRecordHref('formSubmission', context, interaction.refId) : null
    case 'order':
      return interaction.refId ? pluginRecordHref('order', context, interaction.refId) : null
    case 'booking':
      return pluginRecordListHref('booking', context)
    case 'member':
      return context.host
        ? buildRoute(Route.HOST_USERS, { orgSlug: context.orgSlug, host: context.host })
        : null
    default:
      return null
  }
}
