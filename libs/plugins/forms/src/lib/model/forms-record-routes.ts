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
 * Where a form is read, published for every other surface.
 *
 * A campaign lists the forms filed under it, the CRM's lead routing names the
 * forms that capture leads, and an assistant job opens the form it drafted.
 * Each links to the form's own page, which is this plugin's — so they ask the
 * record-route registry for `form` rather than spelling this plugin's nav
 * slug, and get `null` (text instead of a link) where it is not loaded.
 *
 * A form belongs to one site: the organization level has no address for it.
 */

/** The nav slug the shell resolves this plugin's catalog by. */
const FORMS_SLUG = 'forms'

function catalog({ orgSlug, host }: PluginRecordRouteContext): string | null {
  return host ? buildRoute(Route.HOST_PLUGIN, { orgSlug, host, pluginSlug: FORMS_SLUG }) : null
}

/**
 * Called from the console registrar. The owner is named rather than read off
 * the loader's marker, so the route registers the same way under a spec that
 * calls the registrar directly.
 */
export function registerFormsRecordRoutes(): void {
  registerPluginRecordRoute(
    'form',
    {
      list: catalog,
      record: (context, id) => {
        const list = catalog(context)
        return list ? `${list}/${encodeURIComponent(id)}` : null
      },
    },
    { pluginId: BUNDLE_ID },
  )
}
