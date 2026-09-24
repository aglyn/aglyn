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
import {
  registerPluginRecordRoute,
  type PluginRecordRouteContext,
} from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { BUNDLE_ID } from '../constants/bundle-common'
import { crmRoutes, type CrmRoutes } from './crm-routes'

/**
 * Where the CRM's records are read, published for every other surface.
 *
 * The Inbox links a lead, a submission links its sender, a form links the
 * people it captured. Each used to import {@link crmRoutes} and spell the
 * CRM's nav slug to do it, which made every one of them a reader of this
 * plugin's address table. They ask the record-route registry now, and get
 * `null` — text instead of a link — in a workspace where the CRM is not
 * loaded, which is also the first time that link stopped pointing at a page
 * the workspace cannot open.
 */

/** The nav slug the shell resolves this plugin's hub by, at either scope. */
const CRM_SLUG = 'crm'

function hub(context: PluginRecordRouteContext): CrmRoutes {
  return crmRoutes(
    context.host
      ? buildRoute(Route.HOST_PLUGIN, {
          orgSlug: context.orgSlug,
          host: context.host,
          pluginSlug: CRM_SLUG,
        })
      : buildRoute(Route.ORG_PLUGIN, {
          orgSlug: context.orgSlug,
          pluginSlug: CRM_SLUG,
        }),
  )
}

/** The one narrowing the contacts list publishes: the form that captured them. */
export const CRM_CONTACT_FILTER_FORM = 'form'

/**
 * Called from the console registrar. The owner is named rather than read off
 * the loader's marker, so the routes register the same way under a spec that
 * calls the registrar directly.
 */
export function registerCrmRecordRoutes(): void {
  const owner = { pluginId: BUNDLE_ID }
  registerPluginRecordRoute('contact', {
    list: (context) => hub(context).section('contacts'),
    record: (context, id) => hub(context).contact(id),
    byEmail: (context, email) => hub(context).contactByEmail(email),
    filtered: (context, filter, value) =>
      filter === CRM_CONTACT_FILTER_FORM
        ? hub(context).contactsByForm(value)
        : null,
  }, owner)
  registerPluginRecordRoute('lead', {
    list: (context) => hub(context).section('leads'),
    // One org row per person since AGL-3275, so the id alone addresses a
    // lead at both levels — the organization's hub included, where the
    // organization's Inbox links its leads (AGL-3303).
    record: (context, id) => hub(context).lead(id),
  }, owner)
  registerPluginRecordRoute('company', {
    list: (context) => hub(context).section('companies'),
    record: (context, id) => hub(context).company(id),
  }, owner)
  registerPluginRecordRoute('deal', {
    list: (context) => hub(context).section('deals'),
    record: (context, id) => hub(context).deal(id),
  }, owner)
}
