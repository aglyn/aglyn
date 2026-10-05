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
import { registerPluginTransferResource } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { BUNDLE_ID } from './constants/bundle-common'
import type { EventsTransferResource } from './transfer/events-transfer'
import {
  EVENTS_ALIASES,
  EVENTS_CATALOG,
  EVENTS_MATCH_KEYS,
  eventsValuesEqual,
} from './transfer/events-transfer-catalog'
import { EVENTS_TRANSFER_RESOURCE } from './transfer/events-transfer-key'

let loading: Promise<EventsTransferResource> | null = null

/**
 * The resource over the Admin SDK, built on the first hook a transfer calls:
 * the transfer core, the Admin SDK and the plan table load then, not at boot.
 * A failed load is forgotten, so the next call tries again.
 */
function eventsResource(): Promise<EventsTransferResource> {
  loading ??= (async () => {
    const [
      { createEventsTransferResource },
      { firebaseAdmin },
      { checkEntitlement },
    ] = await Promise.all([
      import('./transfer/events-transfer'),
      import('@aglyn/tenant-data-admin/server/firebase-admin'),
      import('@aglyn/aglyn/server'),
    ])
    const firestore = firebaseAdmin.app().firestore()
    return createEventsTransferResource({
      firestore,
      deleteField: () => firebaseAdmin.firestore.FieldValue.delete(),
      timestamp: (ms) => firebaseAdmin.firestore.Timestamp.fromMillis(ms),
      // The add-on the Events page is gated on, read the way the public
      // listing reads it: from the workspace's own document.
      entitled: async (orgId) => {
        const org = await firestore.collection('orgs').doc(orgId).get()
        return checkEntitlement(
          org.exists ? (org.data() as never) : null,
          'eventCalendar',
        )
      },
    })
  })().catch((error: unknown) => {
    loading = null
    throw error
  })
  return loading
}

/**
 * The events-calendar plugin's CONSOLE-ONLY server declarations, named under
 * `consoleServerDeclarations` in `plugins.config.json` and run at the
 * console's boot. The tenant runtime registers none of it.
 *
 * The server half of the `events` transfer resource
 * (`transfer/events-transfer.ts`): the catalog, the match keys and the
 * aliases are plain data registered as they are; every hook that reads or
 * writes loads the resource on first use. Registering again replaces this
 * plugin's own.
 */
export function registerEventsCalendarConsoleServerDeclarations(): void {
  registerPluginTransferResource(
    EVENTS_TRANSFER_RESOURCE,
    {
      fields: () => EVENTS_CATALOG,
      matchKeys: EVENTS_MATCH_KEYS,
      aliases: EVENTS_ALIASES,
      // A status in any case is the stored one, in the review as in the plan.
      valuesEqual: eventsValuesEqual,
      count: async (ctx, options) =>
        (await eventsResource()).count(ctx, options),
      readPage: async (ctx, cursor, fieldIds, options) =>
        (await eventsResource()).readPage(ctx, cursor, fieldIds, options),
      lookup: async (ctx, requests) =>
        (await eventsResource()).lookup(ctx, requests),
      plan: async (ctx, input) => (await eventsResource()).plan(ctx, input),
      apply: async (ctx, chunk, writer) =>
        (await eventsResource()).apply(ctx, chunk, writer),
      revert: async (ctx, snapshot, decisions) =>
        (await eventsResource()).revert(ctx, snapshot, decisions),
    },
    { pluginId: BUNDLE_ID },
  )
}
