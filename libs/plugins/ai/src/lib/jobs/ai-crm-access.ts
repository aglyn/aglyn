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

import { isHostPluginEnabled, isPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import {
  pluginRecordFactsReader,
  type ResolvedPluginRecordFactsReader,
} from '@aglyn/aglyn/plugin-manager/plugin-record-facts'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import { filterEnabledPluginsByReleaseFlags } from '@aglyn/tenant-data-admin/server/release-flags'
import {
  AI_CRM_FACTS_RESOURCES,
  AI_CRM_IMPORT_FACTS_RESOURCE,
  AI_CRM_PLUGIN_ID,
  type AiCrmRequest,
} from '../model/ai-crm'
import type { AiJobAdmissionRefusal } from './ai-job-admission'

/**
 * Who may read a CRM record for AI (AGL-2917), as the CRM decides it.
 *
 * Asked twice: by the `crm` kind's admission before a job exists, for the
 * member creating it, and by the answer door before it serves a kept answer,
 * for the member reading it — so a member who lost the record since, or a
 * workspace that switched the CRM off, is not shown what was written from it.
 * Apart from the step so the door reads it without the generator.
 */

export const AI_CRM_UNAVAILABLE_COPY = 'Turn on the CRM for this site before using AI with it.'

/** How a resource's reader is found; the core's registry by default. */
export type AiCrmReaderLookup = (resource: string) => ResolvedPluginRecordFactsReader | null

/** The resource a question's facts are read from, and the record's id there. */
export function aiCrmFactsResource(request: AiCrmRequest): { resource: string; id: string } {
  return request.task === 'mapping'
    ? { resource: AI_CRM_IMPORT_FACTS_RESOURCE, id: request.collection }
    : { resource: AI_CRM_FACTS_RESOURCES[request.record.kind], id: request.record.id }
}

export interface AiCrmAccessInput {
  firestore: FirebaseFirestore.Firestore
  orgId: string
  hostId: string | null
  resource: string
  id: string
  org: object | null
  /** The member to ask about; absent asks nothing of the reader. */
  uid: string | null | undefined
  /** A verified staff caller, whom the CRM's reader lets read as it lets staff read a record. */
  staff?: boolean
  readerFor?: AiCrmReaderLookup
  now?: Date
}

/**
 * Whether the CRM would let this member read this record here now; `null`
 * admits them.
 *
 * First what an in-process read of the CRM skips of the plugin API
 * dispatcher, in order: a named site is the org's; the CRM is released for
 * the org, switched on where the read runs, and has registered its reader in
 * this process. Then the CRM's own reader, which applies the member's reach,
 * `data.manage`, the plan and the record's visibility, in the CRM's words.
 */
export async function aiCrmAccessRefusal(input: AiCrmAccessInput): Promise<AiJobAdmissionRefusal | null> {
  const org = input.org as { enabledPlugins?: string[] } | null
  let host: Record<string, unknown> | null = null
  if (input.hostId) {
    const owner = await resolveOrgIdForHost(input.hostId)
    if (!owner || owner !== input.orgId) return { status: 404, error: 'Unknown site' }
    host = (await input.firestore.collection('hosts').doc(input.hostId).get()).data() ?? null
  }
  const found = (input.readerFor ?? pluginRecordFactsReader)(input.resource)
  const released = (
    await filterEnabledPluginsByReleaseFlags([AI_CRM_PLUGIN_ID], { orgId: input.orgId, authorization: null })
  ).includes(AI_CRM_PLUGIN_ID)
  const enabled = input.hostId
    ? isHostPluginEnabled(org, host, AI_CRM_PLUGIN_ID)
    : isPluginEnabled(org, AI_CRM_PLUGIN_ID)
  if (!found || found.pluginId !== AI_CRM_PLUGIN_ID || !released || !enabled) {
    return { status: 403, error: AI_CRM_UNAVAILABLE_COPY }
  }
  if (!input.uid) return null
  const read = await found.reader.read({
    orgId: input.orgId,
    hostId: input.hostId,
    id: input.id,
    uid: input.uid,
    ...(input.staff ? { staff: true } : {}),
    org: (input.org as Record<string, unknown> | null) ?? null,
    now: input.now ?? new Date(),
  })
  return read.ok === false ? { status: read.status, error: read.error } : null
}
