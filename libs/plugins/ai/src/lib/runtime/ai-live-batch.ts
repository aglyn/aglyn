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

import type { AiProvider, AiProviderRequest, AiResult } from '../providers/contract'
import type { AiDevEnv as Env } from './ai-dev-env'

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
 */

/** How long the queue waits for one more request before it sends the batch. */
export const AI_LIVE_BATCH_WINDOW_ENV = 'AGLYN_LIVE_AI_BATCH_WINDOW_MS'


interface Queued {
  request: AiProviderRequest
  resolve: (result: AiResult) => void
  reject: (error: unknown) => void
}

const queues = new Map<AiProvider, { entries: Queued[]; timer: ReturnType<typeof setTimeout> | null }>()

/** How many batches this process has sent, and how many requests rode in them. */
const counts = { batches: 0, requests: 0 }

export function aiLiveBatchStats(): { batches: number; requests: number } {
  return { ...counts }
}

export function resetAiLiveBatchStats(): void {
  counts.batches = 0
  counts.requests = 0
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
  counts.requests += entries.length
  try {
    const results = await provider.completeBatch(entries.map((entry) => entry.request))
    entries.forEach((entry, index) => {
      const result = results[index]
      if (result instanceof Error || !result) entry.reject(result ?? new Error('the batch returned no result'))
      else entry.resolve(result)
    })
  } catch (error) {
    for (const entry of entries) entry.reject(error)
  }
}

/** One request as an entry of the next batch to `provider`. */
export function aiCompleteInBatch(
  provider: AiProvider,
  request: AiProviderRequest,
  env: Env = process.env,
): Promise<AiResult> {
  if (!provider.completeBatch) return provider.complete(request)
  return new Promise<AiResult>((resolve, reject) => {
    const queue = queues.get(provider) ?? { entries: [], timer: null }
    queues.set(provider, queue)
    queue.entries.push({ request, resolve, reject })
    if (queue.timer) clearTimeout(queue.timer)
    queue.timer = setTimeout(() => void flush(provider), windowMs(env))
  })
}
