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

import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import {
  registerPluginRecordRoute,
  type PluginRecordRouteContext,
} from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * Where a booking is read, published for every other surface (AGL-3080).
 *
 * A contact's timeline opens the bookings it names and a person's page lists
 * the bookings their address holds. Each asks the record-route registry for
 * `booking` rather than spelling this plugin's console path, and gets `null`
 * (text instead of a link) where this plugin is not loaded.
 *
 * Bookings are a site's, so only a site has an address. A booking has no page
 * of its own — the Bookings page lists them — so a record answers the page,
 * and a person's bookings are the page narrowed by
 * {@link BOOKINGS_BOOKER_PARAM}.
 */

/** The nav slug the shell resolves the Bookings page by. */
const BOOKINGS_SLUG = 'bookings'

/**
 * The query key the Bookings page narrows to one booker by (AGL-2660) — the
 * same word the CRM's contacts list and the Orders list use: one address,
 * one word.
 */
export const BOOKINGS_BOOKER_PARAM = 'email'

/** The site's Bookings page, or `null` at the organization, where there is none. */
export function bookingsPageHref(context: PluginRecordRouteContext): string | null {
  return context.host
    ? buildRoute(Route.HOST_PLUGIN, {
        orgSlug: context.orgSlug,
        host: context.host,
        pluginSlug: BOOKINGS_SLUG,
      })
    : null
}

/**
 * Called from the console registrar. The owner is named rather than read off
 * the loader's marker, so the route registers the same way under a spec that
 * calls the registrar directly.
 */
export function registerBookingsRecordRoutes(): void {
  registerPluginRecordRoute(
    'booking',
    {
      list: bookingsPageHref,
      record: (context) => bookingsPageHref(context),
      byEmail: (context, email) => {
        const page = bookingsPageHref(context)
        return page
          ? `${page}?${new URLSearchParams({ [BOOKINGS_BOOKER_PARAM]: email }).toString()}`
          : null
      },
    },
    { pluginId: BUNDLE_ID },
  )
}
