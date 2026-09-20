/**
 * @license
 * Copyright 2026 Aglyn LLC
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *   http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import { registerPluginRecordRoute } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * Where a campaign is read, published for every other surface.
 *
 * A message's template lists the campaigns its sends belonged to, and a
 * campaign's pages are this plugin's. A surface elsewhere asks the
 * record-route registry for `campaign` rather than spelling this plugin's nav
 * slug, and gets `null` — text instead of a link — where this plugin is not
 * loaded.
 */

/** The nav slug the shell resolves this plugin's hub by. */
const MARKETING_SLUG = 'marketing'

/**
 * Called from the console registrar. The owner is named rather than read off
 * the loader's marker, so the route registers the same way under a spec that
 * calls the registrar directly.
 */
export function registerMarketingRecordRoutes(): void {
  registerPluginRecordRoute(
    'campaign',
    {
      // Campaigns belong to one site, so the organization has no address.
      list: (context) =>
        context.host
          ? `${hub(context.orgSlug, context.host)}/campaigns`
          : null,
      record: (context, id) =>
        context.host
          ? `${hub(context.orgSlug, context.host)}/campaigns/${id}`
          : null,
    },
    { pluginId: BUNDLE_ID },
  )
}

function hub(orgSlug: string, host: string): string {
  return buildRoute(Route.HOST_PLUGIN, {
    orgSlug,
    host,
    pluginSlug: MARKETING_SLUG,
  })
}
