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
 * Where the Emails page's records are read, published for every other
 * surface (AGL-3080).
 *
 * A contact's timeline links a campaign email to its report, and a composer
 * refused for an unverified sender links to where a sender is set up. Both
 * pages are this plugin's — the Emails page under a site, and the same page
 * over every site at the organization level — so a surface elsewhere asks
 * the record-route registry for the kind rather than spelling this plugin's
 * nav slug, and gets `null` (text instead of a link) where it is not loaded.
 *
 * - `emailMessage`: one send, at `messages/{id}`; the list is the Messages
 *   section. What draws a message's report is a zone the plugin that owns
 *   campaigns fills, but the address is this page's.
 * - `sendingIdentity`: who the mail comes from, set up in the Sending
 *   section. An identity has no page of its own, so its record answers the
 *   section it is kept in.
 * - `emailTemplate`: a site's email design, at `templates/{id}` (the
 *   screen's id). A design is a site's, so the organization level has no
 *   address for one: a caller at the org names the site the send used.
 */

/** The nav slug the shell resolves this plugin's page by. */
const EMAILS_SLUG = 'emails'

function hub({ orgSlug, host }: PluginRecordRouteContext): string {
  return host
    ? buildRoute(Route.HOST_PLUGIN, { orgSlug, host, pluginSlug: EMAILS_SLUG })
    : buildRoute(Route.ORG_PLUGIN, { orgSlug, pluginSlug: EMAILS_SLUG })
}

/**
 * Called from the console registrar. The owner is named rather than read off
 * the loader's marker, so the routes register the same way under a spec that
 * calls the registrar directly.
 */
export function registerEmailRecordRoutes(): void {
  registerPluginRecordRoute(
    'emailMessage',
    {
      list: (context) => `${hub(context)}/messages`,
      record: (context, id) => `${hub(context)}/messages/${encodeURIComponent(id)}`,
    },
    { pluginId: BUNDLE_ID },
  )
  registerPluginRecordRoute(
    'emailTemplate',
    {
      list: (context) => (context.host ? `${hub(context)}/templates` : null),
      record: (context, id) =>
        context.host ? `${hub(context)}/templates/${encodeURIComponent(id)}` : null,
    },
    { pluginId: BUNDLE_ID },
  )
  registerPluginRecordRoute(
    'sendingIdentity',
    {
      list: (context) => `${hub(context)}/sending`,
      record: (context) => `${hub(context)}/sending`,
    },
    { pluginId: BUNDLE_ID },
  )
}
