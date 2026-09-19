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

// lockdown-423: via libs/plugins/ai/src/lib/runtime/ai-gate.ts
// The POST climbs `aiGateLadder`, whose lockdown rung is the verdict.

import { randomUUID } from 'crypto'
import { resolveOrgEntitlements } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import {
  getOrgForUser,
  memberHasPermissionOnHost,
} from '@aglyn/tenant-data-admin/server/organizations'
import { aiJobAdmissionRefusal, aiJobSiteRefusal } from '../jobs/ai-job-admission'
import { AI_JOB_BRIEF_MAX_CHARS } from '../jobs/ai-job-text-step'
import { aiJobSummary, createAiJob } from '../jobs/ai-jobs'
import {
  AI_SITE_BATCH_MAX,
  AI_SITE_BATCH_MIN_HOST_LIMIT,
  AI_SITE_INPUT_MAX_CHARS,
  AI_SITE_PAGES,
} from '../model/ai-site-job'
import { aiGateLadder } from '../runtime/ai-gate'
import { releaseAssistMessage } from '../usage/assist-usage'

/**
 * The agency batch (AGL-2911): one brief, many sites.
 *
 * An agency builds the same site again and again with the business name, the
 * city and the brand changed, so this door takes ONE brief and a list of the
 * org's sites with those variables per site, and creates one `site` job per
 * site under one batch id. The jobs are ordinary scaffolds — the beat runs
 * them, each plans and waits for its own confirmation, each writes only
 * drafts — and the batch id is what lets the org Sites page show them as one
 * run with a link into each.
 *
 * ── Why the batch has a door of its own ──────────────────────────────────
 *
 * Twenty-five calls to the create door would meet its per-minute window and
 * its inline first step, and would leave the batch half made when the window
 * closed. This door creates them in one request and runs NO step: it spends
 * no tokens, so the message the ladder reserved goes straight back, and every
 * job's own steps reserve and meter as they run. What the batch costs is
 * therefore metered per step exactly as a single scaffold is, and the org's
 * ceiling binds it the same way.
 *
 * ── Who may run it ───────────────────────────────────────────────────────
 *
 * The ladder answers for the org — `aiGenerative`, the release flag, the
 * `ai-generate` switch and `ai.generate` on the org axis — and then each
 * named site is asked for on its own: it must be this org's, and the caller
 * must hold `ai.generate` THERE (AGL-2927), so a collaborator's permission on
 * one site never starts a scaffold on another. A site the caller cannot use
 * is reported back beside the ones that started, never silently dropped.
 *
 * The plan band is the issue's own: the batch is for the plans that sell
 * enough sites to need it, which `hostLimit` is what distinguishes.
 */

const AI_JOBS_BATCH_RATE_LIMIT = {
  key: 'ai-jobs-batch',
  limit: 3,
  windowMs: 60_000,
}

const ID_CHARS = /^[A-Za-z0-9_-]{1,100}$/

/** The longest model id a body may carry; the catalog's ids are far shorter. */
const MAX_MODEL_CHARS = 100

export const AI_SITE_BATCH_PLAN_REFUSAL =
  'Generating for many sites is included in the plans that hold at least ' +
  `${AI_SITE_BATCH_MIN_HOST_LIMIT} sites — upgrade in Billing`

export interface AiSiteBatchSite {
  hostId: string
  businessName: string
  city: string
  brand: string
}

export interface CreateAiSiteBatchBody {
  orgId: string
  brief: string
  businessType: string
  pages: number
  welcomeEmail: boolean
  sites: AiSiteBatchSite[]
  model: string | null
}

/** Validate + clamp the request body; a string names what is wrong. */
export function parseAiSiteBatchBody(
  payload: unknown,
): CreateAiSiteBatchBody | string {
  const body = (payload ?? {}) as Record<string, unknown>
  const orgId = String(body['orgId'] ?? '').trim()
  if (!orgId) return 'Open a workspace before using this feature'
  const brief = String(body['brief'] ?? '').trim()
  if (!brief) return 'Write a brief for the sites'
  if (brief.length > AI_JOB_BRIEF_MAX_CHARS) {
    return `Keep the brief under ${AI_JOB_BRIEF_MAX_CHARS.toLocaleString('en-US')} characters`
  }
  const businessType = String(body['businessType'] ?? '').trim()
  if (!businessType) return 'Say what kind of business the sites are for'
  if (businessType.length > AI_SITE_INPUT_MAX_CHARS) {
    return `businessType must be text under ${AI_SITE_INPUT_MAX_CHARS} characters`
  }
  const rawPages = body['pages']
  const pages =
    typeof rawPages === 'number' ? rawPages : Number(rawPages ?? NaN)
  if (
    !Number.isInteger(pages) ||
    pages < AI_SITE_PAGES.min ||
    pages > AI_SITE_PAGES.max
  ) {
    return `pages must be a whole number from ${AI_SITE_PAGES.min} to ${AI_SITE_PAGES.max}`
  }
  const rawSites = body['sites']
  if (!Array.isArray(rawSites) || rawSites.length === 0)
    return 'Pick the sites to generate for'
  if (rawSites.length > AI_SITE_BATCH_MAX) {
    return `Generate for up to ${AI_SITE_BATCH_MAX} sites at a time`
  }
  const sites: AiSiteBatchSite[] = []
  const seen = new Set<string>()
  for (const raw of rawSites as Array<Record<string, unknown>>) {
    const hostId = String(raw?.['hostId'] ?? '').trim()
    if (!ID_CHARS.test(hostId)) return 'sites[].hostId is not a site id'
    if (seen.has(hostId)) return 'The same site is listed twice'
    seen.add(hostId)
    const variable = (key: string): string | null => {
      const value = raw?.[key]
      if (value === undefined || value === null || value === '') return ''
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length > AI_SITE_INPUT_MAX_CHARS ? null : trimmed
    }
    const businessName = variable('businessName')
    const city = variable('city')
    const brand = variable('brand')
    if (businessName === null || city === null || brand === null) {
      return `Keep each site's name, city and brand under ${AI_SITE_INPUT_MAX_CHARS} characters`
    }
    sites.push({ hostId, businessName, city, brand })
  }
  const rawModel = typeof body['model'] === 'string' ? body['model'].trim() : ''
  if (rawModel.length > MAX_MODEL_CHARS) return 'model is not a model id'
  return {
    orgId,
    brief,
    businessType,
    pages,
    welcomeEmail: body['welcomeEmail'] !== false,
    sites,
    model: rawModel && rawModel !== 'auto' ? rawModel : null,
  }
}

