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
 * Where a dataset is read, published for every other surface (AGL-3616).
 *
 * An assistant job that made a menu or a team as a dataset opens it on the
 * Data page, which is this plugin's — so it asks the record-route registry
 * for `dataset` rather than spelling this plugin's nav slug, and gets `null`
 * (text instead of a link) where it is not loaded. A dataset belongs to the
 * organization and is shared with sites: a site's Data page lists the ones it
 * can see, and the organization's lists them all. Neither has a page of one
 * dataset, so a record opens the list.
 */

/** The nav slug the shell resolves this plugin's site page by. */
const DATA_SLUG = 'data'

function list({ orgSlug, host }: PluginRecordRouteContext): string | null {
  if (!orgSlug) return null
  return host ? buildRoute(Route.HOST_PLUGIN, { orgSlug, host, pluginSlug: DATA_SLUG }) : buildRoute(Route.ORG_DATA, { orgSlug })
}

/**
 * Called from the console registrar. The owner is named rather than read off
 * the loader's marker, so the route registers the same way under a spec that
 * calls the registrar directly.
 */
export function registerDataRecordRoutes(): void {
  registerPluginRecordRoute('dataset', { list, record: (context) => list(context) }, { pluginId: BUNDLE_ID })
}
