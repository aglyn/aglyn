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

import {
  registerPluginApiRoute,
  type PluginApiSubjectResolver,
} from '@aglyn/aglyn/server'
import { registerDatasetAiCapability } from './server/dataset-ai-capability'
import { registerDatasetDraftWriter } from './server/dataset-drafts'
import { datasetsHandler } from './server/datasets-route'
import { recordPagesHandler } from './record-pages/record-pages-route'

/**
 * The organization a datasets request is for, read from the request the way
 * the handler reads it — the JSON body's `orgId` (or `?orgId=`). Datasets belong to the organization and name no site, so without
 * this the dispatcher's release gate would read the request as anonymous and
 * refuse it under a partial rollout of the data store.
 */
const orgSubject: PluginApiSubjectResolver = async (request) => {
  const fromQuery = new URL(request.url).searchParams.get('orgId')
  if (fromQuery) return { orgId: fromQuery }
  if (request.method === 'GET' || request.method === 'HEAD') return null
  const body = (await request.json().catch(() => null)) as {
    orgId?: unknown
  } | null
  return typeof body?.orgId === 'string' && body.orgId
    ? { orgId: body.orgId }
    : null
}

/**
 * Console API: the organization's datasets — creating a dataset and its
 * records within the plan (`POST /api/orgs/datasets`) — and a site's record
 * templates (`POST /api/hosts/record-pages`). A dataset's import and export
 * run on the platform's transfer routes (`/api/transfer/*`, AGL-3530). Served by the console's plugin
 * dispatcher, at the addresses the console always answered them on.
 */
export function registerDataConsoleApi(): void {
  registerPluginApiRoute('orgs/datasets', { web: datasetsHandler }, {
    subject: orgSubject,
  })
  // A site's record templates (AGL-3475): `POST /api/hosts/record-pages`.
  registerPluginApiRoute('hosts/record-pages', { web: recordPagesHandler })
  // A dataset another plugin asks for by name (AGL-3616): Aglyn AI keeping a
  // menu, a team or a list of services as records, under this plugin's rules.
  // The console runs AI jobs (AGL-3026).
  registerDatasetDraftWriter()
  // …and the operation an AI build plans for it, which that writer executes.
  registerDatasetAiCapability()
}
