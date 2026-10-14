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

import { AiBatchUnfinishedError, type AiProvider, type AiProviderRequest, type AiResult } from '../providers/contract'
import { aiLiveBatchWaitMs, type AiDevEnv as Env } from './ai-dev-env'

/**
 * A LIVE EVAL ROUND AS ONE MESSAGE BATCH (AGL-3660), at half the price.
 *
 * `AGLYN_LIVE_AI_BATCH=1` turns every non-streaming request a live eval sends
 * into an entry of a batch instead of a request of its own. The eval code does
 * not change: each request still awaits its own answer. Requests that arrive
 * together — a `Promise.all` over the briefs — gather into one batch, which
 * is sent once nothing new has arrived for `AGLYN_LIVE_AI_BATCH_WINDOW_MS`
 * (2 s), and every request resolves when the batch has ended. A re-ask is
 * asked only once its answer has been read, so the re-asks of a round gather
 * into the NEXT batch on their own: a round with re-asks is two or three
 * batches, never a request apiece.
 *
 * A batch takes minutes rather than seconds (most end within the hour), so it
 * suits the full sweep an agent runs before landing, not the one brief it is
 * iterating on. Streams are never batched. Development only: refused in any
 * deployed server, where nothing should wait minutes for an answer.
 *
 * A batch is waited on for `AGLYN_LIVE_AI_BATCH_WAIT_MS` (half an hour) and
 * no longer (AGL-3781). What it answered by then is kept; each request it left
 * unanswered is asked on its own — the same request, cache breakpoints and
 * all, the first alone so it writes the cached prefix the rest then read —
 * and counted as a live request at full price, not a batched one. One line
 * says so when it happens. A slow batch costs a round part of its discount,
 * never its answers.
 */

/** How long the queue waits for one more request before it sends the batch. */
export const AI_LIVE_BATCH_WINDOW_ENV = 'AGLYN_LIVE_AI_BATCH_WINDOW_MS'


interface Queued {
  request: AiProviderRequest
  resolve: (result: AiResult) => void
  reject: (error: unknown) => void
}

const queues = new Map<
  AiProvider,
  { entries: Queued[]; timer: ReturnType<typeof setTimeout> | null; env: Env }
>()

/** What this process's batches did. */
export interface AiLiveBatchStats {
  /** Batches sent. */
  batches: number
  /** Requests a batch answered, at the batch's half price. */
  requests: number
  /** Requests a batch left unanswered past its wait, asked on their own at full price. */
  fallbacks: number
}

const counts: AiLiveBatchStats = { batches: 0, requests: 0, fallbacks: 0 }

export function aiLiveBatchStats(): AiLiveBatchStats {
  return { ...counts }
}

export function resetAiLiveBatchStats(): void {
  counts.batches = 0
  counts.requests = 0
  counts.fallbacks = 0
}

/** Results a batch did not answer, answered by a request of their own — billed at full price. */
const answeredOnTheirOwn = new WeakSet<AiResult>()

/** Whether this result came from a request of its own after its batch's wait ran out (AGL-3781). */
export function aiAnsweredOutsideBatch(result: AiResult): boolean {
  return answeredOnTheirOwn.has(result)
}

async function answerOnItsOwn(provider: AiProvider, entry: Queued): Promise<void> {
  try {
    const result = await provider.complete(entry.request)
    answeredOnTheirOwn.add(result)
    entry.resolve(result)
  } catch (error) {
    entry.reject(error)
  }
}

/**
 * The requests a batch left unanswered, each asked on its own: the first
 * alone, so the cached prefix it writes is there for the others to read,
 * then the rest together.
 */
async function finishOnTheirOwn(provider: AiProvider, left: readonly Queued[], of: number, waitMs: number) {
  counts.fallbacks += left.length
  console.warn(
    `[ai] live batch: ${left.length} of ${of} requests unanswered after ${waitMs} ms; ` +
      'asked on their own at full price',
  )
  const [first, ...rest] = left
  await answerOnItsOwn(provider, first)
  await Promise.all(rest.map((entry) => answerOnItsOwn(provider, entry)))
}

function windowMs(env: Env): number {
  const parsed = Number(env[AI_LIVE_BATCH_WINDOW_ENV])
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2_000
}

async function flush(provider: AiProvider): Promise<void> {
  const queue = queues.get(provider)
  if (!queue) return
  const entries = queue.entries
  queues.delete(provider)
  if (!entries.length || !provider.completeBatch) return
  counts.batches += 1
  const waitMs = aiLiveBatchWaitMs(queue.env)
  let results: Array<AiResult | Error>
  try {
    results = await provider.completeBatch(
      entries.map((entry) => entry.request),
      { timeoutMs: waitMs },
    )
  } catch (error) {
    for (const entry of entries) entry.reject(error)
    return
  }
  const left: Queued[] = []
  entries.forEach((entry, index) => {
    const result = results[index]
    if (result instanceof AiBatchUnfinishedError) left.push(entry)
    else if (result instanceof Error || !result) entry.reject(result ?? new Error('the batch returned no result'))
    else {
      counts.requests += 1
      entry.resolve(result)
    }
  })
  if (left.length) await finishOnTheirOwn(provider, left, entries.length, waitMs)
}

/** One request as an entry of the next batch to `provider`. */
export function aiCompleteInBatch(
  provider: AiProvider,
  request: AiProviderRequest,
  env: Env = process.env,
): Promise<AiResult> {
  if (!provider.completeBatch) return provider.complete(request)
  return new Promise<AiResult>((resolve, reject) => {
    const queue = queues.get(provider) ?? { entries: [], timer: null, env }
    queues.set(provider, queue)
    queue.entries.push({ request, resolve, reject })
    if (queue.timer) clearTimeout(queue.timer)
    queue.timer = setTimeout(() => void flush(provider), windowMs(env))
  })
}
