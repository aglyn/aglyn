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

import { aiBuildItemDelivered, type AiBuildUnit } from '../model/ai-build-job'
import type { AiJobItemLedger, AiJobOutput } from '../model/ai-jobs.types'
import { AiUpstreamError } from '../runtime/ai-runtime'
import type { AiSiteBuiltRef } from './ai-job-site-step'
import type { AiJobItemOutcome, AiJobStepOutcome } from './ai-job-text-step'

/**
 * One delegated unit's pass as an ITEM of a job settled item by item
 * (AGL-3616) — a `build`, and a site scaffold, which is the build's preset.
 * The runner's spend is the pass's; what the runner came to is the item's
 * row: still running, built (or built without something that failed),
 * failed on our side, or failed on the model's or the workspace's.
 *
 * Shared by both steps, and importing neither, so neither imports the other.
 */

/** What a unit says when it finished without reporting anything. */
export const AI_BUILD_UNIT_EMPTY_COPY = 'It could not be built this time.'

/** What a unit's model declining the request says. */
export const AI_BUILD_UNIT_REFUSED_COPY = 'The AI declined to build this one.'

/** A runner's outcome narrowed to its spend: no plan, no review, nothing the delegating job keeps. */
export function aiUnitSpend(outcome: AiJobStepOutcome): AiJobStepOutcome {
  return {
    outputs: outcome.outputs,
    usage: outcome.usage,
    estCostUsd: outcome.estCostUsd,
    model: outcome.model,
    stopReason: outcome.stopReason,
    ...(outcome.effort ? { effort: outcome.effort } : {}),
  }
}

/**
 * What a runner's outcome comes to for its item; `null` when the unit
 * reported what it built and the caller decides whether that counts.
 */
export function aiUnitFailure(slot: string, outcome: AiJobStepOutcome): AiJobItemOutcome | null {
  const outputs = outcome.outputs.map((output) => output.id)
  if (outcome.refused) {
    return { slot, status: 'failed', failure: { ours: false, reason: 'refused', message: AI_BUILD_UNIT_REFUSED_COPY }, outputs }
  }
  if (outcome.review) {
    // A building rule still broken after its re-ask is ours (AGL-3596); a
    // site at an allowance is the workspace's to change.
    const ours = outcome.review.reason === 'doctrine'
    return {
      slot,
      status: 'failed',
      failure: { ours, reason: ours ? 'doctrine-refused' : 'review', message: outcome.review.message || AI_BUILD_UNIT_EMPTY_COPY },
      outputs,
    }
  }
  if (outcome.failure) {
    return { slot, status: 'failed', failure: { ours: true, reason: 'step-failure', message: outcome.failure }, outputs }
  }
  if (outcome.continue) return { slot, status: 'running', outputs }
  if (!outcome.outputs.length) {
    return { slot, status: 'failed', failure: { ours: true, reason: 'step-failure', message: AI_BUILD_UNIT_EMPTY_COPY } }
  }
  return null
}

/**
 * Whether an error a unit's runner threw is the machine's to retry — a
 * provider that will answer later, or a budget that ended — rather than this
 * item's failure.
 */
export function aiUnitErrorRetryable(error: unknown): boolean {
  if (error instanceof AiUpstreamError && error.retryable) return true
  const name = (error as { name?: string } | null)?.name
  return name === 'AbortError' || name === 'TimeoutError'
}

/**
 * What the build has created that a later unit can name: each delivered
 * creation's record, by its plan name. A creation's first output is the
 * record it wrote.
 */
export function aiBuildBuiltRefs(
  units: readonly AiBuildUnit[],
  ledger: readonly AiJobItemLedger[],
  outputs: readonly Pick<AiJobOutput, 'id' | 'label'>[],
): Map<string, AiSiteBuiltRef> {
  const rows = new Map(ledger.map((row) => [row.slot, row]))
  const built = new Map<string, AiSiteBuiltRef>()
  for (const unit of units) {
    const creation = unit.creation
    const row = rows.get(unit.slot)
    if (!creation || !row || !aiBuildItemDelivered(row) || !row.outputs.length) continue
    if (creation.kind !== 'layout' && creation.kind !== 'form' && creation.kind !== 'component') continue
    const id = row.outputs[0]
    const label = outputs.find((output) => output.id === id)?.label || creation.name
    built.set(creation.name.toLowerCase(), { id, label, kind: creation.kind })
  }
  return built
}
