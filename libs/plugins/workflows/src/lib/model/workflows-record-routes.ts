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
import type { WorkflowsConsoleSectionId } from '../components/workflows-console-sections'

/**
 * Where a site's workflows, actions and webhooks are read, published for
 * every other surface — the same three kinds this plugin indexes.
 *
 * The CRM installs an action recipe and names where it landed; an assistant
 * job opens the actions list its drafted automation was saved to. Each asks
 * the record-route registry for the kind rather than spelling this plugin's
 * nav slug, and gets `null` (text instead of a link) where it is not loaded.
 *
 * None of the three has a page of its own: each is edited in its section of
 * the Automation page, so a record's address is its section. The
 * organization's hub lists every site's records under the same section ids,
 * so both levels answer.
 */

/** The nav slug the shell resolves this plugin's hub by, at either level. */
const AUTOMATION_SLUG = 'automation'

function section(
  { orgSlug, host }: PluginRecordRouteContext,
  id: WorkflowsConsoleSectionId,
): string {
  const hub = host
    ? buildRoute(Route.HOST_PLUGIN, { orgSlug, host, pluginSlug: AUTOMATION_SLUG })
    : buildRoute(Route.ORG_PLUGIN, { orgSlug, pluginSlug: AUTOMATION_SLUG })
  return `${hub}/${id}`
}

/**
 * Called from the console registrar. The owner is named rather than read off
 * the loader's marker, so the routes register the same way under a spec that
 * calls the registrar directly.
 */
export function registerWorkflowsRecordRoutes(): void {
  const owner = { pluginId: BUNDLE_ID }
  for (const [kind, id] of [
    ['workflow', 'workflows'],
    ['action', 'actions'],
    ['webhook', 'webhooks'],
  ] as const) {
    registerPluginRecordRoute(
      kind,
      { list: (context) => section(context, id), record: (context) => section(context, id) },
      owner,
    )
  }
}
