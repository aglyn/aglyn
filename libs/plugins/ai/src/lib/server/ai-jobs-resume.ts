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
import { aiJobAdmissionRefusal } from '../jobs/ai-job-admission'
import {
  AI_JOB_INLINE_BUDGET_MS,
  aiJobNextStepMinimumMs,
  aiJobSummary,
  getAiJob,
  resumeAiJob,
  runAiJobStep,
  writeAiJobAudit,
} from '../jobs/ai-jobs'
import { aiGateLadder } from '../runtime/ai-gate'
import { releaseAssistMessage } from '../usage/assist-usage'

/**
 * Resume a job that stopped for a person (AGL-2935): confirm its plan, or
 * try again the step whose answer broke a building rule on its re-ask.
 *
 * A door that SPENDS — the next step calls the provider — so it climbs the
 * whole ladder the create door climbs: `aiGenerative`,
 * `release_ai_generative`, the `ai-generate` switch, `ai.generate` on the
 * job's site, a per-uid window and a reservation. It then runs the next
 * step inline on that reservation, the way the create door runs the first,
 * and hands the reservation back whenever no step runs here.
 *
 * The body names the org and the job's site. A site that is not the job's
 * is refused, so a collaborator's permission on one site never confirms a
 * job on another. Audited per resume that changed something.
 */

const AI_JOBS_RESUME_RATE_LIMIT = { key: 'ai-jobs-resume', limit: 10, windowMs: 60_000 }

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  let payload: Record<string, unknown> | null
  try {
    payload = (await request.json()) as Record<string, unknown>
  } catch {
    payload = null
  }
  const rawHost = payload?.['hostId']
  const hostId = typeof rawHost === 'string' && rawHost ? rawHost : null
  const gate = await aiGateLadder(
    { request, orgId: String(payload?.['orgId'] ?? ''), hostId },
    {
      feature: 'aiGenerative',
      releaseFlag: 'release_ai_generative',
      lockdownFeature: 'ai-generate',
      permission: 'ai.generate',
      rateLimit: AI_JOBS_RESUME_RATE_LIMIT,
    },
  )
  if (gate instanceof Response) return gate
  // No token is spent until a step runs, so every exit before one hands the
  // message back.
  const release = () =>
    releaseAssistMessage(gate.firestore, gate.orgId, gate.reservation).catch(() => undefined)

  const { jobId } = await context.params
  const existing = await getAiJob(gate.firestore, gate.orgId, jobId)
  if (!existing) {
    await release()
    return Response.json({ error: 'Unknown job' }, { status: 404 })
  }
  if ((existing.hostId ?? null) !== hostId) {
    await release()
    return Response.json({ error: 'That job belongs to another site' }, { status: 400 })
  }
  // A confirmed plan runs the step that writes, and an allowance free when the
  // job was created may be used by now (AGL-2909): the kind is asked again
  // before anything runs, and a refusal leaves the job waiting for review.
  if (existing.status === 'needs_review') {
    let refusal: Awaited<ReturnType<typeof aiJobAdmissionRefusal>>
    try {
      refusal = await aiJobAdmissionRefusal(existing.kind, {
        firestore: gate.firestore,
        orgId: gate.orgId,
        hostId: existing.hostId ?? null,
        inputs: existing.inputs ?? {},
        org: gate.org,
        // The plan being confirmed, for a kind that builds only some plans.
        plan: existing.plan ?? null,
      })
    } catch (error) {
      await release()
      console.error('ai job admission failed', { orgId: gate.orgId, jobId, error })
      return Response.json({ error: 'The AI job could not be resumed' }, { status: 500 })
    }
    if (refusal) {
      await release()
      return Response.json(
        { error: refusal.error, job: aiJobSummary(existing, new Date()) },
        { status: refusal.status },
      )
    }
  }
  const now = new Date()
  const { job, changed } = await resumeAiJob(
    gate.firestore,
    gate.orgId,
    jobId,
    { uid: gate.uid },
    now,
  )
  if (!changed) {
    await release()
    return Response.json(
      { error: 'This job is not waiting for review', job: aiJobSummary(job, now) },
      { status: 409 },
    )
  }
  await writeAiJobAudit(gate.firestore, {
    action: 'ai.job.resume',
    actorUid: gate.uid,
    actorEmail: gate.decoded.email ?? null,
    orgId: gate.orgId,
    jobId,
    after: {
      status: job.status,
      reason: existing.review?.reason ?? null,
      kind: existing.kind,
    },
  })
  if (job.status !== 'queued') {
    await release()
    return Response.json({ job: aiJobSummary(job, now) }, { status: 200 })
  }
  // A step that needs more time than this request has (AGL-2907) is left
  // queued for the beat, which starts it with a budget of its own: a provider
  // call this request's timeout cut off would be billed upstream and metered
  // nowhere.
  if (aiJobNextStepMinimumMs(job) > AI_JOB_INLINE_BUDGET_MS) {
    await release()
    return Response.json({ job: aiJobSummary(job, now) }, { status: 200 })
  }

  const run = await runAiJobStep(gate.firestore, gate.orgId, jobId, {
    owner: `route:${randomUUID()}`,
    now,
    reservation: gate.reservation,
    org: gate.org,
    signal: AbortSignal.timeout(AI_JOB_INLINE_BUDGET_MS),
    actor: { uid: gate.uid, email: gate.decoded.email ?? null },
  })
  if (run.outcome === 'not-claimable') {
    // The beat claimed the step between the resume and this run; it runs
    // there, on a reservation of its own.
    await release()
    const latest = await getAiJob(gate.firestore, gate.orgId, jobId)
    return Response.json({ job: aiJobSummary(latest ?? job, now) }, { status: 200 })
  }
  return Response.json({ job: aiJobSummary(run.job) }, { status: 200 })
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60
