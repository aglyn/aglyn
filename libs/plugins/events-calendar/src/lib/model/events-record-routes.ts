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
import { EVENT_DRAFT_RESOURCE } from './event-draft-content'

/**
 * Where an event is read, published for every other surface (AGL-3743).
 *
 * The AI plugin's job drawer opens an event an AI build drafted by asking the
 * record-route registry for `event`, and gets text instead of a link where
 * this plugin is not loaded. An event is a site's, so only a site has an
 * address; it opens in the Events page's editor, so the record answers the
 * list a person finds it on.
 */

/** The nav slug the shell resolves the Events page by: the nav item's `/events`. */
export const EVENTS_SLUG = 'events'

function eventsPage(context: PluginRecordRouteContext): string | null {
  return context.host
    ? buildRoute(Route.HOST_PLUGIN, { orgSlug: context.orgSlug, host: context.host, pluginSlug: EVENTS_SLUG })
    : null
}

/** Called from the console registrar; the owner is named so a spec calling it directly registers the same way. */
export function registerEventsRecordRoutes(): void {
  registerPluginRecordRoute(EVENT_DRAFT_RESOURCE, { list: eventsPage, record: eventsPage }, { pluginId: BUNDLE_ID })
}
