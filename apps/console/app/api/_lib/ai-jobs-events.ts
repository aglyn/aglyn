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

import { AI_JOB_TERMINAL_STATUSES } from '@aglyn/aglyn/foundation/definitions/ai-jobs.types'
import type { AiJobSummary } from '@aglyn/aglyn/foundation/definitions/ai-jobs.types'

/**
 * One job's progress as a server-sent event stream (AGL-2904).
 *
 * The console has no Firestore listener on `aiJobs` — the collection is
 * client-readable, but the drawer reads through the route so the same
 * membership, flag and entitlement rungs answer every read — so progress
 * is a poll the SERVER runs on the client's behalf: one `state` event the
 * moment the stream opens, then a re-read every `intervalMs` that emits
 * only when the document moved, until the job is terminal or the stream
 * has been open for `deadlineMs`. At the deadline a `reconnect` event
 * tells the drawer to open a fresh stream, which keeps every stream inside
 * the route's `maxDuration` rather than trusting the platform to cut it.
 *
 * The client hanging up ends the poll through `signal`, so a closed tab
 * does not keep a function reading a document nobody is watching.
 */
export const AI_JOB_EVENTS_INTERVAL_MS = 2_000
export const AI_JOB_EVENTS_DEADLINE_MS = 55_000

export type AiJobEvent =
  | { type: 'state'; job: AiJobSummary }
  | { type: 'gone' }
  | { type: 'reconnect' }

export interface AiJobEventStreamOptions {
  /** The job as it is now, or `null` once it no longer exists. */
  read: () => Promise<AiJobSummary | null>
  /** Ends the poll — the request's own signal in the route. */
  signal?: AbortSignal
  now?: () => number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  intervalMs?: number
  deadlineMs?: number
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Whether a re-read is worth an event: the status or the clock moved. */
function changed(previous: AiJobSummary, next: AiJobSummary): boolean {
  return (
    previous.status !== next.status ||
    previous.updatedAt !== next.updatedAt ||
    previous.running !== next.running ||
    previous.outputs.length !== next.outputs.length
  )
}

export function aiJobEventStream(
  initial: AiJobSummary,
  options: AiJobEventStreamOptions,
): ReadableStream<Uint8Array> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? defaultSleep
  const intervalMs = options.intervalMs ?? AI_JOB_EVENTS_INTERVAL_MS
  const deadlineMs = options.deadlineMs ?? AI_JOB_EVENTS_DEADLINE_MS
  const encoder = new TextEncoder()
  let closed = false
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AiJobEvent) => {
        if (closed) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      const close = () => {
        if (closed) return
        closed = true
        controller.close()
      }
      const openedAt = now()
      let last = initial
      emit({ type: 'state', job: initial })
      if (AI_JOB_TERMINAL_STATUSES.includes(initial.status)) {
        close()
        return
      }
      for (;;) {
        await sleep(intervalMs, options.signal)
        if (closed || options.signal?.aborted) {
          close()
          return
        }
        let next: AiJobSummary | null
        try {
          next = await options.read()
        } catch (error) {
          // A transient read failure is not the job failing; the next
          // interval asks again, and the deadline bounds how long for.
          console.error('ai job events read failed', error)
          next = last
        }
        if (!next) {
          emit({ type: 'gone' })
          close()
          return
        }
        if (changed(last, next)) {
          emit({ type: 'state', job: next })
          last = next
        }
        if (AI_JOB_TERMINAL_STATUSES.includes(next.status)) {
          close()
          return
        }
        if (now() - openedAt >= deadlineMs) {
          emit({ type: 'reconnect' })
          close()
          return
        }
      }
    },
    cancel() {
      closed = true
    },
  })
}

export function aiJobEventResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
