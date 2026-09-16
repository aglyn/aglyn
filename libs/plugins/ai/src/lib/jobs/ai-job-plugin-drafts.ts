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

import { isHostPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import {
  pluginResourceDraftWriter,
  type PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { filterEnabledPluginsByReleaseFlags } from '@aglyn/tenant-data-admin/server/release-flags'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import type { AiJobKind } from '../model/ai-jobs.types'
import type { AiJobAdmissionContext, AiJobAdmissionRefusal } from './ai-job-admission'

/**
 * Admitting a job whose drafts ANOTHER plugin writes (AGL-2912).
 *
 * `aiDraftAdmissionRefusal` admits the kinds this plugin writes itself, where
 * the allowance is one it can read. An email job writes no document of its
 * own: the email plugin owns the email design and the marketing plugin owns
 * the campaign, and each registers a writer on the `plugin-resource-drafts`
 * seam. So the question this answers is different, and it is the caller's
 * half of that seam's contract — the seam carries no authorization of the
 * caller, so a caller establishes, before it asks for anything:
 *
 *  1. a site is named, and it is the job's own org's;
 *  2. the owning plugin runs on that site — switched on for the workspace,
 *    not switched off for the site, and past its release flag — and has
 *    actually registered its writer in this process;
 *  3. whatever the kind checks of its own, such as the plan a campaign needs;
 *  4. that the member the drafts are for may create one of each, which only
 *    the owner can answer, and does, through `refusal`.
 *
 * Asked at the create door before the job exists and again at the resume door
 * before a confirmed plan runs, so a plugin switched off, or an allowance used
 * up, in between is caught before the job spends. A refusal is the owner's own
 * sentence wherever there is one, so a person reads what the console would
 * have told them.
 */

/** How a resource's draft writer is found; the core's registry by default. */
export type AiPluginDraftWriterLookup = (resource: string) => PluginResourceDraftWriter | null

/** The registered writer for a resource, or `null` when no plugin writes it here. */
export const aiPluginDraftWriter: AiPluginDraftWriterLookup = (resource) =>
  pluginResourceDraftWriter(resource)?.writer ?? null

/** One draft a job kind needs written, and who owns it. */
export interface AiPluginDraftNeed {
  /** The resource name the owner registered its writer under. */
  resource: string
  /** The owning plugin, as `plugins.config.json` names it. */
  pluginId: string
  /** What the site's plugin list calls it, for the sentence a person reads. */
  label: string
}

export interface AiPluginDraftAdmissionInput {
  /** The job kind, named in the refusal that asks for a site. */
  kind: AiJobKind
  /** Every draft the kind writes, each checked in turn. */
  drafts: readonly AiPluginDraftNeed[]
  /** The kind's own check, asked once the site and its plugins are known good. */
  ownCheck?: (hostId: string) => Promise<AiJobAdmissionRefusal | null>
  /** How a writer is found; the registry otherwise. */
  writerFor?: AiPluginDraftWriterLookup
  /** The instant the owner's allowance is read against; now otherwise. */
  now?: Date
}

/** What a person is told when the plugin that owns a draft does not run here. */
export function aiPluginDraftUnavailable(label: string): string {
  return `Turn on ${label} for this site before starting the job.`
}

/**
 * Whether a job of this kind may start on this site for this member; `null`
 * admits it. Nothing here writes, and nothing here spends.
 */
export async function aiPluginDraftAdmissionRefusal(
  context: AiJobAdmissionContext,
  input: AiPluginDraftAdmissionInput,
): Promise<AiJobAdmissionRefusal | null> {
  const { hostId } = context
  if (!hostId) {
    return { status: 400, error: `Open the site the ${input.kind} is for before starting the job` }
  }
  const owner = await resolveOrgIdForHost(hostId)
  if (!owner || owner !== context.orgId) return { status: 404, error: 'Unknown site' }

  const writerFor = input.writerFor ?? aiPluginDraftWriter
  const host = (await context.firestore.collection('hosts').doc(hostId).get()).data() ?? null
  const org = context.org as { enabledPlugins?: string[] } | null
  // One release-flag read for every owner at once: the answer is per org, and
  // a plugin subtracted here is one the site cannot reach at all.
  const released = new Set(
    await filterEnabledPluginsByReleaseFlags(
      input.drafts.map((draft) => draft.pluginId),
      { orgId: context.orgId, authorization: null },
    ),
  )
  const writers: PluginResourceDraftWriter[] = []
  for (const draft of input.drafts) {
    const writer = writerFor(draft.resource)
    if (
      !writer ||
      !released.has(draft.pluginId) ||
      !isHostPluginEnabled(org, host, draft.pluginId)
    ) {
      return { status: 403, error: aiPluginDraftUnavailable(draft.label) }
    }
    writers.push(writer)
  }

  const own = await input.ownCheck?.(hostId)
  if (own) return own

  // Whether this member may create one of each, in the owner's own words. A
  // door that names no member — the machine re-checking a job it stored —
  // asks nothing here, because there is nobody to ask about.
  const uid = context.uid
  if (!uid) return null
  const now = input.now ?? new Date()
  for (const writer of writers) {
    const refusal = await writer.refusal({ orgId: context.orgId, hostId, uid, org, now })
    // The seam's 409 is "one already exists", which for an admission is a
    // room-to-create answer rather than a fault the door can act on.
    if (refusal) return { status: refusal.status === 409 ? 403 : refusal.status, error: refusal.error }
  }
  return null
}