/** A batch id: a plain token the job inputs and the console group by. */
export function newAiSiteBatchId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 20)
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    payload = null
  }
  const parsed = parseAiSiteBatchBody(payload)
  const orgId =
    typeof parsed === 'string'
      ? String((payload as Record<string, unknown> | null)?.['orgId'] ?? '')
      : parsed.orgId
  // The org axis: the batch belongs to no one site, and each named site is
  // asked for on its own below.
  const gate = await aiGateLadder(
    { request, orgId, hostId: null },
    {
      feature: 'aiGenerative',
      releaseFlag: 'release_ai_generative',
      lockdownFeature: 'ai-generate',
      permission: 'ai.generate',
      rateLimit: AI_JOBS_BATCH_RATE_LIMIT,
    },
  )
  if (gate instanceof Response) return gate
  // No step runs here, so nothing is spent and the message goes back whatever
  // this door answers.
  await releaseAssistMessage(
    gate.firestore,
    gate.orgId,
    gate.reservation,
  ).catch(() => undefined)
  if (typeof parsed === 'string') {
    return Response.json({ error: parsed }, { status: 400 })
  }
  const entitlements = resolveOrgEntitlements(
    gate.org as Partial<AglynOrgBilling>,
  )
  if (!gate.staff && entitlements.hostLimit < AI_SITE_BATCH_MIN_HOST_LIMIT) {
    return Response.json(
      { error: AI_SITE_BATCH_PLAN_REFUSAL, reason: 'entitlement' },
      { status: 403 },
    )
  }
  const membership = gate.staff
    ? null
    : await getOrgForUser(gate.uid, gate.orgId)
  if (!gate.staff && membership?.orgId !== gate.orgId) {
    return Response.json(
      { error: 'You are not a member of that organization' },
      { status: 403 },
    )
  }

  const batchId = newAiSiteBatchId()
  const now = new Date()
  const started: ReturnType<typeof aiJobSummary>[] = []
  const refused: Array<{ hostId: string; error: string }> = []
  for (const site of parsed.sites) {
    const permitted =
      gate.staff ||
      (await memberHasPermissionOnHost(
        gate.orgId,
        site.hostId,
        membership?.member,
        'ai.generate',
      ))
    if (!permitted) {
      refused.push({
        hostId: site.hostId,
        error: 'You cannot generate on that site',
      })
      continue
    }
    const inputs = {
      businessType: parsed.businessType,
      pages: parsed.pages,
      welcomeEmail: parsed.welcomeEmail,
      businessName: site.businessName,
      city: site.city,
      brand: site.brand,
      batchId,
    }
    // What only a scaffold can say about this site (AGL-2909): its inputs, the
    // site being this org's, and a step that can build its pages.
    let refusal: Awaited<ReturnType<typeof aiJobAdmissionRefusal>>
    try {
      // A site that switched AI off is refused on its own (AGL-3028): the
      // dispatcher cannot see a site named inside `sites[]`, and the rest of
      // the batch still starts.
      refusal =
        (await aiJobSiteRefusal({
          firestore: gate.firestore,
          org: gate.org,
          hostId: site.hostId,
        })) ??
        (await aiJobAdmissionRefusal('site', {
          firestore: gate.firestore,
          orgId: gate.orgId,
          hostId: site.hostId,
          inputs,
          org: gate.org,
        }))
    } catch (error) {
      console.error('ai site batch admission failed', {
        orgId: gate.orgId,
        error,
      })
      refused.push({
        hostId: site.hostId,
        error: 'This site could not be started',
      })
      continue
    }
    if (refusal) {
      refused.push({ hostId: site.hostId, error: refusal.error })
      continue
    }
    try {
      const job = await createAiJob(
        gate.firestore,
        {
          orgId: gate.orgId,
          hostId: site.hostId,
          kind: 'site',
          brief: parsed.brief,
          inputs,
          model: parsed.model,
          createdBy: gate.uid,
          createdByEmail: gate.decoded.email ?? null,
        },
        now,
      )
      started.push(aiJobSummary(job, now))
    } catch (error) {
      console.error('ai site batch create failed', { orgId: gate.orgId, error })
      refused.push({
        hostId: site.hostId,
        error: 'This site could not be started',
      })
    }
  }
  if (!started.length) {
    return Response.json(
      {
        error: refused[0]?.error ?? 'No site could be started',
        batchId,
        jobs: [],
        refused,
      },
      { status: 403 },
    )
  }
  // The jobs are queued, not run: the beat plans each one, and each waits for
  // its own confirmation before it builds anything.
  return Response.json({ batchId, jobs: started, refused }, { status: 202 })
}
