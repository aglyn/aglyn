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
import {
  registerPluginResourceDraftWriter,
  type PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { BUNDLE_ID } from './constants/bundle-common'
import { checkEventDraftContent, EVENT_DRAFT_RESOURCE } from './model/event-draft-content'
import { registerEventAiCapability } from './server/event-ai-capability'
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
  loading ??= import('./transfer/events-transfer.server')
    .then(({ adminEventsTransferResource }) => adminEventsTransferResource())
    .catch((error: unknown) => {
      loading = null
      throw error
    })
  return loading
}

let writerLoading: Promise<PluginResourceDraftWriter> | null = null

/** The `event` draft writer over the Admin SDK, loaded on its first read or write. */
function eventWriter(): Promise<PluginResourceDraftWriter> {
  writerLoading ??= import('./server/event-drafts.server')
    .then(({ eventDraftWriter }) => eventDraftWriter)
    .catch((error: unknown) => {
      writerLoading = null
      throw error
    })
  return writerLoading
}

/**
 * The `event` draft writer as boot registers it (AGL-3743): the check is pure
 * and answers at once; the hooks that read or write load the Admin SDK half
 * on first use.
 */
export const lazyEventDraftWriter: PluginResourceDraftWriter = {
  check: (content) => checkEventDraftContent(content),
  refusal: async (context) => (await eventWriter()).refusal(context),
  read: async (context) => (await eventWriter()).read(context),
  write: async (request) => (await eventWriter()).write(request),
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
 *
 * And the `event` draft writer with the build operation it executes
 * (AGL-3743): what an AI build drafts when a request asks for events, under
 * this plugin's rules. The console runs AI jobs (AGL-3026).
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
  registerPluginResourceDraftWriter(EVENT_DRAFT_RESOURCE, lazyEventDraftWriter, { pluginId: BUNDLE_ID })
  // …and the operation an AI build plans for it, which that writer executes.
  registerEventAiCapability()
}
