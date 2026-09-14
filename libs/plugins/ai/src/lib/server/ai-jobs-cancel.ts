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

import {
  aiJobSummary,
  cancelAiJob,
  getAiJob,
  writeAiJobAudit,
} from '../jobs/ai-jobs'
import { aiJobsGate } from './ai-jobs-gate'

/**
 * Cancel a job (AGL-2904). Idempotent: a job already terminal answers as
 * it is, unchanged. A step in flight is not interrupted — the runner that
 * holds its lease records what it cost and finds the job canceled when it
 * goes to complete it — so a cancel is never a way to spend tokens the
 * document does not show. Audited per cancel that changed something.
 */
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
  const gate = await aiJobsGate(request, String(payload?.orgId ?? ''))
  if (gate instanceof Response) return gate
  const { jobId } = await context.params
  const existing = await getAiJob(gate.firestore, gate.orgId, jobId)
  if (!existing) return Response.json({ error: 'Unknown job' }, { status: 404 })
  const now = new Date()
  // The machine writes the org feed's row with this actor when the cancel
  // changed something; the staff audit row below is this route's own.
  const { job, changed } = await cancelAiJob(gate.firestore, gate.orgId, jobId, now, {
    uid: gate.uid,
    email: gate.decoded.email ?? null,
  })
  if (changed) {
    await writeAiJobAudit(gate.firestore, {
      action: 'ai.job.cancel',
      actorUid: gate.uid,
      actorEmail: gate.decoded.email ?? null,
      orgId: gate.orgId,
      jobId,
      after: { status: 'canceled', wasStatus: existing.status, kind: existing.kind },
    })
  }
  return Response.json({ job: aiJobSummary(job, now), changed }, { status: 200 })
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60
