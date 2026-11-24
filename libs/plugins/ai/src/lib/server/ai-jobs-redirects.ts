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

// lockdown-423: via libs/plugins/ai/src/lib/server/ai-jobs-gate.ts

import { memberHasPermissionOnHost, permissionRefusal } from '@aglyn/tenant-data-admin/server/organizations'
import { AI_JOBS_COLLECTION, aiJobSummary, getAiJob } from '../jobs/ai-jobs'
import { aiSiteImportWriteRedirects } from '../jobs/ai-site-import-redirects'
import type { AiJob } from '../model/ai-jobs.types'
import { aiSiteImportRedirectsRetryable } from '../model/ai-site-import-redirects'
import { aiJobsGate } from './ai-jobs-gate'

/**
 * "Add redirects for published pages" on a Bring my site import (AGL-4245):
 * `POST /api/ai/jobs/{jobId}/redirects` `{ orgId, hostId }`.
 *
 * A wave's close redirects the old addresses of the pages that are live then.
 * A page the owner publishes later, room the plan gains, or redirects turned
 * on later, are caught here: the same pass (`aiSiteImportWriteRedirects`),
 * through the redirects plugin's writer, as the member who asks. It spends
 * nothing and calls no model.
 *
 * Who may: a member who holds `ai.generate` on the job's site, the permission
 * that runs the import. The writer then holds every rule to the Redirects
 * page's own rules for that member. Idempotent: a rule already made is found
 * under its id, and an address already settled is not asked again.
 *
 * Only while no step holds the job: a running wave writes the import itself,
 * and its own close runs the pass.
 */

const BUSY: ReadonlySet<AiJob['status']> = new Set(['queued', 'running'])

export interface AiJobsRedirectsDeps {
  writeRedirects?: typeof aiSiteImportWriteRedirects
}

export function createAiJobsRedirectsRoute(deps: AiJobsRedirectsDeps = {}) {
  const writeRedirects = deps.writeRedirects ?? aiSiteImportWriteRedirects
  return async function POST(request: Request, context: { params: Promise<{ jobId: string }> }): Promise<Response> {
    let payload: Record<string, unknown> | null
    try {
      payload = (await request.json()) as Record<string, unknown>
    } catch {
      payload = null
    }
    const gate = await aiJobsGate(request, String(payload?.['orgId'] ?? ''))
    if (gate instanceof Response) return gate
    const { jobId } = await context.params
    const existing = await getAiJob(gate.firestore, gate.orgId, jobId)
    if (!existing || existing.kind !== 'import' || !existing.siteImport) {
      return Response.json({ error: 'Unknown site import' }, { status: 404 })
    }
    const rawHost = payload?.['hostId']
    if ((existing.hostId ?? null) !== (typeof rawHost === 'string' && rawHost ? rawHost : null) || !existing.hostId) {
      return Response.json({ error: 'That import belongs to another site' }, { status: 400 })
    }
    if (!(await memberHasPermissionOnHost(gate.orgId, existing.hostId, gate.member, 'ai.generate'))) {
      return permissionRefusal('ai.generate')
    }
    const now = new Date()
    if (BUSY.has(existing.status)) {
      return Response.json(
        { error: 'A wave is being brought in. Its redirects are added when it is in.', job: aiJobSummary(existing, now) },
        { status: 409 },
      )
    }
    if (!aiSiteImportRedirectsRetryable(existing.siteImport)) {
      return Response.json({ job: aiJobSummary(existing, now), changed: false }, { status: 200 })
    }
    const redirects = await writeRedirects(gate.firestore, {
      job: existing,
      state: existing.siteImport,
      items: existing.items ?? [],
      org: gate.org as Readonly<Record<string, unknown>>,
      now,
      actorUid: gate.uid,
    })
    if (!redirects) return Response.json({ job: aiJobSummary(existing, now), changed: false }, { status: 200 })
    await gate.firestore
      .collection('orgs')
      .doc(gate.orgId)
      .collection(AI_JOBS_COLLECTION)
      .doc(jobId)
      .update({ 'siteImport.redirects': redirects })
    const job: AiJob = { ...existing, siteImport: { ...existing.siteImport, redirects } }
    return Response.json({ job: aiJobSummary(job, now), changed: true }, { status: 200 })
  }
}

export const POST = createAiJobsRedirectsRoute()

export const dynamic = 'force-dynamic'
export const maxDuration = 60
