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

import type { PluginConfigSchema } from '@aglyn/aglyn'
import { BOOKING_MAX_DAYS_AHEAD, BOOKING_PATH_DEFAULT } from './model'

/**
 * Bookings plugin config schema (AGL-428) — the first adopter of the
 * per-plugin settings framework. PURE DATA (type-only aglyn import): the
 * client barrel registers it via '@aglyn/aglyn' and the /server entry via
 * '@aglyn/aglyn/server', so neither bundle drags in the other's barrel.
 */
export const BOOKINGS_CONFIG_SCHEMA: PluginConfigSchema = {
  pluginId: 'bookings',
  fields: [
    {
      key: 'maxDaysAhead',
      label: 'Booking horizon (days)',
      type: 'number',
      min: 1,
      max: 365,
      description:
        'How far ahead visitors can book. Slots beyond this many days ' +
        'from now are not offered.',
    },
    {
      // Where a booking link sends people (AGL-2660). The Booking block is
      // placed on whichever page the site owner chose, and nothing records
      // which; the CRM's "Book a meeting" links and the "Insert booking
      // link" chip build on this path. Per site, through the ordinary
      // site-level override.
      key: 'bookingPath',
      label: 'Booking page path',
      type: 'string',
      description:
        'The page on your site that holds the Booking block, e.g. /book. ' +
        'Booking links from the CRM open this page with the service ' +
        'preselected.',
    },
  ],
  defaults: { maxDaysAhead: BOOKING_MAX_DAYS_AHEAD, bookingPath: BOOKING_PATH_DEFAULT },
}
