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
// The POST climbs `aiGateLadder`, whose lockdown rung is the verdict; the
// GET climbs `ai-jobs-gate.ts`, which carries the same rung.

import { randomUUID } from 'crypto'
import {
  AI_JOB_KINDS,
  type AiJobKind,
  type AiJobStatus,
} from '../model/ai-jobs.types'
// By their own entry points rather than the barrel (AGL-2903): the specs
// stub the barrel closed-world, and the ladder, the machine and the runtime
// are the things under test here, not things to be stubbed away.
import { aiGateLadder } from '../runtime/ai-gate'
import { AI_JOB_BRIEF_MAX_CHARS } from '../jobs/ai-job-text-step'
import {
  AI_JOB_INLINE_BUDGET_MS,
  aiJobSummary,
  createAiJob,
  listAiJobs,
  runAiJobStep,
} from '../jobs/ai-jobs'
import { releaseAssistMessage } from '../usage/assist-usage'
import { aiJobsGate } from './ai-jobs-gate'

/**
 * AI generation jobs: create and list (AGL-2904).
 *
 * `POST` is a door that spends, so it climbs the whole ladder (AGL-2903) —
 * `aiGenerative`, `release_ai_generative`, the `ai-generate` switch, a
 * per-uid window, and a reservation — and then creates the job and runs
 * its first step INLINE under `AI_JOB_INLINE_BUDGET_MS`. A step that
 * finishes in time answers with the job `done` (or `queued` behind its
 * next step); one that does not is aborted, its reservation handed back,
 * and the job answers `queued` for the beat to resume. Either way the
 * caller gets the job document, and the events route is how it watches
 * from there.
 *
 * `GET` lists the org's jobs, newest first, through the read gate: the
 * same rungs up to the lockdown verdict, no reservation.
 *
 * The request must NAME the org it is metered against (AGL-1934). There
 * is no fallback to "the caller's first org".
 */

const AI_JOBS_RATE_LIMIT = { key: 'ai-jobs', limit: 10, windowMs: 60_000 }

/** Kind-specific inputs, bounded: a runner reads scalars, not a document. */
const MAX_INPUTS_JSON_CHARS = 8_000

/** The admitted statuses for the list filter, as the union spells them. */
const AI_JOB_STATUSES: readonly AiJobStatus[] = [
  'queued',
  'running',
  'needs_input',
  'done',
  'failed',
  'canceled',
]

export interface CreateAiJobBody {
  orgId: string
  hostId: string | null
  kind: AiJobKind
  brief: string
  inputs: Record<string, string | number | boolean>
}

const ID_CHARS = /^[A-Za-z0-9_-]{1,100}$/

