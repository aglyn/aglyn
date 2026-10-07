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
'use client'

import type { MaybeTokenSource } from '@aglyn/shared-util-http/authorized-token'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { publishAiJob } from './ai-jobs-store'

// Reading a job's events stream (AGL-2904), shared by the AI jobs drawer and
// every dialog that follows the job it started (AGL-3593).

/**
 * `data:` frames out of an SSE body, one parsed event per frame. Shared with
 * every panel that watches a job through the events route.
 */
export async function readEventFrames(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find((part) => part.startsWith('data: '))
      if (!line) continue
      try {
        onEvent(JSON.parse(line.slice('data: '.length)))
      } catch {
        // A torn frame is dropped; the next state event carries the whole job.
      }
    }
  }
}

/**
 * How a follow ended (AGL-3596): the stream ran its course (`ok`), the route
 * answered that the job is not this reader's to see or does not exist
 * (`not-found`), or the route could not be reached or failed (`error`).
 */
export type AiJobFollowEnd = 'ok' | 'not-found' | 'error'

/**
 * Follows one job through the events route until it settles, the signal
 * aborts or the route stops answering, handing each state to `onJob` and to
 * every surface counting the workspace's jobs (AGL-3593). The server closes a
 * stream at its deadline with `reconnect`; this re-opens it.
 */
export async function followAiJobEvents(
  user: () => MaybeTokenSource,
  orgId: string,
  jobId: string,
  signal: AbortSignal,
  onJob: (job: AiJobSummary) => void,
): Promise<AiJobFollowEnd> {
  let again = true
  while (again && !signal.aborted) {
    again = false
    try {
      const response = await authorizedFetch(
        user(),
        `/api/ai/jobs/${encodeURIComponent(jobId)}/events?orgId=${encodeURIComponent(orgId)}`,
        { signal },
      )
      if (response.status === 404 || response.status === 403) return 'not-found'
      if (!response.ok || !response.body) return 'error'
      await readEventFrames(response.body, (event) => {
        if (signal.aborted) return
        if (event['type'] === 'state') {
          const next = event['job'] as AiJobSummary
          publishAiJob(next)
          onJob(next)
        } else if (event['type'] === 'reconnect') again = true
      })
    } catch {
      return 'error'
    }
  }
  return 'ok'
}
