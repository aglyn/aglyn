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

// The registry's own module, not the `@aglyn/aglyn/server` barrel: boot needs
// one registry, not the whole server surface.
import { registerPluginPersonEraser } from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import {
  registerPluginTransferResource,
  type PluginTransferResource,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { declarePluginDomainEvents } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { registerApiV1SiteResource } from '@aglyn/tenant-data-admin/server/api-v1-resources'
import { BUNDLE_ID } from './constants/bundle-common'
import { BOOKING_EVENT_DECLARATIONS } from './model/booking-events'
import {
  BOOKINGS_TRANSFER_MATCH_KEYS,
  BOOKINGS_TRANSFER_RESOURCE,
} from './transfer/bookings-transfer-common'

/**
 * The `bookings` transfer resource over the platform's Firestore, built on
 * first use: the resource module and the Admin SDK load with the first
 * export, not at boot.
 */
let bookingsTransfer: Promise<PluginTransferResource> | null = null
function bookingsTransferResource(): Promise<PluginTransferResource> {
  return (bookingsTransfer ??= import('./transfer/bookings-transfer.server')
    .then(({ adminBookingsTransferResource }) =>
      adminBookingsTransferResource(),
    )
    .catch((error: unknown) => {
      // A failed load is retried by the next export rather than remembered.
      bookingsTransfer = null
      throw error
    }))
}

/**
 * The bookings plugin's CONSOLE-ONLY server declarations (AGL-3080), named
 * under `consoleServerDeclarations` in `plugins.config.json` and run at the
 * console's boot. The tenant runtime registers none of it.
 *
 * Its share of a person erasure: every booking the person made on a site of
 * the workspace keeps its service and its time, with the person taken off it
 * (`server/person-eraser.ts`). Declared `requiredPersonEraser`, because the
 * erasure promises it — a console whose boot skipped this refuses to erase.
 *
 * Its `bookings` transfer resource: every booking of a site, exported and
 * never imported (`transfer/bookings-transfer.ts` says why).
 *
 * Its bookings on the customer REST API, `/v1/sites/{siteId}/bookings`
 * (AGL-3643), and the booking events it raises, declared.
 *
 * Light at boot: the eraser, the export and the Admin SDK they bring load
 * with the first erasure or export. Registering again replaces this plugin's
 * own.
 */
export function registerBookingsConsoleServerDeclarations(): void {
  // The booking events this plugin raises (AGL-3643), named for the pickers
  // and diagnostics that list what is declared; raising needs no declaration.
  declarePluginDomainEvents(BOOKING_EVENT_DECLARATIONS, { pluginId: BUNDLE_ID })
  // A site's bookings on the customer REST API (AGL-3643), read-only. The
  // handler asks its scope and then the plan, so no `entitlement` is named
  // here: the router would ask them the other way round.
  registerApiV1SiteResource(
    'bookings',
    {
      handle: async (...args) => (await import('./server/api-v1/bookings')).handleBookings(...args),
      describe: async () => (await import('./server/api-v1/openapi')).BOOKINGS_API_V1_DESCRIPTION,
    },
    { pluginId: BUNDLE_ID },
  )
  registerPluginPersonEraser(
    async (request) =>
      (await import('./server/person-eraser')).bookingsPersonEraser(request),
    { pluginId: BUNDLE_ID },
  )
  registerPluginTransferResource(
    BOOKINGS_TRANSFER_RESOURCE,
    {
      fields: async (ctx) =>
        (await bookingsTransferResource()).fields?.(ctx) ?? { standard: [] },
      // Read synchronously by the routes, so a plain array, not a loaded one.
      matchKeys: BOOKINGS_TRANSFER_MATCH_KEYS,
      count: async (ctx, options) =>
        (await bookingsTransferResource()).count?.(ctx, options) ?? 0,
      readPage: async (ctx, cursor, fieldIds, options) => {
        const resource = await bookingsTransferResource()
        if (!resource.readPage) throw new Error('bookings export: no reader')
        return resource.readPage(ctx, cursor, fieldIds, options)
      },
      lookup: async (ctx, requests) => {
        const resource = await bookingsTransferResource()
        if (!resource.lookup) throw new Error('bookings export: no lookup')
        return resource.lookup(ctx, requests)
      },
    },
    { pluginId: BUNDLE_ID },
  )
}
