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

import { createHash } from 'node:crypto'
import { isHostPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import type {
  PluginDraftRecord,
  PluginDraftRefusal,
  PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { filterEnabledPluginsByReleaseFlags } from '@aglyn/tenant-data-admin/server/release-flags'
import type { AiJob, AiJobItemLedger } from '../model/ai-jobs.types'
import type { AiSiteImportRedirect, AiSiteImportRedirectReason, AiSiteImportState } from '../model/ai-site-import'
import { aiSiteImportRedirectPlan } from '../model/ai-site-import-redirects'
import { aiPluginDraftOwner, aiPluginDraftWriter, type AiPluginDraftOwnerLookup, type AiPluginDraftWriterLookup } from './ai-job-plugin-drafts'

/*==========================================
 * A CLOSED WAVE'S OLD ADDRESSES, REDIRECTED (AGL-4245).
 *
 * After a wave's pages go live, each old address the plan
 * (`aiSiteImportRedirectPlan`) asks for is written as a permanent redirect by
 * the redirects plugin's writer, on the core's resource-drafts seam under the
 * resource `redirect`. This plugin never imports the redirects plugin and
 * never writes a rule itself: the writer applies the Redirects page's rules
 * to the member who started the import.
 *
 * The caller's half of the seam's contract, as an AI build's drafts make it:
 * the owning plugin must run on the site (switched on for the workspace, not
 * off for the site, past its release flag), and the writer's `refusal` is
 * asked once before any write. Either refusing leaves every address out with
 * why; nothing here throws for it.
 *
 * Each rule is written under `<job id>-<hash of its old address>`, so a wave
 * closing twice, a re-read of the site or a later wave finds the rule it
 * already made instead of a second one, and the job's own id names every rule
 * it made. A rule the site already has at that address (the owner's) is kept
 * and reported, never overwritten. The writer follows an existing chain from
 * the new page's address to where it ends, and refuses a loop.
 *=========================================*/

/** The resource the redirects plugin registers its writer under. */
export const AI_SITE_IMPORT_REDIRECT_RESOURCE = 'redirect'

/** The status code an import's redirects carry: the move is permanent. */
export const AI_SITE_IMPORT_REDIRECT_STATUS = 301

/** The writer's refusal codes this import reads (the redirects plugin's `REDIRECT_AI_REFUSAL_CODES`). */
const CODE_DUPLICATE = 'duplicate'
const CODE_LIVE_PAGE = 'live-page'
const CODE_PLAN_LIMIT = 'plan-limit'

/** The rule id an old address's redirect is written under. */
export function aiSiteImportRedirectId(jobId: string, from: string): string {
  return `${jobId}-${createHash('sha256').update(from).digest('hex').slice(0, 16)}`
}

export interface AiSiteImportRedirectsDeps {
  writerFor?: AiPluginDraftWriterLookup
  ownerFor?: AiPluginDraftOwnerLookup
  /** Whether the owning plugin runs on the site; the release flags and the site's plugin list otherwise. */
  pluginOn?: (input: { orgId: string; pluginId: string; org: Readonly<Record<string, unknown>> | null; host: Readonly<Record<string, unknown>> }) => Promise<boolean>
}

async function readPluginOn(input: {
  orgId: string
  pluginId: string
  org: Readonly<Record<string, unknown>> | null
  host: Readonly<Record<string, unknown>>
}): Promise<boolean> {
  const released = await filterEnabledPluginsByReleaseFlags([input.pluginId], { orgId: input.orgId, authorization: null })
  return released.includes(input.pluginId) && isHostPluginEnabled(input.org as never, input.host as never, input.pluginId)
}

/** What the redirects plugin's `check` says an old address is stored as, or `null`. */
function storedSourceWith(writer: PluginResourceDraftWriter, hostId: string): (path: string) => string | null {
  return (path) => {
    const checked = writer.check({ action: 'create', source: path, destination: '/' }, { hostId })
    if (!checked.ok) return null
    const stored = checked.facts['storedSource']
    return typeof stored === 'string' && stored ? stored : null
  }
}

/** Lowercase, no trailing slash, no query: a fallback reading of an old address when no writer can say. */
function plainPath(path: string): string | null {
  const value = String(path ?? '').split(/[?#]/)[0]?.trim().toLowerCase() ?? ''
  if (!value.startsWith('/')) return null
  return value.length > 1 ? value.replace(/\/+$/, '') || '/' : '/'
}

/**
 * The import's redirects after a wave closed: every old address considered,
 * each `created`, `kept`, `same` or `left-out` with why. `null` when the job
 * names no site. Never throws for a refusal; a write that throws is left out.
 */
export async function aiSiteImportWriteRedirects(
  firestore: FirebaseFirestore.Firestore,
  input: {
    job: Pick<AiJob, '$id' | 'orgId' | 'hostId' | 'createdBy'>
    state: AiSiteImportState
    items: readonly AiJobItemLedger[]
    org: Readonly<Record<string, unknown>> | null
    now: Date
  },
  deps: AiSiteImportRedirectsDeps = {},
): Promise<AiSiteImportRedirect[] | null> {
  const { job, state } = input
  const hostId = job.hostId
  if (!hostId) return null
  const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
  const host = (hostSnapshot.exists ? hostSnapshot.data() : null) ?? {}
  const writer = (deps.writerFor ?? aiPluginDraftWriter)(AI_SITE_IMPORT_REDIRECT_RESOURCE)
  const owner = (deps.ownerFor ?? aiPluginDraftOwner)(AI_SITE_IMPORT_REDIRECT_RESOURCE)
  const plan = aiSiteImportRedirectPlan({
    state,
    items: input.items,
    screens: (host as { screens?: Record<string, unknown> }).screens ?? null,
    storedSource: writer ? storedSourceWith(writer, hostId) : plainPath,
  })
  const entries = [...plan.entries]
  if (!plan.asks.length) return entries

  const leaveAll = (reason: AiSiteImportRedirectReason, note: string | null) => {
    for (const ask of plan.asks) entries[ask.at] = { from: ask.from, to: ask.to, outcome: 'left-out', reason, note, slot: ask.slot }
    return entries
  }
  const pluginOn = deps.pluginOn ?? readPluginOn
  if (!writer || !owner || !(await pluginOn({ orgId: job.orgId, pluginId: owner, org: input.org, host }))) {
    return leaveAll('off', 'Redirects is turned off for this site, so no redirects were added. Turn it on to add them.')
  }
  const context = { orgId: job.orgId, hostId, uid: job.createdBy, org: input.org, now: input.now }
  const refusal = await writer.refusal(context)
  if (refusal) return leaveAll('off', refusal.error)

  let full: string | null = null
  for (const ask of plan.asks) {
    const leave = (reason: AiSiteImportRedirectReason, note: string | null = null) => {
      entries[ask.at] = { from: ask.from, to: ask.to, outcome: 'left-out', reason, note, slot: ask.slot }
    }
    // Once the plan has no room, the rest wait for room too.
    if (full) {
      leave('plan-limit', full)
      continue
    }
    const ruleId = aiSiteImportRedirectId(job.$id, ask.from)
    try {
      const written = await writer.write({
        ...context,
        id: ruleId,
        name: `${ask.from} → ${ask.to}`,
        content: {
          action: 'create',
          source: ask.from,
          destination: ask.to,
          statusCode: AI_SITE_IMPORT_REDIRECT_STATUS,
          followChain: true,
        },
      })
      if (written.ok === false) {
        // `strictNullChecks` is off, so the refusal is read by its own shape.
        const refusal = written as PluginDraftRefusal
        if (refusal.code === CODE_DUPLICATE) {
          entries[ask.at] = { from: ask.from, to: null, outcome: 'kept', slot: ask.slot }
        } else if (refusal.code === CODE_LIVE_PAGE) {
          leave('page-there')
        } else if (refusal.code === CODE_PLAN_LIMIT) {
          full = refusal.error
          leave('plan-limit', refusal.error)
        } else {
          leave('refused', refusal.error)
        }
      } else {
        const record = written as PluginDraftRecord
        const to = typeof record.facts?.['destination'] === 'string' ? (record.facts['destination'] as string) : ask.to
        entries[ask.at] = { from: ask.from, to, outcome: 'created', slot: ask.slot, ruleId: record.id || ruleId }
      }
    } catch (error) {
      console.error('ai site import: a redirect could not be written', { orgId: job.orgId, jobId: job.$id, error })
      leave('refused', null)
    }
  }
  return entries
}
