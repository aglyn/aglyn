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

import { AI_JOB_TERMINAL_STATUSES, type AiJob } from '../model/ai-jobs.types'

/**
 * Canceling a job mid-step (AGL-3616).
 *
 * The cancel door writes `cancelRequested` in a transaction. A job no step
 * holds ends `canceled` in that same write. A job whose step holds a live
 * lease is stopped by the runner that holds it: the machine watches the job
 * while the step runs ({@link watchAiJobCancel}) and aborts the step's
 * signal with an {@link AiJobCanceledError}. Every provider call already
 * takes that signal, so a call in flight ends and a call not yet started
 * never starts; a step about to write a draft or publish a site asks
 * {@link throwIfAiJobCanceled} first. The machine's next write then ends the
 * job `canceled`, never `failed`.
 */

/** How often a running step re-reads its job for a cancel. */
export const AI_JOB_CANCEL_POLL_MS = 3_000

/** What an item a cancel stopped before says on its row. */
export const AI_JOB_CANCELED_ITEM_NOTE = 'Not built: the job was canceled before it reached this.'

/**
 * The reason a canceled step's signal is aborted with. Named `AbortError`,
 * as `fetch` names an abort, so every path that already treats an abort as
 * "the provider was never heard from" treats a cancel the same way; the
 * machine tells the two apart by {@link isAiJobCanceledError}.
 */
export class AiJobCanceledError extends Error {
  override readonly name = 'AbortError'
  readonly aiJobCanceled = true
  constructor() {
    super('The AI job was canceled.')
  }
}

export function isAiJobCanceledError(error: unknown): boolean {
  return (error as { aiJobCanceled?: unknown } | null)?.aiJobCanceled === true
}

/**
 * Stops a step before a write once its job was canceled: throws the cancel
 * when the step's signal was aborted by one. A budget that ran out is not a
 * cancel and lets the write through, as it always has.
 */
export function throwIfAiJobCanceled(signal?: AbortSignal | null): void {
  if (signal?.aborted && isAiJobCanceledError(signal.reason)) throw signal.reason
}

/** A cancel was asked of a job that has not ended yet. */
export function aiJobCancelPending(job: Pick<AiJob, 'status' | 'cancelRequested'>): boolean {
  return Boolean(job.cancelRequested) && !AI_JOB_TERMINAL_STATUSES.includes(job.status)
}

/**
 * Aborts `controller` with an {@link AiJobCanceledError} once `read` finds
 * the job canceled or asked to cancel, polling every `pollMs`. Returns the
 * stop for the caller's `finally`. A read that fails is skipped: the watch
 * is a way to stop sooner, never a reason for a step to fail.
 */
export function watchAiJobCancel(
  read: () => Promise<Pick<AiJob, 'status' | 'cancelRequested'> | null>,
  controller: AbortController,
  pollMs = AI_JOB_CANCEL_POLL_MS,
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const tick = async () => {
    if (stopped || controller.signal.aborted) return
    const job = await read().catch(() => null)
    if (stopped || controller.signal.aborted) return
    if (job && (job.status === 'canceled' || aiJobCancelPending(job))) {
      controller.abort(new AiJobCanceledError())
      return
    }
    schedule()
  }
  const schedule = () => {
    timer = setTimeout(() => void tick(), pollMs)
    ;(timer as { unref?: () => void }).unref?.()
  }
  schedule()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}

/** Whether a step's signal was aborted by its job's cancel (not by its budget). */
export function aiJobCanceledBy(signal?: AbortSignal | null): boolean {
  return Boolean(signal?.aborted && isAiJobCanceledError(signal.reason))
}

/**
 * Whether a person has canceled the job, read fresh (AGL-3616): asked right
 * before a step does something it cannot take back — putting a site live —
 * because the running step's watch only looks every few seconds. A read
 * that fails answers no: the cancel is still caught by the machine's next
 * write.
 */
export async function aiJobCancelAsked(
  firestore: FirebaseFirestore.Firestore,
  job: Pick<AiJob, '$id' | 'orgId'>,
  signal?: AbortSignal | null,
): Promise<boolean> {
  if (aiJobCanceledBy(signal)) return true
  try {
    const snapshot = await firestore.collection('orgs').doc(job.orgId).collection('aiJobs').doc(job.$id).get()
    const stored = snapshot.exists ? (snapshot.data() as Pick<AiJob, 'status' | 'cancelRequested'>) : null
    return Boolean(stored && (stored.status === 'canceled' || aiJobCancelPending(stored)))
  } catch {
    return false
  }
}
