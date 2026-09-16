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
  getAiJob,
} from '../jobs/ai-jobs'
import { aiJobEventResponse, aiJobEventStream } from './ai-jobs-events'
import { aiJobsGate } from './ai-jobs-gate'

/**
 * One job's progress as server-sent events (AGL-2904): a `state` event
 * now, a re-read every two seconds until the job is terminal, and a
 * `reconnect` event at 55 s so no stream outlives the route's
 * `maxDuration`. The read gate answers who may watch; the job id is only
 * ever resolved under the org the request named, so a member of one
 * workspace cannot watch another's job by guessing an id.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const url = new URL(request.url)
  const gate = await aiJobsGate(request, url.searchParams.get('orgId') ?? '')
  if (gate instanceof Response) return gate
  const { jobId } = await context.params
  const read = async () => {
    const job = await getAiJob(gate.firestore, gate.orgId, jobId)
    return job ? aiJobSummary(job) : null
  }
  const initial = await read()
  if (!initial) return Response.json({ error: 'Unknown job' }, { status: 404 })
  return aiJobEventResponse(
    aiJobEventStream(initial, { read, signal: request.signal }),
  )
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60