/** Validate + clamp the request body; a string names what is wrong. */
export function parseCreateAiJobBody(payload: unknown): CreateAiJobBody | string {
  const body = (payload ?? {}) as Record<string, unknown>
  const orgId = String(body.orgId ?? '').trim()
  if (!orgId) return 'Open a workspace before using this feature'
  const kind = String(body.kind ?? '')
  if (!(AI_JOB_KINDS as readonly string[]).includes(kind)) {
    return `kind must be one of ${AI_JOB_KINDS.join(', ')}`
  }
  const brief = String(body.brief ?? '').trim()
  if (!brief) return 'Write a brief for the job'
  if (brief.length > AI_JOB_BRIEF_MAX_CHARS) {
    return `Keep the brief under ${AI_JOB_BRIEF_MAX_CHARS.toLocaleString('en-US')} characters`
  }
  const rawHost = body.hostId
  const hostId =
    rawHost === undefined || rawHost === null || rawHost === ''
      ? null
      : typeof rawHost === 'string' && ID_CHARS.test(rawHost)
        ? rawHost
        : undefined
  if (hostId === undefined) return 'hostId is not a site id'
  // A theme is fields on one site's document, so a theme job that names no
  // site has nothing to propose a change to (AGL-2938).
  if (kind === 'theme' && !hostId) return 'Open a site before changing its theme'
  const rawInputs = body.inputs
  const inputs: Record<string, string | number | boolean> = {}
  if (rawInputs !== undefined && rawInputs !== null) {
    if (typeof rawInputs !== 'object' || Array.isArray(rawInputs)) {
      return 'inputs must be an object'
    }
    for (const [key, value] of Object.entries(rawInputs as Record<string, unknown>)) {
      if (
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      ) {
        return `inputs.${key} must be a string, number or boolean`
      }
      inputs[key] = value
    }
    if (JSON.stringify(inputs).length > MAX_INPUTS_JSON_CHARS) {
      return 'inputs are too large'
    }
  }
  return { orgId, hostId, kind: kind as AiJobKind, brief, inputs }
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    payload = null
  }
  const parsed = parseCreateAiJobBody(payload)
  // The org is parsed BEFORE the ladder so a request that named none is
  // refused with the ladder's 400 rather than a shape error; every other
  // shape fault waits until the caller has proven who they are.
  const orgId = typeof parsed === 'string' ? String((payload as Record<string, unknown> | null)?.orgId ?? '') : parsed.orgId
  // The site rides along for the same reason: a collaborator's `ai.generate`
  // is decided per site (AGL-2927), so the ladder needs it before it can say
  // whether this member may generate here at all.
  const hostId = typeof parsed === 'string' ? null : parsed.hostId
  const gate = await aiGateLadder(
    { request, orgId, hostId },
    {
      feature: 'aiGenerative',
      releaseFlag: 'release_ai_generative',
      lockdownFeature: 'ai-generate',
      permission: 'ai.generate',
      rateLimit: AI_JOBS_RATE_LIMIT,
    },
  )
  if (gate instanceof Response) return gate
  if (typeof parsed === 'string') {
    // Admitted, reserved, and then found to have sent nothing runnable: the
    // reservation goes back, because no token was spent.
    await releaseAssistMessage(gate.firestore, gate.orgId, gate.reservation).catch(
      () => undefined,
    )
    return Response.json({ error: parsed }, { status: 400 })
  }

  const now = new Date()
  let jobId: string
  try {
    const job = await createAiJob(
      gate.firestore,
      {
        orgId: gate.orgId,
        hostId: parsed.hostId,
        kind: parsed.kind,
        brief: parsed.brief,
        inputs: parsed.inputs,
        createdBy: gate.uid,
        createdByEmail: gate.decoded.email ?? null,
      },
      now,
    )
    jobId = job.$id
  } catch (error) {
    await releaseAssistMessage(gate.firestore, gate.orgId, gate.reservation).catch(
      () => undefined,
    )
    console.error('ai job create failed', { orgId: gate.orgId, error })
    return Response.json({ error: 'The AI job could not be created' }, { status: 500 })
  }

  // The first step, inline, on the reservation the ladder already holds.
  // The runner hands that reservation back itself if the provider is never
  // reached, and re-queues the step when the budget ends first.
  const run = await runAiJobStep(gate.firestore, gate.orgId, jobId, {
    owner: `route:${randomUUID()}`,
    now,
    reservation: gate.reservation,
    org: gate.org,
    signal: AbortSignal.timeout(AI_JOB_INLINE_BUDGET_MS),
    // The caller is on the request, so what the inline step produces is
    // attributed with their address; the beat's steps carry the uid alone.
    actor: { uid: gate.uid, email: gate.decoded.email ?? null },
  })
  if (run.outcome === 'not-claimable') {
    // A job created a moment ago has a claimable first step; anything else
    // is a fault in the machine, and the reservation must not be stranded.
    await releaseAssistMessage(gate.firestore, gate.orgId, gate.reservation).catch(
      () => undefined,
    )
    console.error('ai job first step not claimable', { orgId: gate.orgId, jobId })
    return Response.json({ error: 'The AI job could not be started' }, { status: 500 })
  }
  return Response.json({ job: aiJobSummary(run.job) }, { status: 200 })
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const gate = await aiJobsGate(request, url.searchParams.get('orgId') ?? '')
  if (gate instanceof Response) return gate
  const rawStatus = url.searchParams.get('status') ?? ''
  const status = (AI_JOB_STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as AiJobStatus)
    : undefined
  const limit = Number(url.searchParams.get('limit') ?? '')
  const now = new Date()
  const jobs = await listAiJobs(gate.firestore, gate.orgId, {
    ...(status ? { status } : {}),
    ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
  })
  return Response.json(
    { jobs: jobs.map((job) => aiJobSummary(job, now)) },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60
